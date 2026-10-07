const mongoose = require('mongoose');
const jsonPlugin = require('./plugins');

const orderSchema = new mongoose.Schema(
  {
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    drugName: String,
    batchCode: String,
    quantity: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    total: { type: Number, required: true },
  },
  { timestamps: true }
);

jsonPlugin(orderSchema);
module.exports = mongoose.model('MarketplaceOrder', orderSchema);
