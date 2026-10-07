const mongoose = require('mongoose');
const jsonPlugin = require('./plugins');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
    kind: { type: String, enum: ['reminder', 'expiring_1m', 'expiring_2w', 'expired', 'system'], required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// one notification per batch per kind -> the daily scan can safely re-run
notificationSchema.index(
  { user: 1, batch: 1, kind: 1 },
  { unique: true, partialFilterExpression: { batch: { $exists: true } } }
);
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

jsonPlugin(notificationSchema);
module.exports = mongoose.model('Notification', notificationSchema);
