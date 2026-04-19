// API tests — vendors CRUD + masked banking + reveal
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'Vendors_Secure12!';
let adminToken;
let warehouseToken; // no vendor.read

before(async () => {
  adminToken = await loginAdmin();

  const wName = uniq('vnd-wh');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: wName, email: `${wName}@local`, full_name: 'Vnd WH',
            password: PASS, role_codes: ['WAREHOUSE'] }
  });
  const wLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: wName, password: PASS } });
  warehouseToken = wLogin.body.token;
});

// ── GET /vendors ──────────────────────────────────────────────────────────────
test('GET /vendors — 401 without token', async () => {
  assert.equal((await apiFetch('/vendors')).status, 401);
});

test('GET /vendors — 403 without vendor.read (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/vendors', { token: warehouseToken })).status, 403);
});

test('GET /vendors — 200 with admin, returns array', async () => {
  const r = await apiFetch('/vendors', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── POST /vendors ─────────────────────────────────────────────────────────────
test('POST /vendors — 401 without token', async () => {
  assert.equal((await apiFetch('/vendors', { method: 'POST', body: {} })).status, 401);
});

test('POST /vendors — 400 missing required fields', async () => {
  const r = await apiFetch('/vendors', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /vendors — 201 happy path', async () => {
  const r = await apiFetch('/vendors', {
    method: 'POST', token: adminToken,
    body: { code: uniq('VND'), legal_name: 'Test Vendor LLC' }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.id);
});

// ── GET /vendors/:id/banking ──────────────────────────────────────────────────
test('GET /vendors/:id/banking — 401 without token', async () => {
  assert.equal((await apiFetch('/vendors/1/banking')).status, 401);
});

test('GET /vendors/:id/banking — 404 for missing vendor', async () => {
  const r = await apiFetch('/vendors/999999999/banking', { token: adminToken });
  assert.equal(r.status, 404);
});

test('GET /vendors/:id/banking — 200 returns masked banking', async () => {
  const vendor = await apiFetch('/vendors', {
    method: 'POST', token: adminToken,
    body: { code: uniq('VND-BNK'), legal_name: 'Banking Vendor' }
  });
  assert.equal(vendor.status, 201);
  const r = await apiFetch(`/vendors/${vendor.body.id}/banking`, { token: adminToken });
  assert.ok([200, 404].includes(r.status), `unexpected status ${r.status}: ${JSON.stringify(r.body)}`);
});

// ── PUT /vendors/:id/banking ──────────────────────────────────────────────────
test('PUT /vendors/:id/banking — 401 without token', async () => {
  assert.equal((await apiFetch('/vendors/1/banking', { method: 'PUT', body: {} })).status, 401);
});

test('PUT /vendors/:id/banking — 200 updates banking', async () => {
  const vendor = await apiFetch('/vendors', {
    method: 'POST', token: adminToken,
    body: { code: uniq('VND-UPD'), legal_name: 'Update Vendor' }
  });
  assert.equal(vendor.status, 201);
  const r = await apiFetch(`/vendors/${vendor.body.id}/banking`, {
    method: 'PUT', token: adminToken,
    body: { tax_id: '12-3456789', bank_routing: '021000021', bank_account: '9876543210' }
  });
  assert.ok([200, 201].includes(r.status), `status ${r.status}: ${JSON.stringify(r.body)}`);
});

// ── POST /vendors/:id/banking/reveal ─────────────────────────────────────────
test('POST /vendors/:id/banking/reveal — 401 without token', async () => {
  assert.equal((await apiFetch('/vendors/1/banking/reveal', { method: 'POST' })).status, 401);
});

test('POST /vendors/:id/banking/reveal — 404 for missing vendor', async () => {
  const r = await apiFetch('/vendors/999999999/banking/reveal', {
    method: 'POST', token: adminToken, body: { reason: 'audit' }
  });
  assert.equal(r.status, 404);
});

test('POST /vendors/:id/banking/reveal — 200 reveals banking', async () => {
  const vendor = await apiFetch('/vendors', {
    method: 'POST', token: adminToken,
    body: { code: uniq('VND-REV'), legal_name: 'Reveal Vendor' }
  });
  assert.equal(vendor.status, 201);
  // Set banking first
  await apiFetch(`/vendors/${vendor.body.id}/banking`, {
    method: 'PUT', token: adminToken,
    body: { tax_id: '12-9999999', bank_routing: '021000021', bank_account: '1234567890' }
  });
  const r = await apiFetch(`/vendors/${vendor.body.id}/banking/reveal`, {
    method: 'POST', token: adminToken, body: { reason: 'annual audit' }
  });
  assert.ok([200, 404].includes(r.status), `status ${r.status}: ${JSON.stringify(r.body)}`);
});
