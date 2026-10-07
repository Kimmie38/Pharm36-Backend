const mongoose = require('mongoose');
const jsonPlugin = require('./plugins');
const { drugCategories, expiryBuckets } = require('../constants/professions');
const { daysUntil, statusFromDays } = require('../utils/dates');

const batchSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    drugName: { type: String, required: true, trim: true },
    category: { type: String, enum: drugCategories.map((c) => c.key), default: 'general' },
    batchCode: { type: String, required: true, trim: true },
    manufacturer: { type: String, trim: true },
    strength: { type: String, trim: true },
    form: { type: String, trim: true },
    manufactureDate: Date,
    expiryDate: { type: Date, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, default: 0, min: 0 },
    reminder: { type: String, enum: [...expiryBuckets, null], default: null },
    state: { type: String, enum: ['active', 'sold', 'disposed'], default: 'active' },
    closedAt: Date,
    disposalReason: String,
    source: { type: String, enum: ['manual', 'marketplace'], default: 'manual' },
  },
  { timestamps: true }
);

// One ACTIVE record per (owner, batchCode); closed ones don't block re-adding the same code later.
batchSchema.index(
  { owner: 1, batchCode: 1 },
  { unique: true, partialFilterExpression: { state: 'active' } }
);
batchSchema.index({ batchCode: 1, state: 1 }); // public verification lookups
batchSchema.index({ drugName: 1, state: 1 }); // public name search
batchSchema.index({ owner: 1, state: 1, expiryDate: 1 }); // inventory / expiry lists

batchSchema.virtual('daysToExpiry').get(function () {
  return this.expiryDate ? daysUntil(this.expiryDate) : null;
});
batchSchema.virtual('status').get(function () {
  return this.expiryDate ? statusFromDays(daysUntil(this.expiryDate)) : null;
});
batchSchema.virtual('totalValue').get(function () {
  return (this.quantity || 0) * (this.unitPrice || 0);
});

jsonPlugin(batchSchema);

module.exports = mongoose.model('Batch', batchSchema);
