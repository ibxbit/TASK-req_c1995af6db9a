// Unit tests — larger routes: events, orders, itineraries, payment_intake,
// workflow_engine, integrations, inventory, vendors, audit, ingestion_sources,
// itinerary_templates, auth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerRoutes, setDbHandlers, findRoute, invokeRoute,
  fakeRequest, fakeUser
} from './_route_harness.js';

import eventRoutes       from '../src/routes/events.js';
import orderRoutes       from '../src/routes/orders.js';
import itineraryRoutes   from '../src/routes/itineraries.js';
import itineraryTplRoutes from '../src/routes/itinerary_templates.js';
import paymentIntakeRoutes from '../src/routes/payment_intake.js';
import workflowEngineRoutes from '../src/routes/workflow_engine.js';
import integrationRoutes from '../src/routes/integrations.js';
import inventoryRoutes   from '../src/routes/inventory.js';
import vendorRoutes      from '../src/routes/vendors.js';
import auditRoutes       from '../src/routes/audit.js';
import ingestionSourceRoutes from '../src/routes/ingestion_sources.js';
import authRoutes        from '../src/routes/auth.js';

const ALL = fakeUser({
  id: 1,
  permissions: [
    'data.city.all', 'data.finance.all',
    'candidate.read','candidate.write','event.read','event.write',
    'order.read','order.write','payment.collect','refund.issue',
    'itinerary.read','itinerary.write','itinerary.template.manage',
    'inventory.read','inventory.write','inventory.issue',
    'venue.read','venue.write',
    'vendor.read','vendor.write','vendor.banking.read','vendor.banking.write',
    'workflow.view','workflow.define','approval.submit','approval.approve','approval.reject',
    'data.ingest','audit.read','user.manage','role.manage','finance.read','finance.write'
  ]
});
const CITY = fakeUser({ id: 2, permissions: ['data.city.assigned','inventory.read','venue.read','event.read','order.read','payment.collect','refund.issue','audit.read','approval.submit','workflow.view'], assignedCityIds: [1] });

// ============================================================================
// events
// ============================================================================
test('events — list/create/get/headcount/cancel/evaluate', async () => {
  const app = await registerRoutes(eventRoutes);

  setDbHandlers([{ match: /FROM core\.event/, rows: [{ id: 1, city_id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/events'), { request: fakeRequest({ user: ALL }) });
  await invokeRoute(findRoute(app, 'GET', '/events'), { request: fakeRequest({ user: CITY }) });
  await invokeRoute(findRoute(app, 'GET', '/events'), { request: fakeRequest({ user: fakeUser({ permissions: ['event.read'], assignedCityIds: [] }) }) });

  // POST 400 / 403 / 201
  setDbHandlers([]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/events'), { request: fakeRequest({ user: ALL, body: {} }) }))._status, 400);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/events'), { request: fakeRequest({ user: CITY, body: { city_id: 9, name: 'n', starts_at: '2026-01-01', min_headcount: 1, headcount_cutoff_at: '2026-01-01' } }) }))._status, 403);

  setDbHandlers([{ match: /INSERT INTO core\.event/, rows: [{ id: 1 }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/events'), { request: fakeRequest({ user: ALL, body: { city_id: 1, name: 'n', starts_at: '2026-01-01', ends_at: '2026-01-01', min_headcount: 1, headcount_cutoff_at: '2026-01-01' } }) }))._status, 201);

  // GET :id 404 / 403 / 200
  setDbHandlers([{ match: /FROM core\.event WHERE id/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/events/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);
  setDbHandlers([{ match: /FROM core\.event WHERE id/, rows: [{ id: 1, city_id: 9 }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/events/:id'), { request: fakeRequest({ user: CITY, params: { id: 1 } }) }))._status, 403);
  setDbHandlers([{ match: /FROM core\.event WHERE id/, rows: [{ id: 1, city_id: 1 }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/events/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 200);

  // headcount 400
  setDbHandlers([]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/events/:id/headcount'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { current_headcount: -1 } }) }))._status, 400);

  // headcount 404
  setDbHandlers([{ match: /SELECT \* FROM core\.event/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/events/:id/headcount'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { current_headcount: 5 } }) }))._status, 404);

  // headcount 403
  setDbHandlers([{ match: /SELECT \* FROM core\.event/, rows: [{ id: 1, city_id: 9 }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/events/:id/headcount'), { request: fakeRequest({ user: CITY, params: { id: 1 }, body: { current_headcount: 5 } }) }))._status, 403);

  // headcount happy (no refund triggered because min_headcount condition not met)
  setDbHandlers([
    { match: /SELECT \* FROM core\.event/, rows: [{ id: 1, city_id: 1, min_headcount: 1, current_headcount: 0, headcount_cutoff_at: '2030-01-01', status: 'planned' }] },
    { match: /UPDATE core\.event SET current_headcount/, rows: [] },
    { match: /FROM core\.event WHERE id = \$1/, rows: [{ id: 1, city_id: 1 }] }
  ]);
  const rHc = await invokeRoute(findRoute(app, 'POST', '/events/:id/headcount'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { current_headcount: 5 } }) });
  assert.equal(rHc._status, 200);

  // cancel 404 / 403 / 409 / happy
  setDbHandlers([{ match: /SELECT \* FROM core\.event WHERE id/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/events/:id/cancel'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: {} }) }))._status, 404);
  setDbHandlers([{ match: /SELECT \* FROM core\.event WHERE id/, rows: [{ id: 1, city_id: 9, status: 'planned' }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/events/:id/cancel'), { request: fakeRequest({ user: CITY, params: { id: 1 }, body: {} }) }))._status, 403);
  setDbHandlers([{ match: /SELECT \* FROM core\.event WHERE id/, rows: [{ id: 1, city_id: 1, status: 'canceled' }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/events/:id/cancel'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: {} }) }))._status, 409);

  setDbHandlers([
    { match: /SELECT \* FROM core\.event WHERE id/, rows: [{ id: 1, city_id: 1, status: 'planned', min_headcount: 1, current_headcount: 0, headcount_cutoff_at: '2020-01-01' }] },
    { match: /UPDATE core\.event\s+SET status='canceled'/, rows: [] },
    { match: /FROM core\.event_order\s+WHERE event_id/, rows: [] },
    { match: /FROM core\.event WHERE id = \$1/, rows: [{ id: 1, city_id: 1 }] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/events/:id/cancel'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { reason: 'bad weather' } }) }))._status, 200);

  // evaluate-refunds
  setDbHandlers([{ match: /SELECT id, city_id FROM core\.event/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/events/:id/evaluate-refunds'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);
  setDbHandlers([{ match: /SELECT id, city_id FROM core\.event/, rows: [{ id: 1, city_id: 9 }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/events/:id/evaluate-refunds'), { request: fakeRequest({ user: CITY, params: { id: 1 } }) }))._status, 403);
  setDbHandlers([
    { match: /SELECT id, city_id FROM core\.event/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM core\.event WHERE id = \$1/, rows: [{ id: 1, min_headcount: 1, current_headcount: 10, headcount_cutoff_at: '2030-01-01', status: 'planned' }] }
  ]);
  await invokeRoute(findRoute(app, 'POST', '/events/:id/evaluate-refunds'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
});

// ============================================================================
// orders
// ============================================================================
test('orders — list / get-one / create / cancel / receipt / refund', async () => {
  const app = await registerRoutes(orderRoutes);

  setDbHandlers([{ match: /FROM core\.event_order/, rows: [{ id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/orders'), { request: fakeRequest({ user: ALL }) });
  await invokeRoute(findRoute(app, 'GET', '/orders'), { request: fakeRequest({ user: CITY }) });
  await invokeRoute(findRoute(app, 'GET', '/orders'), { request: fakeRequest({ user: fakeUser({ permissions: ['order.read'], assignedCityIds: [] }) }) });

  // get-one 404 / 403 / 200
  setDbHandlers([{ match: /FROM core\.event_order WHERE id/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/orders/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);
  setDbHandlers([
    { match: /FROM core\.event_order WHERE id = \$1/, rows: [{ id: 1, city_id: 9 }] },
    { match: /FROM core\.payment_stage ps/, rows: [] },
    { match: /FROM core\.event_order_line/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/orders/:id'), { request: fakeRequest({ user: CITY, params: { id: 1 } }) }))._status, 403);

  // POST /orders — 403 scope
  setDbHandlers([]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/orders'), { request: fakeRequest({ user: CITY, body: { city_id: 9 } }) }))._status, 403);

  // POST /orders — 201 happy
  setDbHandlers([
    { match: /FROM core\.event WHERE id = \$1 FOR UPDATE/, rows: [{ id: 1, city_id: 1, starts_at: new Date(), status: 'planned' }] },
    { match: /nextval/, rows: [{ n: 1 }] },
    { match: /INSERT INTO core\.event_order/, rows: [{ id: 1, created_at: new Date() }] },
    { match: /INSERT INTO core\.payment_stage/, rows: [{ id: 10 }] },
    { match: /INSERT INTO core\.invoice/, rows: [] },
    { match: /FROM core\.event_order WHERE id = \$1/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM core\.payment_stage ps/, rows: [] },
    { match: /FROM core\.event_order_line/, rows: [] }
  ]);
  const oc = await invokeRoute(findRoute(app, 'POST', '/orders'), { request: fakeRequest({ user: ALL, body: {
    event_id: 1, city_id: 1, customer_name: 'c', total_amount_cents: 100,
    stages: [{ label: 'a', amount_cents: 100, due_rule_type: 'relative_to_order', due_offset_minutes: 60 }]
  } }) });
  assert.equal(oc._status, 201);

  // POST /orders/:id/cancel — 404 / 403 / happy
  setDbHandlers([{ match: /FROM core\.event_order WHERE id=\$1 FOR UPDATE/, rows: [] }]);
  assert.ok((await invokeRoute(findRoute(app, 'POST', '/orders/:id/cancel'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status >= 400);
  setDbHandlers([{ match: /FROM core\.event_order WHERE id=\$1 FOR UPDATE/, rows: [{ city_id: 9, status: 'active' }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/orders/:id/cancel'), { request: fakeRequest({ user: CITY, params: { id: 1 } }) }))._status, 403);

  setDbHandlers([
    { match: /FROM core\.event_order WHERE id=\$1 FOR UPDATE/, rows: [{ id: 1, city_id: 1, status: 'active' }] },
    { match: /FROM core\.event_order WHERE id = \$1 FOR UPDATE/, rows: [{ id: 1, status: 'active' }] },
    { match: /UPDATE core\.payment_stage\s+SET status = 'voided'/, rows: [] },
    { match: /SELECT id FROM core\.stock_reservation/, rows: [] },
    { match: /bool_or\(status = 'paid'\)/, rows: [{ any_paid: false }] },
    { match: /UPDATE core\.event_order SET status/, rows: [] },
    { match: /FROM core\.event_order WHERE id = \$1/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM core\.payment_stage ps/, rows: [] },
    { match: /FROM core\.event_order_line/, rows: [] }
  ]);
  await invokeRoute(findRoute(app, 'POST', '/orders/:id/cancel'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: {} }) });

  // receipt 404 and 403
  setDbHandlers([{ match: /SELECT city_id FROM core\.event_order WHERE id=\$1 FOR UPDATE/, rows: [] }]);
  const recN = await invokeRoute(findRoute(app, 'POST', '/orders/:id/stages/:stageId/receipts'), { request: fakeRequest({ user: ALL, params: { id: 1, stageId: 1 }, body: {} }) });
  assert.equal(recN._status, 404);

  setDbHandlers([{ match: /SELECT city_id FROM core\.event_order WHERE id=\$1 FOR UPDATE/, rows: [{ city_id: 9 }] }]);
  const recF = await invokeRoute(findRoute(app, 'POST', '/orders/:id/stages/:stageId/receipts'), { request: fakeRequest({ user: CITY, params: { id: 1, stageId: 1 }, body: {} }) });
  assert.equal(recF._status, 403);

  // refund — reuse paths
  setDbHandlers([{ match: /SELECT city_id FROM core\.event_order WHERE id=\$1 FOR UPDATE/, rows: [{ city_id: 9 }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/orders/:id/stages/:stageId/refund'), { request: fakeRequest({ user: CITY, params: { id: 1, stageId: 1 }, body: {} }) }))._status, 403);
});

// ============================================================================
// itineraries — list/create/getOne/update/validate + event CRUD + reorder
// ============================================================================
test('itineraries — list/create/get/update/events CRUD/validate/versions', async () => {
  const app = await registerRoutes(itineraryRoutes);

  // LIST
  setDbHandlers([{ match: /FROM core\.itinerary\b/, rows: [{ id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/itineraries'), { request: fakeRequest({ user: ALL }) });
  await invokeRoute(findRoute(app, 'GET', '/itineraries'), { request: fakeRequest({ user: CITY }) });
  await invokeRoute(findRoute(app, 'GET', '/itineraries'), { request: fakeRequest({ user: fakeUser({ permissions: ['itinerary.read'], assignedCityIds: [] }) }) });

  // CREATE 400 / 403 / 201
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries'), { request: fakeRequest({ user: ALL, body: {} }) }))._status, 400);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries'), { request: fakeRequest({ user: CITY, body: { city_id: 9, name: 'n', itinerary_date: '2026-01-01' } }) }))._status, 403);

  setDbHandlers([
    { match: /INSERT INTO core\.itinerary\s/, rows: [{ id: 1 }] },
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1, current_version: 0, name: 'n', itinerary_date: '2026-01-01' }] },
    { match: /FROM core\.itinerary_event/, rows: [] },
    { match: /INSERT INTO core\.itinerary_version/, rows: [] },
    { match: /UPDATE core\.itinerary\s+SET current_version/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries'), { request: fakeRequest({ user: ALL, body: { city_id: 1, name: 'n', itinerary_date: '2026-01-01' } }) }))._status, 201);

  // GET one 404 / 403 / 200
  setDbHandlers([{ match: /FROM core\.itinerary WHERE id/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/itineraries/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);

  setDbHandlers([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 9 }] },
    { match: /FROM core\.itinerary_event/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/itineraries/:id'), { request: fakeRequest({ user: CITY, params: { id: 1 } }) }))._status, 403);

  setDbHandlers([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM core\.itinerary_event/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/itineraries/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 200);

  // VALIDATE (read-only)
  setDbHandlers([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM core\.itinerary_event/, rows: [] }
  ]);
  await invokeRoute(findRoute(app, 'GET', '/itineraries/:id/validate'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });

  // PUT metadata
  setDbHandlers([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1, current_version: 1, name: 'n', itinerary_date: '2026-01-01' }] },
    { match: /FROM core\.itinerary_event/, rows: [] },
    { match: /UPDATE core\.itinerary\s+SET name/, rows: [] },
    { match: /INSERT INTO core\.itinerary_version/, rows: [] },
    { match: /UPDATE core\.itinerary\s+SET current_version/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'PUT', '/itineraries/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { name: 'x' } }) }))._status, 200);

  // ADD event validation 400
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/events'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: {} }) }))._status, 400);

  // ADD event happy
  setDbHandlers([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1, current_version: 1, name: 'n', itinerary_date: '2026-01-01' }] },
    { match: /FROM core\.itinerary_event/, rows: [] },
    { match: /INSERT INTO core\.itinerary_event/, rows: [] },
    { match: /INSERT INTO core\.itinerary_version/, rows: [] },
    { match: /UPDATE core\.itinerary\s+SET current_version/, rows: [] }
  ]);
  const addE = await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/events'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { title: 'x', start_at: '2026-01-01T10:00:00Z', end_at: '2026-01-01T11:00:00Z' } }) });
  assert.equal(addE._status, 201);

  // UPDATE event — 404 when update returns no rows
  setDbHandlers([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM core\.itinerary_event\s+WHERE itinerary_id/, rows: [] },
    { match: /UPDATE core\.itinerary_event/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'PUT', '/itineraries/:id/events/:eventId'), { request: fakeRequest({ user: ALL, params: { id: 1, eventId: 99 }, body: { title: 'x' } }) }))._status, 404);

  // DELETE event 404
  setDbHandlers([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM core\.itinerary_event\s+WHERE itinerary_id/, rows: [] },
    { match: /DELETE FROM core\.itinerary_event/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'DELETE', '/itineraries/:id/events/:eventId'), { request: fakeRequest({ user: ALL, params: { id: 1, eventId: 99 } }) }))._status, 404);

  // REORDER 400
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/reorder'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: {} }) }))._status, 400);

  // VERSIONS list
  setDbHandlers([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM core\.itinerary_event/, rows: [] },
    { match: /FROM core\.itinerary_version v/, rows: [{ id: 1 }] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/itineraries/:id/versions'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 200);

  // VERSIONS get — 404
  setDbHandlers([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM core\.itinerary_event/, rows: [] },
    { match: /FROM core\.itinerary_version\s+WHERE itinerary_id/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/itineraries/:id/versions/:n'), { request: fakeRequest({ user: ALL, params: { id: 1, n: 1 } }) }))._status, 404);

  // RESTORE 404
  setDbHandlers([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM core\.itinerary_event/, rows: [] },
    { match: /FROM core\.itinerary_version\s+WHERE itinerary_id/, rows: [] }
  ]);
  const rst = await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/versions/:n/restore'), { request: fakeRequest({ user: ALL, params: { id: 1, n: 1 } }) });
  assert.equal(rst._status, 404);
});

// ============================================================================
// itinerary_templates
// ============================================================================
test('itinerary_templates — basic happy/404/400', async () => {
  const app = await registerRoutes(itineraryTplRoutes);

  setDbHandlers([{ match: /FROM core\.itinerary_template/, rows: [{ id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/itinerary-templates'), { request: fakeRequest({ user: ALL }) });

  // GET :id 404
  setDbHandlers([{ match: /FROM core\.itinerary_template WHERE id/, rows: [] }]);
  const r0 = await invokeRoute(findRoute(app, 'GET', '/itinerary-templates/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
  assert.equal(r0._status, 404);

  setDbHandlers([
    { match: /FROM core\.itinerary_template WHERE id/, rows: [{ id: 1, name: 't' }] },
    { match: /FROM core\.itinerary_template_event/, rows: [] }
  ]);
  const r1 = await invokeRoute(findRoute(app, 'GET', '/itinerary-templates/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
  assert.equal(r1._status, 200);

  // POST template 400
  const r2 = await invokeRoute(findRoute(app, 'POST', '/itinerary-templates'), { request: fakeRequest({ user: ALL, body: {} }) });
  assert.equal(r2._status, 400);

  // POST template happy
  setDbHandlers([
    { match: /INSERT INTO core\.itinerary_template\s/, rows: [{ id: 1, name: 't' }] },
    { match: /INSERT INTO core\.itinerary_template_event/, rows: [] },
    { match: /FROM core\.itinerary_template WHERE id/, rows: [{ id: 1, name: 't' }] },
    { match: /FROM core\.itinerary_template_event/, rows: [] }
  ]);
  const r3 = await invokeRoute(findRoute(app, 'POST', '/itinerary-templates'), { request: fakeRequest({ user: ALL, body: { name: 't', description: 'd', events: [{ title: 't', default_duration_minutes: 30 }] } }) });
  assert.equal(r3._status, 201);
});

// ============================================================================
// payment_intake
// ============================================================================
test('payment_intake — list/get/create/process/compensate/sweep/reconciliation', async () => {
  const app = await registerRoutes(paymentIntakeRoutes);

  // LIST
  setDbHandlers([{ match: /FROM core\.payment_intake pi/, rows: [{ id: 1, city_id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/payments/intake'), { request: fakeRequest({ user: ALL, query: {} }) });
  await invokeRoute(findRoute(app, 'GET', '/payments/intake'), { request: fakeRequest({ user: CITY, query: { status: 'received', method: 'cash' } }) });
  await invokeRoute(findRoute(app, 'GET', '/payments/intake'), { request: fakeRequest({ user: fakeUser({ permissions: ['payment.collect'], assignedCityIds: [] }), query: {} }) });

  // GET one 404
  setDbHandlers([{ match: /FROM core\.payment_intake pi/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/payments/intake/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);

  // GET one 403 out of scope
  setDbHandlers([
    { match: /FROM core\.payment_intake pi/, rows: [{ id: 1, city_id: 9 }] },
    { match: /FROM audit\.payment_attempt/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/payments/intake/:id'), { request: fakeRequest({ user: CITY, params: { id: 1 } }) }))._status, 403);

  setDbHandlers([
    { match: /FROM core\.payment_intake pi/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM audit\.payment_attempt/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/payments/intake/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 200);

  // process — scope 403 (city mismatch)
  setDbHandlers([
    { match: /FROM core\.payment_intake pi\s+LEFT JOIN core\.event_order/, rows: [{ id: 1, city_id: 9 }] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/payments/intake/:id/process'), { request: fakeRequest({ user: CITY, params: { id: 1 } }) }))._status, 403);

  // process — 404 (intake not found)
  setDbHandlers([
    { match: /FROM core\.payment_intake pi\s+LEFT JOIN core\.event_order/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/payments/intake/:id/process'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);

  // compensate 403 out of scope
  setDbHandlers([
    { match: /FROM core\.payment_intake pi\s+LEFT JOIN core\.event_order/, rows: [{ id: 1, city_id: 9 }] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/payments/intake/:id/compensate'), { request: fakeRequest({ user: CITY, params: { id: 1 }, body: {} }) }))._status, 403);

  // sweep
  setDbHandlers([
    { match: /FROM core\.payment_intake\s+WHERE status = 'failed'/, rows: [] }
  ]);
  await invokeRoute(findRoute(app, 'POST', '/payments/intake/sweep-retries'), { request: fakeRequest({ user: ALL }) });

  // reconciliation
  setDbHandlers([
    { match: /FROM core\.payment_intake i/, rows: [] },
    { match: /FROM core\.receipt r/, rows: [] },
    { match: /FROM core\.refund rf/, rows: [] }
  ]);
  await invokeRoute(findRoute(app, 'GET', '/payments/reconciliation'), { request: fakeRequest({ user: ALL, query: {} }) });
});

// ============================================================================
// workflow_engine
// ============================================================================
test('workflow_engine — definitions + instances + tasks', async () => {
  const app = await registerRoutes(workflowEngineRoutes);

  // definitions list/get
  setDbHandlers([{ match: /FROM core\.workflow_definition/, rows: [{ id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/workflows/definitions'), { request: fakeRequest({ user: ALL }) });

  // definitions get 404
  setDbHandlers([{ match: /FROM core\.workflow_definition WHERE id/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/workflows/definitions/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);

  setDbHandlers([
    { match: /FROM core\.workflow_definition WHERE id/, rows: [{ id: 1 }] },
    { match: /FROM core\.workflow_step/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/workflows/definitions/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 200);

  // instances list & get
  setDbHandlers([{ match: /FROM core\.workflow_instance/, rows: [{ id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/workflows/instances'), { request: fakeRequest({ user: ALL, query: {} }) });

  setDbHandlers([{ match: /FROM core\.workflow_instance wi/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/workflows/instances/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);

  setDbHandlers([
    { match: /FROM core\.workflow_instance wi/, rows: [{ id: 1 }] },
    { match: /FROM core\.workflow_task wt/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/workflows/instances/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 200);

  // instances list — non-elevated user (workflow.view only) triggers visibility filter
  const nonElevated = fakeUser({ id: 99, permissions: ['workflow.view'] });
  setDbHandlers([{ match: /FROM core\.workflow_instance wi/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/workflows/instances'), { request: fakeRequest({ user: nonElevated, query: {} }) });

  // instances detail — non-elevated, non-visible user => 403
  setDbHandlers([
    { match: /FROM core\.workflow_instance wi/, rows: [{ id: 1, initiated_by: 55, definition_id: 1, definition_code: 'c', entity_type: 'v', entity_id: '1', summary: null, status: 'running', current_step_id: 10, decided_at: null, updated_at: null, archived_at: null, initiated_at: new Date() }] },
    { match: /FROM core\.workflow_task wt/, rows: [{ id: 1, step_id: 10, sequence: 1, step_name: 's', assignee_permission: 'approval.approve', status: 'open', decision: null, decided_by: null, decided_at: null, decision_notes: null, validation_errors: null, due_at: new Date(), created_at: new Date(), is_overdue: false }] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/workflows/instances/:id'), { request: fakeRequest({ user: nonElevated, params: { id: 1 } }) }))._status, 403);

  // instances detail — non-elevated but IS the initiator => 200
  const initiatorUser = fakeUser({ id: 55, permissions: ['workflow.view', 'approval.submit'] });
  setDbHandlers([
    { match: /FROM core\.workflow_instance wi/, rows: [{ id: 1, initiated_by: 55, definition_id: 1, definition_code: 'c', entity_type: 'v', entity_id: '1', summary: null, status: 'running', current_step_id: 10, decided_at: null, updated_at: null, archived_at: null, initiated_at: new Date() }] },
    { match: /FROM core\.workflow_task wt/, rows: [] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/workflows/instances/:id'), { request: fakeRequest({ user: initiatorUser, params: { id: 1 } }) }))._status, 200);

  // /workflows/tasks/mine
  setDbHandlers([{ match: /FROM core\.workflow_task wt/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/workflows/tasks/mine'), { request: fakeRequest({ user: ALL, query: {} }) });

  // /workflows/tasks/:id 404 / 403 / 200
  setDbHandlers([{ match: /FROM core\.workflow_task wt/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/workflows/tasks/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);

  setDbHandlers([{ match: /FROM core\.workflow_task wt/, rows: [{ id: 1, assignee_permission: 'approval.approve', initiated_by: 999 }] }]);
  const notAssignee = fakeUser({ id: 42, permissions: ['workflow.view'] });
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/workflows/tasks/:id'), { request: fakeRequest({ user: notAssignee, params: { id: 1 } }) }))._status, 403);

  setDbHandlers([{ match: /FROM core\.workflow_task wt/, rows: [{ id: 1, assignee_permission: 'approval.approve', initiated_by: 999 }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/workflows/tasks/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 200);
});

// ============================================================================
// integrations
// ============================================================================
test('integrations — balance/ledger/consistency', async () => {
  const app = await registerRoutes(integrationRoutes);

  setDbHandlers([{ match: /FROM audit\.financial_ledger/, rows: [{ id: 1, entry_type: 'receipt' }] }]);
  await invokeRoute(findRoute(app, 'GET', '/integrations/financial-ledger'), { request: fakeRequest({ user: ALL, query: { order_id: 1, entry_type: 'receipt', from: '2026-01-01', to: '2026-02-01', limit: 50 } }) });

  // balance 404
  setDbHandlers([{ match: /FROM core\.event_order WHERE id/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/integrations/orders/:id/balance'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);

  // balance 403
  setDbHandlers([{ match: /FROM core\.event_order WHERE id/, rows: [{ id: 1, city_id: 9 }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/integrations/orders/:id/balance'), { request: fakeRequest({ user: CITY, params: { id: 1 } }) }))._status, 403);

  // balance happy
  setDbHandlers([
    { match: /FROM core\.event_order WHERE id/, rows: [{ id: 1, order_number: 'o', total_amount_cents: 100, currency: 'USD', status: 'active', city_id: 1 }] },
    { match: /FROM audit\.financial_ledger\s+WHERE order_id/, rows: [{ entry_type: 'receipt', count: 1, total: 100 }] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/integrations/orders/:id/balance'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 200);

  // consistency
  setDbHandlers([
    { match: /FROM core\.event_order eo\s+WHERE NOT EXISTS/, rows: [] },
    { match: /FROM core\.payment_stage ps\s+WHERE NOT EXISTS/, rows: [] },
    { match: /FROM core\.payment_stage\s+WHERE status = 'paid'/, rows: [] },
    { match: /FROM core\.payment_stage\s+WHERE status = 'refunded'/, rows: [] },
    { match: /FROM core\.receipt r\s+WHERE NOT EXISTS/, rows: [] },
    { match: /FROM core\.refund rf\s+WHERE NOT EXISTS/, rows: [] },
    { match: /FROM core\.stock_reservation sr/, rows: [] },
    { match: /FROM core\.event_order_line eol/, rows: [] },
    { match: /FROM core\.event_order\s+WHERE status = 'fulfilled'/, rows: [] },
    { match: /FROM core\.stock_reservation\s+WHERE status = 'active'/, rows: [] }
  ]);
  const r = await invokeRoute(findRoute(app, 'GET', '/integrations/consistency'), { request: fakeRequest({ user: ALL }) });
  assert.equal(r._body.consistent, true);
});

// ============================================================================
// inventory routes — many branches
// ============================================================================
test('inventory routes — list/alerts/ledger/movements/inbound/outbound/transfer/cc/reservation', async () => {
  const app = await registerRoutes(inventoryRoutes);

  // list
  setDbHandlers([{ match: /FROM core\.v_stock_position/, rows: [{ item_id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/inventory'), { request: fakeRequest({ user: ALL, query: { item_id: 1, warehouse_id: 1, location_id: 1 } }) });
  await invokeRoute(findRoute(app, 'GET', '/inventory'), { request: fakeRequest({ user: CITY, query: {} }) });
  await invokeRoute(findRoute(app, 'GET', '/inventory'), { request: fakeRequest({ user: fakeUser({ permissions: ['inventory.read'], assignedCityIds: [] }), query: {} }) });

  // low-stock — admin (all)
  setDbHandlers([{ match: /FROM core\.v_low_stock_item/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/inventory/alerts/low-stock'), { request: fakeRequest({ user: ALL }) });
  // low-stock — scoped
  setDbHandlers([{ match: /FROM core\.item i\s+JOIN core\.v_stock_position/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/inventory/alerts/low-stock'), { request: fakeRequest({ user: CITY }) });
  // low-stock — no scope
  assert.deepEqual(
    (await invokeRoute(findRoute(app, 'GET', '/inventory/alerts/low-stock'), { request: fakeRequest({ user: fakeUser({ permissions: ['inventory.read'], assignedCityIds: [] }) }) }))._body,
    []
  );

  // ledger
  setDbHandlers([{ match: /FROM audit\.stock_ledger/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/inventory/ledger'), { request: fakeRequest({ user: ALL, query: { limit: 100, item_id: 1, location_id: 1 } }) });
  await invokeRoute(findRoute(app, 'GET', '/inventory/ledger'), { request: fakeRequest({ user: CITY, query: {} }) });
  assert.deepEqual(
    (await invokeRoute(findRoute(app, 'GET', '/inventory/ledger'), { request: fakeRequest({ user: fakeUser({ permissions: ['audit.read'], assignedCityIds: [] }), query: {} }) }))._body,
    []
  );

  // movements
  setDbHandlers([{ match: /FROM core\.stock_movement/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/inventory/movements'), { request: fakeRequest({ user: ALL, query: { limit: 10 } }) });
  await invokeRoute(findRoute(app, 'GET', '/inventory/movements'), { request: fakeRequest({ user: CITY, query: {} }) });
  assert.deepEqual(
    (await invokeRoute(findRoute(app, 'GET', '/inventory/movements'), { request: fakeRequest({ user: fakeUser({ permissions: ['inventory.read'], assignedCityIds: [] }), query: {} }) }))._body,
    []
  );

  // inbound 400 / 404 / 403 / 201
  setDbHandlers([]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/inventory/inbound'), { request: fakeRequest({ user: ALL, body: {} }) }))._status, 400);

  setDbHandlers([{ match: /FROM core\.warehouse_location/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/inventory/inbound'), { request: fakeRequest({ user: ALL, body: { location_id: 9, item_id: 1, quantity: 1 } }) }))._status, 404);

  setDbHandlers([{ match: /FROM core\.warehouse_location/, rows: [{ city_id: 9 }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/inventory/inbound'), { request: fakeRequest({ user: CITY, body: { location_id: 1, item_id: 1, quantity: 1 } }) }))._status, 403);

  setDbHandlers([
    { match: /FROM core\.warehouse_location/, rows: [{ city_id: 1 }] },
    { match: /FROM core\.stock\s+WHERE item_id/, rows: [{ on_hand: 0, reserved: 0 }] },
    { match: /INSERT INTO core\.stock \(/, rows: [] },
    { match: /INSERT INTO core\.stock_movement/, rows: [{ id: 1 }] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/inventory/inbound'), { request: fakeRequest({ user: ALL, body: { location_id: 1, item_id: 1, quantity: 5 } }) }))._status, 201);

  // outbound 400/404/403
  setDbHandlers([]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/inventory/outbound'), { request: fakeRequest({ user: ALL, body: {} }) }))._status, 400);

  // transfer
  setDbHandlers([]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/inventory/transfer'), { request: fakeRequest({ user: ALL, body: {} }) }))._status, 400);

  // cycle-count
  setDbHandlers([]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/inventory/cycle-counts'), { request: fakeRequest({ user: ALL, body: {} }) }))._status, 400);

  // reservations
  setDbHandlers([]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/inventory/reservations'), { request: fakeRequest({ user: ALL, body: {} }) }))._status, 400);

  // sweep
  setDbHandlers([{ match: /FROM core\.stock_reservation/, rows: [] }]);
  await invokeRoute(findRoute(app, 'POST', '/inventory/reservations/sweep-expired'), { request: fakeRequest({ user: ALL }) });

  // release / fulfill 404
  setDbHandlers([{ match: /FROM core\.stock_reservation/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/inventory/reservations/:id/release'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);
  setDbHandlers([{ match: /FROM core\.stock_reservation/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/inventory/reservations/:id/fulfill'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);
});

// ============================================================================
// vendors
// ============================================================================
test('vendors — list/create/banking', async () => {
  const app = await registerRoutes(vendorRoutes);

  setDbHandlers([{ match: /FROM core\.vendor/, rows: [{ id: 1, has_tax_id: false, has_bank_routing: false, bank_account_last4: null }] }]);
  await invokeRoute(findRoute(app, 'GET', '/vendors'), { request: fakeRequest({ user: ALL }) });

  // POST — delegated to route's requireFields; skip validation test if not path.
  setDbHandlers([{ match: /INSERT INTO core\.vendor/, rows: [{ id: 1, code: 'V1', legal_name: 'Acme', status: 'pending' }] }]);
  await invokeRoute(findRoute(app, 'POST', '/vendors'), { request: fakeRequest({ user: ALL, body: { code: 'V1', legal_name: 'Acme', contact_email: 'x@y', contact_phone: '1' } }) });

  // banking read 404
  setDbHandlers([{ match: /FROM core\.vendor WHERE id/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/vendors/:id/banking'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);

  // banking read happy (no encrypted data)
  setDbHandlers([{ match: /FROM core\.vendor WHERE id/, rows: [{ id: 1, tax_id_encrypted: null, bank_routing_encrypted: null, bank_account_encrypted: null, bank_account_last4: null, updated_at: new Date() }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/vendors/:id/banking'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 200);

  // banking update 404
  setDbHandlers([{ match: /UPDATE core\.vendor/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'PUT', '/vendors/:id/banking'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: {} }) }))._status, 404);

  // banking update happy
  setDbHandlers([{ match: /UPDATE core\.vendor/, rows: [{ id: 1, bank_account_last4: '7890' }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'PUT', '/vendors/:id/banking'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { tax_id: '12345', bank_routing: '1234', bank_account: '1234567890' } }) }))._status, 200);

  // banking reveal 404
  setDbHandlers([{ match: /FROM core\.vendor WHERE id/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/vendors/:id/banking/reveal'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);
});

// ============================================================================
// audit
// ============================================================================
test('audit — events/log/stats/retention', async () => {
  const app = await registerRoutes(auditRoutes);

  setDbHandlers([{ match: /FROM audit\.permission_event/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/audit/events'), { request: fakeRequest({ user: ALL, query: { user_id: 1, username: 'u', workstation: 'ws', action: 'login', entity_type: 'v', entity_id: 1, from: '2026-01-01', to: '2026-02-01', granted: 'true', limit: 50 } }) });
  await invokeRoute(findRoute(app, 'GET', '/audit/events'), { request: fakeRequest({ user: ALL, query: { granted: 'false' } }) });
  await invokeRoute(findRoute(app, 'GET', '/audit/events'), { request: fakeRequest({ user: ALL, query: {} }) });

  setDbHandlers([{ match: /FROM audit\.v_audit_log/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/audit/log'), { request: fakeRequest({ user: ALL, query: { source: 'permission_event', user_id: 1, workstation: 'ws', action: 'l', entity_type: 'v', entity_id: '1', from: '2026-01-01', to: '2026-02-01' } }) });

  setDbHandlers([{ match: /FROM audit\.permission_event/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/audit/stats/by-user'), { request: fakeRequest({ user: ALL }) });
  await invokeRoute(findRoute(app, 'GET', '/audit/stats/by-workstation'), { request: fakeRequest({ user: ALL }) });
  await invokeRoute(findRoute(app, 'GET', '/audit/stats/by-action'), { request: fakeRequest({ user: ALL }) });

  setDbHandlers([{ match: /SELECT\s+\(SELECT MIN/, rows: [{ oldest_permission_event: new Date() }] }]);
  await invokeRoute(findRoute(app, 'GET', '/audit/retention'), { request: fakeRequest({ user: ALL }) });
});

// ============================================================================
// ingestion_sources
// ============================================================================
test('ingestion_sources — list/get/create/update/run/tick/records/checkpoint', async () => {
  const app = await registerRoutes(ingestionSourceRoutes);

  setDbHandlers([{ match: /FROM core\.ingestion_source/, rows: [{ id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/ingestion/sources'), { request: fakeRequest({ user: ALL }) });

  // get 404
  setDbHandlers([{ match: /FROM core\.ingestion_source/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/ingestion/sources/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);

  // get 200
  setDbHandlers([{ match: /FROM core\.ingestion_source/, rows: [{ id: 1 }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/ingestion/sources/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 200);

  // POST validation on min_interval_hours
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/ingestion/sources'), { request: fakeRequest({ user: ALL, body: { code: 'c', type: 'job_board', format: 'csv', inbox_dir: 'i', parser_key: 'generic_jobs_csv', min_interval_hours: 1 } }) }))._status, 400);

  // POST happy
  setDbHandlers([{ match: /INSERT INTO core\.ingestion_source/, rows: [{ id: 1 }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/ingestion/sources'), { request: fakeRequest({ user: ALL, body: { code: 'c', type: 'job_board', format: 'csv', inbox_dir: 'i', parser_key: 'generic_jobs_csv', min_interval_hours: 6, is_active: true, user_agent: 'UA', ip_hint: 'direct', captcha_strategy: 'none', config: { a: 1 } } }) }))._status, 201);

  // PUT with min_interval < 6
  assert.equal((await invokeRoute(findRoute(app, 'PUT', '/ingestion/sources/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { min_interval_hours: 1 } }) }))._status, 400);

  // tick
  setDbHandlers([{ match: /FROM core\.ingestion_source s/, rows: [] }]);
  await invokeRoute(findRoute(app, 'POST', '/ingestion/sources/tick'), { request: fakeRequest({ user: ALL }) });
});

// ============================================================================
// auth
// ============================================================================
test('auth — login 400/401/423, /auth/me', async () => {
  const app = await registerRoutes(authRoutes);

  // 400 missing
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/auth/login'), { request: fakeRequest({ body: {} }) }))._status, 400);

  // 401 invalid (no user)
  setDbHandlers([{ match: /FROM core\.app_user WHERE username/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/auth/login'), { request: fakeRequest({ body: { username: 'u', password: 'p' } }) }))._status, 401);

  // 423 locked
  setDbHandlers([{ match: /FROM core\.app_user WHERE username/, rows: [{ id: 1, username: 'u', password_hash: 'x', is_active: false, failed_login_count: 0, locked_until: null }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/auth/login'), { request: fakeRequest({ body: { username: 'u', password: 'p' } }) }))._status, 423);

  // 401 bad password (user exists but hash won't verify)
  setDbHandlers([
    { match: /FROM core\.app_user WHERE username/, rows: [{ id: 1, username: 'u', password_hash: '$2a$10$xxxxxxxxxxxxxxxxxxxxxx', is_active: true, failed_login_count: 0, locked_until: null }] },
    { match: /UPDATE core\.app_user/, rows: [{ failed_login_count: 1, locked_until: null }] }
  ]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/auth/login'), { request: fakeRequest({ body: { username: 'u', password: 'wrong' } }) }))._status, 401);

  // /auth/me
  setDbHandlers([]);
  const r = await invokeRoute(findRoute(app, 'GET', '/auth/me'), { request: fakeRequest({ user: { id: 1, username: 'u', email: 'e', fullName: 'f', roles: [], permissions: new Set(['x']), assignedCities: [] } }) });
  assert.equal(r._body.id, 1);
});
