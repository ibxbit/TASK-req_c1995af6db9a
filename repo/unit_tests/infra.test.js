// Unit tests — auth (password/tokens/lockout/plugin), rbac (audit/enforce/permissions),
// middleware (validate/audit_mutations), config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient, fakeUser } from './_fakes.js';
import { pool } from '../src/db.js';

// Import after setup so env vars are populated.
import { hashPassword, verifyPassword, validatePasswordStrength } from '../src/auth/password.js';
import { signToken, verifyToken } from '../src/auth/tokens.js';
import {
  loadUserForLogin, isLocked, recordFailedLogin, recordSuccessfulLogin, adminUnlock
} from '../src/auth/lockout.js';
import authPlugin from '../src/auth/plugin.js';
import { logPermissionEvent } from '../src/rbac/audit.js';
import {
  requireAuth, requirePermission, getCityScope, assertCityAccess, canAccessFinance
} from '../src/rbac/enforce.js';
import { PERMISSIONS } from '../src/rbac/permissions.js';
import { requireFields, check } from '../src/middleware/validate.js';
import auditMutationsPlugin from '../src/middleware/audit_mutations.js';
import { config } from '../src/config.js';

// ============================================================================
// config + permissions constants
// ============================================================================
test('config has required keys', () => {
  assert.ok(config.databaseUrl);
  assert.ok(config.jwtSecret);
  assert.ok(config.lockoutThreshold >= 1);
});

test('PERMISSIONS enum is populated', () => {
  for (const k of ['USER_MANAGE', 'CANDIDATE_READ', 'AUDIT_READ']) assert.ok(PERMISSIONS[k]);
});

// ============================================================================
// password
// ============================================================================
test('hashPassword / verifyPassword round-trip', async () => {
  const pw = 'StrongPass1234!';
  const h = await hashPassword(pw);
  assert.ok(h.startsWith('$2'));
  assert.equal(await verifyPassword(pw, h), true);
  assert.equal(await verifyPassword('wrong', h), false);
});

test('validatePasswordStrength enforces min length and complexity', () => {
  assert.throws(() => validatePasswordStrength('short'), /at least/);
  assert.throws(() => validatePasswordStrength(123), /at least/);
  assert.throws(() => validatePasswordStrength('correcthorsebatterystaple1!'), /uppercase/);
  assert.throws(() => validatePasswordStrength('CorrectHorseBatteryStaple!'), /digit/);
  assert.throws(() => validatePasswordStrength('CorrectHorse123456789'), /special/);
  validatePasswordStrength('CorrectHorse2Battery!'); // no throw
});

// ============================================================================
// tokens
// ============================================================================
test('signToken / verifyToken round-trip', () => {
  const t = signToken({ sub: 1, username: 'u' });
  const d = verifyToken(t);
  assert.equal(d.sub, 1);
  assert.throws(() => verifyToken('bogus'));
});

// ============================================================================
// lockout
// ============================================================================
test('isLocked — no user, inactive, active+locked, unlocked', () => {
  assert.equal(isLocked(null).locked, false);
  assert.equal(isLocked({ is_active: false }).locked, true);
  assert.equal(isLocked({ is_active: true, locked_until: null }).locked, false);
  const inFuture = new Date(Date.now() + 60_000);
  assert.equal(isLocked({ is_active: true, locked_until: inFuture }).locked, true);
  const pastLock = new Date(Date.now() - 60_000);
  assert.equal(isLocked({ is_active: true, locked_until: pastLock }).locked, false);
});

test('loadUserForLogin / recordFailedLogin / recordSuccessfulLogin / adminUnlock', async () => {
  const c = makeClient([
    { match: /FROM core\.app_user WHERE username/, rows: [{ id: 1, username: 'u', password_hash: 'h', is_active: true, failed_login_count: 0, locked_until: null }] },
    { match: /UPDATE core\.app_user\s+SET failed_login_count = CASE/, rows: [{ failed_login_count: 1, locked_until: null }] },
    // adminUnlock has RETURNING id, username; recordSuccessfulLogin has no RETURNING.
    { match: (sql) => /UPDATE core\.app_user/.test(sql) && /RETURNING/.test(sql), rows: [{ id: 1, username: 'u' }] },
    { match: /UPDATE core\.app_user/, rows: [] }
  ]);
  assert.ok(await loadUserForLogin(c, 'u'));
  assert.ok(await recordFailedLogin(c, 1));
  await recordSuccessfulLogin(c, 1);
  assert.ok(await adminUnlock(c, 1));

  const noUser = makeClient([{ match: /FROM core\.app_user WHERE username/, rows: [] }]);
  assert.equal(await loadUserForLogin(noUser, 'x'), null);
});

// ============================================================================
// rbac/audit.logPermissionEvent
// ============================================================================
test('logPermissionEvent — happy path + error swallow', async () => {
  const orig = pool.query;
  try {
    let called = false;
    pool.query = async () => { called = true; return { rows: [] }; };
    await logPermissionEvent({
      user: { id: 1, username: 'u' }, permissionCode: 'a',
      resource: 'r', action: 'x', entity_type: 'v', entity_id: 1,
      granted: true, reason: 'ok',
      request: { headers: { 'x-workstation': 'ws' }, method: 'GET', url: '/x', ip: '1.1.1.1' },
      metadata: { a: 1 }
    });
    assert.equal(called, true);

    // error path: pool.query throws, function swallows
    pool.query = async () => { throw new Error('db boom'); };
    await logPermissionEvent({ permissionCode: 'a', granted: false, request: { log: { error: () => {} } } });

    // Null user + missing fields
    pool.query = async () => ({ rows: [] });
    await logPermissionEvent({ permissionCode: 'a', granted: true });
    await logPermissionEvent({ user: null, permissionCode: 'a', granted: true, request: { headers: { 'X-Workstation': 'W' } } });
  } finally {
    pool.query = orig;
  }
});

// ============================================================================
// rbac/enforce
// ============================================================================
test('requireAuth — 401 without user, pass with user', async () => {
  const mw = requireAuth();
  const origQ = pool.query;
  pool.query = async () => ({ rows: [] });
  try {
    // 401 branch
    const rep1 = { code(c) { this._c = c; return this; }, send(b) { this._b = b; return this; } };
    await mw({ user: null, headers: {} }, rep1);
    assert.equal(rep1._c, 401);

    // pass branch returns undefined
    const rep2 = { code: () => rep2, send: () => rep2 };
    const r = await mw({ user: { id: 1 }, headers: {} }, rep2);
    assert.equal(r, undefined);
  } finally { pool.query = origQ; }
});

test('requirePermission — 401 / 403 / pass', async () => {
  const mw = requirePermission('x');
  const origQ = pool.query;
  pool.query = async () => ({ rows: [] });
  try {
    const r1 = { code(c) { this._c = c; return this; }, send() { return this; } };
    await mw({ user: null, headers: {} }, r1);
    assert.equal(r1._c, 401);

    const r2 = { code(c) { this._c = c; return this; }, send() { return this; } };
    await mw({ user: { permissions: new Set() }, headers: {} }, r2);
    assert.equal(r2._c, 403);

    const r3 = { code: () => r3, send: () => r3 };
    const result = await mw({ user: { permissions: new Set(['x']) }, headers: {} }, r3);
    assert.equal(result, undefined);
  } finally { pool.query = origQ; }
});

test('getCityScope + assertCityAccess + canAccessFinance', () => {
  const all = fakeUser({ permissions: [PERMISSIONS.DATA_CITY_ALL] });
  assert.equal(getCityScope(all).all, true);
  assert.equal(assertCityAccess(all, 9), true);

  const assigned = fakeUser({ permissions: [PERMISSIONS.DATA_CITY_ASSIGNED], assignedCityIds: [1] });
  assert.deepEqual(getCityScope(assigned), { all: false, cityIds: [1] });
  assert.equal(assertCityAccess(assigned, 1), true);
  assert.equal(assertCityAccess(assigned, 2), false);

  const noScope = fakeUser({ permissions: [] });
  assert.deepEqual(getCityScope(noScope), { all: false, cityIds: [] });

  assert.equal(canAccessFinance(fakeUser({ permissions: ['finance.read'] })), true);
  assert.equal(canAccessFinance(fakeUser({ permissions: [] })), false);
});

// ============================================================================
// middleware validate.js
// ============================================================================
test('requireFields — missing / empty / pass', async () => {
  const mw = requireFields(['a', 'b']);
  const rep1 = { code(c) { this._c = c; return this; }, send(b) { this._b = b; return this; } };
  await mw({ body: { a: 1 } }, rep1);
  assert.equal(rep1._c, 400);

  const rep2 = { code: () => rep2, send: () => rep2 };
  const r = await mw({ body: { a: 1, b: 2 } }, rep2);
  assert.equal(r, undefined);

  const rep3 = { code(c) { this._c = c; return this; }, send() { return this; } };
  await mw({ body: { a: '', b: null } }, rep3);
  assert.equal(rep3._c, 400);
});

test('check — issues / ok', async () => {
  const mw = check(() => null);
  const rep1 = { code: () => rep1, send: () => rep1 };
  assert.equal(await mw({}, rep1), undefined);

  const mw2 = check(() => ['bad']);
  const rep2 = { code(c) { this._c = c; return this; }, send(b) { this._b = b; return this; } };
  await mw2({}, rep2);
  assert.equal(rep2._c, 400);
});

// ============================================================================
// middleware/audit_mutations
// ============================================================================
test('audit_mutations — hook fires for POST 2xx with user, skips others', async () => {
  const hooks = {};
  const fakeApp = {
    addHook: (name, fn) => { hooks[name] = fn; }
  };
  await auditMutationsPlugin(fakeApp);
  assert.ok(hooks.onResponse);

  const origQ = pool.query;
  pool.query = async () => ({ rows: [] });
  try {
    // Untracked method
    await hooks.onResponse({ method: 'GET', user: { id: 1 } }, { statusCode: 200 });
    // No user
    await hooks.onResponse({ method: 'POST', user: null }, { statusCode: 200 });
    // 4xx
    await hooks.onResponse({ method: 'POST', user: { id: 1 }, url: '/x' }, { statusCode: 400 });
    // skipped path
    await hooks.onResponse({ method: 'POST', user: { id: 1 }, url: '/auth/login' }, { statusCode: 200 });
    // tracked
    await hooks.onResponse({
      method: 'POST',
      user: { id: 1, username: 'u' },
      url: '/orders',
      headers: { 'x-workstation': 'ws' },
      routeOptions: { url: '/orders' },
      log: { error: () => {} }
    }, { statusCode: 201 });
  } finally { pool.query = origQ; }
});

// ============================================================================
// auth/plugin
// ============================================================================
test('authPlugin — onRequest hook; valid / missing / bad token / inactive user / no user', async () => {
  const hooks = {};
  const fakeApp = {
    decorateRequest: () => {},
    addHook: (name, fn) => { hooks[name] = fn; }
  };
  await authPlugin(fakeApp);

  // Missing header → no user
  const r1 = { headers: {} };
  await hooks.onRequest(r1);
  assert.equal(r1.user, undefined);

  // Bad Bearer → caught
  const r2 = { headers: { authorization: 'Bearer garbage' } };
  await hooks.onRequest(r2);
  assert.equal(r2.user, undefined);

  // Valid token + active user
  const token = signToken({ sub: 42, username: 'u' });
  const origQ = pool.query;
  pool.query = async (sql) => {
    if (/FROM core\.app_user/.test(sql)) return { rows: [{ id: 42, username: 'u', email: 'e', full_name: 'f', is_active: true }] };
    if (/v_user_permission/.test(sql)) return { rows: [{ code: 'audit.read', layer: 'action' }] };
    if (/FROM core\.user_role/.test(sql)) return { rows: [{ code: 'ADMIN', name: 'Admin' }] };
    if (/FROM core\.user_city/.test(sql)) return { rows: [{ id: 1, code: 'NYC', name: 'New York' }] };
    return { rows: [] };
  };
  const r3 = { headers: { authorization: `Bearer ${token}` } };
  await hooks.onRequest(r3);
  assert.ok(r3.user);
  assert.equal(r3.user.id, 42);

  // Valid token but inactive user
  pool.query = async (sql) => {
    if (/FROM core\.app_user/.test(sql)) return { rows: [{ id: 42, is_active: false }] };
    return { rows: [] };
  };
  const r4 = { headers: { authorization: `Bearer ${token}` } };
  await hooks.onRequest(r4);
  assert.equal(r4.user, undefined);

  // Valid token but user missing
  pool.query = async () => ({ rows: [] });
  const r5 = { headers: { authorization: `Bearer ${token}` } };
  await hooks.onRequest(r5);
  assert.equal(r5.user, undefined);

  pool.query = origQ;
});
