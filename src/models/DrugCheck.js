const mongoose = require('mongoose');

// Anonymous log of consumer scans/searches (analytics + spotting unregistered batches being checked a lot).
const drugCheckSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['scan', 'search'], default: 'scan' },
    query: { type: String, index: true },
    found: Boolean,
    verified: Boolean,
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
drugCheckSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 }); // keep 180 days

module.exports = mongoose.model('DrugCheck', drugCheckSchema);
