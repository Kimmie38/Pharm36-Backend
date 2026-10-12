const mongoose = require('mongoose');

const aiSettingsSchema = new mongoose.Schema(
  {
    scope: { type: String, enum: ['global'], default: 'global', unique: true },
    enabled: { type: Boolean, default: false },
    summaryModel: { type: String, trim: true, maxlength: 120 },
    askModel: { type: String, trim: true, maxlength: 120 },
    askPerMinute: { type: Number, min: 1, max: 60, default: 6 },
    askPerDay: { type: Number, min: 1, max: 1000, default: 40 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AISettings', aiSettingsSchema);
