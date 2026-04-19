// Auth lockout lifecycle tests.
// Proves: 5 failed attempts → 423, valid creds during lockout → 423,
// admin unlock → 200, successful login after unlock → 200.
// Tests are stateful and must execute in declaration order.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const LOCK_PASS  = 'LockoutTest_Secure12!';
const LOCK_WRONG = 'WrongPassword_Never_Correct!';

let adminToken;
let lockUserId;
let lockUsername;

before(async () => {
  adminToken = await loginAdmin();
  lockUsername = uniq('locktest');
  const created = await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: {
      username: lockUsername,
      email: `${lockUsername}@local`,
      full_name: 'Lockout Test User',
      password: LOCK_PASS,
      role_codes: []
    }
  });
  assert.equal(created.status, 201,
    `create lockout user: ${JSON.stringify(created.body)}`);
  lockUserId = created.body.id;
});

// ── Attempts 1-4 must return 401, not yet locked ──────────────────────────────
test('lockout — first 4 failed attempts each return 401 (not yet locked)', async () => {
  for (let i = 1; i <= 4; i++) {
    const r = await apiFetch('/auth/login', {
      method: 'POST',
      body: { username: lockUsername, password: LOCK_WRONG }
    });
    assert.equal(r.status, 401,
      `attempt ${i}: expected 401, got ${r.status} body=${JSON.stringify(r.body)}`);
  }
});

// ── 5th failed attempt crosses the threshold → 423 ───────────────────────────
test('lockout — 5th failed attempt triggers lockout (423)', async () => {
  const r = await apiFetch('/auth/login', {
    method: 'POST',
    body: { username: lockUsername, password: LOCK_WRONG }
  });
  assert.equal(r.status, 423,
    `5th bad attempt should lock account; got ${r.status} body=${JSON.stringify(r.body)}`);
  assert.ok(r.body.locked_until,
    `423 response must include locked_until; got ${JSON.stringify(r.body)}`);
});

// ── Valid credentials during lockout must still return 423 ────────────────────
test('lockout — valid credentials during active lockout still return 423', async () => {
  const r = await apiFetch('/auth/login', {
    method: 'POST',
    body: { username: lockUsername, password: LOCK_PASS }
  });
  assert.equal(r.status, 423,
    `correct password during lockout should be 423; got ${r.status} body=${JSON.stringify(r.body)}`);
});

// ── Admin unlock endpoint clears the lockout ──────────────────────────────────
test('lockout — admin unlock (POST /admin/users/:id/unlock) returns 200', async () => {
  const r = await apiFetch(`/admin/users/${lockUserId}/unlock`, {
    method: 'POST', token: adminToken
  });
  assert.equal(r.status, 200,
    `admin unlock should return 200; got ${r.status} body=${JSON.stringify(r.body)}`);
  assert.equal(Number(r.body.id), Number(lockUserId),
    'unlock response must echo the user id');
});

// ── Successful login after unlock ─────────────────────────────────────────────
test('lockout — valid login succeeds after admin unlock', async () => {
  const r = await apiFetch('/auth/login', {
    method: 'POST',
    body: { username: lockUsername, password: LOCK_PASS }
  });
  assert.equal(r.status, 200,
    `login after unlock should be 200; got ${r.status} body=${JSON.stringify(r.body)}`);
  assert.ok(typeof r.body.token === 'string' && r.body.token.length > 20,
    'response must include a JWT token');
});
