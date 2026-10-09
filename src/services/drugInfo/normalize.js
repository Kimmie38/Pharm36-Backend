const { SYNONYMS, COMBOS } = require('./synonyms');

const FORM_WORDS = {
  tablet: 'oral', tablets: 'oral', tab: 'oral', tabs: 'oral', capsule: 'oral', capsules: 'oral', cap: 'oral', caps: 'oral',
  syrup: 'oral', suspension: 'oral', susp: 'oral', sachet: 'oral', powder: 'oral',
  drops: 'other', solution: 'other', suppository: 'other', pessary: 'other',
  injection: 'injectable', inj: 'injectable', infusion: 'injectable',
  cream: 'topical', ointment: 'topical', gel: 'topical', lotion: 'topical',
  inhaler: 'inhaled',
};
const NOISE = new Set(['effervescent', 'dispersible', 'chewable', 'soluble', 'coated', 'film-coated', 'forte', 'extra', 'oral', 'paediatric', 'pediatric', 'adult', 'for', 'the', 'bp', 'usp', 'ip']);
const STRENGTH_RE = /\b\d+(?:\.\d+)?\s?(?:mg|mcg|µg|ug|g|ml|iu|%)(?:\s?\/\s?\d*\.?\d*\s?(?:mg|mcg|g|ml|l))?/gi;

function splitIngredients(text) {
  let t = text.trim();
  if (COMBOS[t]) return COMBOS[t];
  let parts = t.split(/\s*(?:\/|\+|&|,|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
  // "artesunate-amodiaquine" style (but not "co-trimoxazole", handled above)
  if (parts.length === 1 && /^[a-z]{4,}-[a-z]{4,}$/.test(parts[0]) && !SYNONYMS[parts[0]]) parts = parts[0].split('-');
  return parts.flatMap((p) => COMBOS[p] || [p]);
}

// "Amoxicillin 500mg" -> { ingredients:['amoxicillin'], strength:'500mg', form:null, formGroup:'any', key:'amoxicillin|any' }
// "Paracetamol 500mg Tablets" -> ingredients:['acetaminophen']
// "Augmentin (amoxicillin/clavulanate) 625mg" -> ['amoxicillin','clavulanate']
function normalizeDrugName(raw, hints = {}) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.toLowerCase().replace(/\s+/g, ' ').trim();

  const paren = s.match(/\(([^)]+)\)/);
  const strengthMatches = s.match(STRENGTH_RE) || [];
  const strength = hints.strength || strengthMatches.map((m) => m.replace(/\s+/g, '')).join(' ') || null;

  let form = hints.form ? String(hints.form).toLowerCase() : null;
  let body = paren && !/\d/.test(paren[1]) ? paren[1] : s.replace(/\([^)]*\)/g, ' ');
  body = body.replace(STRENGTH_RE, ' ');

  const words = body.split(/[^a-z0-9\-\/+&,\s]/).join(' ').split(/\s+/).filter(Boolean);
  const kept = [];
  for (const w of words) {
    if (FORM_WORDS[w]) { form = form || w; continue; }
    if (NOISE.has(w)) continue;
    kept.push(w);
  }
  body = kept.join(' ').replace(/\s*[\/+&,]\s*/g, '/').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!body) return null;

  // multi-word synonyms ("vitamin c") before splitting
  let ingredients = splitIngredients(SYNONYMS[body] ? SYNONYMS[body] : body).map((i) => SYNONYMS[i] || i);
  ingredients = [...new Set(ingredients.map((i) => i.trim()).filter((i) => i.length >= 3))].sort();
  if (!ingredients.length) return null;

  const formGroup = (form && FORM_WORDS[form.split(' ')[0]]) || 'any';
  return { ingredients, strength, form, formGroup, key: `${ingredients.join('+')}|${formGroup}` };
}

module.exports = { normalizeDrugName };
