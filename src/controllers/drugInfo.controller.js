const Batch = require('../models/Batch');
const AppError = require('../utils/AppError');
const { loadEntry, present, ask, DISCLAIMERS } = require('../services/drugInfo');
const AIInteraction = require('../models/AIInteraction');
const { getAiSettings } = require('../services/aiSettings');
const { redactText } = require('../utils/redactText');

const HISTORY_TTL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

async function saveHistory({ entry, question, answer = '', status, model }) {
  try {
    await AIInteraction.create({
      drugKey: entry.norm.key,
      drugName: redactText(entry.norm.ingredients.join(' + '), 150),
      question: redactText(question, 300),
      answer: redactText(answer, 1200),
      responseStatus: status,
      model: model || undefined,
      expiresAt: new Date(Date.now() + HISTORY_TTL_DAYS * DAY_MS),
    });
  } catch {
    // Do not log prompt/answer contents; a history write must not break a grounded public response.
    console.warn('[ai-history] interaction could not be stored');
  }
}

// Resolve what the consumer is asking about: a scanned batch code (-> registered drug) or a typed drug name.
async function resolveTarget({ batchCode, name }) {
  if (batchCode) {
    const rows = await Batch.find({ batchCode, state: { $in: ['active', 'sold'] } }).populate('owner', 'pcnStatus +deletionInProgress').sort({ createdAt: 1 });
    const b = rows.find((r) => r.owner && r.owner.pcnStatus === 'active' && !r.owner.deletionInProgress);
    if (!b) return { error: { reason: 'UNREGISTERED_BATCH', message: "This batch isn't in our registry, so we can't tell which medicine it is. Search by the drug's name instead." } };
    return { input: { name: b.drugName, strength: b.strength, form: b.form, category: b.category }, batch: b };
  }
  return { input: { name } };
}

// GET /api/public/drugs/info?batchCode=...   or   ?name=Amoxicillin 500mg
async function info(req, res) {
  const t = await resolveTarget(req.valid.query);
  if (t.error) return res.json({ available: false, ...t.error, disclaimers: DISCLAIMERS });

  const entry = await loadEntry(t.input, { refresh: false });
  if (!entry.doc) {
    const message = entry.reason === 'VETERINARY_NOT_SUPPORTED'
      ? 'Veterinary medicine information is not available yet. Please ask a veterinary doctor.'
      : "We couldn't recognise that medicine name. Try the generic name, e.g. \"amoxicillin\".";
    return res.json({ available: false, reason: entry.reason, message, disclaimers: DISCLAIMERS });
  }
  res.json(present(entry.doc, entry.norm, t.input));
}

// POST /api/public/drugs/ask  { batchCode | name, question }
async function askQuestion(req, res) {
  const { question, ...target } = req.valid.body;
  const t = await resolveTarget(target);
  if (t.error) return res.json({ available: false, ...t.error });
  const entry = await loadEntry(t.input, {});
  if (!entry.doc || entry.doc.status !== 'ok') {
    return res.json({ available: false, reason: entry.reason || 'NOT_IN_LABEL_DATABASE', message: "We don't have label information for this medicine, so we can't answer. Please ask a pharmacist." });
  }
  const settings = await getAiSettings();
  let r;
  try {
    r = await ask(entry.doc, entry.norm, question, { deps: { aiSettings: settings } });
  } catch (error) {
    await saveHistory({ entry, question, status: 'unavailable', model: settings.askModel });
    throw error;
  }
  const responseStatus = r.emergency ? 'emergency' : r.unavailable ? 'unavailable' : r.grounded === false ? 'ungrounded' : 'answered';
  await saveHistory({ entry, question, answer: r.answer || '', status: responseStatus, model: settings.askModel });
  if (r.unavailable) throw new AppError(503, 'The question assistant is not available right now. You can still read the official-label excerpts.');
  res.json({ available: true, question, answer: r.answer, emergency: r.emergency, grounded: r.grounded !== false, source: { name: 'U.S. FDA drug label', url: entry.doc.label?.url || null }, disclaimers: { general: DISCLAIMERS.general, emergency: DISCLAIMERS.emergency } });
}

module.exports = { info, askQuestion };
