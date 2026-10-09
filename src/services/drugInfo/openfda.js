// openFDA drug label API (official FDA-approved labelling, free):  https://open.fda.gov/apis/drug/label/
const BASE = 'https://api.fda.gov/drug/label.json';
const defaultFetch = (...a) => globalThis.fetch(...a);

const first = (v) => (Array.isArray(v) ? v[0] : v);
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function buildUrl(field, ingredients, { apiKey, limit }) {
  const parts = ingredients.map((i) => `openfda.${field}:${encodeURIComponent(`"${i}"`)}`);
  return `${BASE}?search=${parts.join('+AND+')}&limit=${limit}${apiKey ? `&api_key=${apiKey}` : ''}`;
}

async function query(url, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (res.status === 404) return []; // openFDA answers 404 when nothing matches
    if (!res.ok) throw new Error(`openFDA responded ${res.status}`);
    const body = await res.json();
    return Array.isArray(body.results) ? body.results : [];
  } finally {
    clearTimeout(timer);
  }
}

async function searchLabels(ingredients, { fetchImpl = defaultFetch, apiKey, limit = 25, timeoutMs = 9000 } = {}) {
  let results = await query(buildUrl('generic_name', ingredients, { apiKey, limit }), fetchImpl, timeoutMs);
  if (!results.length) results = await query(buildUrl('substance_name', ingredients, { apiKey, limit }), fetchImpl, timeoutMs);
  return results;
}

const KEY_SECTIONS = ['indications_and_usage', 'dosage_and_administration', 'adverse_reactions', 'contraindications'];

function pickBestLabel(results, { ingredients, category, formGroup }) {
  let best = null;
  for (const r of results) {
    const o = r.openfda || {};
    const substanceCount = (o.substance_name || []).length || ingredients.length;
    let score = -100 * Math.abs(substanceCount - ingredients.length); // single-ingredient request shouldn't get a combo label
    score += KEY_SECTIONS.filter((k) => r[k]).length * 10;
    if (r.warnings || r.warnings_and_cautions) score += 5;
    const type = (first(o.product_type) || '').toUpperCase();
    if (category === 'general' && type.includes('OTC')) score += 15;
    if (category === 'prescription' && type.includes('PRESCRIPTION')) score += 15;
    const routes = (o.route || []).map((x) => x.toUpperCase());
    if (formGroup === 'oral' || formGroup === 'any') {
      if (routes.includes('ORAL')) score += 8;
      else if (routes.length) score -= 20;
    } else if (formGroup === 'topical' && routes.includes('TOPICAL')) score += 8;
    else if (formGroup === 'injectable' && routes.some((x) => /INTRA|SUBCUT/.test(x))) score += 8;
    score += Number(r.effective_time || 0) / 1e7; // tie-break: newest label
    if (!best || score > best.score) best = { score, label: r };
  }
  return best && best.score > -50 ? best.label : null;
}

const clean = (v) =>
  arr(v).join('\n').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

const join = (...vs) => vs.map(clean).filter(Boolean).join('\n\n');

// Normalised section texts we feed to the AI (and keep as verbatim excerpts for the app)
function extractSections(label) {
  return {
    indications: join(label.indications_and_usage, label.purpose),
    dosage: join(label.dosage_and_administration),
    pediatric: join(label.pediatric_use),
    adverseReactions: join(label.adverse_reactions),
    warnings: join(label.boxed_warning, label.warnings_and_cautions, label.warnings),
    contraindications: join(label.contraindications, label.do_not_use),
    stopAndAsk: join(label.stop_use, label.ask_doctor, label.ask_doctor_or_pharmacist, label.when_using),
    interactions: join(label.drug_interactions),
    pregnancy: join(label.pregnancy, label.nursing_mothers, label.lactation, label.pregnancy_or_breast_feeding),
    overdose: join(label.overdosage),
    storage: join(label.storage_and_handling, label.how_supplied),
    activeIngredient: join(label.active_ingredient),
  };
}

function labelMeta(label) {
  const o = label.openfda || {};
  const t = String(label.effective_time || '');
  return {
    setId: label.set_id,
    effectiveDate: t.length === 8 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : null,
    brandNames: (o.brand_name || []).slice(0, 8),
    genericNames: (o.generic_name || []).slice(0, 4),
    manufacturer: first(o.manufacturer_name) || null,
    route: o.route || [],
    productType: first(o.product_type) || null,
    url: label.set_id ? `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${label.set_id}` : null,
  };
}

module.exports = { searchLabels, pickBestLabel, extractSections, labelMeta, buildUrl };
