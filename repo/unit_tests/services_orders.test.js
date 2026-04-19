// Unit tests — services/orders.js
// Covers number generation, stage due computation, order/receipt/refund flows,
// auto fulfillment, evaluateRefunds (cancel/headcount/manual), manual refund
// aggregate status logic, and cancel order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from './_fakes.js';
import {
  nextNumber,
  computeStageDueAt,
  createEventOrder,
  loadOrderAggregate,
  recordReceipt,
  evaluateRefunds,
  issueManualRefund,
  cancelEventOrder,
  RESERVATION_WINDOW_MINUTES
} from '../src/services/orders.js';

test('RESERVATION_WINDOW_MINUTES is 60', () => {
  assert.equal(RESERVATION_WINDOW_MINUTES, 60);
});

test('nextNumber throws on unknown kind', async () => {
  const c = makeClient([{ match: /.*/, rows: [{ n: 1 }] }]);
  await assert.rejects(() => nextNumber(c, 'bogus'), /Unknown numbering/);
});

test('nextNumber formats prefixed zero-padded id', async () => {
  const c = makeClient([{ match: /nextval/, rows: [{ n: 42 }] }]);
  const s = await nextNumber(c, 'order');
  assert.match(s, /^ORD-\d{4}-000042$/);
});

test('computeStageDueAt — absolute', () => {
  const d = computeStageDueAt({ due_rule_type: 'absolute', due_at: '2026-01-01T00:00:00Z' });
  assert.equal(d.toISOString(), '2026-01-01T00:00:00.000Z');
});

test('computeStageDueAt — absolute requires due_at', () => {
  assert.throws(() => computeStageDueAt({ due_rule_type: 'absolute' }), /absolute due rule/);
});

test('computeStageDueAt — relative requires integer offset', () => {
  assert.throws(
    () => computeStageDueAt({ due_rule_type: 'relative_to_order' }, new Date(), new Date()),
    /integer due_offset_minutes/
  );
});

test('computeStageDueAt — relative to order / event', () => {
  const ord = new Date('2026-01-01T00:00:00Z');
  const ev  = new Date('2026-02-01T00:00:00Z');
  const a = computeStageDueAt({ due_rule_type: 'relative_to_order',       due_offset_minutes: 60 }, ord, ev);
  assert.equal(a.getTime(), ord.getTime() + 60 * 60_000);
  const b = computeStageDueAt({ due_rule_type: 'relative_to_event_start', due_offset_minutes: -30 }, ord, ev);
  assert.equal(b.getTime(), ev.getTime() - 30 * 60_000);
});

function baseOrderClient(overrides = {}) {
  // Returns a client that satisfies a full createEventOrder happy-path flow.
  const event = {
    id: 1, city_id: 1,
    starts_at: '2026-06-01T10:00:00Z',
    status: 'planned'
  };
  const stageSeq = [10, 20];
  let stageIdx = 0;

  return makeClient([
    { match: /SELECT id, city_id, starts_at, status FROM core\.event/, rows: [overrides.event ?? event] },
    { match: /nextval\('core\.seq_order_number/,   rows: [{ n: 1 }] },
    { match: /nextval\('core\.seq_invoice_number/, rows: [{ n: 1 }] },
    { match: /nextval\('core\.seq_receipt_number/, rows: [{ n: 1 }] },
    { match: /nextval\('core\.seq_refund_number/,  rows: [{ n: 1 }] },
    { match: /INSERT INTO core\.event_order\s+\(order_number/, rows: [{ id: 100, created_at: new Date() }] },
    { match: /INSERT INTO core\.payment_stage/, rows: () => [{ id: stageSeq[stageIdx++] ?? 999 }] },
    { match: /INSERT INTO core\.invoice/, rows: [] },
    { match: /INSERT INTO core\.event_order_line/, rows: [] },
    { match: /FROM core\.event_order WHERE id = \$1\s*\)?\s*$/, rows: [{ id: 100, order_number: 'ORD-1', event_id: 1, city_id: 1, customer_name: 'n', customer_email: null, customer_phone: null, total_amount_cents: 100, currency: 'USD', status: 'active', created_by: 1, created_at: new Date(), updated_at: new Date() }] },
    { match: /FROM core\.payment_stage ps\s+LEFT JOIN core\.invoice/, rows: [] },
    { match: /FROM core\.event_order_line eol/, rows: [] },
    // Reservation path (used when line_items present)
    { match: /SELECT on_hand, reserved/, rows: [{ on_hand: 10, reserved: 0 }] },
    { match: /UPDATE core\.stock\s+SET reserved = reserved \+/, rows: [] },
    { match: /INSERT INTO core\.stock_movement/, rows: [{ id: 1 }] },
    { match: /INSERT INTO audit\.stock_ledger/, rows: [] },
    { match: /INSERT INTO core\.stock_reservation/, rows: [{ id: 7, item_id: 1, location_id: 2, quantity: 1, status: 'active', expires_at: null, created_at: new Date() }] }
  ]);
}

test('createEventOrder requires fields & rejects mismatched totals', async () => {
  const c = baseOrderClient();
  await assert.rejects(
    () => createEventOrder(c, 1, { event_id: 1, city_id: 1, customer_name: 'x', total_amount_cents: 100, stages: [] }),
    /required/
  );
  await assert.rejects(
    () => createEventOrder(c, 1, { event_id: 1, city_id: 1, customer_name: 'x', total_amount_cents: 100, stages: [{ label: 'a', amount_cents: 50, due_rule_type: 'relative_to_order', due_offset_minutes: 60 }] }),
    /Stage total/
  );
  await assert.rejects(
    () => createEventOrder(c, 1, { event_id: 1, city_id: 1, customer_name: 'x', total_amount_cents: 100, stages: [{ label: 'a', amount_cents: 100, due_rule_type: 'relative_to_order', due_offset_minutes: 60 }], line_items: 'not-array' }),
    /line_items must be an array/
  );
});

test('createEventOrder 404 when event missing, 400 for mismatched city, 400 when canceled', async () => {
  const c1 = makeClient([{ match: /FROM core\.event/, rows: [] }]);
  await assert.rejects(
    () => createEventOrder(c1, 1, { event_id: 1, city_id: 1, customer_name: 'x', total_amount_cents: 100, stages: [{ label: 'a', amount_cents: 100, due_rule_type: 'relative_to_order', due_offset_minutes: 60 }] }),
    /Event not found/
  );

  const c2 = makeClient([{ match: /FROM core\.event/, rows: [{ id: 1, city_id: 9, starts_at: new Date(), status: 'planned' }] }]);
  await assert.rejects(
    () => createEventOrder(c2, 1, { event_id: 1, city_id: 1, customer_name: 'x', total_amount_cents: 100, stages: [{ label: 'a', amount_cents: 100, due_rule_type: 'relative_to_order', due_offset_minutes: 60 }] }),
    /does not match/
  );

  const c3 = makeClient([{ match: /FROM core\.event/, rows: [{ id: 1, city_id: 1, starts_at: new Date(), status: 'canceled' }] }]);
  await assert.rejects(
    () => createEventOrder(c3, 1, { event_id: 1, city_id: 1, customer_name: 'x', total_amount_cents: 100, stages: [{ label: 'a', amount_cents: 100, due_rule_type: 'relative_to_order', due_offset_minutes: 60 }] }),
    /canceled event/
  );
});

test('createEventOrder happy path with line_items', async () => {
  const c = baseOrderClient();
  const agg = await createEventOrder(c, 1, {
    event_id: 1, city_id: 1, customer_name: 'Ada',
    total_amount_cents: 100,
    stages: [{ label: 'Deposit', amount_cents: 100, due_rule_type: 'relative_to_order', due_offset_minutes: 60 }],
    line_items: [{ item_id: 1, location_id: 2, quantity: 1 }]
  });
  assert.equal(agg.id, 100);
});

test('createEventOrder validates each stage', async () => {
  const c = baseOrderClient();
  await assert.rejects(
    () => createEventOrder(c, 1, {
      event_id: 1, city_id: 1, customer_name: 'x', total_amount_cents: 100,
      stages: [{ amount_cents: 100, due_rule_type: 'relative_to_order', due_offset_minutes: 60 }]
    }),
    /stage needs label/
  );
});

test('createEventOrder rejects bad line_items', async () => {
  const c = baseOrderClient();
  await assert.rejects(
    () => createEventOrder(c, 1, {
      event_id: 1, city_id: 1, customer_name: 'x', total_amount_cents: 100,
      stages: [{ label: 'a', amount_cents: 100, due_rule_type: 'relative_to_order', due_offset_minutes: 60 }],
      line_items: [{ item_id: 0, location_id: 0, quantity: 0 }]
    }),
    /line_item needs/
  );
});

test('loadOrderAggregate returns null when order missing', async () => {
  const c = makeClient([{ match: /FROM core\.event_order/, rows: [] }]);
  const r = await loadOrderAggregate(c, 999);
  assert.equal(r, null);
});

test('loadOrderAggregate returns nested stages+lines', async () => {
  const c = makeClient([
    { match: /FROM core\.event_order WHERE id = \$1/, rows: [{ id: 1, order_number: 'o', event_id: 1, city_id: 1, customer_name: 'c', total_amount_cents: 100, currency: 'USD', status: 'active' }] },
    { match: /FROM core\.payment_stage ps/, rows: [{ id: 11 }] },
    { match: /FROM core\.event_order_line eol/, rows: [{ id: 22 }] }
  ]);
  const r = await loadOrderAggregate(c, 1);
  assert.equal(r.stages.length, 1);
  assert.equal(r.line_items.length, 1);
});

test('recordReceipt — stage not found / wrong order / no invoice / not invoiced / partial', async () => {
  const none = makeClient([{ match: /FROM core\.payment_stage/, rows: [] }]);
  await assert.rejects(() => recordReceipt(none, 1, 1, 1, {}), /Stage not found/);

  const wrongOrder = makeClient([{ match: /FROM core\.payment_stage/, rows: [{ id: 1, order_id: 9, amount_cents: 100, status: 'invoiced', invoice_id: 5, currency: 'USD' }] }]);
  await assert.rejects(() => recordReceipt(wrongOrder, 1, 1, 1, {}), /Stage not found/);

  const noInvoice = makeClient([{ match: /FROM core\.payment_stage/, rows: [{ id: 1, order_id: 1, amount_cents: 100, status: 'invoiced', invoice_id: null, currency: 'USD' }] }]);
  await assert.rejects(() => recordReceipt(noInvoice, 1, 1, 1, {}), /no invoice/);

  const notInvoiced = makeClient([{ match: /FROM core\.payment_stage/, rows: [{ id: 1, order_id: 1, amount_cents: 100, status: 'paid', invoice_id: 5, currency: 'USD' }] }]);
  await assert.rejects(() => recordReceipt(notInvoiced, 1, 1, 1, {}), /not invoiced/);

  const ok = makeClient([
    { match: /FROM core\.payment_stage ps\s+LEFT JOIN core\.invoice/, rows: [{ id: 1, order_id: 1, amount_cents: 100, status: 'invoiced', invoice_id: 5, currency: 'USD' }] },
    { match: /nextval/, rows: [{ n: 1 }] },
    { match: /INSERT INTO core\.receipt/, rows: [{ id: 7, receipt_number: 'RCP-1', paid_at: new Date() }] },
    { match: /UPDATE core\.payment_stage/, rows: [] },
    { match: /UPDATE core\.stock_reservation\s+SET expires_at = NULL/, rows: [] },
    { match: /INSERT INTO audit\.financial_ledger/, rows: [] },
    { match: /bool_and\(status = 'paid'\)/, rows: [{ all_paid: true }] },
    { match: /UPDATE core\.event_order SET status='fulfilled'/, rows: [] }
  ]);
  await assert.rejects(() => recordReceipt(ok, 1, 1, 1, { amount_cents: 50 }), /Partial payments/);
});

test('recordReceipt happy path fulfills order', async () => {
  const c = makeClient([
    { match: /FROM core\.payment_stage ps\s+LEFT JOIN core\.invoice/, rows: [{ id: 1, order_id: 1, amount_cents: 100, status: 'invoiced', invoice_id: 5, currency: 'USD' }] },
    { match: /nextval/, rows: [{ n: 1 }] },
    { match: /INSERT INTO core\.receipt/, rows: [{ id: 7, receipt_number: 'RCP-1', paid_at: new Date() }] },
    { match: /UPDATE core\.payment_stage SET status='paid'/, rows: [] },
    { match: /UPDATE core\.stock_reservation\s+SET expires_at = NULL/, rows: [] },
    { match: /INSERT INTO audit\.financial_ledger/, rows: [] },
    { match: /bool_and\(status = 'paid'\)/, rows: [{ all_paid: true }] },
    { match: /UPDATE core\.event_order SET status='fulfilled'/, rows: [] }
  ]);
  const r = await recordReceipt(c, 1, 1, 1, {});
  assert.equal(r.receipt_number, 'RCP-1');
});

test('recordReceipt does not fulfill when other stages unpaid', async () => {
  const c = makeClient([
    { match: /FROM core\.payment_stage ps\s+LEFT JOIN core\.invoice/, rows: [{ id: 1, order_id: 1, amount_cents: 100, status: 'invoiced', invoice_id: 5, currency: 'USD' }] },
    { match: /nextval/, rows: [{ n: 2 }] },
    { match: /INSERT INTO core\.receipt/, rows: [{ id: 7, receipt_number: 'RCP-2', paid_at: new Date() }] },
    { match: /UPDATE core\.payment_stage SET status='paid'/, rows: [] },
    { match: /UPDATE core\.stock_reservation\s+SET expires_at = NULL/, rows: [] },
    { match: /INSERT INTO audit\.financial_ledger/, rows: [] },
    { match: /bool_and\(status = 'paid'\)/, rows: [{ all_paid: false }] }
  ]);
  const r = await recordReceipt(c, 1, 1, 1, {});
  assert.equal(r.receipt_number, 'RCP-2');
});

test('evaluateRefunds — no applicable reason returns noop', async () => {
  const c = makeClient([
    { match: /FROM core\.event WHERE id = \$1/, rows: [{ id: 1, min_headcount: 5, current_headcount: 10, headcount_cutoff_at: '2024-01-01T00:00:00Z', status: 'planned' }] }
  ]);
  const r = await evaluateRefunds(c, 1, 'system', 1, { now: new Date('2023-12-31T00:00:00Z') });
  assert.equal(r.reason, null);
  assert.equal(r.refundsCreated, 0);
});

test('evaluateRefunds — event not found', async () => {
  const c = makeClient([{ match: /FROM core\.event WHERE id/, rows: [] }]);
  await assert.rejects(() => evaluateRefunds(c, 99, 'system', 1), /Event not found/);
});

test('evaluateRefunds — canceled event refunds paid + voids pending', async () => {
  const c = makeClient([
    { match: /FROM core\.event WHERE id = \$1/, rows: [{ id: 1, min_headcount: 1, current_headcount: 0, headcount_cutoff_at: '2026-01-01T00:00:00Z', status: 'canceled' }] },
    { match: /FROM core\.event_order\s+WHERE event_id/, rows: [{ id: 10, currency: 'USD' }] },
    { match: /FROM core\.payment_stage\s+WHERE order_id = \$1 FOR UPDATE/, rows: [
        { id: 100, amount_cents: 50, status: 'paid' },
        { id: 101, amount_cents: 50, status: 'pending' },
        { id: 102, amount_cents: 0, status: 'voided' }
    ] },
    { match: /nextval/, rows: [{ n: 1 }] },
    { match: /INSERT INTO core\.refund/, rows: [{ id: 1 }] },
    { match: /UPDATE core\.payment_stage SET status='refunded'/, rows: [] },
    { match: /INSERT INTO audit\.financial_ledger/, rows: [] },
    { match: /UPDATE core\.payment_stage SET status='voided'/, rows: [] },
    { match: /UPDATE core\.event_order\s+SET status = \$2/, rows: [] },
    { match: /SELECT id FROM core\.stock_reservation\s+WHERE reference_type/, rows: [] }
  ]);
  const r = await evaluateRefunds(c, 1, 'system', 1);
  assert.equal(r.reason, 'event_canceled');
  assert.equal(r.refundsCreated, 1);
  assert.equal(r.ordersAffected, 1);
});

test('evaluateRefunds — headcount miss after cutoff with no paid stages', async () => {
  const c = makeClient([
    { match: /FROM core\.event WHERE id = \$1/, rows: [{ id: 1, min_headcount: 10, current_headcount: 2, headcount_cutoff_at: '2020-01-01T00:00:00Z', status: 'planned' }] },
    { match: /FROM core\.event_order\s+WHERE event_id/, rows: [{ id: 10, currency: 'USD' }] },
    { match: /FROM core\.payment_stage\s+WHERE order_id = \$1 FOR UPDATE/, rows: [
        { id: 200, amount_cents: 100, status: 'invoiced' }
    ] },
    { match: /UPDATE core\.payment_stage SET status='voided'/, rows: [] },
    { match: /UPDATE core\.event_order\s+SET status = \$2/, rows: [] },
    { match: /SELECT id FROM core\.stock_reservation\s+WHERE reference_type/, rows: [] }
  ]);
  const r = await evaluateRefunds(c, 1, 'system', 1);
  assert.equal(r.reason, 'headcount_miss');
  assert.equal(r.refundsCreated, 0);
});

test('evaluateRefunds — manual reason overrides', async () => {
  const c = makeClient([
    { match: /FROM core\.event WHERE id = \$1/, rows: [{ id: 1, min_headcount: 1, current_headcount: 10, headcount_cutoff_at: '2026-01-01T00:00:00Z', status: 'planned' }] },
    { match: /FROM core\.event_order\s+WHERE event_id/, rows: [] }
  ]);
  const r = await evaluateRefunds(c, 1, 'user', 1, { manualReason: 'event_canceled' });
  assert.equal(r.reason, 'event_canceled');
});

test('issueManualRefund — 404 / 409 / full refund', async () => {
  const none = makeClient([{ match: /FROM core\.payment_stage ps\s+JOIN core\.event_order/, rows: [] }]);
  await assert.rejects(() => issueManualRefund(none, 1, 1, 1, {}), /not found/);

  const wrongOrder = makeClient([{ match: /FROM core\.payment_stage ps\s+JOIN core\.event_order/, rows: [{ id: 1, order_id: 2, amount_cents: 100, status: 'paid', currency: 'USD' }] }]);
  await assert.rejects(() => issueManualRefund(wrongOrder, 1, 1, 1, {}), /not found/);

  const notPaid = makeClient([{ match: /FROM core\.payment_stage ps\s+JOIN core\.event_order/, rows: [{ id: 1, order_id: 1, amount_cents: 100, status: 'invoiced', currency: 'USD' }] }]);
  await assert.rejects(() => issueManualRefund(notPaid, 1, 1, 1, {}), /not paid/);

  const ok = makeClient([
    { match: /FROM core\.payment_stage ps\s+JOIN core\.event_order/, rows: [{ id: 1, order_id: 1, amount_cents: 100, status: 'paid', currency: 'USD' }] },
    { match: /nextval/, rows: [{ n: 1 }] },
    { match: /INSERT INTO core\.refund/, rows: [{ id: 5, refund_number: 'REF-1', issued_at: new Date() }] },
    { match: /UPDATE core\.payment_stage SET status='refunded'/, rows: [] },
    { match: /INSERT INTO audit\.financial_ledger/, rows: [] },
    { match: /bool_and\(status IN/, rows: [{ all_closed: true, any_refunded: true }] },
    { match: /UPDATE core\.event_order SET status/, rows: [] }
  ]);
  const r = await issueManualRefund(ok, 1, 1, 1, {});
  assert.equal(r.refund_number, 'REF-1');
});

test('issueManualRefund — next status branches (partial, canceled, active)', async () => {
  async function run(row) {
    const c = makeClient([
      { match: /FROM core\.payment_stage ps\s+JOIN core\.event_order/, rows: [{ id: 1, order_id: 1, amount_cents: 100, status: 'paid', currency: 'USD' }] },
      { match: /nextval/, rows: [{ n: 1 }] },
      { match: /INSERT INTO core\.refund/, rows: [{ id: 5, refund_number: 'REF-1', issued_at: new Date() }] },
      { match: /UPDATE core\.payment_stage SET status='refunded'/, rows: [] },
      { match: /INSERT INTO audit\.financial_ledger/, rows: [] },
      { match: /bool_and\(status IN/, rows: [row] },
      { match: /UPDATE core\.event_order SET status/, rows: [] }
    ]);
    await issueManualRefund(c, 1, 1, 1, { reason: 'manual' });
  }
  await run({ all_closed: true,  any_refunded: false }); // canceled
  await run({ all_closed: false, any_refunded: true });  // partially_refunded
  await run({ all_closed: false, any_refunded: false }); // active
});

test('cancelEventOrder — 404 / already canceled / happy path', async () => {
  const none = makeClient([{ match: /FROM core\.event_order WHERE id/, rows: [] }]);
  await assert.rejects(() => cancelEventOrder(none, 1, 1), /Order not found/);

  const done = makeClient([{ match: /FROM core\.event_order WHERE id/, rows: [{ id: 1, status: 'canceled' }] }]);
  await assert.rejects(() => cancelEventOrder(done, 1, 1), /already canceled/);

  const ok = makeClient([
    { match: /FROM core\.event_order WHERE id/, rows: [{ id: 1, status: 'active' }] },
    { match: /UPDATE core\.payment_stage\s+SET status = 'voided'/, rows: [] },
    { match: /SELECT id FROM core\.stock_reservation\s+WHERE reference_type/, rows: [] },
    { match: /bool_or\(status = 'paid'\)/, rows: [{ any_paid: false }] },
    { match: /UPDATE core\.event_order SET status/, rows: [] }
  ]);
  const r = await cancelEventOrder(ok, 1, 1, { reason: 'customer_request' });
  assert.equal(r.status, 'canceled');

  const paid = makeClient([
    { match: /FROM core\.event_order WHERE id/, rows: [{ id: 1, status: 'active' }] },
    { match: /UPDATE core\.payment_stage\s+SET status = 'voided'/, rows: [] },
    { match: /SELECT id FROM core\.stock_reservation\s+WHERE reference_type/, rows: [] },
    { match: /bool_or\(status = 'paid'\)/, rows: [{ any_paid: true }] },
    { match: /UPDATE core\.event_order SET status/, rows: [] }
  ]);
  const p = await cancelEventOrder(paid, 1, 1);
  assert.equal(p.status, 'partially_refunded');
});
