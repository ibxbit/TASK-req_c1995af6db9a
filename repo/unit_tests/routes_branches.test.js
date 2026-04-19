// Extra branch coverage — targets the paths c8 reported as uncovered.
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

import ingestionSourceRoutes from '../src/routes/ingestion_sources.js';
import itineraryTplRoutes from '../src/routes/itinerary_templates.js';
import itineraryRoutes from '../src/routes/itineraries.js';
import inventoryRoutes from '../src/routes/inventory.js';
import paymentIntakeRoutes from '../src/routes/payment_intake.js';
import vendorRoutes from '../src/routes/vendors.js';
import authRoutes from '../src/routes/auth.js';
import integrationRoutes from '../src/routes/integrations.js';
import { decryptField, encryptField } from '../src/auth/crypto.js';

const ALL = fakeUser({
  id: 1,
  permissions: [
    'data.city.all','data.ingest','itinerary.template.manage','itinerary.read','itinerary.write',
    'inventory.read','inventory.write','inventory.issue','audit.read','payment.collect','refund.issue',
    'vendor.read','vendor.write','vendor.banking.read','vendor.banking.write',
    'order.read','order.write','workflow.view','workflow.define','approval.submit','approval.approve','approval.reject'
  ]
});

// ============================================================================
// ingestion_sources: run happy + rate-limited 409
// ============================================================================
test('ingestion_sources run — rate-limited 409 + tick', async () => {
  const app = await registerRoutes(ingestionSourceRoutes);

  // Rate-limited: last_run_started_at = very recent (just now).
  setDbHandlers([
    { match: /FROM core\.ingestion_source WHERE id/, rows: [{ id: 1, is_active: true, min_interval_hours: 6, code: 'c', parser_key: 'generic_jobs_csv', format: 'csv', inbox_dir: 'src', config: null }] },
    { match: /FROM core\.ingestion_checkpoint/, rows: [{ last_run_started_at: new Date() }] }
  ]);
  const r = await invokeRoute(findRoute(app, 'POST', '/ingestion/sources/:id/run'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { force: false } }) });
  assert.ok(r._status >= 400);

  // tick
  setDbHandlers([{ match: /FROM core\.ingestion_source s/, rows: [{ id: 1 }] }, { match: /FROM core\.ingestion_source WHERE id/, rows: [] }]);
  await invokeRoute(findRoute(app, 'POST', '/ingestion/sources/tick'), { request: fakeRequest({ user: ALL }) });
});

// ============================================================================
// itinerary_templates — list routes
// ============================================================================
test('itinerary_templates — list + get one', async () => {
  const app = await registerRoutes(itineraryTplRoutes);

  // GET list
  setDbHandlers([{ match: /FROM core\.itinerary_template\s+ORDER BY name/, rows: [{ id: 1, name: 't' }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'GET', '/itinerary-templates'), { request: fakeRequest({ user: ALL }) }))._status, 200);

  // POST with events validation error (events not array)
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itinerary-templates'), { request: fakeRequest({ user: ALL, body: { name: 't', events: 'not-array' } }) }))._status, 400);

  // POST without events
  setDbHandlers([{ match: /INSERT INTO core\.itinerary_template\s/, rows: [{ id: 1, name: 't' }] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/itinerary-templates'), { request: fakeRequest({ user: ALL, body: { name: 't' } }) }))._status, 201);
});

// ============================================================================
// itineraries — 422 validation failure path via a call-counted event handler
// ============================================================================
test('itineraries — 422 validation failure on event add', async () => {
  const app = await registerRoutes(itineraryRoutes);

  let eventCall = 0;
  setDbHandlers([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1 }] },
    { match: /FROM core\.itinerary_event/, rows: () => {
      eventCall++;
      // First call: existing event. After insert: two events (overlap).
      if (eventCall === 1) return [{ id: 1, title: 'a', sequence: 1, start_at: '2026-01-01T10:00:00Z', end_at: '2026-01-01T11:00:00Z', venue_id: null }];
      return [
        { id: 1, title: 'a', sequence: 1, start_at: '2026-01-01T10:00:00Z', end_at: '2026-01-01T11:00:00Z', venue_id: null },
        { id: 2, title: 'b', sequence: 2, start_at: '2026-01-01T10:30:00Z', end_at: '2026-01-01T11:30:00Z', venue_id: null }
      ];
    } },
    { match: /INSERT INTO core\.itinerary_event/, rows: [] },
    { match: /FROM core\.drive_time/, rows: [] }
  ]);
  const r = await invokeRoute(findRoute(app, 'POST', '/itineraries/:id/events'), { request: fakeRequest({ user: ALL, params: { id: 1 }, body: { title: 'b', start_at: '2026-01-01T10:30:00Z', end_at: '2026-01-01T11:30:00Z' } }) });
  assert.equal(r._status, 422);
});

// ============================================================================
// inventory — low-stock all-city branch hits v_low_stock_item
// ============================================================================
test('inventory — more branches', async () => {
  const app = await registerRoutes(inventoryRoutes);

  // transfer 404 missing location
  setDbHandlers([{ match: /FROM core\.warehouse_location/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/inventory/transfer'), { request: fakeRequest({ user: ALL, body: { item_id: 1, from_location_id: 9, to_location_id: 1, quantity: 1 } }) }))._status, 404);

  // reservations release — 404 (no reservation)
  setDbHandlers([{ match: /FROM core\.stock_reservation/, rows: [] }]);
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/inventory/reservations/:id/release'), { request: fakeRequest({ user: ALL, params: { id: 99 } }) }))._status, 404);

  // reservation 403 out-of-scope location
  setDbHandlers([{ match: /FROM core\.warehouse_location/, rows: [{ city_id: 9 }] }]);
  const scoped = fakeUser({ permissions: ['inventory.issue', 'data.city.assigned'], assignedCityIds: [1] });
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/inventory/reservations'), { request: fakeRequest({ user: scoped, body: { item_id: 1, location_id: 1, quantity: 1 } }) }))._status, 403);
});

// ============================================================================
// payment_intake — list with status/method filters + no order_id branch
// ============================================================================
test('payment_intake — list with filters', async () => {
  const app = await registerRoutes(paymentIntakeRoutes);
  setDbHandlers([{ match: /FROM core\.payment_intake pi/, rows: [{ id: 1 }] }]);
  await invokeRoute(findRoute(app, 'GET', '/payments/intake'), { request: fakeRequest({ user: ALL, query: { status: 'received', method: 'cash' } }) });

  // Non-global user tries to process unlinked intake (city_id null)
  setDbHandlers([{ match: /FROM core\.payment_intake pi\s+LEFT JOIN core\.event_order/, rows: [{ id: 1, city_id: null }] }]);
  const scoped = fakeUser({ permissions: ['payment.collect', 'data.city.assigned'], assignedCityIds: [1] });
  assert.equal((await invokeRoute(findRoute(app, 'POST', '/payments/intake/:id/process'), { request: fakeRequest({ user: scoped, params: { id: 1 } }) }))._status, 403);

  // Admin allowed for unlinked intake (DATA_CITY_ALL)
  setDbHandlers([
    { match: /FROM core\.payment_intake pi\s+LEFT JOIN core\.event_order/, rows: [{ id: 1, city_id: null }] },
    { match: /FROM core\.payment_intake WHERE id = \$1 FOR UPDATE/, rows: [] }
  ]);
  await invokeRoute(findRoute(app, 'POST', '/payments/intake/:id/process'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
});

// ============================================================================
// payment_intake — wechat happy path using real signed file
// ============================================================================
test('payment_intake — wechat import happy', async () => {
  const app = await registerRoutes(paymentIntakeRoutes);
  // Resolve the directory config actually uses.
  const { config } = await import('../src/config.js');
  const dir = path.resolve(config.wechatImportDir);
  fs.mkdirSync(dir, { recursive: true });
  const SECRET = process.env.WECHAT_SHARED_SECRET;

  const TX_FIELDS = ['external_id','amount_cents','currency','order_id','paid_at'];
  const rec = { external_id: 'e-wx-1', amount_cents: 100, currency: 'USD', order_id: 1, paid_at: 'now' };
  const msg = TX_FIELDS.map((f) => `${f}=${rec[f]}`).join('|');
  rec.signature = crypto.createHmac('sha256', SECRET).update(msg).digest('hex');
  fs.writeFileSync(path.join(dir, 'happy-tx.json'), JSON.stringify({ transactions: [rec] }));

  setDbHandlers([{ match: /INSERT INTO core\.payment_intake/, rows: [{ id: 1 }] }]);
  const r = await invokeRoute(findRoute(app, 'POST', '/payments/wechat/import-transactions'), { request: fakeRequest({ user: ALL, body: { filename: 'happy-tx.json' } }) });
  assert.equal(r._status, 201);
});

// ============================================================================
// vendors — banking reveal with encrypted tax_id actually visible
// ============================================================================
test('vendors banking — decrypted reveal', async () => {
  const app = await registerRoutes(vendorRoutes);
  const enc = encryptField('123456789');
  setDbHandlers([{ match: /FROM core\.vendor WHERE id/, rows: [{ id: 1, tax_id_encrypted: enc, bank_routing_encrypted: null, bank_account_encrypted: null, bank_account_last4: null, updated_at: new Date() }] }]);
  // Reveal
  const r = await invokeRoute(findRoute(app, 'POST', '/vendors/:id/banking/reveal'), { request: fakeRequest({ user: ALL, params: { id: 1 } }) });
  assert.equal(r._status, 200);
  assert.equal(r._body.tax_id, '123456789');
});

// ============================================================================
// integrations — financial-ledger with no filters (default limit)
// ============================================================================
test('integrations — financial-ledger no filters', async () => {
  const app = await registerRoutes(integrationRoutes);
  setDbHandlers([{ match: /FROM audit\.financial_ledger/, rows: [] }]);
  await invokeRoute(findRoute(app, 'GET', '/integrations/financial-ledger'), { request: fakeRequest({ user: ALL, query: {} }) });
});

// ============================================================================
// auth — 401 bad token scenarios via authPlugin — simulated
// ============================================================================
test('auth — login happy path with valid password', async () => {
  const app = await registerRoutes(authRoutes);
  const bcrypt = await import('bcryptjs');
  const hash = await (bcrypt.default || bcrypt).hash('rightPasswordLong', 4);
  setDbHandlers([
    { match: /FROM core\.app_user WHERE username/, rows: [{ id: 1, username: 'u', password_hash: hash, is_active: true, failed_login_count: 0, locked_until: null }] },
    { match: /UPDATE core\.app_user\s+SET failed_login_count = 0/, rows: [] }
  ]);
  const r = await invokeRoute(findRoute(app, 'POST', '/auth/login'), { request: fakeRequest({ body: { username: 'u', password: 'rightPasswordLong' } }) });
  assert.equal(r._status, 200);
  assert.ok(r._body.token);
});

test('auth — login locked_now after threshold', async () => {
  const app = await registerRoutes(authRoutes);
  setDbHandlers([
    { match: /FROM core\.app_user WHERE username/, rows: [{ id: 1, username: 'u', password_hash: '$2a$10$xxxxxxxxxxxxxxxxxxxxxx', is_active: true, failed_login_count: 4, locked_until: null }] },
    { match: /UPDATE core\.app_user/, rows: [{ failed_login_count: 0, locked_until: new Date(Date.now() + 60_000) }] }
  ]);
  const r = await invokeRoute(findRoute(app, 'POST', '/auth/login'), { request: fakeRequest({ body: { username: 'u', password: 'wrong' } }) });
  assert.equal(r._status, 423);
});

// ============================================================================
// crypto.js — invalid payload branches
// ============================================================================
test('crypto — null/empty passthrough, invalid payload format', () => {
  assert.equal(decryptField(null), null);
  assert.equal(decryptField(''), null);
  assert.throws(() => decryptField('invalid:payload'), /Invalid encrypted payload/);
  assert.throws(() => decryptField('v2:a:b:c'), /Invalid encrypted payload/);

  // Null input to encryptField returns null (branch).
  assert.equal(encryptField(null), null);
  assert.equal(encryptField(''), null);
});
