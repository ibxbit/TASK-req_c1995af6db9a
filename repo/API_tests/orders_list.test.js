// API tests — orders list + cancel (orders_payments.test.js covers POST/receipt/refund)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'OrdList_Secure12!';
let adminToken;
let warehouseToken; // no order.read

const iso = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

before(async () => {
  adminToken = await loginAdmin();

  const wName = uniq('ord-wh');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: wName, email: `${wName}@local`, full_name: 'Ord WH',
            password: PASS, role_codes: ['WAREHOUSE'] }
  });
  const wLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: wName, password: PASS } });
  warehouseToken = wLogin.body.token;
});

// ── GET /orders ───────────────────────────────────────────────────────────────
test('GET /orders — 401 without token', async () => {
  assert.equal((await apiFetch('/orders')).status, 401);
});

test('GET /orders — 403 without order.read (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/orders', { token: warehouseToken })).status, 403);
});

test('GET /orders — 200 with admin, returns array', async () => {
  const r = await apiFetch('/orders', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── GET /orders/:id ───────────────────────────────────────────────────────────
test('GET /orders/:id — 401 without token', async () => {
  assert.equal((await apiFetch('/orders/1')).status, 401);
});

test('GET /orders/:id — 404 for missing order', async () => {
  assert.equal((await apiFetch('/orders/999999999', { token: adminToken })).status, 404);
});

// ── POST /orders/:id/cancel ───────────────────────────────────────────────────
test('POST /orders/:id/cancel — 401 without token', async () => {
  assert.equal((await apiFetch('/orders/1/cancel', { method: 'POST' })).status, 401);
});

test('POST /orders/:id/cancel — 404 for missing order', async () => {
  const r = await apiFetch('/orders/999999999/cancel', {
    method: 'POST', token: adminToken
  });
  assert.equal(r.status, 404);
});

test('POST /orders/:id/cancel — 200 cancels an active order', async () => {
  // Create event + order to cancel
  const ev = await apiFetch('/events', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, name: uniq('EV-CANCEL-ORD'), starts_at: iso(240),
            headcount_cutoff_at: iso(72), min_headcount: 1 }
  });
  assert.equal(ev.status, 201);

  const order = await apiFetch('/orders', {
    method: 'POST', token: adminToken,
    body: {
      event_id: ev.body.id,
      city_id: 1,
      customer_name: 'Cancel Test Co',
      total_amount_cents: 5000,
      stages: [{ label: 'Full', amount_cents: 5000,
                 due_rule_type: 'relative_to_order', due_offset_minutes: 60 }]
    }
  });
  assert.equal(order.status, 201);

  const r = await apiFetch(`/orders/${order.body.id}/cancel`, {
    method: 'POST', token: adminToken
  });
  assert.ok([200, 201].includes(r.status), `status ${r.status}: ${JSON.stringify(r.body)}`);
});
