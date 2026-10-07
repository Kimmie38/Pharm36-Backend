const router = require('express').Router();
const { professionalTypes, drugCategories, expiryBuckets, NIGERIAN_STATES } = require('../constants/professions');

// Public, static reference data. The app can use this instead of hard-coding mockData.js lists.
router.get('/', (_req, res) => {
  res.json({ professionalTypes, drugCategories, expiryBuckets, states: NIGERIAN_STATES });
});

module.exports = router;
