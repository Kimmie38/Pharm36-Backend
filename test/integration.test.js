// End-to-end tests against a REAL MongoDB. Skipped unless MONGODB_TEST_URI is set, e.g.
//   MONGODB_TEST_URI=mongodb://127.0.0.1:27017/pharm36_test npm test
// The database name must contain "test" — it is wiped before the run.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');

const URI = process.env.MONGODB_TEST_URI;
const skip = !URI && 'set MONGODB_TEST_URI to run the database integration tests';

const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const { connectDB } = require('../src/config/db');
const { todayUTC, addDays } = require('../src/utils/dates');

let server; let base;
const ymd = (n) => addDays(todayUTC(), n).toISOString().slice(0, 10);

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const reg = (over) => api('/api/auth/register', {
  method: 'POST',
  body: { professionalType: 'pharmacist', name: 'Test Pharmacist', phone: '08031110000', email: 'a@test.com',
    location: '1 Test Street, Yaba', state: 'Lagos', storeName: 'Test Pharmacy', sections: ['general_pharmacy', 'controlled_drugs'],
    password: 'Passw0rd!', confirmPassword: 'Passw0rd!', ...over },
});

test.before(async () => {
  if (skip) return;
  const dbName = new URL(URI).pathname.slice(1);
  assert.ok(/test/i.test(dbName), 'refusing to wipe a database whose name does not contain "test"');
  await connectDB(URI);
  await mongoose.connection.dropDatabase();
  await mongoose.syncIndexes();
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { if (skip) return; server.close(); await mongoose.disconnect(); });

test('full pharmacist + consumer + marketplace flow', { skip }, async (t) => {
  let alice; let bob;

  await t.test('register + login + duplicate checks', async () => {
    const r = await reg();
    assert.equal(r.status, 201, JSON.stringify(r.json));
    alice = r.json.token;
    assert.equal(r.json.user.phone, '+2348031110000');
    assert.equal(r.json.user.pcnStatus, 'active');
    assert.equal(r.json.user.passwordHash, undefined);
    assert.equal((await reg()).status, 409);
    assert.equal((await api('/api/auth/login', { method: 'POST', body: { identifier: '0803 111 0000', password: 'Passw0rd!' } })).status, 200);
    assert.equal((await api('/api/auth/login', { method: 'POST', body: { identifier: 'a@test.com', password: 'wrong-pass' } })).status, 401);
    const b = await reg({ phone: '08032220000', email: 'b@test.com', storeName: 'Bob Chemist', sections: ['general_pharmacy'] });
    bob = b.json.token;
  });

  await t.test('controlled drugs are locked until the council verifies the section', async () => {
    const body = { drugName: 'Morphine 10mg', category: 'controlled', batchCode: 'CTRL-0001', expiryDate: ymd(300), quantity: 10, unitPrice: 500 };
    const r = await api('/api/batches', { method: 'POST', token: alice, body });
    assert.equal(r.status, 403);
    assert.equal(r.json.details.code, 'CATEGORY_RESTRICTED');

    await User.create({ role: 'admin', name: 'Admin', email: 'admin@test.com', council: 'ALL', passwordHash: await User.hashPassword('AdminPass1') });
    const adminToken = (await api('/api/auth/login', { method: 'POST', body: { identifier: 'admin@test.com', password: 'AdminPass1' } })).json.token;
    const me = (await api('/api/me', { token: alice })).json.user;
    const v = await api(`/api/admin/professionals/${me.id}/verification`, {
      method: 'PATCH', token: adminToken, body: { verificationStatus: 'verified', verifiedSections: ['general_pharmacy', 'controlled_drugs'] },
    });
    assert.equal(v.status, 200);
    assert.equal((await api('/api/batches', { method: 'POST', token: alice, body })).status, 201);
    assert.equal((await api('/api/admin/stats', { token: alice })).status, 403, 'professionals cannot use admin routes');
  });

  let amox; let para; let old;
  await t.test('add batches, duplicates, validation, computed status', async () => {
    const mk = (b) => api('/api/batches', { method: 'POST', token: alice, body: { quantity: '100', price: '85', ...b } });
    const r1 = await mk({ drugName: 'Amoxicillin 500mg', category: 'prescription', batchCode: '5012345678901', manufactureDate: ymd(-300), expiryDate: ymd(20), manufacturer: 'Emzor' });
    assert.equal(r1.status, 201, JSON.stringify(r1.json));
    amox = r1.json.batch;
    assert.equal(amox.status, 'expiring_1m');
    assert.equal(amox.daysToExpiry, 20);
    assert.equal(amox.unitPrice, 85);
    assert.equal(amox.totalValue, 8500);
    para = (await mk({ drugName: 'Paracetamol 500mg', batchCode: '5019988771234', expiryDate: ymd(10) })).json.batch;
    assert.equal(para.status, 'expiring_2w');
    old = (await mk({ drugName: 'Old Stock', batchCode: 'OLD-0001', expiryDate: ymd(-5) })).json.batch;
    assert.equal(old.status, 'expired');
    assert.equal((await mk({ drugName: 'Dup', batchCode: '5012345678901', expiryDate: ymd(50) })).status, 409);
    assert.equal((await mk({ drugName: 'Bad dates', batchCode: 'BAD-1', manufactureDate: ymd(10), expiryDate: ymd(5) })).status, 400);
    assert.equal((await mk({ drugName: 'Bad date', batchCode: 'BAD-2', expiryDate: '2026-02-31' })).status, 400);
  });

  await t.test('inventory list, filters, expiring list, dashboard', async () => {
    const all = (await api('/api/batches', { token: alice })).json;
    assert.equal(all.total, 4); // incl. the controlled one
    assert.equal((await api('/api/batches?search=amox', { token: alice })).json.total, 1);
    assert.equal((await api('/api/batches?status=expired', { token: alice })).json.items[0].batchCode, 'OLD-0001');
    assert.equal((await api('/api/batches?status=expiring_2w', { token: alice })).json.items[0].batchCode, '5019988771234');
    const exp = (await api('/api/batches/expiring', { token: alice })).json;
    assert.equal(exp.total, 3);
    assert.deepEqual(exp.items.map((b) => b.batchCode), ['OLD-0001', '5019988771234', '5012345678901']);
    const d = (await api('/api/dashboard', { token: alice })).json;
    assert.equal(d.totalBatches, 4);
    assert.equal(d.expiringCount, 3);
    assert.equal((await api('/api/batches', { token: bob })).json.total, 0, 'inventories are private');
    assert.equal((await api(`/api/batches/${amox.id}`, { token: bob })).status, 404);
  });

  await t.test('selling: partial, oversell blocked, expired blocked, sold-out closes batch, sales levels', async () => {
    let r = await api(`/api/batches/${amox.id}/sell`, { method: 'POST', token: alice, body: { quantity: 30 } });
    assert.equal(r.status, 200);
    assert.equal(r.json.batch.quantity, 70);
    assert.equal(r.json.sold.revenue, 2550);
    assert.equal((await api(`/api/batches/${amox.id}/sell`, { method: 'POST', token: alice, body: { quantity: 500 } })).status, 409);
    assert.equal((await api(`/api/batches/${old.id}/sell`, { method: 'POST', token: alice, body: {} })).status, 409);
    r = await api(`/api/batches/${para.id}/sell`, { method: 'POST', token: alice, body: {} });
    assert.equal(r.json.batch.state, 'sold');
    assert.equal((await api('/api/batches', { token: alice })).json.total, 3);
    const s = (await api('/api/sales', { token: alice })).json;
    assert.equal(s.totalUnits, 130);
    assert.ok(s.salesLevels.every((l) => ['high', 'medium', 'low'].includes(l.level)));
  });

  await t.test('dispose expired batch', async () => {
    const r = await api(`/api/batches/${old.id}/dispose`, { method: 'POST', token: alice, body: {} });
    assert.equal(r.json.batch.state, 'disposed');
    assert.equal(r.json.batch.disposalReason, 'expired');
    assert.equal((await api(`/api/batches/${old.id}/dispose`, { method: 'POST', token: alice, body: {} })).status, 409);
  });

  await t.test('consumer verification (no login)', async () => {
    let r = await api('/api/public/drugs/verify?batchCode=5012345678901');
    assert.equal(r.status, 200);
    assert.equal(r.json.verified, true);
    assert.equal(r.json.drug.name, 'Amoxicillin 500mg');
    assert.equal(r.json.registeredPharmacy, 'Test Pharmacy, 1 Test Street, Yaba');
    assert.equal(r.json.safeToUse, false, 'expires in 20 days (<30)');
    r = await api('/api/public/drugs/verify?batchCode=NOT-A-REAL-CODE');
    assert.equal(r.json.found, false);
    assert.equal(r.json.verified, false);
    assert.equal((await api('/api/public/drugs/verify?batchCode=OLD-0001')).json.found, false, 'disposed batches are not valid records');
    r = await api('/api/public/drugs/search?q=amoxi');
    assert.equal(r.json.total, 1);
    r = await api('/api/public/reports', { method: 'POST', body: { batchCode: '5012345678901', reason: 'suspected_fake', description: 'pack looked odd' } });
    assert.equal(r.status, 201);
  });

  await t.test('marketplace: list, browse, buy (partial then rest), stock moves, buyer gets inventory', async () => {
    const vit = (await api('/api/batches', { method: 'POST', token: alice, body: { drugName: 'Vitamin C 1000mg', batchCode: 'VITC-1', expiryDate: ymd(400), quantity: 100, unitPrice: 45 } })).json.batch;
    const l = await api('/api/marketplace/listings', { method: 'POST', token: alice, body: { batchId: vit.id, quantity: 60, unitPrice: 40 } });
    assert.equal(l.status, 201, JSON.stringify(l.json));
    assert.equal((await api('/api/marketplace/listings', { method: 'POST', token: alice, body: { batchId: vit.id } })).status, 409, 'one open listing per batch');
    assert.equal((await api('/api/marketplace/listings', { method: 'POST', token: alice, body: { batchId: old.id } })).status, 409);

    const seen = (await api('/api/marketplace/listings', { token: bob })).json;
    assert.equal(seen.total, 1);
    assert.equal((await api('/api/marketplace/listings', { token: alice })).json.total, 0, "you don't see your own in 'buy from others'");
    assert.equal((await api('/api/marketplace/listings?mine=true', { token: alice })).json.total, 1);

    const id = l.json.listing.id;
    assert.equal((await api(`/api/marketplace/listings/${id}/buy`, { method: 'POST', token: alice, body: {} })).status, 400, 'cannot buy own');
    let b = await api(`/api/marketplace/listings/${id}/buy`, { method: 'POST', token: bob, body: { quantity: 25 } });
    assert.equal(b.status, 201, JSON.stringify(b.json));
    assert.equal(b.json.order.total, 1000);
    assert.equal(b.json.batch.quantity, 25);
    assert.equal((await api(`/api/marketplace/listings/${id}/buy`, { method: 'POST', token: bob, body: { quantity: 999 } })).status, 400);
    b = await api(`/api/marketplace/listings/${id}/buy`, { method: 'POST', token: bob, body: {} });
    assert.equal(b.json.batch.quantity, 60, 'merged into the buyer\'s existing batch');
    assert.equal((await api(`/api/marketplace/listings/${id}/buy`, { method: 'POST', token: bob, body: {} })).status, 404, 'fulfilled');

    assert.equal((await api(`/api/batches/${vit.id}`, { token: alice })).json.batch.quantity, 40, 'seller stock reduced');
    assert.equal((await api('/api/batches?search=vitamin', { token: bob })).json.items[0].source, 'marketplace');
  });

  await t.test('buy requests', async () => {
    const r = await api('/api/marketplace/requests', { method: 'POST', token: bob, body: { drugName: 'Ibuprofen 400mg', quantity: 200, maxUnitPrice: 35 } });
    assert.equal(r.status, 201);
    assert.equal((await api('/api/marketplace/listings?type=request', { token: alice })).json.total, 1);
  });

  await t.test('revoked professionals are read-only and invisible to consumers', async () => {
    const adminToken = (await api('/api/auth/login', { method: 'POST', body: { identifier: 'admin@test.com', password: 'AdminPass1' } })).json.token;
    const bobId = (await api('/api/me', { token: bob })).json.user.id;
    await api(`/api/admin/professionals/${bobId}/verification`, { method: 'PATCH', token: adminToken, body: { pcnStatus: 'revoked' } });
    assert.equal((await api('/api/batches', { token: bob })).status, 200);
    assert.equal((await api('/api/batches', { method: 'POST', token: bob, body: { drugName: 'X', batchCode: 'XXX', expiryDate: ymd(90), quantity: 1 } })).status, 403);
    assert.equal((await api('/api/public/drugs/verify?batchCode=VITC-1')).json.registeredPharmacy.includes('Bob'), false);
  });

  await t.test('password reset invalidates old sessions', async () => {
    const f = await api('/api/auth/forgot-password', { method: 'POST', body: { identifier: 'a@test.com' } });
    assert.ok(f.json.devCode);
    const r = await api('/api/auth/reset-password', { method: 'POST', body: { identifier: 'a@test.com', code: f.json.devCode, password: 'NewPassw0rd!' } });
    assert.equal(r.status, 200);
    assert.equal((await api('/api/me', { token: alice })).status, 401, 'old token no longer valid');
    assert.equal((await api('/api/auth/login', { method: 'POST', body: { identifier: 'a@test.com', password: 'NewPassw0rd!' } })).status, 200);
  });

  await t.test('daily expiry scan creates each notification once', async () => {
    const { runExpiryScan } = require('../src/jobs/expiryScan');
    const login = (await api('/api/auth/login', { method: 'POST', body: { identifier: 'a@test.com', password: 'NewPassw0rd!' } })).json.token;
    const first = await runExpiryScan();
    assert.ok(first >= 1);
    assert.equal(await runExpiryScan(), 0, 're-running is idempotent');
    const n = (await api('/api/me/notifications', { token: login })).json;
    assert.ok(n.unreadCount >= 1);
    assert.equal((await api('/api/me/notifications/read-all', { method: 'POST', token: login })).status, 200);
  });
});
