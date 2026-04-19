// API tests — itineraries full CRUD + events + reorder + validate + versions
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'Itinerary_Secure12!';
let adminToken;
let warehouseToken; // no itinerary.read

const iso = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

before(async () => {
  adminToken = await loginAdmin();

  const wName = uniq('itin-wh');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: wName, email: `${wName}@local`, full_name: 'Itin WH',
            password: PASS, role_codes: ['WAREHOUSE'] }
  });
  const wLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: wName, password: PASS } });
  warehouseToken = wLogin.body.token;
});

// ── GET /itineraries ──────────────────────────────────────────────────────────
test('GET /itineraries — 401 without token', async () => {
  assert.equal((await apiFetch('/itineraries')).status, 401);
});

test('GET /itineraries — 403 without itinerary.read (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/itineraries', { token: warehouseToken })).status, 403);
});

test('GET /itineraries — 200 with admin', async () => {
  const r = await apiFetch('/itineraries', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── POST /itineraries ─────────────────────────────────────────────────────────
test('POST /itineraries — 401 without token', async () => {
  assert.equal((await apiFetch('/itineraries', { method: 'POST', body: {} })).status, 401);
});

test('POST /itineraries — 400 missing required fields', async () => {
  const r = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /itineraries — 201 happy path', async () => {
  const r = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.id);
  assert.equal(Number(r.body.city_id), 1);
});

// ── GET /itineraries/:id ──────────────────────────────────────────────────────
test('GET /itineraries/:id — 404 for missing itinerary', async () => {
  assert.equal((await apiFetch('/itineraries/999999999', { token: adminToken })).status, 404);
});

test('GET /itineraries/:id — 200 for created itinerary', async () => {
  const created = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-GET'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(created.status, 201);
  const r = await apiFetch(`/itineraries/${created.body.id}`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, created.body.id);
});

// ── PUT /itineraries/:id ──────────────────────────────────────────────────────
test('PUT /itineraries/:id — 404 for missing itinerary', async () => {
  const r = await apiFetch('/itineraries/999999999', {
    method: 'PUT', token: adminToken, body: { name: 'X' }
  });
  assert.equal(r.status, 404);
});

test('PUT /itineraries/:id — 200 updates itinerary', async () => {
  const created = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-PUT'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(created.status, 201);
  const r = await apiFetch(`/itineraries/${created.body.id}`, {
    method: 'PUT', token: adminToken, body: { name: 'Updated Itinerary' }
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Updated Itinerary');
});

// ── GET /itineraries/:id/validate ─────────────────────────────────────────────
test('GET /itineraries/:id/validate — 404 for missing itinerary', async () => {
  assert.equal((await apiFetch('/itineraries/999999999/validate', { token: adminToken })).status, 404);
});

test('GET /itineraries/:id/validate — 200 with conflicts array', async () => {
  const created = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-VAL'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(created.status, 201);
  const r = await apiFetch(`/itineraries/${created.body.id}/validate`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(r.body.conflicts !== undefined || Array.isArray(r.body.issues) || Array.isArray(r.body),
    `unexpected shape: ${JSON.stringify(r.body)}`);
});

// ── POST /itineraries/:id/events ──────────────────────────────────────────────
test('POST /itineraries/:id/events — 400 missing required fields', async () => {
  const itin = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-EV'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(itin.status, 201);
  const r = await apiFetch(`/itineraries/${itin.body.id}/events`, {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /itineraries/:id/events — 201 adds event to itinerary', async () => {
  const itin = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-EV2'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(itin.status, 201);
  const r = await apiFetch(`/itineraries/${itin.body.id}/events`, {
    method: 'POST', token: adminToken,
    body: { venue_id: 1, starts_at: iso(24), ends_at: iso(26), notes: 'Test event' }
  });
  assert.ok([201, 200].includes(r.status), `status ${r.status}: ${JSON.stringify(r.body)}`);
});

// ── POST /itineraries/:id/reorder ─────────────────────────────────────────────
test('POST /itineraries/:id/reorder — 400 missing event_ids', async () => {
  const itin = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-RO'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(itin.status, 201);
  const r = await apiFetch(`/itineraries/${itin.body.id}/reorder`, {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

// ── GET /itineraries/:id/versions ─────────────────────────────────────────────
test('GET /itineraries/:id/versions — 404 for missing itinerary', async () => {
  assert.equal((await apiFetch('/itineraries/999999999/versions', { token: adminToken })).status, 404);
});

test('GET /itineraries/:id/versions — 200 returns versions array', async () => {
  const itin = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-VER'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(itin.status, 201);
  const r = await apiFetch(`/itineraries/${itin.body.id}/versions`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── GET /itineraries/:id/versions/:n ─────────────────────────────────────────
test('GET /itineraries/:id/versions/:n — 404 for missing version', async () => {
  const itin = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-VN'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(itin.status, 201);
  const r = await apiFetch(`/itineraries/${itin.body.id}/versions/999`, { token: adminToken });
  assert.equal(r.status, 404);
});
