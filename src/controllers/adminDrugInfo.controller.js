const DrugInfo = require('../models/DrugInfo');
const AppError = require('../utils/AppError');
const { escapeRegex } = require('../utils/regex');
const { loadEntry } = require('../services/drugInfo');

function requireAllScope(admin) {
  if (admin?.council !== 'ALL') throw new AppError(403, 'Global drug-label review requires an ALL-scope administrator');
}

async function list(req, res) {
  requireAllScope(req.user);
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
  requireAllScope(req.user);
  const doc = await DrugInfo.findById(req.valid.params.id);
  if (!doc) throw new AppError(404, 'Entry not found');
  res.json({ entry: doc });
}

// PATCH: correct fields (override) and/or mark reviewed. `override: null` clears all corrections.
async function update(req, res) {
  requireAllScope(req.user);
  const { override, reviewed } = req.valid.body;
  if (override !== undefined && reviewed === true) throw new AppError(400, 'Save a correction first, then mark it reviewed in a separate action');
  const doc = await DrugInfo.findById(req.valid.params.id);
  if (!doc) throw new AppError(404, 'Entry not found');
  if (override !== undefined) {
    doc.override = override === null ? undefined : { ...(doc.override || {}), ...override };
    doc.reviewed = false;
    doc.reviewedBy = null;
    doc.reviewedAt = null;
  } else if (reviewed !== undefined) {
    doc.reviewed = reviewed;
    doc.reviewedBy = reviewed ? req.user._id : null;
    doc.reviewedAt = reviewed ? new Date() : null;
  }
  doc.markModified('override');
  await doc.save();
  res.json({ entry: doc });
}

// Re-fetch the label and rebuild the excerpts (keep corrections but reset review until they are checked against the refreshed source).
async function refresh(req, res) {
  requireAllScope(req.user);
  const doc = await DrugInfo.findById(req.valid.params.id);
  if (!doc) throw new AppError(404, 'Entry not found');
  const name = doc.ingredients.join('/');
  const entry = await loadEntry({ name }, { refresh: true });
  res.json({ entry: entry.doc || null });
}

module.exports = { list, getOne, update, refresh };
