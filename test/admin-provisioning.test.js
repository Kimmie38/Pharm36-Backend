'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AdminProvisioningError, parseFlags, provisionAdmin } = require('../src/services/adminProvisioning');

function fakeModel(initial = null) {
  const state = { user: initial, created: null, hashCalls: [], saveCalls: 0, createCalls: 0 };
  const User = {
    async findOne({ email }) {
      return state.user && state.user.email === email ? state.user : null;
    },
    async hashPassword(password) {
      state.hashCalls.push(password);
      return `hashed:${password}`;
    },
    async create(document) {
      state.createCalls += 1;
      state.created = { ...document, tokenVersion: 0 };
      state.user = state.created;
      return state.created;
    },
  };
  return { User, state };
}

const testOnlyPassword = 'test-only-long-passphrase-73';

test('creates a new admin with normalized email, explicit scope, and a hash only', async () => {
  const { User, state } = fakeModel();
  const result = await provisionAdmin({ User, email: ' Admin@Example.Test ', password: testOnlyPassword, council: 'ALL' });
  assert.deepEqual(result, { action: 'created', council: 'ALL' });
  assert.equal(state.created.email, 'admin@example.test');
  assert.equal(state.created.role, 'admin');
  assert.equal(state.created.council, 'ALL');
  assert.equal(state.created.passwordHash, `hashed:${testOnlyPassword}`);
  assert.equal(Object.hasOwn(state.created, 'password'), false);
  assert.equal(state.createCalls, 1);
});

test('does not reset or change an existing admin when run without explicit flags', async () => {
  const existing = { role: 'admin', email: 'admin@example.test', council: 'PCN', passwordHash: 'keep-this-hash', tokenVersion: 4, save: async () => assert.fail('must not save') };
  const { User, state } = fakeModel(existing);
  const result = await provisionAdmin({ User, email: existing.email });
  assert.deepEqual(result, { action: 'unchanged', council: 'PCN' });
  assert.equal(existing.passwordHash, 'keep-this-hash');
  assert.equal(existing.tokenVersion, 4);
  assert.equal(state.hashCalls.length, 0);
});

test('refuses to promote a professional account with the same email', async () => {
  const existing = { role: 'professional', email: 'user@example.test', council: undefined, save: async () => assert.fail('must not save') };
  const { User, state } = fakeModel(existing);
  await assert.rejects(
    provisionAdmin({ User, email: existing.email, password: testOnlyPassword, council: 'ALL' }),
    (error) => error instanceof AdminProvisioningError && /refusing role escalation/i.test(error.message)
  );
  assert.equal(state.createCalls, 0);
  assert.equal(state.hashCalls.length, 0);
});

test('resets an existing admin password only when requested and invalidates prior tokens', async () => {
  const existing = { role: 'admin', email: 'admin@example.test', council: 'PCN', passwordHash: 'old-hash', tokenVersion: 4, async save() { this.saved = true; } };
  const { User, state } = fakeModel(existing);
  const result = await provisionAdmin({ User, email: existing.email, password: testOnlyPassword, resetPassword: true });
  assert.deepEqual(result, { action: 'updated', council: 'PCN', resetPassword: true, setCouncil: false });
  assert.equal(existing.passwordHash, `hashed:${testOnlyPassword}`);
  assert.equal(existing.tokenVersion, 5);
  assert.equal(existing.council, 'PCN');
  assert.equal(existing.saved, true);
  assert.deepEqual(state.hashCalls, [testOnlyPassword]);
});

test('changes existing admin scope only when explicitly requested', async () => {
  const existing = { role: 'admin', email: 'admin@example.test', council: 'PCN', passwordHash: 'keep-this-hash', tokenVersion: 2, async save() { this.saved = true; } };
  const { User, state } = fakeModel(existing);
  const result = await provisionAdmin({ User, email: existing.email, council: 'ALL', setCouncil: true });
  assert.deepEqual(result, { action: 'updated', council: 'ALL', resetPassword: false, setCouncil: true });
  assert.equal(existing.passwordHash, 'keep-this-hash');
  assert.equal(existing.tokenVersion, 2);
  assert.equal(existing.council, 'ALL');
  assert.equal(existing.saved, true);
  assert.equal(state.hashCalls.length, 0);
});

test('update flags never create a new admin', async () => {
  const { User, state } = fakeModel();
  await assert.rejects(
    provisionAdmin({ User, email: 'new@example.test', password: testOnlyPassword, council: 'ALL', resetPassword: true }),
    /require an existing admin account/
  );
  assert.equal(state.createCalls, 0);
});

test('rejects invalid council values before creating an admin', async () => {
  const { User, state } = fakeModel();
  await assert.rejects(provisionAdmin({ User, email: 'new@example.test', password: testOnlyPassword, council: 'GLOBAL' }), /ADMIN_COUNCIL/);
  assert.equal(state.createCalls, 0);
});

test('accepts only known one-time mutation flags', () => {
  assert.deepEqual(parseFlags([]), { resetPassword: false, setCouncil: false });
  assert.deepEqual(parseFlags(['--reset-password', '--set-council']), { resetPassword: true, setCouncil: true });
  assert.throws(() => parseFlags(['--force']), /Supported options/);
  assert.throws(() => parseFlags(['--reset-password', '--reset-password']), /Supported options/);
});
