// API tests — itinerary templates list/detail/create/apply
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'ItinTpl_Secure12!';
let adminToken;
let warehouseToken; // no itinerary.read

before(async () => {
  adminToken = await loginAdmin();

  const wName = uniq('tpl-wh');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: wName, email: `${wName}@local`, full_name: 'Tpl WH',
            password: PASS, role_codes: ['WAREHOUSE'] }
  });
  const wLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: wName, password: PASS } });
  warehouseToken = wLogin.body.token;
});

// ── GET /itinerary-templates ──────────────────────────────────────────────────
test('GET /itinerary-templates — 401 without token', async () => {
  assert.equal((await apiFetch('/itinerary-templates')).status, 401);
});

test('GET /itinerary-templates — 403 without itinerary.read (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/itinerary-templates', { token: warehouseToken })).status, 403);
});

test('GET /itinerary-templates — 200 with admin, returns array', async () => {
  const r = await apiFetch('/itinerary-templates', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── POST /itinerary-templates ─────────────────────────────────────────────────
test('POST /itinerary-templates — 401 without token', async () => {
  assert.equal((await apiFetch('/itinerary-templates', { method: 'POST', body: {} })).status, 401);
});

test('POST /itinerary-templates — 400 missing required fields', async () => {
  const r = await apiFetch('/itinerary-templates', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /itinerary-templates — 201 happy path', async () => {
  const r = await apiFetch('/itinerary-templates', {
    method: 'POST', token: adminToken,
    body: {
      name: uniq('TPL'),
      description: 'Test template',
      events: [
        { title: 'Opening', sequence: 1, default_duration_minutes: 60, offset_from_start_minutes: 0 }
      ]
    }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.id);
});

// ── GET /itinerary-templates/:id ──────────────────────────────────────────────
test('GET /itinerary-templates/:id — 404 for missing template', async () => {
  assert.equal((await apiFetch('/itinerary-templates/999999999', { token: adminToken })).status, 404);
});

test('GET /itinerary-templates/:id — 200 returns template with events', async () => {
  const created = await apiFetch('/itinerary-templates', {
    method: 'POST', token: adminToken,
    body: {
      name: uniq('TPL-GET'),
      events: [{ title: 'Step 1', sequence: 1, default_duration_minutes: 30, offset_from_start_minutes: 0 }]
    }
  });
  assert.equal(created.status, 201);
  const r = await apiFetch(`/itinerary-templates/${created.body.id}`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, created.body.id);
  assert.ok(Array.isArray(r.body.events));
});

// ── POST /itinerary-templates/:id/apply ───────────────────────────────────────
test('POST /itinerary-templates/:id/apply — 404 for missing template', async () => {
  const itin = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-TPL'), starts_on: new Date().toISOString().slice(0, 10) }
  });
  assert.equal(itin.status, 201);
  const r = await apiFetch('/itinerary-templates/999999999/apply', {
    method: 'POST', token: adminToken,
    body: { itinerary_id: itin.body.id, start_at: new Date(Date.now() + 86400000).toISOString() }
  });
  assert.equal(r.status, 404);
});

test('POST /itinerary-templates/:id/apply — 200 applies template to itinerary', async () => {
  const tpl = await apiFetch('/itinerary-templates', {
    method: 'POST', token: adminToken,
    body: {
      name: uniq('TPL-APPLY'),
      events: [{ title: 'Main Event', sequence: 1, default_duration_minutes: 120, offset_from_start_minutes: 0 }]
    }
  });
  assert.equal(tpl.status, 201);

  const itin = await apiFetch('/itineraries', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('ITIN-APPLY'), starts_on: new Date().toISOString().slice(0, 10) }
  });
  assert.equal(itin.status, 201);

  const r = await apiFetch(`/itinerary-templates/${tpl.body.id}/apply`, {
    method: 'POST', token: adminToken,
    body: { itinerary_id: itin.body.id, start_at: new Date(Date.now() + 86400000).toISOString() }
  });
  assert.ok([200, 201].includes(r.status), `status ${r.status}: ${JSON.stringify(r.body)}`);
});
