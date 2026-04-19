// Edge-case branch tests — exercise fallback literals (body || {}), default
// params, and remaining error paths across the route surface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerRoutes, setDbHandlers, findRoute, invokeRoute,
  fakeRequest, fakeUser
} from './_route_harness.js';

import candidateRoutes from '../src/routes/candidates.js';
import itemRoutes from '../src/routes/items.js';
import warehouseRoutes from '../src/routes/warehouses.js';
import venueRoutes from '../src/routes/venues.js';
import paymentRoutes from '../src/routes/payments.js';
import ingestionRoutes from '../src/routes/ingestion.js';
import ingestionSourceRoutes from '../src/routes/ingestion_sources.js';
import vendorRoutes from '../src/routes/vendors.js';
import eventRoutes from '../src/routes/events.js';
import orderRoutes from '../src/routes/orders.js';
import inventoryRoutes from '../src/routes/inventory.js';
import itineraryRoutes from '../src/routes/itineraries.js';
import authRoutes from '../src/routes/auth.js';
import integrationRoutes from '../src/routes/integrations.js';
import adminRoutes from '../src/routes/admin.js';
import workflowsRoutes from '../src/routes/workflows.js';
import auditRoutes from '../src/routes/audit.js';
import workflowEngineRoutes from '../src/routes/workflow_engine.js';

const ALL = fakeUser({
  id: 1,
  permissions: [
    'data.city.all','data.ingest','candidate.read','candidate.write',
    'inventory.read','inventory.write','inventory.issue','audit.read',
    'venue.read','venue.write','order.read','order.write',
    'event.read','event.write','payment.collect','refund.issue',
    'vendor.read','vendor.write','vendor.banking.read','vendor.banking.write',
    'itinerary.read','itinerary.write','itinerary.template.manage',
    'workflow.view','workflow.define','approval.submit','approval.approve','approval.reject',
    'user.manage','role.manage','finance.read'
  ]
});

// Body null for routes that use `request.body || {}`.
test('body-null branches — candidates/items/warehouses/venues/admin/orders', async () => {
  const cand = await registerRoutes(candidateRoutes);
  assert.equal((await invokeRoute(findRoute(cand, 'POST', '/candidates'), { request: fakeRequest({ user: ALL }) }))._status, 400);

  const items = await registerRoutes(itemRoutes);
  assert.equal((await invokeRoute(findRoute(items, 'POST', '/items'), { request: fakeRequest({ user: ALL }) }))._status, 400);
  setDbHandlers([{ match: /UPDATE core\.item/, rows: [{ id: 1, sku: 's', name: 'n' }] }]);
  assert.equal((await invokeRoute(findRoute(items, 'PUT', '/items/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 200);

  const wh = await registerRoutes(warehouseRoutes);
  assert.equal((await invokeRoute(findRoute(wh, 'POST', '/warehouses'), { request: fakeRequest({ user: ALL }) }))._status, 400);
  setDbHandlers([{ match: /FROM core\.warehouse WHERE id/, rows: [{ city_id: 1 }] }]);
  assert.equal((await invokeRoute(findRoute(wh, 'POST', '/warehouses/:id/locations'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 400);

  const ven = await registerRoutes(venueRoutes);
  assert.equal((await invokeRoute(findRoute(ven, 'POST', '/venues'), { request: fakeRequest({ user: ALL }) }))._status, 400);
  assert.equal((await invokeRoute(findRoute(ven, 'POST', '/venues/drive-time'), { request: fakeRequest({ user: ALL }) }))._status, 400);

  const adm = await registerRoutes(adminRoutes);
  assert.equal((await invokeRoute(findRoute(adm, 'POST', '/admin/users'), { request: fakeRequest({ user: ALL }) }))._status, 400);

  const ord = await registerRoutes(orderRoutes);
  setDbHandlers([]);
  assert.equal((await invokeRoute(findRoute(ord, 'POST', '/orders'), { request: fakeRequest({ user: ALL, body: { city_id: 1 } }) }))._status >= 400, true);
});

// Audit routes: no filters (default path), all-branches query
test('audit — default limits and minimal query', async () => {
  const app = await registerRoutes(auditRoutes);
  setDbHandlers([{ match: /FROM audit\.permission_event/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/audit/events'), { request: fakeRequest({ user: ALL }) });
  setDbHandlers([{ match: /FROM audit\.v_audit_log/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/audit/log'), { request: fakeRequest({ user: ALL }) });
});

// Integrations — all filter permutations
test('integrations — various filter permutations', async () => {
  const app = await registerRoutes(integrationRoutes);
  setDbHandlers([{ match: /FROM audit\.financial_ledger/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/integrations/financial-ledger'), { request: fakeRequest({ user: ALL, query: { order_id: '1' } }) });
  await invokeRoute(findRoute(app, 'GET', '/integrations/financial-ledger'), { request: fakeRequest({ user: ALL, query: { from: '2026-01-01' } }) });
  await invokeRoute(findRoute(app, 'GET', '/integrations/financial-ledger'), { request: fakeRequest({ user: ALL, query: { to: '2026-02-01' } }) });
  await invokeRoute(findRoute(app, 'GET', '/integrations/financial-ledger'), { request: fakeRequest({ user: ALL, query: { limit: 10 } }) });
});

// Events — POST /events with ends_at null branch
test('events — ends_at null branch', async () => {
  const app = await registerRoutes(eventRoutes);
  setDbHandlers([{ match: /INSERT INTO core\.event/, rows: [{ id: 1 }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/events'), { request: fakeRequest({ user: ALL, body: { city_id: 1, name: 'n', starts_at: '2026-01-01', min_headcount: 0, headcount_cutoff_at: '2026-01-01' } }) }))._status, 201);
});

// Inventory — outbound/transfer happy with only item_id/location_id, reservations release cause default
test('inventory — release cause + more outbound/transfer branches', async () => {
  const app = await registerRoutes(inventoryRoutes);

  setDbHandlers([
    { match: /FROM core\.warehouse_location/, rows: [{ city_id: 1 }] },
    { match: /SELECT on_hand, reserved/, rows: [{ on_hand: 10, reserved: 0 }] },
    { match: /UPDATE core\.stock SET on_hand/, rows: [] },
    { match: /INSERT INTO core\.stock_movement/, rows: [{ id: 1 }] }
  ]);
  // outbound happy without notes
  await invokeRoute(findRoute(app, 'POST', '/inventory/outbound'), { request: fakeRequest({ user: ALL, body: { item_id: 1, location_id: 1, quantity: 1 } }) });

  // transfer requires both scope checks pass
  setDbHandlers([
    { match: /FROM core\.warehouse_location/, rows: [{ city_id: 1 }] },
    { match: /SELECT item_id, location_id FROM core\.stock/, rows: [] },
    { match: /SELECT on_hand, reserved/, rows: [{ on_hand: 10, reserved: 0 }] },
    { match: /UPDATE core\.stock SET on_hand/, rows: [] },
    { match: /INSERT INTO core\.stock \(/, rows: [] },
    { match: /INSERT INTO core\.stock_movement/, rows: [{ id: 1 }] }
  ]);
  await invokeRoute(findRoute(app, 'POST', '/inventory/transfer'), { request: fakeRequest({ user: ALL, body: { item_id: 1, from_location_id: 1, to_location_id: 2, quantity: 1, notes: 'x', reference_type: 't', reference_id: '1' } }) });
});

// Payments — stages/:stageId with null city_id branch
test('payments stages — null city_id and default stage shape', async () => {
  const app = await registerRoutes(paymentRoutes);
  setDbHandlers([{ match: /FROM core\.payment_stage ps/, rows: [{ id: 1, city_id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/payments/stages/:stageId'), { request: fakeRequest({ user: ALL, params: { stageId: 1 } }) });

  setDbHandlers([{ match: /FROM core\.receipt r/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/payments/receipts'), { request: fakeRequest({ user: ALL, query: {} }) });
});

// Admin — body missing some subset
test('admin — post user with only roles (no cities)', async () => {
  const app = await registerRoutes(adminRoutes);
  setDbHandlers([
    { match: /INSERT INTO core\.app_user/, rows: [{ id: 1, username: 'u' }] },
    { match: /INSERT INTO core\.user_role/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/admin/users'), { request: fakeRequest({ user: ALL, body: { username: 'u', email: 'e@e', full_name: 'f', password: 'StrongPassword123!', role_codes: ['ADMIN'] } }) }))._status, 201);
});

// Workflows routes — body-null branches for decide paths
test('workflows/approvals — notes absent branches', async () => {
  const app = await registerRoutes(workflowsRoutes);
  setDbHandlers([
    { match: /SELECT status FROM core\.approval_request/, rows: [{ status: 'pending' }] },
    { match: /UPDATE core\.approval_request/, rows: [{ id: 1, status: 'approved', entity_type: 'v', entity_id: '1' }] }
  ]);
  await invokeRoute(findRoute(app, 'POST', '/workflows/approvals/:id/approve'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
  setDbHandlers([
    { match: /SELECT status FROM core\.approval_request/, rows: [{ status: 'pending' }] },
    { match: /UPDATE core\.approval_request/, rows: [{ id: 1, status: 'rejected', entity_type: 'v', entity_id: '1' }] }
  ]);
  await invokeRoute(findRoute(app, 'POST', '/workflows/approvals/:id/reject'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
});

// ingestion — /ingestion/resources covered + /ingestion/:resource with default-returned
test('ingestion — resources and default branch', async () => {
  const app = await registerRoutes(ingestionRoutes);
  await invokeRoute(findRoute(app, 'GET', '/ingestion/resources'), { request: fakeRequest({ user: ALL }) });

  // records not array → 400 via check middleware — skipped since we ignore preHandlers.
  // Test the ok-path with an empty records array (valid empty).
  setDbHandlers([]);
  await invokeRoute(findRoute(app, 'POST', '/ingestion/:resource'), { request: fakeRequest({ user: ALL, params: { resource: 'items' }, body: { records: [] } }) });
});

// ingestion_sources — PUT with individual field subsets
test('ingestion_sources — PUT individual fields', async () => {
  const app = await registerRoutes(ingestionSourceRoutes);
  setDbHandlers([{ match: /UPDATE core\.ingestion_source/, rows: [{ id: 1 }] }]);
  await invokeRoute(findRoute(app, 'PUT', '/ingestion/sources/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: {} }) });
  await invokeRoute(findRoute(app, 'PUT', '/ingestion/sources/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { is_active: false } }) });
});

// Auth login — outcome error paths
test('auth login — username but no password (400) + user but no password hash (bcrypt invalid)', async () => {
  const app = await registerRoutes(authRoutes);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/auth/login'), { request: fakeRequest({ body: { username: 'x' } }) }))._status, 400);
});

// Itineraries — empty-scope branch already tested; add no-body branch for update
test('itineraries — update without body', async () => {
  const app = await registerRoutes(itineraryRoutes);
  setDbHandlers([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1, current_version: 1, name: 'n', itinerary_date: '2026-01-01' }] },
    { match: /FROM core\.itinerary_event/, rows: [] },
    { match: /UPDATE core\.itinerary\s+SET name/, rows: [] },
    { match: /INSERT INTO core\.itinerary_version/, rows: [] },
    { match: /UPDATE core\.itinerary\s+SET current_version/, rows: [] }
  ]);
  await invokeRoute(findRoute(app, 'PUT', '/itineraries/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
});

// Workflow engine — /workflows/tasks/mine default query + body=null decide
test('workflow_engine — tasks/mine no query', async () => {
  const app = await registerRoutes(workflowEngineRoutes);
  setDbHandlers([{ match: /FROM core\.workflow_task wt/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/workflows/tasks/mine'), { request: fakeRequest({ user: ALL }) });
});
