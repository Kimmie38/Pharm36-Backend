process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');

const { daysUntil, statusFromDays, todayUTC, statusRange } = require('../src/utils/dates');
const { normalizePhone } = require('../src/utils/phone');
const { canAddCategory } = require('../src/constants/permissions');
const { dueKinds } = require('../src/jobs/expiryScan');
const { levelFor } = require('../src/services/sales');
const { escapeRegex } = require('../src/utils/regex');
const { redactText } = require('../src/utils/redactText');
const AIInteraction = require('../src/models/AIInteraction');
const DrugInfo = require('../src/models/DrugInfo');
const { scopeFor, requireAllScope } = require('../src/controllers/admin.controller');
const { deleteSale, deleteOrder } = require('../src/controllers/adminOperations.controller');
const { update: updateDrugInfo } = require('../src/controllers/adminDrugInfo.controller');
const { isTransactionUnsupported } = require('../src/services/adminInvariant');

test('expiry status buckets match the app (1 month / 2 weeks / expired)', () => {
  assert.equal(statusFromDays(-1), 'expired');
  assert.equal(statusFromDays(0), 'expiring_2w');
  assert.equal(statusFromDays(14), 'expiring_2w');
  assert.equal(statusFromDays(15), 'expiring_1m');
  assert.equal(statusFromDays(30), 'expiring_1m');
  assert.equal(statusFromDays(31), 'ok');
});

test('daysUntil uses the Lagos calendar day', () => {
  // 2026-10-07 23:30 UTC is already 2026-10-08 00:30 in Lagos
  const now = Date.UTC(2026, 9, 7, 23, 30);
  assert.equal(todayUTC(now).toISOString().slice(0, 10), '2026-10-08');
  assert.equal(daysUntil(new Date('2026-10-28T00:00:00Z'), now), 20);
  assert.equal(daysUntil(new Date('2026-10-08T00:00:00Z'), now), 0);
});

test('statusRange boundaries agree with statusFromDays', () => {
  const now = Date.UTC(2026, 9, 7, 10);
  const t = todayUTC(now).getTime();
  const day = 86400000;
  for (const d of [-5, -1, 0, 7, 14, 15, 30, 31, 400]) {
    const expiry = new Date(t + d * day);
    const status = statusFromDays(daysUntil(expiry, now));
    const r = statusRange(status, now);
    const ok = Object.entries(r).every(([op, v]) => ({ $lt: expiry < v, $lte: expiry <= v, $gt: expiry > v, $gte: expiry >= v }[op]));
    assert.ok(ok, `day offset ${d} should fall in range for ${status}`);
  }
});

test('phone normalisation', () => {
  assert.equal(normalizePhone('0803 555 0142'), '+2348035550142');
  assert.equal(normalizePhone('+234 803 555 0142'), '+2348035550142');
  assert.equal(normalizePhone('2348035550142'), '+2348035550142');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone(''), null);
});

test('category permissions follow verified sections (default config)', () => {
  const u = { sections: ['controlled_drugs', 'general_pharmacy'], verifiedSections: ['general_pharmacy'] };
  assert.equal(canAddCategory(u, 'general'), true);
  assert.equal(canAddCategory(u, 'prescription'), true);
  assert.equal(canAddCategory(u, 'controlled'), false, 'claimed but not yet verified');
  assert.equal(canAddCategory({ verifiedSections: ['controlled_drugs'] }, 'controlled'), true);
  assert.equal(canAddCategory({ verifiedSections: ['veterinary_pharmacy'] }, 'veterinary'), true);
  assert.equal(canAddCategory({ verifiedSections: ['general_veterinary'] }, 'veterinary'), true);
  assert.equal(canAddCategory({ verifiedSections: [] }, 'nonsense'), false);
});

test('expiry scan decides which notifications are due', () => {
  const day = 86400000;
  const at = (d) => new Date(todayUTC().getTime() + d * day);
  const mk = (d, reminder = null) => ({ expiryDate: at(d), reminder });
  assert.deepEqual(dueKinds(mk(200)).kinds, []);
  assert.deepEqual(dueKinds(mk(60, '3 months')).kinds, ['reminder']);
  assert.deepEqual(dueKinds(mk(100, '3 months')).kinds, []);
  assert.deepEqual(dueKinds(mk(20, '1 month')).kinds, ['expiring_1m'], '1 month reminder would duplicate the auto alert');
  assert.deepEqual(dueKinds(mk(10)).kinds, ['expiring_2w']);
  assert.deepEqual(dueKinds(mk(5, '1 week')).kinds, ['reminder', 'expiring_2w']);
  assert.deepEqual(dueKinds(mk(-3)).kinds, ['expired']);
});

test('sales levels reproduce the demo data tiers', () => {
  assert.equal(levelFor(15300), 'high');
  assert.equal(levelFor(8400), 'high');
  assert.equal(levelFor(6500), 'medium');
  assert.equal(levelFor(2860), 'low');
});

test('regex escaping prevents regex injection in searches', () => {
  assert.equal(escapeRegex('a.*b(c)'), 'a\\.\\*b\\(c\\)');
});

test('administrator council scopes are explicit and fail closed', () => {
  assert.deepEqual(scopeFor({ council: 'PCN' }), { professionalType: 'pharmacist' });
  assert.deepEqual(scopeFor({ council: 'VCN' }), { professionalType: 'veterinary' });
  assert.deepEqual(scopeFor({ council: 'ALL' }), {});
  assert.throws(() => scopeFor({ council: 'OTHER' }), /no valid council scope/);
  assert.throws(() => scopeFor({}), /no valid council scope/);
  assert.doesNotThrow(() => requireAllScope({ council: 'ALL' }));
  assert.throws(() => requireAllScope({ council: 'PCN' }), /ALL-scope administrator/);
});

test('permanent sale and order deletion is restricted to ALL-scope admins', async () => {
  const req = { user: { council: 'PCN' }, valid: { body: { confirmation: 'DELETE' }, params: { id: '000000000000000000000001' } } };
  await assert.rejects(deleteSale(req, {}), /requires an ALL-scope administrator/);
  await assert.rejects(deleteOrder(req, {}), /requires an ALL-scope administrator/);
});

test('anonymous AI history has the 90-day TTL field and no account or request identity paths', () => {
  const fields = AIInteraction.schema.paths;
  assert.ok(fields.drugKey && fields.drugName && fields.question && fields.answer && fields.responseStatus && fields.model && fields.expiresAt);
  for (const field of ['user', 'userId', 'accountId', 'email', 'phone', 'ip', 'ipAddress', 'userAgent']) {
    assert.equal(fields[field], undefined, `AI history must not store ${field}`);
  }
  const ttl = AIInteraction.schema.indexes().find(([keys]) => keys.expiresAt === 1);
  assert.equal(ttl?.[1]?.expireAfterSeconds, 0, 'MongoDB TTL is driven directly by expiresAt');
  assert.equal(AIInteraction.schema.path('updatedAt'), undefined, 'updatedAt is not collected for these append-only records');
});

test('drug-label correction approval is a separate ALL-admin action and excerpt provenance is schema-valid', async () => {
  assert.ok(DrugInfo.schema.path('generatedBy').enumValues.includes('ai-label-excerpts'));
  const req = { user: { council: 'ALL', _id: '000000000000000000000001' }, valid: { params: { id: '000000000000000000000002' }, body: { override: { summary: 'correction' }, reviewed: true } } };
  await assert.rejects(updateDrugInfo(req, {}), /Save a correction first/);
});

test('AI history redacts email and phone patterns before storage', () => {
  assert.equal(redactText('Email alex@example.com; phone +1 (415) 555-0123.'), 'Email [redacted email]; phone [redacted phone].');
});

test('admin invariant reports unsupported standalone-Mongo transactions', () => {
  assert.equal(isTransactionUnsupported({ message: 'Transaction numbers are only allowed on a replica set member or mongos' }), true);
  assert.equal(isTransactionUnsupported({ name: 'MongoServerError', message: 'duplicate key' }), false);
  assert.equal(isTransactionUnsupported({ name: 'MongoServerError', message: 'The operation completed' }), false);
});
