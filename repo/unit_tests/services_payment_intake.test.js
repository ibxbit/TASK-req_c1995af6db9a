// Unit tests — services/payment_intake.js
// Covers validation, createIntake, processIntake (success/failure/final-retry),
// sweepPaymentRetries, compensateIntake, reconciliationReport (scope, mismatch).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from './_fakes.js';
import {
  createIntake,
  processIntake,
  sweepPaymentRetries,
  compensateIntake,
  reconciliationReport
} from '../src/services/payment_intake.js';

test('createIntake validates method, external_id, amount_cents', async () => {
  const c = makeClient([{ match: /INSERT INTO core\.payment_intake/, rows: [{ id: 1, method: 'cash', external_id: 'x', status: 'received', attempt_count: 0, receipt_id: null, created_at: new Date() }] }]);

  await assert.rejects(() => createIntake(c, 1, { method: 'bogus', external_id: 'x', amount_cents: 1, order_id: 1 }), /method must/);
  await assert.rejects(() => createIntake(c, 1, { method: 'cash',  external_id: '',  amount_cents: 1, order_id: 1 }), /external_id/);
  await assert.rejects(() => createIntake(c, 1, { method: 'cash',  external_id: 'x', amount_cents: 0, order_id: 1 }), /amount_cents/);
});

test('createIntake allows unlinked intake (no order_id)', async () => {
  // Unlinked intakes are supported for offline cash receipts captured before order is known.
  const c = makeClient([{ match: /INSERT INTO core\.payment_intake/, rows: [{ id: 2, method: 'cash', external_id: 'y', status: 'received', attempt_count: 0, receipt_id: null, created_at: new Date() }] }]);
  const r = await createIntake(c, 1, { method: 'cash', external_id: 'y', amount_cents: 500 });
  assert.equal(r.status, 'received');
});

test('createIntake inserts + returns row', async () => {
  const c = makeClient([{
    match: /INSERT INTO core\.payment_intake/,
    rows: [{ id: 1, method: 'cash', external_id: 'X1', status: 'received', attempt_count: 0, receipt_id: null, created_at: new Date() }]
  }]);
  const r = await createIntake(c, 1, {
    method: 'cash', external_id: 'X1', amount_cents: 100,
    order_id: 1, raw_payload: { a: 1 }, signature: 's', signature_verified: true,
    notes: 'n'
  });
  assert.equal(r.status, 'received');
});

function intakeClient(row, extra = []) {
  return makeClient([
    { match: /FROM core\.payment_intake WHERE id = \$1 FOR UPDATE/, rows: row ? [row] : [] },
    { match: /UPDATE core\.payment_intake SET status='processing'/, rows: [] },
    { match: /SAVEPOINT intake_apply/, rows: [] },
    { match: /RELEASE SAVEPOINT/, rows: [] },
    { match: /ROLLBACK TO SAVEPOINT/, rows: [] },
    { match: /UPDATE core\.payment_intake\s+SET status = 'applied'/, rows: [] },
    { match: /UPDATE core\.payment_intake\s+SET status = \$2/, rows: [] },
    { match: /INSERT INTO audit\.payment_attempt/, rows: [] },
    ...extra
  ]);
}

test('processIntake — 404 when missing', async () => {
  const c = intakeClient(null);
  await assert.rejects(() => processIntake(c, 1, 99), /not found/);
});

test('processIntake — already applied returns cached', async () => {
  const c = intakeClient({ id: 1, status: 'applied', receipt_id: 7, attempt_count: 1, order_id: 1, payment_stage_id: 11, method: 'cash', external_id: 'e', amount_cents: 100 });
  const r = await processIntake(c, 1, 1);
  assert.equal(r.already, true);
  assert.equal(r.receipt_id, 7);
});

test('processIntake — wrong status 409', async () => {
  const c = intakeClient({ id: 1, status: 'rejected', receipt_id: null, attempt_count: 3, order_id: 1, payment_stage_id: null, method: 'cash', external_id: 'e', amount_cents: 100 });
  await assert.rejects(() => processIntake(c, 1, 1), /rejected and cannot/);
});

test('processIntake — successful apply via explicit stage', async () => {
  const c = intakeClient(
    { id: 1, status: 'received', receipt_id: null, attempt_count: 0, order_id: 1, payment_stage_id: 10, method: 'cash', external_id: 'e', amount_cents: 100 },
    [
      { match: /FROM core\.payment_stage ps\s+LEFT JOIN core\.invoice/, rows: [{ id: 10, order_id: 1, amount_cents: 100, status: 'invoiced', invoice_id: 5, currency: 'USD' }] },
      { match: /nextval/, rows: [{ n: 9 }] },
      { match: /INSERT INTO core\.receipt/, rows: [{ id: 42, receipt_number: 'RCP-9', paid_at: new Date() }] },
      { match: /UPDATE core\.payment_stage SET status='paid'/, rows: [] },
      { match: /UPDATE core\.stock_reservation\s+SET expires_at = NULL/, rows: [] },
      { match: /INSERT INTO audit\.financial_ledger/, rows: [] },
      { match: /bool_and\(status = 'paid'\)/, rows: [{ all_paid: true }] },
      { match: /UPDATE core\.event_order SET status='fulfilled'/, rows: [] }
    ]
  );
  const r = await processIntake(c, 1, 1);
  assert.equal(r.status, 'applied');
  assert.equal(r.receipt_id, 42);
});

test('processIntake — resolves stage from order when none on intake', async () => {
  const c = intakeClient(
    { id: 1, status: 'received', receipt_id: null, attempt_count: 0, order_id: 1, payment_stage_id: null, method: 'cash', external_id: 'e', amount_cents: 100 },
    [
      { match: /SELECT id FROM core\.payment_stage\s+WHERE order_id = \$1 AND status = 'invoiced'/, rows: [{ id: 10 }] },
      { match: /FROM core\.payment_stage ps\s+LEFT JOIN core\.invoice/, rows: [{ id: 10, order_id: 1, amount_cents: 100, status: 'invoiced', invoice_id: 5, currency: 'USD' }] },
      { match: /nextval/, rows: [{ n: 9 }] },
      { match: /INSERT INTO core\.receipt/, rows: [{ id: 42, receipt_number: 'RCP-9', paid_at: new Date() }] },
      { match: /UPDATE core\.payment_stage SET status='paid'/, rows: [] },
      { match: /UPDATE core\.stock_reservation\s+SET expires_at = NULL/, rows: [] },
      { match: /INSERT INTO audit\.financial_ledger/, rows: [] },
      { match: /bool_and\(status = 'paid'\)/, rows: [{ all_paid: false }] }
    ]
  );
  const r = await processIntake(c, 1, 1);
  assert.equal(r.status, 'applied');
});

test('processIntake — failure path retries (attempt 1 -> failed)', async () => {
  const c = intakeClient(
    { id: 1, status: 'received', receipt_id: null, attempt_count: 0, order_id: 1, payment_stage_id: null, method: 'cash', external_id: 'e', amount_cents: 100 },
    [
      { match: /SELECT id FROM core\.payment_stage\s+WHERE order_id = \$1 AND status = 'invoiced'/, rows: [] }
    ]
  );
  const r = await processIntake(c, 1, 1);
  assert.equal(r.status, 'failed');
  assert.match(r.error, /No invoiced payment stage/);
});

test('processIntake — final retry becomes rejected (attempt >= max)', async () => {
  // PAYMENT_RETRY_MAX defaults to 3; attempt_count=2 means next attempt=3 => final.
  const c = intakeClient(
    { id: 1, status: 'failed', receipt_id: null, attempt_count: 2, order_id: 1, payment_stage_id: null, method: 'cash', external_id: 'e', amount_cents: 100 },
    [
      { match: /SELECT id FROM core\.payment_stage\s+WHERE order_id = \$1 AND status = 'invoiced'/, rows: [] }
    ]
  );
  const r = await processIntake(c, 1, 1);
  assert.equal(r.status, 'rejected');
  assert.equal(r.next_attempt_at, null);
});

test('sweepPaymentRetries iterates + catches', async () => {
  const c = makeClient([
    { match: /FROM core\.payment_intake\s+WHERE status = 'failed'/, rows: [{ id: 1 }, { id: 2 }] },
    { match: /FROM core\.payment_intake WHERE id = \$1 FOR UPDATE/, rows: (params) => params[0] === 1 ? [{ id: 1, status: 'received', receipt_id: null, attempt_count: 0, order_id: 1, payment_stage_id: null, method: 'cash', external_id: 'e', amount_cents: 100 }] : [] },
    { match: /UPDATE core\.payment_intake SET status='processing'/, rows: [] },
    { match: /SAVEPOINT intake_apply/, rows: [] },
    { match: /ROLLBACK TO SAVEPOINT/, rows: [] },
    { match: /SELECT id FROM core\.payment_stage\s+WHERE order_id = \$1 AND status = 'invoiced'/, rows: [] },
    { match: /UPDATE core\.payment_intake\s+SET status = \$2/, rows: [] },
    { match: /INSERT INTO audit\.payment_attempt/, rows: [] }
  ]);
  const r = await sweepPaymentRetries(c, 1);
  assert.equal(r.processed, 2);
});

test('compensateIntake — 404, 409 on wrong status, 409 on no receipt, 409 when receipt has no stage', async () => {
  const none = intakeClient(null);
  await assert.rejects(() => compensateIntake(none, 1, 1, {}), /not found/);

  const wrong = intakeClient({ id: 1, status: 'failed', receipt_id: null, attempt_count: 1, order_id: 1, payment_stage_id: null, method: 'cash', external_id: 'e', amount_cents: 100 });
  await assert.rejects(() => compensateIntake(wrong, 1, 1, {}), /Cannot compensate/);

  const noReceipt = intakeClient({ id: 1, status: 'applied', receipt_id: null, attempt_count: 1, order_id: 1, payment_stage_id: null, method: 'cash', external_id: 'e', amount_cents: 100 });
  await assert.rejects(() => compensateIntake(noReceipt, 1, 1, {}), /no receipt/);

  const noStage = makeClient([
    { match: /FROM core\.payment_intake WHERE id = \$1 FOR UPDATE/, rows: [{ id: 1, status: 'applied', receipt_id: 7, attempt_count: 1, order_id: 1, payment_stage_id: null, method: 'cash', external_id: 'e', amount_cents: 100 }] },
    { match: /FROM core\.receipt WHERE id = \$1/, rows: [] }
  ]);
  await assert.rejects(() => compensateIntake(noStage, 1, 1, {}), /not linked to a payment stage/);
});

test('compensateIntake — happy path issues refund', async () => {
  const c = makeClient([
    { match: /FROM core\.payment_intake WHERE id = \$1 FOR UPDATE/, rows: [{ id: 1, status: 'applied', receipt_id: 7, attempt_count: 1, order_id: 1, payment_stage_id: 10, method: 'cash', external_id: 'e', amount_cents: 100 }] },
    { match: /FROM core\.receipt WHERE id = \$1/, rows: [{ payment_stage_id: 10 }] },
    { match: /FROM core\.payment_stage ps\s+JOIN core\.event_order/, rows: [{ id: 10, order_id: 1, amount_cents: 100, status: 'paid', currency: 'USD' }] },
    { match: /nextval/, rows: [{ n: 1 }] },
    { match: /INSERT INTO core\.refund/, rows: [{ id: 5, refund_number: 'REF-1', issued_at: new Date() }] },
    { match: /UPDATE core\.payment_stage SET status='refunded'/, rows: [] },
    { match: /INSERT INTO audit\.financial_ledger/, rows: [] },
    { match: /bool_and\(status IN/, rows: [{ all_closed: true, any_refunded: true }] },
    { match: /UPDATE core\.event_order SET status/, rows: [] },
    { match: /UPDATE core\.payment_intake\s+SET status = 'compensated'/, rows: [] },
    { match: /INSERT INTO audit\.payment_attempt/, rows: [] }
  ]);
  const r = await compensateIntake(c, 1, 1, { reason: 'ops-reversal' });
  assert.equal(r.status, 'compensated');
  assert.equal(r.refund.refund_number, 'REF-1');
});

test('reconciliationReport — scope gate on no cities returns empty', async () => {
  const c = makeClient([]);
  const r = await reconciliationReport(c, { scope: { all: false, cityIds: [] } });
  assert.equal(r.consistent, true);
  assert.match(r.notes, /No cities/);
});

test('reconciliationReport — builds report with totals', async () => {
  const c = makeClient([
    { match: /FROM core\.payment_intake i/, rows: [
      { status: 'applied', method: 'cash', count: 2, total_cents: 150 },
      { status: 'failed', method: 'cash', count: 1, total_cents: 50 }
    ] },
    { match: /FROM core\.receipt r/, rows: [{ payment_method: 'cash', count: 2, total_cents: 150 }] },
    { match: /FROM core\.refund rf/, rows: [{ reason: 'manual', count: 1, total_cents: 50 }] }
  ]);
  const r = await reconciliationReport(c, { from: '2026-01-01', to: '2026-02-01', scope: { all: true } });
  assert.equal(r.totals.applied_intakes_cents, 150);
  assert.equal(r.consistent, true);
});

test('reconciliationReport — city-scoped path with mismatch', async () => {
  const c = makeClient([
    { match: /FROM core\.payment_intake i/, rows: [{ status: 'applied', method: 'cash', count: 1, total_cents: 200 }] },
    { match: /FROM core\.receipt r/, rows: [{ payment_method: 'cash', count: 1, total_cents: 100 }] },
    { match: /FROM core\.refund rf/, rows: [] }
  ]);
  const r = await reconciliationReport(c, { from: null, to: null, scope: { all: false, cityIds: [1] } });
  assert.equal(r.consistent, false);
  assert.match(r.notes, /does not match/);
});
