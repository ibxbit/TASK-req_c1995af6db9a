// API tests — warehouses list/detail/create + locations
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'Warehouses_Secure12!';
let adminToken;
let financeToken; // no inventory.read

before(async () => {
  adminToken = await loginAdmin();

  const fName = uniq('wh-fin');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: fName, email: `${fName}@local`, full_name: 'WH Finance',
            password: PASS, role_codes: ['FINANCE'] }
  });
  const fLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: fName, password: PASS } });
  financeToken = fLogin.body.token;
});

// ── GET /warehouses ───────────────────────────────────────────────────────────
test('GET /warehouses — 401 without token', async () => {
  assert.equal((await apiFetch('/warehouses')).status, 401);
});

test('GET /warehouses — 403 without inventory.read (FINANCE)', async () => {
  assert.equal((await apiFetch('/warehouses', { token: financeToken })).status, 403);
});

test('GET /warehouses — 200 with admin, returns array', async () => {
  const r = await apiFetch('/warehouses', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── POST /warehouses ──────────────────────────────────────────────────────────
test('POST /warehouses — 401 without token', async () => {
  assert.equal((await apiFetch('/warehouses', { method: 'POST', body: {} })).status, 401);
});

test('POST /warehouses — 400 missing required fields', async () => {
  const r = await apiFetch('/warehouses', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /warehouses — 201 happy path', async () => {
  const r = await apiFetch('/warehouses', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, code: uniq('WH'), name: 'Test Warehouse', address: '1 Warehouse Rd' }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.id);
  assert.equal(Number(r.body.city_id), 1);
});

// ── GET /warehouses/:id ───────────────────────────────────────────────────────
test('GET /warehouses/:id — 404 for missing warehouse', async () => {
  assert.equal((await apiFetch('/warehouses/999999999', { token: adminToken })).status, 404);
});

test('GET /warehouses/:id — 200 returns warehouse with locations', async () => {
  const created = await apiFetch('/warehouses', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, code: uniq('WH-GET'), name: 'Get Warehouse', address: '2 Warehouse Rd' }
  });
  assert.equal(created.status, 201);
  const r = await apiFetch(`/warehouses/${created.body.id}`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, created.body.id);
  assert.ok(Array.isArray(r.body.locations));
});

// ── POST /warehouses/:id/locations ────────────────────────────────────────────
test('POST /warehouses/:id/locations — 400 missing code', async () => {
  const wh = await apiFetch('/warehouses', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, code: uniq('WH-LOC'), name: 'Loc Warehouse', address: '3 Warehouse Rd' }
  });
  assert.equal(wh.status, 201);
  const r = await apiFetch(`/warehouses/${wh.body.id}/locations`, {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /warehouses/:id/locations — 201 adds location', async () => {
  const wh = await apiFetch('/warehouses', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, code: uniq('WH-LOC2'), name: 'Loc Warehouse 2', address: '4 Warehouse Rd' }
  });
  assert.equal(wh.status, 201);
  const r = await apiFetch(`/warehouses/${wh.body.id}/locations`, {
    method: 'POST', token: adminToken,
    body: { code: 'SHELF-A', name: 'Shelf A' }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.id);
});
