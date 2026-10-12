const DrugInfo = require('../../models/DrugInfo');
const env = require('../../config/env');
const { normalizeDrugName } = require('./normalize');
const { searchLabels, pickBestLabel, extractSections, labelMeta } = require('./openfda');
const { summariseLabel, askAboutLabel, capSections, aiSchema, finalizeInfo } = require('./ai');
const { Source } = require('./grounding');
const { getAiSettings } = require('../aiSettings');

const DAY = 24 * 60 * 60 * 1000;

const DISCLAIMERS = {
  general:
    'AI-selected medicine information is shown only as excerpts verified against the official U.S. FDA label. The leaflet in your pack (NAFDAC-registered products can differ) always takes priority. It is not medical advice: ask a pharmacist or doctor before using any medicine.',
  children:
    "Children's doses depend on age and weight, and a wrong dose can be dangerous. Never guess or scale down an adult dose. Confirm the exact dose with a pharmacist or doctor.",
  emergency: 'In an emergency (overdose, severe allergic reaction, trouble breathing), call 112 or go to the nearest hospital.',
};

const EMERGENCY_RE = /\b(overdos\w*|poison\w*|swallowed (too|a lot|the whole|many)|took too (much|many)|can'?t breathe|cannot breathe|trouble breathing|difficulty breathing|anaphyla\w*|swelling of (the )?(face|throat|tongue|lips)|seizure|convuls\w*|unconscious|not breathing|collaps\w*|(?:child|children|kid|kids|baby|infant|toddler)\b[\s\S]{0,120}\b(?:may have taken|might have taken|could have taken|accidentally took|took|taken|swallowed|ingested|ate|given|received|got into)\b[\s\S]{0,120}\b(?:adult(?:[-\s]?strength)?|grown[-\s]?up)\s+(?:medicine|medication|drug|pills?|tablets?|capsules?|doses?)|(?:adult(?:[-\s]?strength)?\s+(?:medicine|medication|drug|pills?|tablets?|capsules?|doses?))[\s\S]{0,120}\b(?:child|children|kid|kids|baby|infant|toddler)\b[\s\S]{0,120}\b(?:may have taken|might have taken|could have taken|accidentally took|took|taken|swallowed|ingested|ate|given|received|got into)|(?:adult(?:[-\s]?strength)?\s+(?:medicine|medication|drug|pills?|tablets?|capsules?|doses?))[\s\S]{0,120}\b(?:may have taken|might have taken|could have taken|accidentally took|took|taken|swallowed|ingested|ate|given|received|got into)\b[\s\S]{0,120}\b(?:child|children|kid|kids|baby|infant|toddler))\b/i;

const emptyInfo = () => ({
  summary: '', uses: [],
  dosage: { adults: { statements: [] }, children: { statements: [] }, otherNotes: [] },
  sideEffects: { common: [], serious: [] },
  whenToSeekHelp: [], doNotUseIf: [], warnings: [], interactions: [], pregnancyBreastfeeding: [], overdose: [], storage: [],
});

const inflight = new Map(); // key -> Promise  (prevents 50 simultaneous scans of one drug triggering 50 AI calls)

function formatExcerpts(sections) {
  const cut = (t) => (t && t.length > 1500 ? `${t.slice(0, 1500).trimEnd()}…` : t || '');
  return {
    indications: cut(sections.indications), dosage: cut(sections.dosage), pediatric: cut(sections.pediatric),
    adverseReactions: cut(sections.adverseReactions), warnings: cut(sections.warnings), contraindications: cut(sections.contraindications),
  };
}

async function build(norm, { category, deps = {} }) {
  const fetchImpl = deps.fetchImpl;
  const aiSettings = deps.aiSettings || await getAiSettings();
  const results = await searchLabels(norm.ingredients, { fetchImpl, apiKey: env.openFdaApiKey });
  const label = pickBestLabel(results, { ingredients: norm.ingredients, category, formGroup: norm.formGroup });
  const base = { key: norm.key, ingredients: norm.ingredients, fetchedAt: new Date() };

  if (!label) return { ...base, status: 'not_found', expiresAt: new Date(Date.now() + 2 * DAY) };

  const sections = extractSections(label);
  const doc = { ...base, status: 'ok', label: labelMeta(label), sections: capSections(sections) };

  try {
    if (!aiSettings.enabled || !env.anthropicApiKey) throw new Error('AI disabled or provider key unavailable');
    const ai = await summariseLabel({
      sections, drugName: norm.ingredients.join(' + '), apiKey: env.anthropicApiKey, model: aiSettings.summaryModel, fetchImpl,
    });
    return { ...doc, info: ai.info, sections: ai.sections, generatedBy: 'ai-label-excerpts', model: aiSettings.summaryModel, expiresAt: new Date(Date.now() + env.drugInfoTtlDays * DAY) };
  } catch (e) {
    if (aiSettings.enabled && env.anthropicApiKey && e.message !== 'AI disabled or provider key unavailable') console.warn('[drug-info] AI summary failed, serving label text only:', e.message);
    // Label text only. Retry the AI summary sooner than the normal TTL if a key is configured.
    const ttl = env.anthropicApiKey && aiSettings.enabled ? 1 : env.drugInfoTtlDays;
    return { ...doc, info: emptyInfo(), generatedBy: 'label-extract', expiresAt: new Date(Date.now() + ttl * DAY) };
  }
}

// Returns { norm } | { norm, doc }. Never throws for "unknown drug"; throws only for infrastructure errors.
async function loadEntry(input, { refresh = false, deps } = {}) {
  const norm = normalizeDrugName(input.name, { strength: input.strength, form: input.form });
  if (!norm) return { reason: 'UNRECOGNISED_NAME' };
  if (/^veterinary/.test(input.category || '')) return { norm, reason: 'VETERINARY_NOT_SUPPORTED' };

  const cached = await DrugInfo.findOne({ key: norm.key });
  if (cached && !refresh && cached.expiresAt > new Date()) return { norm, doc: cached };

  if (!inflight.has(norm.key)) {
    const p = build(norm, { category: input.category, deps })
      .then(async (fresh) => {
        // Preserve human corrections, but any regenerated label/content must be reviewed again before it is served.
        const keep = cached ? { override: cached.override, reviewed: false, reviewedBy: null, reviewedAt: null } : {};
        return DrugInfo.findOneAndUpdate({ key: norm.key }, { $set: { ...fresh, ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v !== undefined)) } }, { upsert: true, returnDocument: 'after' });
      })
      .finally(() => inflight.delete(norm.key));
    inflight.set(norm.key, p);
  }
  try {
    return { norm, doc: await inflight.get(norm.key) };
  } catch (e) {
    if (cached) return { norm, doc: cached }; // stale beats nothing when openFDA is down
    throw e;
  }
}

function present(doc, norm, input = {}) {
  if (doc.status !== 'ok') {
    return {
      available: false,
      reason: 'NOT_IN_LABEL_DATABASE',
      message: "We couldn't find official label information for this medicine yet. Please read the leaflet in the pack or ask a pharmacist.",
      drug: { name: input.name || norm.ingredients.join(' + '), ingredients: norm.ingredients },
      disclaimers: DISCLAIMERS,
    };
  }
  const aiRecord = ['ai-summary', 'ai-label-excerpts'].includes(doc.generatedBy);
  let baseInfo = doc.info || {};
  if (aiRecord) {
    try { baseInfo = finalizeInfo(aiSchema.parse(baseInfo), doc.sections || {}); }
    catch { baseInfo = emptyInfo(); }
  }
  const activeOverride = doc.reviewed ? doc.override : null;
  const info = { ...emptyInfo(), ...baseInfo, ...(activeOverride || {}) };
  const adults = info.dosage?.adults?.statements || [];
  const children = info.dosage?.children?.statements || [];
  const hasStructured = Boolean(info.summary || info.uses.length || adults.length || children.length || info.sideEffects.common.length);
  return {
    available: true,
    drug: {
      name: input.name || norm.ingredients.join(' + '),
      ingredients: norm.ingredients,
      strength: norm.strength,
      form: norm.form,
      brandNames: doc.label?.brandNames || [],
    },
    summary: info.summary,
    uses: info.uses,
    dosage: {
      adults: { statements: adults, notStated: adults.length === 0 },
      children: { statements: children, notStated: children.length === 0, notice: DISCLAIMERS.children },
      otherNotes: info.dosage?.otherNotes || [],
    },
    sideEffects: info.sideEffects,
    whenToSeekHelp: info.whenToSeekHelp,
    doNotUseIf: info.doNotUseIf,
    warnings: info.warnings,
    interactions: info.interactions,
    pregnancyBreastfeeding: info.pregnancyBreastfeeding,
    overdose: info.overdose,
    storage: info.storage,
    // verbatim label text: always present, so the app can show the real source even when no AI summary exists
    labelExcerpts: formatExcerpts(doc.sections || {}),
    source: {
      name: 'U.S. FDA drug label (openFDA / DailyMed)',
      url: doc.label?.url || null,
      setId: doc.label?.setId || null,
      effectiveDate: doc.label?.effectiveDate || null,
      labeller: doc.label?.manufacturer || null,
    },
    generatedBy: activeOverride ? 'curated' : aiRecord ? 'ai-label-excerpts' : doc.generatedBy,
    humanCorrectionPending: Boolean(doc.override && !doc.reviewed),
    humanCorrectionPending: Boolean(doc.override && !doc.reviewed),
    structured: hasStructured,
    reviewed: Boolean(doc.reviewed && (!aiRecord || activeOverride)),
    disclaimers: DISCLAIMERS,
    updatedAt: doc.updatedAt,
  };
}

// Q&A grounded in the stored label. Returns { answer, emergency, grounded }.
async function ask(doc, norm, question, { deps = {} } = {}) {
  if (EMERGENCY_RE.test(question)) return { answer: 'This may be an emergency. Call 112 or go to the nearest hospital now.', emergency: true };
  const aiSettings = deps.aiSettings || await getAiSettings();
  if (!aiSettings.enabled || !env.anthropicApiKey) return { unavailable: true };
  const { answer, grounded, emergency } = await askAboutLabel({
    question, sections: doc.sections || {}, drugName: norm.ingredients.join(' + '),
    apiKey: env.anthropicApiKey, model: aiSettings.askModel, fetchImpl: deps.fetchImpl,
  });
  if (emergency) return { answer: 'This may be an emergency. Call 112 or go to the nearest hospital now.', emergency: true };
  if (!answer || !grounded) return { answer: "I can't confirm that from the label. Please ask a pharmacist or doctor.", emergency: false, grounded: false };
  return { answer, emergency: false, grounded: true };
}

module.exports = { loadEntry, present, ask, DISCLAIMERS, EMERGENCY_RE, emptyInfo, Source };
