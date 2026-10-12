const mongoose = require('mongoose');
const jsonPlugin = require('./plugins');

// Cache of official drug-label material so each drug is fetched and excerpted once, not on every scan.
const drugInfoSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // e.g. "acetaminophen|oral"
    ingredients: [String],
    status: { type: String, enum: ['ok', 'not_found'], required: true },
    label: { type: mongoose.Schema.Types.Mixed }, // setId, effectiveDate, brandNames, manufacturer, url...
    sections: { type: mongoose.Schema.Types.Mixed }, // the (capped) label text the AI saw; also used for Q&A
    info: { type: mongoose.Schema.Types.Mixed }, // structured, grounded summary (may be empty if AI unavailable)
    generatedBy: { type: String, enum: ['ai-summary', 'ai-label-excerpts', 'label-extract', 'curated'] },
    model: String,
    // human oversight: admins can correct fields (override) and mark an entry as reviewed
    override: { type: mongoose.Schema.Types.Mixed },
    reviewed: { type: Boolean, default: false },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    fetchedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);
drugInfoSchema.index({ reviewed: 1, updatedAt: -1 });

jsonPlugin(drugInfoSchema);
module.exports = mongoose.model('DrugInfo', drugInfoSchema);
