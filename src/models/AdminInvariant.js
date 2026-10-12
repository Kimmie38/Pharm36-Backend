const mongoose = require('mongoose');

// A single document used as a transactional write-conflict point for changes that
// must preserve at least one cross-council administrator.
const adminInvariantSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'global' },
    revision: { type: Number, default: 0 },
  },
  { versionKey: false, collection: 'admininvariants' }
);

module.exports = mongoose.model('AdminInvariant', adminInvariantSchema);
