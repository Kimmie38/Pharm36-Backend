const mongoose = require('mongoose');

const aiInteractionSchema = new mongoose.Schema(
  {
    drugKey: { type: String, required: true, trim: true, maxlength: 180, index: true },
    drugName: { type: String, required: true, trim: true, maxlength: 150, index: true },
    question: { type: String, required: true, trim: true, maxlength: 300 },
    answer: { type: String, default: '', trim: true, maxlength: 1200 },
    responseStatus: { type: String, enum: ['answered', 'emergency', 'ungrounded', 'unavailable'], required: true, index: true },
    model: { type: String, trim: true, maxlength: 120 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

aiInteractionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
aiInteractionSchema.index({ createdAt: -1, drugName: 1 });

module.exports = mongoose.model('AIInteraction', aiInteractionSchema);
