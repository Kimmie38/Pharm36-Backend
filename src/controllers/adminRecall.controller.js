const Recall = require('../models/Recall');
const Batch = require('../models/Batch');
const Notification = require('../models/Notification');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { requireAllScope } = require('./admin.controller');
const { sendExpoPush } = require('../services/notify');

// POST /api/admin/recalls  -> flags the batch code for consumers and alerts every professional holding it
async function create(req, res) {
  requireAllScope(req.user);
  const b = req.valid.body;
  const existing = await Recall.findOne({ batchCode: b.batchCode, active: true });
  if (existing) throw new AppError(409, 'This batch code already has an active recall');

  const holders = await Batch.find({ batchCode: b.batchCode, state: 'active' });
  const recall = await Recall.create({ ...b, drugName: b.drugName || holders[0]?.drugName, issuedBy: req.user._id });

  let notified = 0;
  for (const batch of holders) {
    const title = 'RECALL: stop selling this batch';
    const body = `${batch.drugName} (batch ${batch.batchCode}) has been recalled. ${b.reason}`.slice(0, 280);
    const r = await Notification.updateOne(
      { user: batch.owner, batch: batch._id, kind: 'recall' },
      { $setOnInsert: { title, body } },
      { upsert: true }
    );
    if (!r.upsertedCount) continue;
    notified += 1;
    const owner = await User.findById(batch.owner).select('expoPushToken settings');
    if (owner?.settings?.pushEnabled && owner.expoPushToken) {
      await sendExpoPush(owner.expoPushToken, title, body, { batchId: String(batch._id), kind: 'recall' });
    }
  }
  recall.notified = notified;
  await recall.save();
  res.status(201).json({ recall, holdersFound: holders.length, notified });
}

async function list(req, res) {
  requireAllScope(req.user);
  const { active, page, limit } = req.valid.query;
  const filter = active === undefined ? {} : { active };
  const [items, total] = await Promise.all([
    Recall.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Recall.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
}

async function lift(req, res) {
  requireAllScope(req.user);
  const r = await Recall.findByIdAndUpdate(req.valid.params.id, { active: false, liftedAt: new Date() }, { returnDocument: 'after' });
  if (!r) throw new AppError(404, 'Recall not found');
  res.json({ recall: r });
}

module.exports = { create, list, lift };
