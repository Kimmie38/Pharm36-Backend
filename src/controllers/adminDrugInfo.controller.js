const DrugInfo = require('../models/DrugInfo');
const AppError = require('../utils/AppError');
const { escapeRegex } = require('../utils/regex');
const { loadEntry } = require('../services/drugInfo');

async function list(req, res) {
  const { search, reviewed, status, page, limit } = req.valid.query;
  const filter = {};
  if (reviewed !== undefined) filter.reviewed = reviewed;
  if (status) filter.status = status;
  if (search) filter.key = { $regex: escapeRegex(search), $options: 'i' };
  const [items, total] = await Promise.all([
    DrugInfo.find(filter).select('-sections').sort({ reviewed: 1, updatedAt: -1 }).skip((page - 1) * limit).limit(limit),
    DrugInfo.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
}

async function getOne(req, res) {
  const doc = await DrugInfo.findById(req.valid.params.id);
  if (!doc) throw new AppError(404, 'Entry not found');
  res.json({ entry: doc });
}

// PATCH: correct fields (override) and/or mark reviewed. `override: null` clears all corrections.
async function update(req, res) {
  const { override, reviewed } = req.valid.body;
  const doc = await DrugInfo.findById(req.valid.params.id);
  if (!doc) throw new AppError(404, 'Entry not found');
  if (override !== undefined) doc.override = override === null ? undefined : { ...(doc.override || {}), ...override };
  if (reviewed !== undefined) {
    doc.reviewed = reviewed;
    doc.reviewedBy = reviewed ? req.user._id : undefined;
    doc.reviewedAt = reviewed ? new Date() : undefined;
  }
  doc.markModified('override');
  await doc.save();
  res.json({ entry: doc });
}

// Re-fetch the label and rebuild the summary (human corrections and review state are kept).
async function refresh(req, res) {
  const doc = await DrugInfo.findById(req.valid.params.id);
  if (!doc) throw new AppError(404, 'Entry not found');
  const name = doc.ingredients.join('/');
  const entry = await loadEntry({ name }, { refresh: true });
  res.json({ entry: entry.doc || null });
}

module.exports = { list, getOne, update, refresh };
