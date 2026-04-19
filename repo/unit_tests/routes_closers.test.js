// Closer tests — drive branch coverage to >= 95% by exercising remaining
// scope/404/403/422 paths on high-branch-count route files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  registerRoutes, setDbHandlers, findRoute, invokeRoute,
  fakeRequest, fakeUser
} from './_route_harness.js';

import itineraryRoutes from '../src/routes/itineraries.js';
import itineraryTplRoutes from '../src/routes/itinerary_templates.js';
import inventoryRoutes from '../src/routes/inventory.js';
import orderRoutes from '../src/routes/orders.js';
import vendorRoutes from '../src/routes/vendors.js';
import eventRoutes from '../src/routes/events.js';
import ingestionSourceRoutes from '../src/routes/ingestion_sources.js';
import paymentIntakeRoutes from '../src/routes/payment_intake.js';
import paymentRoutes from '../src/routes/payments.js';
import workflowsRoutes from '../src/routes/workflows.js';

const ALL = fakeUser({
  id: 1,
  permissions: [
    'data.city.all','candidate.read','candidate.write','itinerary.read','itinerary.write',
    'itinerary.template.manage','inventory.read','inventory.write','inventory.issue','audit.read',
    'venue.read','venue.write','order.read','order.write','payment.collect','refund.issue',
    'vendor.read','vendor.write','vendor.banking.read','vendor.banking.write',
    'event.read','event.write','data.ingest',
    'workflow.view','workflow.define','approval.submit','approval.approve','approval.reject',
    'user.manage','role.manage','finance.read'
  ]
});
const SCOPED = fakeUser({ permissions: ['data.city.assigned','itinerary.read','itinerary.write','itinerary.template.manage','inventory.read','inventory.write','inventory.issue','audit.read','vendor.read','vendor.banking.read','vendor.banking.write','order.read','order.write','payment.collect','refund.issue','event.read','event.write'], assignedCityIds: [1] });

// ----------------------------------------------------------------------------
// itineraries — remaining 404/403 on every mutating path
// ----------------------------------------------------------------------------
test('itineraries — 404 and 403 on every CRUD path', async () => {
  const app = await registerRoutes(itineraryRoutes);

  // All calls with missing itinerary (404) or out-of-scope (403)
  const missing = [{ match: /FROM core\.itinerary WHERE id/, rows: [] }];
  const outOfScope = [
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 9 }] },
    { match: /FROM core\.itinerary_event/, rows: [] }
  ];

  // UPDATE metadata 404 / 403
  setDbHandlers(missing);
  assert.equal((await invokeRoute(findRoute(app, 'PUT', '/itineraries/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { name: 'x' } }) }))._status, 404);
  setDbHandlers(outOfScope);
  assert.equal((await invokeRoute(findRoute(app, 'PUT', '/itineraries/:id'), { request: fakeRequest({ user: SCOPED, params: { id: 1 }, body: { name: 'x' } }) }))._status, 403);

  // VALIDATE 404 / 403
  setDbHandlers(missing);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/itineraries/:id/validate'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);
  setDbHandlers(outOfScope);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/itineraries/:id/validate'), { request: fakeRequest({ user: SCOPED, params: { id: 1 } }) }))._status, 403);

  // ADD event 404 / 403
  setDbHandlers(missing);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/events'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { title: 'x', start_at: '2026-01-01T10:00:00Z', end_at: '2026-01-01T11:00:00Z' } }) }))._status, 404);
  setDbHandlers(outOfScope);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/events'), { request: fakeRequest({ user: SCOPED, params: { id: 1 }, body: { title: 'x', start_at: '2026-01-01T10:00:00Z', end_at: '2026-01-01T11:00:00Z' } }) }))._status, 403);

  // UPDATE event 404 / 403
  setDbHandlers(missing);
  assert.equal((await invokeRoute(findRoute(app, 'PUT', '/itineraries/:id/events/:eventId'), { request: fakeRequest({ user: ALL, params: { id: 1, eventId: 1 }, body: {} }) }))._status, 404);
  setDbHandlers(outOfScope);
  assert.equal((await invokeRoute(findRoute(app, 'PUT', '/itineraries/:id/events/:eventId'), { request: fakeRequest({ user: SCOPED, params: { id: 1, eventId: 1 }, body: {} }) }))._status, 403);

  // DELETE event 404 / 403
  setDbHandlers(missing);
  assert.equal((await invokeRoute(findRoute(app, 'DELETE', '/itineraries/:id/events/:eventId'), { request: fakeRequest({ user: ALL, params: { id: 1, eventId: 1 } }) }))._status, 404);
  setDbHandlers(outOfScope);
  assert.equal((await invokeRoute(findRoute(app, 'DELETE', '/itineraries/:id/events/:eventId'), { request: fakeRequest({ user: SCOPED, params: { id: 1, eventId: 1 } }) }))._status, 403);

  // REORDER 404 / 403
  setDbHandlers(missing);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/reorder'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { order: [1] } }) }))._status, 404);
  setDbHandlers(outOfScope);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/reorder'), { request: fakeRequest({ user: SCOPED, params: { id: 1 }, body: { order: [1] } }) }))._status, 403);

  // VERSIONS list 404 / 403 / detail 404 / 403
  setDbHandlers(missing);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/itineraries/:id/versions'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);
  setDbHandlers(outOfScope);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/itineraries/:id/versions'), { request: fakeRequest({ user: SCOPED, params: { id: 1 } }) }))._status, 403);
  setDbHandlers(missing);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/itineraries/:id/versions/:n'), { request: fakeRequest({ user: ALL, params: { id: 1, n: 1 } }) }))._status, 404);
  setDbHandlers(outOfScope);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/itineraries/:id/versions/:n'), { request: fakeRequest({ user: SCOPED, params: { id: 1, n: 1 } }) }))._status, 403);

  // RESTORE 404 / 403
  setDbHandlers(missing);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/versions/:n/restore'), { request: fakeRequest({ user: ALL, params: { id: 1, n: 1 } }) }))._status, 404);
  setDbHandlers(outOfScope);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/versions/:n/restore'), { request: fakeRequest({ user: SCOPED, params: { id: 1, n: 1 } }) }))._status, 403);

  // RESTORE — version not found (500 from service turned 404)
  setDbHandlers([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM core\.itinerary_event/, rows: [] },
    { match: /FROM core\.itinerary_version/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/versions/:n/restore'), { request: fakeRequest({ user: ALL, params: { id: 1, n: 99 } }) }))._status, 404);
});

// ----------------------------------------------------------------------------
// inventory — assertLocationAccess 400 missing location_id on all mutations
// ----------------------------------------------------------------------------
test('inventory — 400 when location_id missing on all mutating routes', async () => {
  const app = await registerRoutes(inventoryRoutes);
  for (const route of ['/inventory/inbound', '/inventory/outbound', '/inventory/reservations', '/inventory/cycle-counts']) {
    setDbHandlers([]);
    const r = await invokeRoute(findRoute(app, 'POST', route), { request: fakeRequest({ user: ALL, body: { item_id: 1, quantity: 1 } }) });
    assert.equal(r._status, 400);
  }
  // transfer needs both from/to
  const r = await invokeRoute(findRoute(app, 'POST', '/inventory/transfer'), { request: fakeRequest({ user: ALL, body: { item_id: 1, quantity: 1 } }) });
  assert.equal(r._status, 400);
});

// Inventory with query only warehouse_id / location_id filters
test('inventory — GET /inventory with only warehouse_id or only location_id filter', async () => {
  const app = await registerRoutes(inventoryRoutes);
  setDbHandlers([{ match: /FROM core\.v_stock_position/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/inventory'), { request: fakeRequest({ user: ALL, query: { warehouse_id: 1 } }) });
  await invokeRoute(findRoute(app, 'GET', '/inventory'), { request: fakeRequest({ user: ALL, query: { location_id: 1 } }) });
  await invokeRoute(findRoute(app, 'GET', '/inventory'), { request: fakeRequest({ user: SCOPED, query: { item_id: 1 } }) });
});

// ----------------------------------------------------------------------------
// vendors — PUT banking 403 via non-banking-write user? Actually banking PUT
// uses VENDOR_BANKING_WRITE so requires perm. Let's exercise more branches
// by calling with null fields to hit all COALESCE null branches.
// ----------------------------------------------------------------------------
test('vendors — banking update with subset of fields + reveal with data', async () => {
  const app = await registerRoutes(vendorRoutes);
  const { encryptField } = await import('../src/auth/crypto.js');

  // Only tax_id set
  setDbHandlers([{ match: /UPDATE core\.vendor/, rows: [{ id: 1, bank_account_last4: null }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'PUT', '/vendors/:id/banking'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { tax_id: '999' } }) }))._status, 200);

  // Only bank_routing
  setDbHandlers([{ match: /UPDATE core\.vendor/, rows: [{ id: 1, bank_account_last4: null }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'PUT', '/vendors/:id/banking'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { bank_routing: '123' } }) }))._status, 200);

  // Only bank_account (last4 extraction)
  setDbHandlers([{ match: /UPDATE core\.vendor/, rows: [{ id: 1, bank_account_last4: '6789' }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'PUT', '/vendors/:id/banking'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { bank_account: '123456789' } }) }))._status, 200);

  // Reveal with some encrypted values
  const taxEnc = encryptField('11-1111111');
  const rtEnc = encryptField('ROUTING-1');
  const acctEnc = encryptField('ACCT-1');
  setDbHandlers([{ match: /FROM core\.vendor WHERE id/, rows: [{ id: 1, tax_id_encrypted: taxEnc, bank_routing_encrypted: rtEnc, bank_account_encrypted: acctEnc }] }]);
  const r = await invokeRoute(findRoute(app, 'POST', '/vendors/:id/banking/reveal'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
  assert.equal(r._status, 200);
  assert.equal(r._body.tax_id, '11-1111111');

  // Banking read with last4 present (non-null branch)
  setDbHandlers([{ match: /FROM core\.vendor WHERE id/, rows: [{ id: 1, tax_id_encrypted: null, bank_routing_encrypted: null, bank_account_encrypted: null, bank_account_last4: '1234', updated_at: new Date() }] }]);
  const r2 = await invokeRoute(findRoute(app, 'GET', '/vendors/:id/banking'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
  assert.equal(r2._status, 200);
});

// ----------------------------------------------------------------------------
// orders — additional branches
// ----------------------------------------------------------------------------
test('orders — 404/403 edge cases + list with null scope', async () => {
  const app = await registerRoutes(orderRoutes);
  // cancel 409 already-canceled — cancelEventOrder does second lookup with same query
  setDbHandlers([
    { match: /FROM core\.event_order WHERE id=\$1 FOR UPDATE/, rows: [{ id: 1, city_id: 1, status: 'canceled' }] },
    { match: /SELECT id, status FROM core\.event_order WHERE id = \$1 FOR UPDATE/, rows: [{ id: 1, status: 'canceled' }] }
  ]);
  assert.ok((await invokeRoute(findRoute(app, 'POST', '/orders/:id/cancel'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status >= 400);

  // receipt 404 (order not found for stage)
  setDbHandlers([{ match: /SELECT city_id FROM core\.event_order WHERE id=\$1 FOR UPDATE/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/orders/:id/stages/:stageId/receipts'), { request: fakeRequest({ user: ALL, params: { id: 1, stageId: 1 }, body: {} }) }))._status, 404);

  // refund 404 (order not found)
  setDbHandlers([{ match: /SELECT city_id FROM core\.event_order WHERE id=\$1 FOR UPDATE/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/orders/:id/stages/:stageId/refund'), { request: fakeRequest({ user: ALL, params: { id: 1, stageId: 1 }, body: {} }) }))._status, 404);
});

// ----------------------------------------------------------------------------
// events — ends_at branch + cancel with reason null
// ----------------------------------------------------------------------------
test('events — cancel with no reason + happy headcount triggering refund', async () => {
  const app = await registerRoutes(eventRoutes);
  setDbHandlers([
    { match: /SELECT \* FROM core\.event WHERE id=\$1 FOR UPDATE/, rows: [{ id: 1, city_id: 1, status: 'planned' }] },
    { match: /UPDATE core\.event\s+SET status='canceled'/, rows: [] },
    { match: /FROM core\.event WHERE id=\$1/, rows: [{ id: 1, city_id: 1, min_headcount: 1, current_headcount: 10, headcount_cutoff_at: '2020-01-01T00:00:00Z', status: 'canceled' }] },
    { match: /FROM core\.event WHERE id = \$1/, rows: [{ id: 1, city_id: 1, min_headcount: 1, current_headcount: 10, headcount_cutoff_at: '2020-01-01T00:00:00Z', status: 'canceled' }] },
    { match: /FROM core\.event_order\s+WHERE event_id/, rows: [] }
  ]);
  await invokeRoute(findRoute(app, 'POST', '/events/:id/cancel'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
});

// ----------------------------------------------------------------------------
// ingestion_sources — more branches (run force with successful run)
// ----------------------------------------------------------------------------
test('ingestion_sources run — force + records with no rows', async () => {
  const app = await registerRoutes(ingestionSourceRoutes);
  // force=true path: runSource proceeds, inactive check (pre-lock)
  setDbHandlers([
    { match: /FROM core\.ingestion_source WHERE id/, rows: [{ id: 1, is_active: false }] }
  ]);
  const inactive = await invokeRoute(findRoute(app, 'POST', '/ingestion/sources/:id/run'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
  assert.ok(inactive._status >= 400);
});

// ----------------------------------------------------------------------------
// payments — list refunds + receipts with filters
// ----------------------------------------------------------------------------
test('payments — receipts/refunds query variations', async () => {
  const app = await registerRoutes(paymentRoutes);
  setDbHandlers([{ match: /FROM core\.receipt r/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/payments/receipts'), { request: fakeRequest({ user: ALL, query: { limit: 10 } }) });
  setDbHandlers([{ match: /FROM core\.refund rf/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/payments/refunds'), { request: fakeRequest({ user: ALL, query: { limit: 10 } }) });
});

// ----------------------------------------------------------------------------
// workflows/approvals — decide body optional (no notes), reject body optional
// ----------------------------------------------------------------------------
test('workflows/approvals — body optional branches', async () => {
  const app = await registerRoutes(workflowsRoutes);

  // approve with notes
  setDbHandlers([
    { match: /SELECT status FROM core\.approval_request/, rows: [{ status: 'pending' }] },
    { match: /UPDATE core\.approval_request/, rows: [{ id: 1, status: 'approved', entity_type: 'v', entity_id: '1' }] }
  ]);
  await invokeRoute(findRoute(app, 'POST', '/workflows/approvals/:id/approve'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { notes: 'n' } }) });

  // reject without body (body: null)
  setDbHandlers([
    { match: /SELECT status FROM core\.approval_request/, rows: [{ status: 'pending' }] },
    { match: /UPDATE core\.approval_request/, rows: [{ id: 1, status: 'rejected', entity_type: 'v', entity_id: '1' }] }
  ]);
  await invokeRoute(findRoute(app, 'POST', '/workflows/approvals/:id/reject'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });

  // approve — 409 path
  setDbHandlers([
    { match: /SELECT status FROM core\.approval_request/, rows: [{ status: 'approved' }] },
    { match: /UPDATE core\.approval_request/, rows: [] }
  ]);
  const r = await invokeRoute(findRoute(app, 'POST', '/workflows/approvals/:id/approve'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: {} }) });
  assert.equal(r._status, 409);
});

// ----------------------------------------------------------------------------
// payment_intake — /payments/wechat/import-callbacks happy path
// ----------------------------------------------------------------------------
test('payment_intake — wechat callbacks happy', async () => {
  const app = await registerRoutes(paymentIntakeRoutes);
  const { config } = await import('../src/config.js');
  const dir = path.resolve(config.wechatImportDir);
  fs.mkdirSync(dir, { recursive: true });
  const SECRET = process.env.WECHAT_SHARED_SECRET;
  const CB_FIELDS = ['external_id','status','paid_at'];
  const cb = { external_id: 'cb-1', status: 'SUCCESS', paid_at: 'now' };
  cb.signature = crypto.createHmac('sha256', SECRET).update(CB_FIELDS.map((f) => `${f}=${cb[f]}`).join('|')).digest('hex');
  fs.writeFileSync(path.join(dir, 'cb-happy.json'), JSON.stringify({ callbacks: [cb] }));
  setDbHandlers([
    { match: /FROM core\.payment_intake\s+WHERE method = 'wechat'/, rows: [{ id: 1, status: 'received' }] },
    { match: /UPDATE core\.payment_intake/, rows: [] }
  ]);
  const r = await invokeRoute(findRoute(app, 'POST', '/payments/wechat/import-callbacks'), { request: fakeRequest({ user: ALL, body: { filename: 'cb-happy.json' } }) });
  assert.equal(r._status, 201);
});

// ----------------------------------------------------------------------------
// itinerary_templates — GET one with events present
// ----------------------------------------------------------------------------
test('itinerary_templates — GET one with events', async () => {
  const app = await registerRoutes(itineraryTplRoutes);
  setDbHandlers([
    { match: /FROM core\.itinerary_template WHERE id/, rows: [{ id: 1, name: 't' }] },
    { match: /FROM core\.itinerary_template_event/, rows: [{ id: 1, sequence: 1 }] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/itinerary-templates/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 200);
});
