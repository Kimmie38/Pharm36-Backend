const AIInteraction = require('../models/AIInteraction');
const AppError = require('../utils/AppError');
const { escapeRegex } = require('../utils/regex');
const { getAiSettings, updateAiSettings } = require('../services/aiSettings');

function requireAllScope(admin) {
  if (admin?.council !== 'ALL') throw new AppError(403, 'Global AI oversight requires an ALL-scope administrator');
}

async function listHistory(req, res) {
  requireAllScope(req.user);
  const { search, status, from, to, page, limit } = req.valid.query;
  const filter = { expiresAt: { $gt: new Date() } };
  if (status) filter.responseStatus = status;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lt = new Date(to.getTime() + 24 * 60 * 60 * 1000);
  }
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ drugKey: rx }, { drugName: rx }, { question: rx }, { answer: rx }];
  }
  const [items, total] = await Promise.all([
    AIInteraction.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AIInteraction.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit, retentionDays: 90 });
}

async function getSettings(req, res) {
  requireAllScope(req.user);
  const settings = await getAiSettings({ force: true });
  res.json({ settings, scope: 'global', secrets: { providerKeyConfigured: settings.providerConfigured, providerKeyValueReturned: false } });
}

async function patchSettings(req, res) {
  requireAllScope(req.user);
  const settings = await updateAiSettings(req.user, req.valid.body);
  res.json({ settings, scope: 'global', secrets: { providerKeyConfigured: settings.providerConfigured, providerKeyValueReturned: false } });
}

async function deleteHistory(req, res) {
  requireAllScope(req.user);
  if (req.valid.body.confirmation !== 'DELETE') throw new AppError(400, 'Type DELETE to confirm permanent removal');
  const result = await AIInteraction.deleteOne({ _id: req.valid.params.id });
  if (!result.deletedCount) throw new AppError(404, 'AI history record not found or already expired');
  res.json({ deleted: 1, message: 'AI history record permanently deleted' });
}

module.exports = { listHistory, getSettings, patchSettings, deleteHistory };
