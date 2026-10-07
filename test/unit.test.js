process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');

const { daysUntil, statusFromDays, todayUTC, statusRange } = require('../src/utils/dates');
const { normalizePhone } = require('../src/utils/phone');
const { canAddCategory } = require('../src/constants/permissions');
const { dueKinds } = require('../src/jobs/expiryScan');
const { levelFor } = require('../src/services/sales');
const { escapeRegex } = require('../src/utils/regex');

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
