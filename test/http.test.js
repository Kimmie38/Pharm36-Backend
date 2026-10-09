// HTTP-level tests that need NO database: routing, validation, auth guards, static meta.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');

let server; let base;
test.before(async () => { await new Promise((r) => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

const call = async (path, opts = {}) => {
  const res = await fetch(base + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: opts.body && JSON.stringify(opts.body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};

test('health', async () => { const r = await call('/health'); assert.equal(r.status, 200); assert.equal(r.json.status, 'ok'); });

test('meta exposes professions, categories, states, reminders', async () => {
  const r = await call('/api/meta');
  assert.equal(r.status, 200);
  assert.equal(r.json.professionalTypes.pharmacist.councilShort, 'PCN');
  assert.equal(r.json.drugCategories.length, 5);
  assert.ok(r.json.states.includes('Lagos'));
  assert.equal(r.json.expiryBuckets[0], '1 year');
});

test('unknown route -> 404 json', async () => { const r = await call('/api/nope'); assert.equal(r.status, 404); });

test('protected routes require a token', async () => {
  for (const p of ['/api/dashboard', '/api/batches', '/api/batches/expiring', '/api/marketplace/listings', '/api/me', '/api/admin/stats']) {
    const r = await call(p); assert.equal(r.status, 401, p);
  }
  const bad = await call('/api/me', { headers: { Authorization: 'Bearer garbage' } });
  assert.equal(bad.status, 401);
});

test('register validates input', async () => {
  const r = await call('/api/auth/register', { method: 'POST', body: { name: 'A', phone: '123', email: 'nope', password: 'short', state: 'Narnia' } });
  assert.equal(r.status, 400);
  const fields = r.json.details.map((d) => d.field);
  for (const f of ['name', 'phone', 'email', 'password', 'state', 'location']) assert.ok(fields.includes(f), `expected error on ${f}`);
});

test('register rejects mismatched confirm password', async () => {
  const r = await call('/api/auth/register', { method: 'POST', body: { name: 'Ada Eze', phone: '08035550142', email: 'a@b.com', location: '14 Herbert Macaulay Way', state: 'Lagos', password: 'Passw0rd!', confirmPassword: 'different' } });
  assert.equal(r.status, 400);
  assert.ok(r.json.details.some((d) => d.field === 'confirmPassword'));
});

test('login validates input', async () => {
  const r = await call('/api/auth/login', { method: 'POST', body: {} });
  assert.equal(r.status, 400);
});

test('public verify / search / report validate input', async () => {
  assert.equal((await call('/api/public/drugs/verify')).status, 400);
  assert.equal((await call('/api/public/drugs/search?q=a')).status, 400);
  assert.equal((await call('/api/public/reports', { method: 'POST', body: { description: 'bad' } })).status, 400);
});

test('drug info endpoints validate input', async () => {
  assert.equal((await call('/api/public/drugs/info')).status, 400);
  assert.equal((await call('/api/public/drugs/ask', { method: 'POST', body: { name: 'Amoxicillin' } })).status, 400);
  assert.equal((await call('/api/public/drugs/ask', { method: 'POST', body: { question: 'ok?' } })).status, 400);
  assert.equal((await call('/api/admin/drug-info')).status, 401);
});

test('malformed JSON -> 400', async () => {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(res.status, 400);
});
