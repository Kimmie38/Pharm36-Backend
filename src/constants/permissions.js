const env = require('../config/env');
const { getCategory } = require('./professions');

// Sections that currently count for this user (verified-only by default).
function effectiveSections(user) {
  return env.requireSectionVerification ? user.verifiedSections || [] : user.sections || [];
}

function canAddCategory(user, categoryKey) {
  const cat = getCategory(categoryKey);
  if (!cat) return false;
  if (cat.requiredSections.length === 0) return true;
  const held = effectiveSections(user);
  return cat.requiredSections.some((s) => held.includes(s));
}

module.exports = { canAddCategory, effectiveSections };
