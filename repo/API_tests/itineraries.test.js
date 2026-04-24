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

test('GET /itineraries/:id/validate — 200 returns valid flag and issues array', async () => {
  const created = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-VAL'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(created.status, 201);
  const r = await apiFetch(`/itineraries/${created.body.id}/validate`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.valid, 'boolean', `expected boolean valid field, got: ${JSON.stringify(r.body)}`);
  assert.ok(Array.isArray(r.body.issues), `expected issues array, got: ${JSON.stringify(r.body)}`);
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
    body: { title: 'Workshop', starts_at: iso(24), ends_at: iso(26) }
  });
  assert.equal(r.status, 201, `status ${r.status}: ${JSON.stringify(r.body)}`);
  assert.ok(Array.isArray(r.body.events), 'response should include events array');
  assert.ok(r.body.events.length > 0, 'itinerary should have at least one event after add');
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

// ── PUT /itineraries/:id/events/:eventId ──────────────────────────────────────
test('PUT /itineraries/:id/events/:eventId — 401 without token', async () => {
  const r = await apiFetch('/itineraries/1/events/1', { method: 'PUT', body: { title: 'X' } });
  assert.equal(r.status, 401);
});

test('PUT /itineraries/:id/events/:eventId — 404 for non-existent event', async () => {
  const itin = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-PUT-EV'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(itin.status, 201);
  const r = await apiFetch(`/itineraries/${itin.body.id}/events/999999999`, {
    method: 'PUT', token: adminToken, body: { title: 'Updated' }
  });
  assert.equal(r.status, 404);
});

test('PUT /itineraries/:id/events/:eventId — 200 updates event fields', async () => {
  // Create itinerary, add one event, then update its title.
  const itin = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-PUT-EV2'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(itin.status, 201);

  const addEvent = await apiFetch(`/itineraries/${itin.body.id}/events`, {
    method: 'POST', token: adminToken,
    body: { title: 'Original Title', starts_at: iso(48), ends_at: iso(50) }
  });
  assert.equal(addEvent.status, 201);
  const eventId = addEvent.body.events[0].id;

  const r = await apiFetch(`/itineraries/${itin.body.id}/events/${eventId}`, {
    method: 'PUT', token: adminToken, body: { title: 'Updated Title' }
  });
  assert.equal(r.status, 200, `PUT event failed: ${JSON.stringify(r.body)}`);
  assert.ok(Array.isArray(r.body.events), 'response should include events array');
  const updatedEvent = r.body.events.find((e) => e.id === eventId);
  assert.ok(updatedEvent, 'updated event should be present in response');
  assert.equal(updatedEvent.title, 'Updated Title', 'event title should be updated');
});

// ── DELETE /itineraries/:id/events/:eventId ───────────────────────────────────
test('DELETE /itineraries/:id/events/:eventId — 401 without token', async () => {
  const r = await apiFetch('/itineraries/1/events/1', { method: 'DELETE' });
  assert.equal(r.status, 401);
});

test('DELETE /itineraries/:id/events/:eventId — 404 for non-existent event', async () => {
  const itin = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-DEL-EV'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(itin.status, 201);
  const r = await apiFetch(`/itineraries/${itin.body.id}/events/999999999`, {
    method: 'DELETE', token: adminToken
  });
  assert.equal(r.status, 404);
});

test('DELETE /itineraries/:id/events/:eventId — 200 removes event from itinerary', async () => {
  const itin = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-DEL-EV2'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(itin.status, 201);

  const addEvent = await apiFetch(`/itineraries/${itin.body.id}/events`, {
    method: 'POST', token: adminToken,
    body: { title: 'To Delete', starts_at: iso(72), ends_at: iso(74) }
  });
  assert.equal(addEvent.status, 201);
  const eventId = addEvent.body.events[0].id;

  const r = await apiFetch(`/itineraries/${itin.body.id}/events/${eventId}`, {
    method: 'DELETE', token: adminToken
  });
  assert.equal(r.status, 200, `DELETE event failed: ${JSON.stringify(r.body)}`);
  assert.ok(Array.isArray(r.body.events), 'response should include events array');
  assert.equal(r.body.events.length, 0, 'itinerary should have no events after deletion');
});

// ── POST /itineraries/:id/versions/:n/restore ─────────────────────────────────
test('POST /itineraries/:id/versions/:n/restore — 401 without token', async () => {
  const r = await apiFetch('/itineraries/1/versions/1/restore', { method: 'POST', body: {} });
  assert.equal(r.status, 401);
});

test('POST /itineraries/:id/versions/:n/restore — 404 for non-existent version', async () => {
  const itin = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-REST'), starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(itin.status, 201);
  const r = await apiFetch(`/itineraries/${itin.body.id}/versions/999/restore`, {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 404);
});

test('POST /itineraries/:id/versions/:n/restore — 200 restores itinerary to version snapshot', async () => {
  // Create itinerary (version 1), then rename it (version 2), then restore to version 1.
  const originalName = uniq('ITIN-RESTORE-ORIG');
  const itin = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: originalName, starts_on: iso(0).slice(0, 10) }
  });
  assert.equal(itin.status, 201);
  const itinId = itin.body.id;

  // Rename — this creates version 2.
  const renamed = await apiFetch(`/itineraries/${itinId}`, {
    method: 'PUT', token: adminToken, body: { name: uniq('ITIN-RESTORE-V2') }
  });
  assert.equal(renamed.status, 200);

  // Confirm versions list has at least version 1 and version 2.
  const versions = await apiFetch(`/itineraries/${itinId}/versions`, { token: adminToken });
  assert.equal(versions.status, 200);
  assert.ok(versions.body.length >= 2, 'should have at least 2 versions after rename');

  // Restore to version 1 — should return the itinerary aggregate with original name.
  const restore = await apiFetch(`/itineraries/${itinId}/versions/1/restore`, {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(restore.status, 200, `restore failed: ${JSON.stringify(restore.body)}`);
  assert.ok(restore.body.id === itinId, 'restored itinerary should have same id');
  assert.equal(restore.body.name, originalName, 'restored name should match version 1 snapshot');
});
