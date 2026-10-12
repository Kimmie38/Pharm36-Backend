// Drug-info pipeline tests with mocked openFDA / Claude responses (no network, no DB).
// NOTE: the label fixture below is hand-written to imitate openFDA's response shape; it is not a real label.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeDrugName } = require('../src/services/drugInfo/normalize');
const { Source, groundedList, groundedStatements } = require('../src/services/drugInfo/grounding');
const { searchLabels, pickBestLabel, extractSections, labelMeta, buildUrl } = require('../src/services/drugInfo/openfda');
const { summariseLabel, askAboutLabel, extractJson } = require('../src/services/drugInfo/ai');
const { EMERGENCY_RE, ask, present } = require('../src/services/drugInfo');

const label = (over = {}) => ({
  set_id: 'abc-123', effective_time: '20240115',
  openfda: { generic_name: ['AMOXICILLIN'], brand_name: ['Amoxil'], substance_name: ['AMOXICILLIN'], route: ['ORAL'], product_type: ['HUMAN PRESCRIPTION DRUG LABEL'], manufacturer_name: ['Acme Pharma'] },
  indications_and_usage: ['Amoxicillin is indicated for infections of the ear, nose, throat and urinary tract.'],
  dosage_and_administration: ['Adults: 500 mg every 12 hours or 250 mg every 8 hours. Children weighing less than 40 kg: 25 mg/kg/day in divided doses every 12 hours.'],
  adverse_reactions: ['The most common adverse reactions are diarrhea, rash and nausea.'],
  contraindications: ['Serious hypersensitivity reaction to amoxicillin or other beta-lactams.'],
  ...over,
});

test('names: Nigerian INN -> US label names, combos, strengths', () => {
  assert.deepEqual(normalizeDrugName('Paracetamol 500mg').ingredients, ['acetaminophen']);
  assert.deepEqual(normalizeDrugName('Artemether/Lumefantrine').ingredients, ['artemether', 'lumefantrine']);
  assert.deepEqual(normalizeDrugName('Co-trimoxazole 480mg').ingredients, ['sulfamethoxazole', 'trimethoprim']);
  assert.equal(normalizeDrugName('Amoxicillin 500mg').strength, '500mg');
  assert.equal(normalizeDrugName('Salbutamol syrup 2mg/5ml').formGroup, 'oral');
  assert.equal(normalizeDrugName('12345'), null);
  assert.equal(normalizeDrugName(''), null);
});

test('grounding exposes only verbatim source excerpts, including nonnumeric claims', () => {
  const src = new Source('Adults: 500 mg every 12 hours. Children: 25 mg/kg/day. Rash and nausea are listed.');
  assert.deepEqual(groundedList(['Adults: 500 mg every 12 hours.', 'Take 1000 mg once daily', 'May cause permanent organ failure', 'Rash and nausea are listed.'], src), ['Adults: 500 mg every 12 hours.', 'Rash and nausea are listed.']);
  const st = groundedStatements([
    { text: 'Adults: 500 mg every 12 hours.', quote: 'Adults: 500 mg every 12 hours.' },
    { text: 'Adults take 500 mg every 12 hours', quote: 'something the label never said' },
    { text: 'Children take 50 mg/kg/day', quote: 'Children: 25 mg/kg/day.' },
  ], src);
  assert.equal(st.length, 1, 'only the exact quoted statement survives');
  assert.equal(st[0].text, st[0].quote, 'no paraphrase is displayed beside the label quote');
  assert.ok(new Source('Take 1,000 mg').numbersGrounded('take 1000 mg'));
});

test('openFDA url building + label selection prefers single-ingredient, oral, complete, right type', () => {
  assert.match(buildUrl('generic_name', ['amoxicillin', 'clavulanate'], { limit: 5 }), /openfda\.generic_name:%22amoxicillin%22\+AND\+openfda\.generic_name:%22clavulanate%22&limit=5/);
  const combo = label({ openfda: { generic_name: ['AMOXICILLIN AND CLAVULANATE'], substance_name: ['AMOXICILLIN', 'CLAVULANATE POTASSIUM'], route: ['ORAL'], product_type: ['HUMAN PRESCRIPTION DRUG LABEL'] }, set_id: 'combo' });
  const thin = label({ set_id: 'thin', dosage_and_administration: undefined, adverse_reactions: undefined });
  const good = label({ set_id: 'good' });
  const picked = pickBestLabel([combo, thin, good], { ingredients: ['amoxicillin'], category: 'prescription', formGroup: 'any' });
  assert.equal(picked.set_id, 'good');
  assert.equal(pickBestLabel([], { ingredients: ['x'] }), null);
  const m = labelMeta(good);
  assert.equal(m.effectiveDate, '2024-01-15');
  assert.match(m.url, /setid=good/);
  assert.match(extractSections(good).dosage, /500 mg every 12 hours/);
});

test('searchLabels: 404 means empty, falls back to substance_name, surfaces real errors', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes('generic_name')) return { status: 404, ok: false };
    return { status: 200, ok: true, json: async () => ({ results: [label()] }) };
  };
  const r = await searchLabels(['amoxicillin'], { fetchImpl });
  assert.equal(r.length, 1);
  assert.equal(seen.length, 2);
  await assert.rejects(searchLabels(['x'], { fetchImpl: async () => ({ status: 500, ok: false }) }), /500/);
});

const claudeReply = (obj) => async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }) });

test('AI summary: exposes only exact section-matched label excerpts and drops unsupported prose', async () => {
  const sections = extractSections(label());
  let sent;
  const uses = 'Amoxicillin is indicated for infections of the ear, nose, throat and urinary tract.';
  const adultDose = 'Adults: 500 mg every 12 hours or 250 mg every 8 hours.';
  const childDose = 'Children weighing less than 40 kg: 25 mg/kg/day in divided doses every 12 hours.';
  const adverse = 'The most common adverse reactions are diarrhea, rash and nausea.';
  const fetchImpl = async (url, opts) => { sent = { url, opts }; return claudeReply('```json\n' + JSON.stringify({
    summary: uses,
    uses: [uses],
    dosage: {
      adults: { statements: [
        { text: adultDose, quote: adultDose },
        { text: 'Take 875 mg twice a day', quote: 'Adults: 875 mg twice a day' }, // hallucinated
      ] },
      children: { statements: [{ text: childDose, quote: childDose }] },
      otherNotes: [],
    },
    sideEffects: { common: [adverse, 'May cause permanent organ failure'], serious: ['Severe allergic reaction 99% of the time'] },
    contraindications: ['ignored extra key'],
  }) + '\n```')(); };
  const { info } = await summariseLabel({ sections, drugName: 'amoxicillin', apiKey: 'k', model: 'm', fetchImpl });
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.opts.headers['x-api-key'], 'k');
  assert.equal(sent.opts.headers['anthropic-version'], '2023-06-01');
  assert.match(JSON.parse(sent.opts.body).system, /ONLY the label text/);
  assert.match(JSON.parse(sent.opts.body).system, /Do not paraphrase/);
  assert.equal(info.summary, uses);
  assert.deepEqual(info.uses, [uses]);
  assert.equal(info.dosage.adults.statements.length, 1);
  assert.equal(info.dosage.adults.statements[0].text, adultDose);
  assert.equal(info.dosage.children.statements.length, 1);
  assert.deepEqual(info.sideEffects.common, [adverse], 'unsupported nonnumeric claims are also discarded');
  assert.deepEqual(info.sideEffects.serious, [], 'unsupported numbers and prose are not shown');
});

test('AI: non-JSON output and API errors throw (caller falls back to label text)', async () => {
  const sections = extractSections(label());
  await assert.rejects(summariseLabel({ sections, drugName: 'x', apiKey: 'k', model: 'm', fetchImpl: claudeReply('sorry, I cannot') }));
  await assert.rejects(summariseLabel({ sections, drugName: 'x', apiKey: 'k', model: 'm', fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'bad key' }) }), /401/);
  assert.deepEqual(extractJson('noise {"a":1} trailing'), { a: 1 });
});

test('legacy cached AI paraphrases and pending human corrections are not served to consumers', () => {
  const normalized = normalizeDrugName('amoxicillin');
  const source = extractSections(label());
  const doc = {
    status: 'ok', generatedBy: 'ai-summary', sections: source,
    label: labelMeta(label()),
    info: { summary: 'An antibiotic for bacterial infections.', uses: ['Treats many infections.'] },
    override: { summary: 'Use this for every infection.' }, reviewed: false,
  };
  const pending = present(doc, normalized);
  assert.equal(pending.summary, '', 'legacy paraphrase without an exact source quote is dropped');
  assert.deepEqual(pending.uses, []);
  assert.equal(pending.generatedBy, 'ai-label-excerpts');
  assert.equal(pending.humanCorrectionPending, true);
  assert.equal(pending.reviewed, false);

  const approved = present({ ...doc, reviewed: true }, normalized);
  assert.equal(approved.summary, 'Use this for every infection.');
  assert.equal(approved.generatedBy, 'curated');
  assert.equal(approved.humanCorrectionPending, false);
  assert.equal(approved.reviewed, true);
});

test('Q&A: returns an exact label excerpt or an empty ungrounded result, never free-form prose', async () => {
  const sections = extractSections(label());
  const quote = 'Adults: 500 mg every 12 hours or 250 mg every 8 hours.';
  const ok = await askAboutLabel({ question: 'How often?', sections, drugName: 'x', apiKey: 'k', model: 'm', fetchImpl: claudeReply({ quote, emergency: false }) });
  assert.equal(ok.grounded, true);
  assert.equal(ok.answer, quote);
  const bad = await askAboutLabel({ question: 'How often?', sections, drugName: 'x', apiKey: 'k', model: 'm', fetchImpl: claudeReply({ quote: 'Give 7 mg per kg.', emergency: false }) });
  assert.equal(bad.grounded, false);
  assert.equal(bad.answer, '');
  const prose = await askAboutLabel({ question: 'How often?', sections, drugName: 'x', apiKey: 'k', model: 'm', fetchImpl: claudeReply('Take 500 mg every 12 hours.') });
  assert.equal(prose.grounded, false, 'plain prose without a valid quote object is never returned');
});

test('emergency phrases are caught before any AI call', () => {
  for (const q of ['my child swallowed too many tablets', 'is this an overdose?', "he can't breathe after taking it", 'swelling of the face', 'she had a seizure']) {
    assert.ok(EMERGENCY_RE.test(q), q);
  }
  for (const q of ['a child who took adult medicine', 'my toddler swallowed an adult-strength tablet', 'an adult pill was taken by a child']) {
    assert.ok(EMERGENCY_RE.test(q), q);
  }
  assert.ok(!EMERGENCY_RE.test('can I take it with food?'));
});

test('a child ingesting adult medicine receives the deterministic emergency response before an AI call', async () => {
  let called = false;
  const result = await ask({ sections: {} }, { ingredients: ['amoxicillin'] }, 'A child who took adult medicine', {
    deps: { aiSettings: { enabled: true, askModel: 'test-model' }, fetchImpl: async () => { called = true; throw new Error('provider must not be called'); } },
  });
  assert.equal(called, false);
  assert.equal(result.emergency, true);
  assert.match(result.answer, /Call 112/);
});
