const mongoose = require('mongoose');
const jsonPlugin = require('./plugins');

const saleSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
    drugName: { type: String, required: true },
    batchCode: String,
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    revenue: { type: Number, required: true, min: 0 },
    channel: { type: String, enum: ['direct', 'marketplace'], default: 'direct' },
    soldAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

saleSchema.index({ owner: 1, soldAt: -1 });

jsonPlugin(saleSchema);
module.exports = mongoose.model('SaleRecord', saleSchema);
