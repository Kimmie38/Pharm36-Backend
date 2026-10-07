const Batch = require('../models/Batch');
const SaleRecord = require('../models/SaleRecord');
const Listing = require('../models/Listing');
const AppError = require('../utils/AppError');
const { escapeRegex } = require('../utils/regex');
const { canAddCategory } = require('../constants/permissions');
const { getCategory, sectionLabel, professionalTypes } = require('../constants/professions');
const { todayUTC, addDays, statusRange } = require('../utils/dates');

async function getOwned(req) {
  const batch = await Batch.findOne({ _id: req.valid.params.id, owner: req.user._id });
  if (!batch) throw new AppError(404, 'Batch not found');
  return batch;
}

const isExpired = (batch) => batch.expiryDate < todayUTC();

// Stop any open marketplace offers backed by this batch (it was sold out / disposed).
const cancelOffers = (batchId) => Listing.updateMany({ batch: batchId, status: 'open' }, { status: 'cancelled' });

// GET /api/batches?search=&category=&status=&state=&page=&limit=
async function list(req, res) {
  const { search, category, status, state, page, limit } = req.valid.query;
  const filter = { owner: req.user._id, state };
  if (search) filter.drugName = { $regex: escapeRegex(search), $options: 'i' };
  if (category) filter.category = category;
  if (status) filter.expiryDate = statusRange(status);

  const [items, total] = await Promise.all([
    Batch.find(filter).sort({ expiryDate: 1 }).skip((page - 1) * limit).limit(limit),
    Batch.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
}

// GET /api/batches/expiring  -> everything expired or expiring within 30 days (Expiry Alerts tab)
async function expiring(req, res) {
  const items = await Batch.find({
    owner: req.user._id,
    state: 'active',
    expiryDate: { $lte: addDays(todayUTC(), 30) },
  }).sort({ expiryDate: 1 });
  res.json({ items, total: items.length });
}

async function getOne(req, res) {
  res.json({ batch: await getOwned(req) });
}

async function create(req, res) {
  const b = req.valid.body;

  if (!canAddCategory(req.user, b.category)) {
    const cat = getCategory(b.category);
    const council = professionalTypes[req.user.professionalType].councilShort;
    throw new AppError(
      403,
      `Adding "${cat.label}" requires one of these sections on your account: ${cat.requiredSections.map(sectionLabel).join(' or ')}. Contact ${council} to update your license.`,
      { code: 'CATEGORY_RESTRICTED', category: b.category, requiredSections: cat.requiredSections }
    );
  }
  if (b.manufactureDate && b.expiryDate <= b.manufactureDate) {
    throw new AppError(400, 'Expiry date must be after the manufacture date');
  }

  const exists = await Batch.exists({ owner: req.user._id, batchCode: b.batchCode, state: 'active' });
  if (exists) throw new AppError(409, 'You already have an active batch with this batch code. Update its quantity instead.');

  const batch = await Batch.create({
    ...b,
    owner: req.user._id,
    reminder: b.reminder ?? req.user.settings?.defaultReminder ?? null,
  });
  res.status(201).json({ batch });
}

// Only operational fields are editable; regulatory identity (code, dates, category) is immutable.
async function update(req, res) {
  const batch = await getOwned(req);
  if (batch.state !== 'active') throw new AppError(409, `This batch is already ${batch.state}`);
  Object.assign(batch, req.valid.body);
  await batch.save();
  res.json({ batch });
}

// POST /api/batches/:id/sell  { quantity?, unitPrice? }  (default: all remaining units)
async function sell(req, res) {
  const batch = await getOwned(req);
  if (batch.state !== 'active') throw new AppError(409, `This batch is already ${batch.state}`);
  if (isExpired(batch)) {
    throw new AppError(409, 'Expired drugs cannot be sold. Dispose of this batch instead.', { code: 'EXPIRED_BATCH' });
  }
  const qty = req.valid.body.quantity ?? batch.quantity;
  const price = req.valid.body.unitPrice ?? batch.unitPrice;
  if (qty < 1) throw new AppError(400, 'Nothing to sell');

  // atomic decrement: two simultaneous sales can never oversell
  const updated = await Batch.findOneAndUpdate(
    { _id: batch._id, owner: req.user._id, state: 'active', quantity: { $gte: qty } },
    { $inc: { quantity: -qty } },
    { returnDocument: 'after' }
  );
  if (!updated) throw new AppError(409, `Only ${batch.quantity} unit(s) left in stock`);

  await SaleRecord.create({
    owner: req.user._id, batch: batch._id, drugName: batch.drugName, batchCode: batch.batchCode,
    quantity: qty, unitPrice: price, revenue: qty * price, channel: 'direct',
  });

  if (updated.quantity === 0) {
    updated.state = 'sold';
    updated.closedAt = new Date();
    await updated.save();
    await cancelOffers(updated._id);
  }
  res.json({ batch: updated, sold: { quantity: qty, unitPrice: price, revenue: qty * price } });
}

// POST /api/batches/:id/dispose  { reason? }
async function dispose(req, res) {
  const batch = await getOwned(req);
  if (batch.state !== 'active') throw new AppError(409, `This batch is already ${batch.state}`);
  batch.state = 'disposed';
  batch.closedAt = new Date();
  batch.disposalReason = req.valid.body.reason || (isExpired(batch) ? 'expired' : 'other');
  await batch.save();
  await cancelOffers(batch._id);
  res.json({ batch });
}

module.exports = { list, expiring, getOne, create, update, sell, dispose };
