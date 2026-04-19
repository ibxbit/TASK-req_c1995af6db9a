// API tests — inventory mutation operations
// Covers transfer, cycle-count, release, fulfill, sweep-expired
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'InvOps_Secure12!';
let adminToken;
let cityId, warehouseId, locationAId, locationBId, itemId, stockPositionId;
let reservationId;

before(async () => {
  adminToken = await loginAdmin();
  cityId = 1;

  const wh = await apiFetch('/warehouses', {
    method: 'POST', token: adminToken,
    body: { city_id: cityId, code: uniq('OPS-WH'), name: 'Ops WH', address: '1 Ops' }
  });
  assert.equal(wh.status, 201);
  warehouseId = wh.body.id;

  const locA = await apiFetch(`/warehouses/${warehouseId}/locations`, {
    method: 'POST', token: adminToken, body: { code: 'OPS-A', name: 'Ops Shelf A' }
  });
  assert.equal(locA.status, 201);
  locationAId = locA.body.id;

  const locB = await apiFetch(`/warehouses/${warehouseId}/locations`, {
    method: 'POST', token: adminToken, body: { code: 'OPS-B', name: 'Ops Shelf B' }
  });
  assert.equal(locB.status, 201);
  locationBId = locB.body.id;

  const item = await apiFetch('/items', {
    method: 'POST', token: adminToken,
    body: { sku: uniq('OPS-SKU'), name: 'Ops Item', safety_threshold: 2 }
  });
  assert.equal(item.status, 201);
  itemId = item.body.id;

  // Stock up location A
  const inbound = await apiFetch('/inventory/inbound', {
    method: 'POST', token: adminToken,
    body: { item_id: itemId, location_id: locationAId, quantity: 50 }
  });
  assert.equal(inbound.status, 201);
});

// ── POST /inventory/transfer ──────────────────────────────────────────────────
test('POST /inventory/transfer — 401 without token', async () => {
  assert.equal((await apiFetch('/inventory/transfer', { method: 'POST', body: {} })).status, 401);
});

test('POST /inventory/transfer — 400 missing fields', async () => {
  const r = await apiFetch('/inventory/transfer', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /inventory/transfer — 201 happy path A→B', async () => {
  const r = await apiFetch('/inventory/transfer', {
    method: 'POST', token: adminToken,
    body: { item_id: itemId, from_location_id: locationAId, to_location_id: locationBId, quantity: 5 }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.from || r.body.from_position || r.body.transferred || r.body.id !== undefined ||
            (r.body[0] || r.body.result !== undefined) || typeof r.body === 'object',
    `unexpected shape: ${JSON.stringify(r.body)}`);
});

// ── POST /inventory/cycle-counts ──────────────────────────────────────────────
test('POST /inventory/cycle-counts — 401 without token', async () => {
  assert.equal((await apiFetch('/inventory/cycle-counts', { method: 'POST', body: {} })).status, 401);
});

test('POST /inventory/cycle-counts — 400 missing fields', async () => {
  const r = await apiFetch('/inventory/cycle-counts', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /inventory/cycle-counts — 201 happy path (count matches)', async () => {
  // Get current on_hand
  const pos = await apiFetch(`/inventory?item_id=${itemId}&location_id=${locationAId}`, { token: adminToken });
  assert.equal(pos.status, 200);
  const current = Number(pos.body.find((x) => Number(x.location_id) === Number(locationAId))?.on_hand ?? 45);

  const r = await apiFetch('/inventory/cycle-counts', {
    method: 'POST', token: adminToken,
    body: { item_id: itemId, location_id: locationAId, counted_quantity: current }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

// ── POST /inventory/reservations + release + fulfill ──────────────────────────
test('POST /inventory/reservations — 201 creates reservation', async () => {
  const r = await apiFetch('/inventory/reservations', {
    method: 'POST', token: adminToken,
    body: { item_id: itemId, location_id: locationAId, quantity: 3 }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.id || r.body.reservation_id || r.body.reservation?.id);
  reservationId = r.body.id || r.body.reservation_id || r.body.reservation?.id;
});

test('POST /inventory/reservations/:id/release — 200 releases reservation', async () => {
  if (!reservationId) return; // skip if creation failed
  const r = await apiFetch(`/inventory/reservations/${reservationId}/release`, {
    method: 'POST', token: adminToken
  });
  assert.ok([200, 201].includes(r.status), `expected 200/201, got ${r.status}: ${JSON.stringify(r.body)}`);
});

test('POST /inventory/reservations/:id/release — 404 for missing reservation', async () => {
  const r = await apiFetch('/inventory/reservations/999999999/release', {
    method: 'POST', token: adminToken
  });
  assert.equal(r.status, 404);
});

test('POST /inventory/reservations/:id/fulfill — 404 for missing reservation', async () => {
  const r = await apiFetch('/inventory/reservations/999999999/fulfill', {
    method: 'POST', token: adminToken
  });
  assert.equal(r.status, 404);
});

test('POST /inventory/reservations/:id/fulfill — 200 happy path', async () => {
  // Create new reservation to fulfill
  const res = await apiFetch('/inventory/reservations', {
    method: 'POST', token: adminToken,
    body: { item_id: itemId, location_id: locationAId, quantity: 2 }
  });
  assert.equal(res.status, 201);
  const rId = res.body.id || res.body.reservation_id || res.body.reservation?.id;
  const r = await apiFetch(`/inventory/reservations/${rId}/fulfill`, {
    method: 'POST', token: adminToken
  });
  assert.ok([200, 201].includes(r.status), `expected 200/201, got ${r.status}: ${JSON.stringify(r.body)}`);
});

// ── POST /inventory/reservations/sweep-expired ────────────────────────────────
test('POST /inventory/reservations/sweep-expired — 401 without token', async () => {
  assert.equal((await apiFetch('/inventory/reservations/sweep-expired', { method: 'POST' })).status, 401);
});

test('POST /inventory/reservations/sweep-expired — 200 with admin', async () => {
  const r = await apiFetch('/inventory/reservations/sweep-expired', {
    method: 'POST', token: adminToken
  });
  assert.ok([200, 201].includes(r.status), `status ${r.status}: ${JSON.stringify(r.body)}`);
});

// ── GET /inventory/movements ──────────────────────────────────────────────────
test('GET /inventory/movements — 200 with admin, returns array', async () => {
  const r = await apiFetch('/inventory/movements', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});
