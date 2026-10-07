const Batch = require('../models/Batch');
const SaleRecord = require('../models/SaleRecord');
const Notification = require('../models/Notification');
const { todayUTC, addDays } = require('../utils/dates');
const { salesLevels } = require('../services/sales');
const { serializeUser } = require('../services/serializers');

// GET /api/dashboard  -> everything HomeScreen needs in one call
async function dashboard(req, res) {
  const owner = req.user._id;
  const active = { owner, state: 'active' };
  const [totals, expiringCount, levels, unread, recent] = await Promise.all([
    Batch.aggregate([
      { $match: active },
      { $group: { _id: null, batches: { $sum: 1 }, units: { $sum: '$quantity' }, value: { $sum: { $multiply: ['$quantity', '$unitPrice'] } } } },
    ]),
    Batch.countDocuments({ ...active, expiryDate: { $lte: addDays(todayUTC(), 30) } }),
    salesLevels(owner, 30),
    Notification.countDocuments({ user: owner, read: false }),
    Batch.find(active).sort({ createdAt: -1 }).limit(5),
  ]);
  const t = totals[0] || { batches: 0, units: 0, value: 0 };
  res.json({
    professional: serializeUser(req.user),
    totalBatches: t.batches,
    totalUnits: t.units,
    inventoryValue: t.value,
    expiringCount,
    salesLevels: levels,
    unreadNotifications: unread,
    recentBatches: recent,
  });
}

// GET /api/sales?days=30
async function salesSummary(req, res) {
  const days = req.valid.query.days;
  const since = addDays(todayUTC(), -days);
  const [levels, recent] = await Promise.all([
    salesLevels(req.user._id, days),
    SaleRecord.find({ owner: req.user._id, soldAt: { $gte: since } }).sort({ soldAt: -1 }).limit(50),
  ]);
  res.json({
    days,
    totalRevenue: levels.reduce((s, l) => s + l.revenue, 0),
    totalUnits: levels.reduce((s, l) => s + l.unitsSold, 0),
    salesLevels: levels,
    recent,
  });
}

module.exports = { dashboard, salesSummary };
