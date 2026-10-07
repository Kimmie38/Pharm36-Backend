const mongoose = require('mongoose');
const jsonPlugin = require('./plugins');

// "Report a problem with this drug" (consumer app) — reviewed in the admin portal.
const reportSchema = new mongoose.Schema(
  {
    batchCode: { type: String, trim: true, index: true },
    drugName: { type: String, trim: true },
    reason: { type: String, enum: ['suspected_fake', 'expired', 'damaged_seal', 'wrong_info', 'unregistered_seller', 'other'], default: 'other' },
    description: { type: String, trim: true, maxlength: 2000 },
    sellerInfo: { type: String, trim: true, maxlength: 300 },
    location: { type: String, trim: true, maxlength: 200 },
    contact: { type: String, trim: true, maxlength: 120 },
    status: { type: String, enum: ['new', 'reviewing', 'resolved', 'dismissed'], default: 'new', index: true },
    adminNote: String,
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

jsonPlugin(reportSchema);
module.exports = mongoose.model('Report', reportSchema);
