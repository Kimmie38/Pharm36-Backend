const mongoose = require('mongoose');
const jsonPlugin = require('./plugins');
const { drugCategories } = require('../constants/professions');
const { timeAgo } = require('../utils/dates');

// type "offer"   : a seller lists part/all of one of their batches ("Buy from others" tab)
// type "request" : a pharmacist posts what they're looking for ("Post a request" button)
const listingSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['offer', 'request'], default: 'offer', index: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
    drugName: { type: String, required: true, trim: true },
    category: { type: String, enum: drugCategories.map((c) => c.key), default: 'general' },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 }, // offer price, or max price for a request
    note: { type: String, trim: true, maxlength: 500 },
    // snapshot of the batch at listing time (offers only)
    batchCode: String,
    manufacturer: String,
    strength: String,
    form: String,
    manufactureDate: Date,
    expiryDate: Date,
    status: { type: String, enum: ['open', 'fulfilled', 'cancelled'], default: 'open', index: true },
  },
  { timestamps: true }
);

listingSchema.index({ status: 1, type: 1, createdAt: -1 });
listingSchema.index({ batch: 1, status: 1 });

listingSchema.virtual('postedAgo').get(function () {
  return timeAgo(this.createdAt);
});

jsonPlugin(listingSchema);
module.exports = mongoose.model('Listing', listingSchema);
