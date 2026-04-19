// API tests — events CRUD + headcount + cancel + evaluate-refunds
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'Events_Secure12!';
let adminToken;
let warehouseToken; // no event.read/write

const iso = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

before(async () => {
  adminToken = await loginAdmin();

  const wName = uniq('ev-wh');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: wName, email: `${wName}@local`, full_name: 'Ev WH',
            password: PASS, role_codes: ['WAREHOUSE'] }
  });
  const wLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: wName, password: PASS } });
  assert.equal(wLogin.status, 200);
  warehouseToken = wLogin.body.token;
});

// ── GET /events ───────────────────────────────────────────────────────────────
test('GET /events — 401 without token', async () => {
  assert.equal((await apiFetch('/events')).status, 401);
});

test('GET /events — 403 without event.read (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/events', { token: warehouseToken })).status, 403);
});

test('GET /events — 200 with admin, returns array', async () => {
  const r = await apiFetch('/events', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── POST /events ──────────────────────────────────────────────────────────────
test('POST /events — 401 without token', async () => {
  assert.equal((await apiFetch('/events', { method: 'POST', body: {} })).status, 401);
});

test('POST /events — 403 without event.write (WAREHOUSE)', async () => {
  const r = await apiFetch('/events', {
    method: 'POST', token: warehouseToken,
    body: { city_id: 1, name: 'x', starts_at: iso(24), min_headcount: 1, headcount_cutoff_at: iso(12) }
  });
  assert.equal(r.status, 403);
});

test('POST /events — 400 missing required fields', async () => {
  const r = await apiFetch('/events', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /events — 201 happy path', async () => {
  const r = await apiFetch('/events', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('EV'), starts_at: iso(240), min_headcount: 5,
            headcount_cutoff_at: iso(72) }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.id);
  assert.equal(r.body.status, 'active');
});

// ── GET /events/:id ───────────────────────────────────────────────────────────
test('GET /events/:id — 401 without token', async () => {
  assert.equal((await apiFetch('/events/1')).status, 401);
});

test('GET /events/:id — 404 for non-existent event', async () => {
  assert.equal((await apiFetch('/events/999999999', { token: adminToken })).status, 404);
});

test('GET /events/:id — 200 for seeded or created event', async () => {
  // Create an event to get a valid ID
  const created = await apiFetch('/events', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('EV-GET'), starts_at: iso(480), min_headcount: 2,
            headcount_cutoff_at: iso(168) }
  });
  assert.equal(created.status, 201);
  const r = await apiFetch(`/events/${created.body.id}`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, created.body.id);
});

// ── POST /events/:id/headcount ────────────────────────────────────────────────
test('POST /events/:id/headcount — 401 without token', async () => {
  assert.equal((await apiFetch('/events/1/headcount', { method: 'POST', body: { current_headcount: 5 } })).status, 401);
});

test('POST /events/:id/headcount — 400 invalid headcount', async () => {
  const ev = await apiFetch('/events', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('EV-HC'), starts_at: iso(720), min_headcount: 1, headcount_cutoff_at: iso(360) }
  });
  assert.equal(ev.status, 201);
  const r = await apiFetch(`/events/${ev.body.id}/headcount`, {
    method: 'POST', token: adminToken, body: { current_headcount: -1 }
  });
  assert.equal(r.status, 400);
});

test('POST /events/:id/headcount — 404 for missing event', async () => {
  const r = await apiFetch('/events/999999999/headcount', {
    method: 'POST', token: adminToken, body: { current_headcount: 5 }
  });
  assert.equal(r.status, 404);
});

test('POST /events/:id/headcount — 200 happy path', async () => {
  const ev = await apiFetch('/events', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('EV-HC2'), starts_at: iso(720), min_headcount: 10, headcount_cutoff_at: iso(360) }
  });
  assert.equal(ev.status, 201);
  const r = await apiFetch(`/events/${ev.body.id}/headcount`, {
    method: 'POST', token: adminToken, body: { current_headcount: 3 }
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.event);
  assert.equal(Number(r.body.event.current_headcount), 3);
});

// ── POST /events/:id/cancel ───────────────────────────────────────────────────
test('POST /events/:id/cancel — 401 without token', async () => {
  assert.equal((await apiFetch('/events/1/cancel', { method: 'POST' })).status, 401);
});

test('POST /events/:id/cancel — 404 for missing event', async () => {
  const r = await apiFetch('/events/999999999/cancel', {
    method: 'POST', token: adminToken, body: { reason: 'test' }
  });
  assert.equal(r.status, 404);
});

test('POST /events/:id/cancel — 200 happy path then 409 on re-cancel', async () => {
  const ev = await apiFetch('/events', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('EV-CANCEL'), starts_at: iso(720), min_headcount: 1, headcount_cutoff_at: iso(360) }
  });
  assert.equal(ev.status, 201);
  const cancel = await apiFetch(`/events/${ev.body.id}/cancel`, {
    method: 'POST', token: adminToken, body: { reason: 'API test cancel' }
  });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.event.status, 'canceled');

  // Re-cancel should return 409
  const rCancel = await apiFetch(`/events/${ev.body.id}/cancel`, {
    method: 'POST', token: adminToken, body: { reason: 'again' }
  });
  assert.equal(rCancel.status, 409);
});

// ── POST /events/:id/evaluate-refunds ─────────────────────────────────────────
test('POST /events/:id/evaluate-refunds — 401 without token', async () => {
  assert.equal((await apiFetch('/events/1/evaluate-refunds', { method: 'POST' })).status, 401);
});

test('POST /events/:id/evaluate-refunds — 404 for missing event', async () => {
  const r = await apiFetch('/events/999999999/evaluate-refunds', {
    method: 'POST', token: adminToken
  });
  assert.equal(r.status, 404);
});

test('POST /events/:id/evaluate-refunds — 200 on valid event', async () => {
  const ev = await apiFetch('/events', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('EV-EVAL'), starts_at: iso(720), min_headcount: 1, headcount_cutoff_at: iso(360) }
  });
  assert.equal(ev.status, 201);
  const r = await apiFetch(`/events/${ev.body.id}/evaluate-refunds`, {
    method: 'POST', token: adminToken
  });
  assert.equal(r.status, 200);
});
