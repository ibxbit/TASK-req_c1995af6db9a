import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin } from './_helpers.js';

let token, eventId, orderId, firstStageId;

function isoIn(hours) {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

before(async () => {
  token = await loginAdmin();

  // Create an event (city_id=1 is the first seeded city — NYC)
  const ev = await apiFetch('/events', {
    method: 'POST', token,
    body: {
      city_id: 1,
      name: 'API Test Event',
      starts_at: isoIn(240),            // +10 days
      headcount_cutoff_at: isoIn(72),   // +3 days
      min_headcount: 5
    }
  });
  assert.equal(ev.status, 201, JSON.stringify(ev.body));
  eventId = ev.body.id;
});

test('POST /orders creates order + invoiced stages', async () => {
  const r = await apiFetch('/orders', {
    method: 'POST', token,
    body: {
      event_id: eventId,
      city_id: 1,
      customer_name: 'Acme Corp',
      customer_email: 'ops@acme.local',
      total_amount_cents: 100000,
      stages: [
        { label: 'Deposit',       amount_cents: 50000, due_rule_type: 'relative_to_order',       due_offset_minutes: 60 * 24 },
        { label: 'Final payment', amount_cents: 50000, due_rule_type: 'relative_to_event_start', due_offset_minutes: -60 * 24 * 7 }
      ]
    }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  orderId = r.body.id;
  assert.equal(r.body.status, 'active');
  assert.equal(r.body.stages.length, 2);
  assert.equal(r.body.stages[0].status, 'invoiced');
  firstStageId = r.body.stages[0].id;
});

test('POST /orders with mismatched stage total is rejected', async () => {
  const r = await apiFetch('/orders', {
    method: 'POST', token,
    body: {
      event_id: eventId, city_id: 1,
      customer_name: 'BadMath Co',
      total_amount_cents: 100000,
      stages: [ { label: 'Only one', amount_cents: 1, due_rule_type: 'relative_to_order', due_offset_minutes: 60 } ]
    }
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Stage total/);
});

test('record receipt marks stage paid + writes financial ledger', async () => {
  const r = await apiFetch(`/orders/${orderId}/stages/${firstStageId}/receipts`, {
    method: 'POST', token,
    body: { payment_method: 'cash', reference: 'TEST-CASH-001' }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));

  const after = await apiFetch(`/orders/${orderId}`, { token });
  const stage = after.body.stages.find((s) => s.id === firstStageId);
  assert.equal(stage.status, 'paid');

  const ledger = await apiFetch(`/integrations/financial-ledger?order_id=${orderId}`, { token });
  assert.ok(ledger.body.some(
    (e) => e.entry_type === 'receipt' && Number(e.amount_cents) === 50000
  ), 'financial ledger should record a +50000 receipt entry');

  const balance = await apiFetch(`/integrations/orders/${orderId}/balance`, { token });
  assert.equal(Number(balance.body.received_cents), 50000);
  assert.equal(Number(balance.body.outstanding_cents), 50000);
});

test('manual refund writes a negative ledger entry', async () => {
  const refund = await apiFetch(`/orders/${orderId}/stages/${firstStageId}/refund`, {
    method: 'POST', token, body: { reason: 'manual' }
  });
  assert.equal(refund.status, 201, JSON.stringify(refund.body));

  const balance = await apiFetch(`/integrations/orders/${orderId}/balance`, { token });
  assert.equal(Number(balance.body.refunded_cents), -50000);
  assert.equal(Number(balance.body.net_cents), 0);
});

test('duplicate receipt on already-refunded stage is rejected', async () => {
  const r = await apiFetch(`/orders/${orderId}/stages/${firstStageId}/receipts`, {
    method: 'POST', token, body: { payment_method: 'cash' }
  });
  assert.equal(r.status, 409);
});
