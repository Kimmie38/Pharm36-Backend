const mongoose = require('mongoose');
const jsonPlugin = require('./plugins');

// A regulator-issued recall for one batch code. While active, consumers see "recalled" and holders are alerted.
const recallSchema = new mongoose.Schema(
  {
    batchCode: { type: String, required: true, trim: true, index: true },
    drugName: { type: String, trim: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    nafdacRef: { type: String, trim: true, maxlength: 60 },
    severity: { type: String, enum: ['class1', 'class2', 'class3'], default: 'class2' },
    active: { type: Boolean, default: true, index: true },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    liftedAt: Date,
    notified: { type: Number, default: 0 },
  },
  { timestamps: true }
);

jsonPlugin(recallSchema);
module.exports = mongoose.model('Recall', recallSchema);
