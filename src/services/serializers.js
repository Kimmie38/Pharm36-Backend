const { professionalTypes, drugCategories, sectionLabel } = require('../constants/professions');
const { canAddCategory, effectiveSections } = require('../constants/permissions');

// Shape expected by ProfileScreen / HomeScreen (mirrors pharmacistProfile in mockData.js).
function serializeUser(user) {
  const u = user.toJSON();
  if (user.role === 'admin') return u;
  const profession = professionalTypes[user.professionalType];
  const held = effectiveSections(user);
  return {
    ...u,
    profession: profession && {
      key: profession.key, label: profession.label, council: profession.council, councilShort: profession.councilShort,
    },
    sectionDetails: (profession ? profession.sections : []).map((s) => ({
      ...s,
      claimed: user.sections.includes(s.key),
      verified: user.verifiedSections.includes(s.key),
    })),
    categories: drugCategories.map((c) => ({
      key: c.key,
      label: c.label,
      requiredSections: c.requiredSections,
      requiredSectionLabels: c.requiredSections.map(sectionLabel),
      allowed: canAddCategory(user, c.key),
    })),
    activeSections: held,
  };
}

// Compact public view of a seller/pharmacy
const sellerLabel = (u) => (u ? `${u.storeName || u.name}${u.state ? `, ${u.state}` : ''}` : 'Unknown seller');

module.exports = { serializeUser, sellerLabel };
