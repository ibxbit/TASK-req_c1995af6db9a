// Unit tests — small routes: candidates, items, warehouses, venues, finance,
// payments (read-only), workflows (approvals), ingestion, admin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerRoutes, setDbHandlers, findRoute, invokeRoute,
  fakeRequest, fakeReply, fakeUser
} from './_route_harness.js';

import candidateRoutes from '../src/routes/candidates.js';
import itemRoutes      from '../src/routes/items.js';
import warehouseRoutes from '../src/routes/warehouses.js';
import venueRoutes     from '../src/routes/venues.js';
import financeRoutes   from '../src/routes/finance.js';
import paymentRoutes   from '../src/routes/payments.js';
import workflowRoutes  from '../src/routes/workflows.js';
import ingestionRoutes from '../src/routes/ingestion.js';
import adminRoutes     from '../src/routes/admin.js';

const ADMIN = fakeUser({ id: 1, permissions: ['data.city.all', 'candidate.read', 'candidate.write', 'inventory.read', 'inventory.write', 'venue.read', 'venue.write', 'finance.read', 'order.read', 'workflow.view', 'approval.submit', 'approval.approve', 'approval.reject', 'data.ingest', 'user.manage', 'audit.read'] });
const CITY_USER = fakeUser({ id: 2, permissions: ['data.city.assigned', 'candidate.read', 'candidate.write', 'finance.read', 'inventory.read', 'venue.read', 'order.read'], assignedCityIds: [1] });

// ============================================================================
// candidates
// ============================================================================
test('GET /candidates — admin (all), scoped user (filtered), no-scope empty', async () => {
  const app = await registerRoutes(candidateRoutes);

  setDbHandlers([{ match: /FROM core\.candidate/, rows: [{ id: 1, city_id: 1 }] }]);
  const r1 = await invokeRoute(findRoute(app, 'GET', '/candidates'), { request: fakeRequest({ user: ADMIN }) });
  assert.equal(r1._status, 200);

  const r2 = await invokeRoute(findRoute(app, 'GET', '/candidates'), { request: fakeRequest({ user: CITY_USER }) });
  assert.equal(r2._status, 200);

  const noScope = fakeUser({ id: 3, permissions: ['candidate.read'], assignedCityIds: [] });
  const r3 = await invokeRoute(findRoute(app, 'GET', '/candidates'), { request: fakeRequest({ user: noScope }) });
  assert.deepEqual(r3._body, []);
});

test('POST /candidates — validation / 403 out-of-scope / 201 happy', async () => {
  const app = await registerRoutes(candidateRoutes);

  setDbHandlers([]);
  const reply1 = await invokeRoute(findRoute(app, 'POST', '/candidates'), { request: fakeRequest({ user: ADMIN, body: {} }) });
  assert.equal(reply1._status, 400);

  const reply2 = await invokeRoute(findRoute(app, 'POST', '/candidates'), { request: fakeRequest({ user: CITY_USER, body: { city_id: 9, full_name: 'x' } }) });
  assert.equal(reply2._status, 403);

  setDbHandlers([{ match: /INSERT INTO core\.candidate/, rows: [{ id: 1, city_id: 1, full_name: 'x' }] }]);
  const reply3 = await invokeRoute(findRoute(app, 'POST', '/candidates'), { request: fakeRequest({ user: ADMIN, body: { city_id: 1, full_name: 'x' } }) });
  assert.equal(reply3._status, 201);
});

// ============================================================================
// items
// ============================================================================
test('items routes — GET/POST/PUT + 400/404', async () => {
  const app = await registerRoutes(itemRoutes);

  setDbHandlers([{ match: /FROM core\.item/, rows: [{ id: 1, sku: 's', name: 'n' }] }]);
  const r1 = await invokeRoute(findRoute(app, 'GET', '/items'), { request: fakeRequest({ user: ADMIN }) });
  assert.equal(r1._status, 200);

  // POST validation
  setDbHandlers([]);
  const r2 = await invokeRoute(findRoute(app, 'POST', '/items'), { request: fakeRequest({ user: ADMIN, body: {} }) });
  assert.equal(r2._status, 400);
  const r3 = await invokeRoute(findRoute(app, 'POST', '/items'), { request: fakeRequest({ user: ADMIN, body: { sku: 'a', name: 'b', safety_threshold: -1 } }) });
  assert.equal(r3._status, 400);

  // POST happy
  setDbHandlers([{ match: /INSERT INTO core\.item/, rows: [{ id: 1, sku: 'a', name: 'b' }] }]);
  const r4 = await invokeRoute(findRoute(app, 'POST', '/items'), { request: fakeRequest({ user: ADMIN, body: { sku: 'a', name: 'b', unit: 'kg', safety_threshold: 5 } }) });
  assert.equal(r4._status, 201);

  // PUT 400 / 404 / 200
  setDbHandlers([]);
  const r5 = await invokeRoute(findRoute(app, 'PUT', '/items/:id'), { request: fakeRequest({ user: ADMIN, params: { id: 1 }, body: { safety_threshold: -1 } }) });
  assert.equal(r5._status, 400);

  setDbHandlers([{ match: /UPDATE core\.item/, rows: [] }]);
  const r6 = await invokeRoute(findRoute(app, 'PUT', '/items/:id'), { request: fakeRequest({ user: ADMIN, params: { id: 1 }, body: { name: 'x' } }) });
  assert.equal(r6._status, 404);

  setDbHandlers([{ match: /UPDATE core\.item/, rows: [{ id: 1, sku: 'a', name: 'x', safety_threshold: 10 }] }]);
  const r7 = await invokeRoute(findRoute(app, 'PUT', '/items/:id'), { request: fakeRequest({ user: ADMIN, params: { id: 1 }, body: { name: 'x', is_active: true, unit: 'kg' } }) });
  assert.equal(r7._status, 200);
});

// ============================================================================
// warehouses
// ============================================================================
test('warehouses — GET list/one, POST, POST location: 400/403/404/201', async () => {
  const app = await registerRoutes(warehouseRoutes);

  // LIST
  setDbHandlers([{ match: /FROM core\.warehouse/, rows: [{ id: 1, city_id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/warehouses'), { request: fakeRequest({ user: ADMIN }) });
  await invokeRoute(findRoute(app, 'GET', '/warehouses'), { request: fakeRequest({ user: CITY_USER }) });
  await invokeRoute(findRoute(app, 'GET', '/warehouses'), { request: fakeRequest({ user: fakeUser({ permissions: ['inventory.read'], assignedCityIds: [] }) }) });

  // GET :id — 404
  setDbHandlers([{ match: /FROM core\.warehouse WHERE id/, rows: [] }]);
  const r0 = await invokeRoute(findRoute(app, 'GET', '/warehouses/:id'), { request: fakeRequest({ user: ADMIN, params: { id: 1 } }) });
  assert.equal(r0._status, 404);

  // GET :id — 403
  setDbHandlers([{ match: /FROM core\.warehouse WHERE id/, rows: [{ id: 1, city_id: 9 }] }]);
  const r1 = await invokeRoute(findRoute(app, 'GET', '/warehouses/:id'), { request: fakeRequest({ user: CITY_USER, params: { id: 1 } }) });
  assert.equal(r1._status, 403);

  // GET :id — 200
  setDbHandlers([
    { match: /FROM core\.warehouse WHERE id/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM core\.warehouse_location/, rows: [] }
  ]);
  const r2 = await invokeRoute(findRoute(app, 'GET', '/warehouses/:id'), { request: fakeRequest({ user: ADMIN, params: { id: 1 } }) });
  assert.equal(r2._status, 200);

  // POST — 400 / 403 / 201
  setDbHandlers([]);
  const p1 = await invokeRoute(findRoute(app, 'POST', '/warehouses'), { request: fakeRequest({ user: ADMIN, body: {} }) });
  assert.equal(p1._status, 400);
  const p2 = await invokeRoute(findRoute(app, 'POST', '/warehouses'), { request: fakeRequest({ user: CITY_USER, body: { city_id: 9, code: 'A', name: 'a' } }) });
  assert.equal(p2._status, 403);

  setDbHandlers([{ match: /INSERT INTO core\.warehouse/, rows: [{ id: 1 }] }]);
  const p3 = await invokeRoute(findRoute(app, 'POST', '/warehouses'), { request: fakeRequest({ user: ADMIN, body: { city_id: 1, code: 'A', name: 'a', address: 'x' } }) });
  assert.equal(p3._status, 201);

  // POST :id/locations — 404 / 403 / 400 / 201
  setDbHandlers([{ match: /FROM core\.warehouse WHERE id/, rows: [] }]);
  const l1 = await invokeRoute(findRoute(app, 'POST', '/warehouses/:id/locations'), { request: fakeRequest({ user: ADMIN, params: { id: 1 }, body: {} }) });
  assert.equal(l1._status, 404);

  setDbHandlers([{ match: /FROM core\.warehouse WHERE id/, rows: [{ city_id: 9 }] }]);
  const l2 = await invokeRoute(findRoute(app, 'POST', '/warehouses/:id/locations'), { request: fakeRequest({ user: CITY_USER, params: { id: 1 }, body: { code: 'A' } }) });
  assert.equal(l2._status, 403);

  setDbHandlers([{ match: /FROM core\.warehouse WHERE id/, rows: [{ city_id: 1 }] }]);
  const l3 = await invokeRoute(findRoute(app, 'POST', '/warehouses/:id/locations'), { request: fakeRequest({ user: ADMIN, params: { id: 1 }, body: {} }) });
  assert.equal(l3._status, 400);

  setDbHandlers([
    { match: /FROM core\.warehouse WHERE id/, rows: [{ city_id: 1 }] },
    { match: /INSERT INTO core\.warehouse_location/, rows: [{ id: 1 }] }
  ]);
  const l4 = await invokeRoute(findRoute(app, 'POST', '/warehouses/:id/locations'), { request: fakeRequest({ user: ADMIN, params: { id: 1 }, body: { code: 'A', name: 'n' } }) });
  assert.equal(l4._status, 201);
});

// ============================================================================
// venues
// ============================================================================
test('venues — GET list/POST, drive-time GET/POST validation + happy', async () => {
  const app = await registerRoutes(venueRoutes);

  setDbHandlers([{ match: /FROM core\.venue/, rows: [{ id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/venues'), { request: fakeRequest({ user: ADMIN }) });
  await invokeRoute(findRoute(app, 'GET', '/venues'), { request: fakeRequest({ user: CITY_USER }) });
  await invokeRoute(findRoute(app, 'GET', '/venues'), { request: fakeRequest({ user: fakeUser({ permissions: ['venue.read'], assignedCityIds: [] }) }) });

  // POST venue 400 / 403 / 201
  setDbHandlers([]);
  const v1 = await invokeRoute(findRoute(app, 'POST', '/venues'), { request: fakeRequest({ user: ADMIN, body: {} }) });
  assert.equal(v1._status, 400);
  const v2 = await invokeRoute(findRoute(app, 'POST', '/venues'), { request: fakeRequest({ user: CITY_USER, body: { city_id: 9, name: 'n' } }) });
  assert.equal(v2._status, 403);
  setDbHandlers([{ match: /INSERT INTO core\.venue/, rows: [{ id: 1 }] }]);
  const v3 = await invokeRoute(findRoute(app, 'POST', '/venues'), { request: fakeRequest({ user: ADMIN, body: { city_id: 1, name: 'n', latitude: 1, longitude: 2, address: 'x' } }) });
  assert.equal(v3._status, 201);

  // GET /venues/drive-time — 400 missing params (no DB needed)
  setDbHandlers([]);
  const d0 = await invokeRoute(findRoute(app, 'GET', '/venues/drive-time'), { request: fakeRequest({ user: ADMIN, query: {} }) });
  assert.equal(d0._status, 400);

  // GET /venues/drive-time — 404 when one venue missing from DB
  setDbHandlers([{ match: /SELECT id, city_id FROM core\.venue/, rows: [{ id: 1, city_id: 1 }] }]);
  const dNotFound = await invokeRoute(findRoute(app, 'GET', '/venues/drive-time'), { request: fakeRequest({ user: ADMIN, query: { origin: 1, destination: 2 } }) });
  assert.equal(dNotFound._status, 404);

  // GET /venues/drive-time — 403 when origin venue is out of scope
  setDbHandlers([{ match: /SELECT id, city_id FROM core\.venue/, rows: [{ id: 1, city_id: 9 }, { id: 2, city_id: 1 }] }]);
  const dOriginForbidden = await invokeRoute(findRoute(app, 'GET', '/venues/drive-time'), { request: fakeRequest({ user: CITY_USER, query: { origin: 1, destination: 2 } }) });
  assert.equal(dOriginForbidden._status, 403);

  // GET /venues/drive-time — 403 when destination venue is out of scope
  setDbHandlers([{ match: /SELECT id, city_id FROM core\.venue/, rows: [{ id: 1, city_id: 1 }, { id: 2, city_id: 9 }] }]);
  const dDestForbidden = await invokeRoute(findRoute(app, 'GET', '/venues/drive-time'), { request: fakeRequest({ user: CITY_USER, query: { origin: 1, destination: 2 } }) });
  assert.equal(dDestForbidden._status, 403);

  // GET /venues/drive-time — 200 happy (ADMIN has data.city.all; city scope lookup + drive_time + coord lookup all use FROM core.venue pattern)
  setDbHandlers([
    { match: /FROM core\.drive_time/, rows: [] },
    { match: /FROM core\.venue/, rows: [{ id: 1, latitude: 1, longitude: 2 }, { id: 2, latitude: 2, longitude: 3 }] }
  ]);
  const d1 = await invokeRoute(findRoute(app, 'GET', '/venues/drive-time'), { request: fakeRequest({ user: ADMIN, query: { origin: 1, destination: 2 } }) });
  assert.equal(d1._status, 200);

  // POST drive-time — 400 missing params / 400 negative minutes (no DB needed)
  setDbHandlers([]);
  const pm1 = await invokeRoute(findRoute(app, 'POST', '/venues/drive-time'), { request: fakeRequest({ user: ADMIN, body: {} }) });
  assert.equal(pm1._status, 400);

  const pm2 = await invokeRoute(findRoute(app, 'POST', '/venues/drive-time'), { request: fakeRequest({ user: ADMIN, body: { origin_venue_id: 1, destination_venue_id: 2, minutes: -1 } }) });
  assert.equal(pm2._status, 400);

  // POST drive-time — 404 when one venue missing
  setDbHandlers([{ match: /SELECT id, city_id FROM core\.venue/, rows: [{ id: 1, city_id: 1 }] }]);
  const pmNotFound = await invokeRoute(findRoute(app, 'POST', '/venues/drive-time'), { request: fakeRequest({ user: ADMIN, body: { origin_venue_id: 1, destination_venue_id: 2, minutes: 5 } }) });
  assert.equal(pmNotFound._status, 404);

  // POST drive-time — 403 when origin is out of scope
  setDbHandlers([{ match: /SELECT id, city_id FROM core\.venue/, rows: [{ id: 1, city_id: 9 }, { id: 2, city_id: 1 }] }]);
  const pmOriginForbidden = await invokeRoute(findRoute(app, 'POST', '/venues/drive-time'), { request: fakeRequest({ user: CITY_USER, body: { origin_venue_id: 1, destination_venue_id: 2, minutes: 5 } }) });
  assert.equal(pmOriginForbidden._status, 403);

  // POST drive-time — 403 when destination is out of scope
  setDbHandlers([{ match: /SELECT id, city_id FROM core\.venue/, rows: [{ id: 1, city_id: 1 }, { id: 2, city_id: 9 }] }]);
  const pmDestForbidden = await invokeRoute(findRoute(app, 'POST', '/venues/drive-time'), { request: fakeRequest({ user: CITY_USER, body: { origin_venue_id: 1, destination_venue_id: 2, minutes: 5 } }) });
  assert.equal(pmDestForbidden._status, 403);

  // POST drive-time — happy path (both venues in scope)
  setDbHandlers([
    { match: /SELECT id, city_id FROM core\.venue/, rows: [{ id: 1, city_id: 1 }, { id: 2, city_id: 1 }] },
    { match: /INSERT INTO core\.drive_time/, rows: [{ origin_venue_id: 1, destination_venue_id: 2, minutes: 5, source: 'manual' }] }
  ]);
  const pm3 = await invokeRoute(findRoute(app, 'POST', '/venues/drive-time'), { request: fakeRequest({ user: ADMIN, body: { origin_venue_id: 1, destination_venue_id: 2, minutes: 5 } }) });
  assert.equal(pm3._status, 200);

  // POST drive-time — same origin == destination => 400 from setManualDriveTime service
  setDbHandlers([{ match: /SELECT id, city_id FROM core\.venue/, rows: [{ id: 1, city_id: 1 }] }]);
  const pm4 = await invokeRoute(findRoute(app, 'POST', '/venues/drive-time'), { request: fakeRequest({ user: ADMIN, body: { origin_venue_id: 1, destination_venue_id: 1, minutes: 5 } }) });
  assert.equal(pm4._status, 400);
});

// ============================================================================
// finance
// ============================================================================
test('finance — all / scoped / empty-scope', async () => {
  const app = await registerRoutes(financeRoutes);
  setDbHandlers([{ match: /FROM core\.finance_transaction/, rows: [{ id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/finance/transactions'), { request: fakeRequest({ user: ADMIN }) });
  await invokeRoute(findRoute(app, 'GET', '/finance/transactions'), { request: fakeRequest({ user: CITY_USER }) });
  const noScope = fakeUser({ permissions: ['finance.read'], assignedCityIds: [] });
  const r = await invokeRoute(findRoute(app, 'GET', '/finance/transactions'), { request: fakeRequest({ user: noScope }) });
  assert.deepEqual(r._body, []);
});

// ============================================================================
// payments — read-only endpoints
// ============================================================================
test('payments — receipts/refunds list + stages detail 404/403/200', async () => {
  const app = await registerRoutes(paymentRoutes);

  setDbHandlers([
    { match: /FROM core\.receipt r/, rows: [{ id: 1 }] },
    { match: /FROM core\.refund rf/, rows: [{ id: 1 }] }
  ]);
  await invokeRoute(findRoute(app, 'GET', '/payments/receipts'), { request: fakeRequest({ user: ADMIN }) });
  await invokeRoute(findRoute(app, 'GET', '/payments/refunds'), { request: fakeRequest({ user: ADMIN }) });

  // stages 404
  setDbHandlers([{ match: /FROM core\.payment_stage ps/, rows: [] }]);
  const r = await invokeRoute(findRoute(app, 'GET', '/payments/stages/:stageId'), { request: fakeRequest({ user: ADMIN, params: { stageId: 1 } }) });
  assert.equal(r._status, 404);

  // stages 403 for out-of-scope user
  setDbHandlers([{ match: /FROM core\.payment_stage ps/, rows: [{ id: 1, city_id: 9 }] }]);
  const r2 = await invokeRoute(findRoute(app, 'GET', '/payments/stages/:stageId'), { request: fakeRequest({ user: CITY_USER, params: { stageId: 1 } }) });
  assert.equal(r2._status, 403);

  setDbHandlers([{ match: /FROM core\.payment_stage ps/, rows: [{ id: 1, city_id: 1 }] }]);
  const r3 = await invokeRoute(findRoute(app, 'GET', '/payments/stages/:stageId'), { request: fakeRequest({ user: ADMIN, params: { stageId: 1 } }) });
  assert.equal(r3._status, 200);
});

// ============================================================================
// workflows (approvals) — base path is /workflows/approvals
// ============================================================================
test('workflows/approvals — list/get/post/decide/cancel', async () => {
  const app = await registerRoutes(workflowRoutes);

  setDbHandlers([{ match: /FROM core\.approval_request ar/, rows: [{ id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/workflows/approvals'), { request: fakeRequest({ user: ADMIN, query: {} }) });

  setDbHandlers([{ match: /FROM core\.approval_request ar/, rows: [] }]);
  const r0 = await invokeRoute(findRoute(app, 'GET', '/workflows/approvals/:id'), { request: fakeRequest({ user: ADMIN, params: { id: 1 } }) });
  assert.equal(r0._status, 404);

  setDbHandlers([{ match: /FROM core\.approval_request ar/, rows: [{ id: 1 }] }]);
  const r1 = await invokeRoute(findRoute(app, 'GET', '/workflows/approvals/:id'), { request: fakeRequest({ user: ADMIN, params: { id: 1 } }) });
  assert.equal(r1._status, 200);

  // POST
  setDbHandlers([{ match: /INSERT INTO core\.approval_request/, rows: [{ id: 1, status: 'pending', entity_type: 'v', entity_id: '1' }] }]);
  const r2 = await invokeRoute(findRoute(app, 'POST', '/workflows/approvals'), { request: fakeRequest({ user: ADMIN, body: { entity_type: 'v', entity_id: 1, summary: 's' } }) });
  assert.equal(r2._status, 201);

  // approve / reject
  setDbHandlers([
    { match: /SELECT status FROM core\.approval_request/, rows: [{ status: 'pending' }] },
    { match: /UPDATE core\.approval_request/, rows: [{ id: 1, status: 'approved', entity_type: 'v', entity_id: '1' }] }
  ]);
  const r3 = await invokeRoute(findRoute(app, 'POST', '/workflows/approvals/:id/approve'), { request: fakeRequest({ user: ADMIN, params: { id: 1 }, body: { notes: 'ok' } }) });
  assert.equal(r3._status, 200);

  setDbHandlers([
    { match: /SELECT status FROM core\.approval_request/, rows: [{ status: 'approved' }] },
    { match: /UPDATE core\.approval_request/, rows: [] }
  ]);
  const r4 = await invokeRoute(findRoute(app, 'POST', '/workflows/approvals/:id/approve'), { request: fakeRequest({ user: ADMIN, params: { id: 1 }, body: {} }) });
  assert.equal(r4._status, 409);

  setDbHandlers([
    { match: /SELECT status FROM core\.approval_request/, rows: [{ status: 'pending' }] },
    { match: /UPDATE core\.approval_request/, rows: [{ id: 1, status: 'rejected', entity_type: 'v', entity_id: '1' }] }
  ]);
  const r5 = await invokeRoute(findRoute(app, 'POST', '/workflows/approvals/:id/reject'), { request: fakeRequest({ user: ADMIN, params: { id: 1 }, body: {} }) });
  assert.equal(r5._status, 200);

  // cancel
  setDbHandlers([
    { match: /SELECT status, requested_by FROM core\.approval_request/, rows: [{ status: 'pending', requested_by: 1 }] },
    { match: /UPDATE core\.approval_request/, rows: [{ id: 1, status: 'canceled' }] }
  ]);
  const r6 = await invokeRoute(findRoute(app, 'POST', '/workflows/approvals/:id/cancel'), { request: fakeRequest({ user: ADMIN, params: { id: 1 } }) });
  assert.equal(r6._status, 200);

  setDbHandlers([
    { match: /SELECT status, requested_by FROM core\.approval_request/, rows: [{ status: 'pending', requested_by: 99 }] },
    { match: /UPDATE core\.approval_request/, rows: [] }
  ]);
  const r7 = await invokeRoute(findRoute(app, 'POST', '/workflows/approvals/:id/cancel'), { request: fakeRequest({ user: ADMIN, params: { id: 1 } }) });
  assert.equal(r7._status, 409);
});

// ============================================================================
// ingestion (JSON payloads)
// ============================================================================
test('ingestion — GET /ingestion/resources + POST /ingestion/:resource', async () => {
  const app = await registerRoutes(ingestionRoutes);

  const r0 = await invokeRoute(findRoute(app, 'GET', '/ingestion/resources'), { request: fakeRequest({ user: ADMIN }) });
  assert.ok(Array.isArray(r0._body.resources));

  setDbHandlers([
    { match: /INSERT INTO core\.item/, rows: [{ inserted: true }] }
  ]);
  const r = await invokeRoute(findRoute(app, 'POST', '/ingestion/:resource'), { request: fakeRequest({ user: ADMIN, params: { resource: 'items' }, body: { records: [{ sku: 'a', name: 'b' }] } }) });
  assert.equal(r._status, 201);

  setDbHandlers([]);
  const r2 = await invokeRoute(findRoute(app, 'POST', '/ingestion/:resource'), { request: fakeRequest({ user: ADMIN, params: { resource: 'bogus' }, body: { records: [] } }) });
  assert.equal(r2._status, 400);
});

// ============================================================================
// admin
// ============================================================================
test('admin — users list/create/unlock/audit', async () => {
  const app = await registerRoutes(adminRoutes);

  setDbHandlers([{ match: /FROM core\.app_user u/, rows: [{ id: 1, roles: ['ADMIN'] }] }]);
  const r1 = await invokeRoute(findRoute(app, 'GET', '/admin/users'), { request: fakeRequest({ user: ADMIN }) });
  assert.equal(r1._status, 200);

  // POST validation
  setDbHandlers([]);
  const r2 = await invokeRoute(findRoute(app, 'POST', '/admin/users'), { request: fakeRequest({ user: ADMIN, body: {} }) });
  assert.equal(r2._status, 400);

  // Weak password
  const r3 = await invokeRoute(findRoute(app, 'POST', '/admin/users'), { request: fakeRequest({ user: ADMIN, body: { username: 'u', email: 'e@e', full_name: 'f', password: 'short' } }) });
  assert.ok(r3._status >= 400);

  // Happy
  setDbHandlers([
    { match: /INSERT INTO core\.app_user/, rows: [{ id: 10, username: 'u', email: 'e@e', full_name: 'f' }] },
    { match: /INSERT INTO core\.user_role/, rows: [] },
    { match: /INSERT INTO core\.user_city/, rows: [] }
  ]);
  const r4 = await invokeRoute(findRoute(app, 'POST', '/admin/users'), { request: fakeRequest({ user: ADMIN, body: { username: 'u', email: 'e@e', full_name: 'f', password: 'StrongPass1234!', role_codes: ['ADMIN'], city_codes: ['NYC'] } }) });
  assert.equal(r4._status, 201);

  // Unlock 404
  setDbHandlers([{ match: /UPDATE core\.app_user/, rows: [] }]);
  const r5 = await invokeRoute(findRoute(app, 'POST', '/admin/users/:id/unlock'), { request: fakeRequest({ user: ADMIN, params: { id: 1 } }) });
  assert.equal(r5._status, 404);

  setDbHandlers([{ match: /UPDATE core\.app_user/, rows: [{ id: 1, username: 'u' }] }]);
  const r6 = await invokeRoute(findRoute(app, 'POST', '/admin/users/:id/unlock'), { request: fakeRequest({ user: ADMIN, params: { id: 1 } }) });
  assert.equal(r6._status, 200);

  // Duplicate username → 409
  setDbHandlers([{ match: /INSERT INTO core\.app_user/, throw: Object.assign(new Error('duplicate key'), { code: '23505' }) }]);
  const r8 = await invokeRoute(findRoute(app, 'POST', '/admin/users'), { request: fakeRequest({ user: ADMIN, body: { username: 'u', email: 'e@e', full_name: 'f', password: 'StrongPass1234!' } }) });
  assert.equal(r8._status, 409);

  // Audit
  setDbHandlers([{ match: /FROM audit\.permission_event/, rows: [{ id: 1 }] }]);
  const r7 = await invokeRoute(findRoute(app, 'GET', '/admin/audit'), { request: fakeRequest({ user: ADMIN, query: {} }) });
  assert.equal(r7._status, 200);
});
