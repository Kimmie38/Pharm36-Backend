const mongoose = require('mongoose');
const SaleRecord = require('../models/SaleRecord');
const env = require('../config/env');
const { addDays, todayUTC } = require('../utils/dates');

const levelFor = (revenue) => (revenue >= env.salesLevelHigh ? 'high' : revenue >= env.salesLevelMedium ? 'medium' : 'low');

// Per-drug sales level for the dashboard (mirrors `salesLevels` in mockData.js)
async function salesLevels(ownerId, days = 30) {
  const since = addDays(todayUTC(), -days);
  const rows = await SaleRecord.aggregate([
    { $match: { owner: new mongoose.Types.ObjectId(String(ownerId)), soldAt: { $gte: since } } },
    { $group: { _id: '$drugName', unitsSold: { $sum: '$quantity' }, revenue: { $sum: '$revenue' } } },
    { $sort: { revenue: -1 } },
  ]);
  return rows.map((r) => ({ drugName: r._id, unitsSold: r.unitsSold, revenue: r.revenue, level: levelFor(r.revenue) }));
}

module.exports = { salesLevels, levelFor };
