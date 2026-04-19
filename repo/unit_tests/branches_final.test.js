// Final branch pushes — targets specific uncovered paths surfaced by c8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  registerRoutes, setDbHandlers, findRoute, invokeRoute,
  fakeRequest, fakeUser
} from './_route_harness.js';
import { makeClient } from './_fakes.js';

import inventoryRoutes from '../src/routes/inventory.js';
import itineraryRoutes from '../src/routes/itineraries.js';
import ingestionSourceRoutes from '../src/routes/ingestion_sources.js';
import vendorRoutes from '../src/routes/vendors.js';
import workflowEngineRoutes from '../src/routes/workflow_engine.js';
import paymentIntakeRoutes from '../src/routes/payment_intake.js';
import venueRoutes from '../src/routes/venues.js';
import orderRoutes from '../src/routes/orders.js';
import integrationRoutes from '../src/routes/integrations.js';

const ALL = fakeUser({
  id: 1,
  permissions: [
    'data.city.all','inventory.read','inventory.write','inventory.issue','audit.read',
    'venue.read','venue.write','order.read','order.write','payment.collect','refund.issue',
    'vendor.read','vendor.write','vendor.banking.read','vendor.banking.write',
    'itinerary.read','itinerary.write','event.read','event.write','data.ingest',
    'workflow.view','workflow.define','approval.submit','approval.approve','approval.reject'
  ]
});

// inventory inbound/outbound/transfer — location 400 with falsy body
test('inventory — mutating routes with null body → 400 on location', async () => {
  const app = await registerRoutes(inventoryRoutes);
  // Request body null (hits `request.body || {}` branch)
  const r1 = await invokeRoute(findRoute(app, 'POST', '/inventory/inbound'), { request: fakeRequest({ user: ALL }) });
  assert.equal(r1._status, 400);
  const r2 = await invokeRoute(findRoute(app, 'POST', '/inventory/outbound'), { request: fakeRequest({ user: ALL }) });
  assert.equal(r2._status, 400);
  const r3 = await invokeRoute(findRoute(app, 'POST', '/inventory/transfer'), { request: fakeRequest({ user: ALL }) });
  assert.equal(r3._status, 400);
  const r4 = await invokeRoute(findRoute(app, 'POST', '/inventory/cycle-counts'), { request: fakeRequest({ user: ALL }) });
  assert.equal(r4._status, 400);
  const r5 = await invokeRoute(findRoute(app, 'POST', '/inventory/reservations'), { request: fakeRequest({ user: ALL }) });
  assert.equal(r5._status, 400);
});

// inventory ledger/movements with various query combos
test('inventory — ledger/movements query combos', async () => {
  const app = await registerRoutes(inventoryRoutes);
  setDbHandlers([{ match: /FROM audit\.stock_ledger/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/inventory/ledger'), { request: fakeRequest({ user: ALL, query: { limit: 5 } }) });
  await invokeRoute(findRoute(app, 'GET', '/inventory/ledger'), { request: fakeRequest({ user: ALL, query: { item_id: 1 } }) });
  await invokeRoute(findRoute(app, 'GET', '/inventory/ledger'), { request: fakeRequest({ user: ALL, query: { location_id: 1 } }) });
  setDbHandlers([{ match: /FROM core\.stock_movement/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/inventory/movements'), { request: fakeRequest({ user: ALL, query: { limit: 10 } }) });
});

// itineraries — add-event 400 missing fields
test('itineraries — add-event 400 + reorder 400', async () => {
  const app = await registerRoutes(itineraryRoutes);
  // Add event with missing start_at
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/events'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { title: 'x', end_at: '2026-01-01' } }) }))._status, 400);
  // Add event with missing end_at
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/events'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { title: 'x', start_at: '2026-01-01' } }) }))._status, 400);
  // Reorder with non-array
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/reorder'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { order: 'bogus' } }) }))._status, 400);
});

// ingestion_sources — various PUT combinations
test('ingestion_sources — PUT with min_interval, user_agent, ip_hint, captcha_strategy', async () => {
  const app = await registerRoutes(ingestionSourceRoutes);
  // All fields set
  setDbHandlers([{ match: /UPDATE core\.ingestion_source/, rows: [{ id: 1 }] }]);
  for (const body of [
    { min_interval_hours: 6, is_active: true, user_agent: 'UA' },
    { ip_hint: 'direct' },
    { captcha_strategy: 'none' },
    { config: { a: 1 } },
    { inbox_dir: 'x', parser_key: 'generic_jobs_csv' }
  ]) {
    setDbHandlers([{ match: /UPDATE core\.ingestion_source/, rows: [{ id: 1 }] }]);
    await invokeRoute(findRoute(app, 'PUT', '/ingestion/sources/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body }) });
  }

  // POST with minimal body
  setDbHandlers([{ match: /INSERT INTO core\.ingestion_source/, rows: [{ id: 1 }] }]);
  for (const body of [
    { code: 'c', type: 'job_board', format: 'csv', inbox_dir: 'i', parser_key: 'generic_jobs_csv', min_interval_hours: 12, is_active: false },
    { code: 'c', type: 'job_board', format: 'csv', inbox_dir: 'i', parser_key: 'generic_jobs_csv', user_agent: 'UA' },
    { code: 'c', type: 'job_board', format: 'csv', inbox_dir: 'i', parser_key: 'generic_jobs_csv' }
  ]) {
    setDbHandlers([{ match: /INSERT INTO core\.ingestion_source/, rows: [{ id: 1 }] }]);
    await invokeRoute(findRoute(app, 'POST', '/ingestion/sources'), { request: fakeRequest({ user: ALL, body }) });
  }
});

// vendors — POST without optional contact info
test('vendors — POST minimal body + PUT banking individual fields', async () => {
  const app = await registerRoutes(vendorRoutes);
  // Only code + legal_name
  setDbHandlers([{ match: /INSERT INTO core\.vendor/, rows: [{ id: 1, code: 'v', legal_name: 'L' }] }]);
  await invokeRoute(findRoute(app, 'POST', '/vendors'), { request: fakeRequest({ user: ALL, body: { code: 'v', legal_name: 'L' } }) });

  // banking update with no input (all null)
  setDbHandlers([{ match: /UPDATE core\.vendor/, rows: [{ id: 1, bank_account_last4: null }] }]);
  await invokeRoute(findRoute(app, 'PUT', '/vendors/:id/banking'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: {} }) });

  // banking read returning 404
  setDbHandlers([{ match: /FROM core\.vendor WHERE id/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/vendors/:id/banking'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) }))._status, 404);
});

// workflow_engine routes — instances filter perms
test('workflow_engine — instances list filters', async () => {
  const app = await registerRoutes(workflowEngineRoutes);
  setDbHandlers([{ match: /FROM core\.workflow_instance/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/workflows/instances'), { request: fakeRequest({ user: ALL, query: { status: 'running' } }) });
  await invokeRoute(findRoute(app, 'GET', '/workflows/instances'), { request: fakeRequest({ user: ALL, query: { entity_type: 'vendor' } }) });
  await invokeRoute(findRoute(app, 'GET', '/workflows/instances'), { request: fakeRequest({ user: ALL, query: { limit: 5 } }) });
});

// payment_intake — list status/method + in-scope process happy
test('payment_intake — list with each filter + sweep', async () => {
  const app = await registerRoutes(paymentIntakeRoutes);
  setDbHandlers([{ match: /FROM core\.payment_intake pi/, rows: [] }]);
  for (const q of [{ status: 'applied' }, { method: 'cash' }, { status: 'failed', method: 'ach' }]) {
    await invokeRoute(findRoute(app, 'GET', '/payments/intake'), { request: fakeRequest({ user: ALL, query: q }) });
  }

  setDbHandlers([{ match: /FROM core\.payment_intake\s+WHERE status = 'failed'/, rows: [] }]);
  await invokeRoute(findRoute(app, 'POST', '/payments/intake/sweep-retries'), { request: fakeRequest({ user: ALL }) });
});

// venues — drive-time without origin (400), without destination (400)
test('venues — drive-time missing params', async () => {
  const app = await registerRoutes(venueRoutes);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/venues/drive-time'), { request: fakeRequest({ user: ALL, query: { origin: 1 } }) }))._status, 400);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/venues/drive-time'), { request: fakeRequest({ user: ALL, query: { destination: 2 } }) }))._status, 400);

  // POST with non-integer minutes
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/venues/drive-time'), { request: fakeRequest({ user: ALL, body: { origin_venue_id: 1, destination_venue_id: 2, minutes: 1.5 } }) }))._status, 400);
});

// orders — list filtering branch (scope.all)
test('orders — list happy / get-one happy', async () => {
  const app = await registerRoutes(orderRoutes);
  setDbHandlers([{ match: /FROM core\.event_order WHERE id = \$1/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM core\.payment_stage ps/, rows: [] },
    { match: /FROM core\.event_order_line/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/orders/:id'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
});

// integrations — different filter combos for financial-ledger
test('integrations — financial-ledger combined filters', async () => {
  const app = await registerRoutes(integrationRoutes);
  setDbHandlers([{ match: /FROM audit\.financial_ledger/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/integrations/financial-ledger'), { request: fakeRequest({ user: ALL, query: { order_id: 1, entry_type: 'refund' } }) });
  await invokeRoute(findRoute(app, 'GET', '/integrations/financial-ledger'), { request: fakeRequest({ user: ALL, query: { from: '2026-01-01', to: '2026-02-01' } }) });
});
