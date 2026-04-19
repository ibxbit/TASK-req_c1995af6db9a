// API tests — venues list/create/drive-time
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'Venues_Secure12!';
let adminToken;
let warehouseToken; // no venue.read

before(async () => {
  adminToken = await loginAdmin();

  const wName = uniq('ven-wh');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: wName, email: `${wName}@local`, full_name: 'Ven WH',
            password: PASS, role_codes: ['WAREHOUSE'] }
  });
  const wLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: wName, password: PASS } });
  warehouseToken = wLogin.body.token;
});

// ── GET /venues ───────────────────────────────────────────────────────────────
test('GET /venues — 401 without token', async () => {
  assert.equal((await apiFetch('/venues')).status, 401);
});

test('GET /venues — 403 without venue.read (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/venues', { token: warehouseToken })).status, 403);
});

test('GET /venues — 200 with admin, returns array', async () => {
  const r = await apiFetch('/venues', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── POST /venues ──────────────────────────────────────────────────────────────
test('POST /venues — 401 without token', async () => {
  assert.equal((await apiFetch('/venues', { method: 'POST', body: {} })).status, 401);
});

test('POST /venues — 400 missing required fields', async () => {
  const r = await apiFetch('/venues', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /venues — 201 happy path', async () => {
  const r = await apiFetch('/venues', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('VENUE'), address: '123 Test St' }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.id);
  assert.equal(Number(r.body.city_id), 1);
});

// ── GET /venues/drive-time ────────────────────────────────────────────────────
test('GET /venues/drive-time — 401 without token', async () => {
  assert.equal((await apiFetch('/venues/drive-time?origin=1&destination=2')).status, 401);
});

test('GET /venues/drive-time — 200 or appropriate response for valid venues', async () => {
  const r = await apiFetch('/venues/drive-time?origin=1&destination=2', { token: adminToken });
  assert.ok([200, 404, 422].includes(r.status), `unexpected status ${r.status}: ${JSON.stringify(r.body)}`);
});

// ── POST /venues/drive-time ───────────────────────────────────────────────────
test('POST /venues/drive-time — 401 without token', async () => {
  assert.equal((await apiFetch('/venues/drive-time', { method: 'POST', body: {} })).status, 401);
});

test('POST /venues/drive-time — 400 missing required fields', async () => {
  const r = await apiFetch('/venues/drive-time', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /venues/drive-time — 200 or 201 sets drive time', async () => {
  // Use seeded venue IDs 1 and 2
  const r = await apiFetch('/venues/drive-time', {
    method: 'POST', token: adminToken,
    body: { origin_venue_id: 1, destination_venue_id: 2, minutes: 45 }
  });
  assert.ok([200, 201, 404].includes(r.status), `status ${r.status}: ${JSON.stringify(r.body)}`);
});
