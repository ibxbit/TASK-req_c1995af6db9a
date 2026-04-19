// API tests — audit stats and log endpoints
// Covers GET /audit/events, /audit/log, /audit/stats/*, /audit/retention
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'AuditStats_Secure12!';
let adminToken;
let noAuditToken; // WAREHOUSE has no audit.read

before(async () => {
  adminToken = await loginAdmin();
  const u = uniq('auditst');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: u, email: `${u}@local`, full_name: 'Audit Stats User',
            password: PASS, role_codes: ['WAREHOUSE'] }
  });
  const login = await apiFetch('/auth/login', { method: 'POST', body: { username: u, password: PASS } });
  assert.equal(login.status, 200);
  noAuditToken = login.body.token;
});

// ── /audit/events ────────────────────────────────────────────────────────────
test('GET /audit/events — 401 without token', async () => {
  assert.equal((await apiFetch('/audit/events')).status, 401);
});

test('GET /audit/events — 403 without audit.read', async () => {
  assert.equal((await apiFetch('/audit/events', { token: noAuditToken })).status, 403);
});

test('GET /audit/events — 200 with admin, returns array', async () => {
  const r = await apiFetch('/audit/events', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

test('GET /audit/events — filter by action', async () => {
  const r = await apiFetch('/audit/events?action=user.create&limit=10', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

test('GET /audit/events — filter by granted=true', async () => {
  const r = await apiFetch('/audit/events?granted=true&limit=5', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(r.body.every((e) => e.granted === true));
});

// ── /audit/log ───────────────────────────────────────────────────────────────
test('GET /audit/log — 401 without token', async () => {
  assert.equal((await apiFetch('/audit/log')).status, 401);
});

test('GET /audit/log — 403 without audit.read', async () => {
  assert.equal((await apiFetch('/audit/log', { token: noAuditToken })).status, 403);
});

test('GET /audit/log — 200 with admin, returns array', async () => {
  const r = await apiFetch('/audit/log', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── /audit/stats/by-user ─────────────────────────────────────────────────────
test('GET /audit/stats/by-user — 401 without token', async () => {
  assert.equal((await apiFetch('/audit/stats/by-user')).status, 401);
});

test('GET /audit/stats/by-user — 403 without audit.read', async () => {
  assert.equal((await apiFetch('/audit/stats/by-user', { token: noAuditToken })).status, 403);
});

test('GET /audit/stats/by-user — 200 with admin, returns array', async () => {
  const r = await apiFetch('/audit/stats/by-user', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
  if (r.body.length > 0) {
    const row = r.body[0];
    assert.ok('user_id' in row || 'username' in row);
    assert.ok('total' in row);
  }
});

// ── /audit/stats/by-workstation ──────────────────────────────────────────────
test('GET /audit/stats/by-workstation — 401 without token', async () => {
  assert.equal((await apiFetch('/audit/stats/by-workstation')).status, 401);
});

test('GET /audit/stats/by-workstation — 403 without audit.read', async () => {
  assert.equal((await apiFetch('/audit/stats/by-workstation', { token: noAuditToken })).status, 403);
});

test('GET /audit/stats/by-workstation — 200 with admin', async () => {
  const r = await apiFetch('/audit/stats/by-workstation', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── /audit/stats/by-action ───────────────────────────────────────────────────
test('GET /audit/stats/by-action — 401 without token', async () => {
  assert.equal((await apiFetch('/audit/stats/by-action')).status, 401);
});

test('GET /audit/stats/by-action — 403 without audit.read', async () => {
  assert.equal((await apiFetch('/audit/stats/by-action', { token: noAuditToken })).status, 403);
});

test('GET /audit/stats/by-action — 200 with admin', async () => {
  const r = await apiFetch('/audit/stats/by-action', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── /audit/retention ─────────────────────────────────────────────────────────
test('GET /audit/retention — 401 without token', async () => {
  assert.equal((await apiFetch('/audit/retention')).status, 401);
});

test('GET /audit/retention — 403 without audit.read', async () => {
  assert.equal((await apiFetch('/audit/retention', { token: noAuditToken })).status, 403);
});

test('GET /audit/retention — 200 with admin, contains retention_years', async () => {
  const r = await apiFetch('/audit/retention', { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.body.retention_years, 7);
  assert.ok(r.body.note);
});
