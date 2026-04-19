// Offline payment intake lifecycle.
//  received -> processing -> applied
//                         \-> failed (retry up to PAYMENT_RETRY_MAX)
//                         \-> rejected (give up)
//                         \-> compensated (reversed via refund)
//
// Idempotency: (method, external_id) UNIQUE on the table.
// Apply attempts use a SAVEPOINT so we can persist the failure even though
// recordReceipt's internal writes are rolled back.

import { config } from '../config.js';
import { recordReceipt, issueManualRefund } from './orders.js';

function err(status, message) {
  return Object.assign(new Error(message), { status });
}

const SUPPORTED_METHODS = ['cash', 'check', 'ach', 'wechat'];

function validatePayload(p) {
  if (!p || !SUPPORTED_METHODS.includes(p.method)) {
    throw err(400, `method must be one of ${SUPPORTED_METHODS.join(', ')}`);
  }
  if (!p.external_id) throw err(400, 'external_id is required (idempotency key)');
  if (!p.amount_cents || !Number.isInteger(p.amount_cents) || p.amount_cents <= 0) {
    throw err(400, 'amount_cents must be a positive integer');
  }
}

/**
 * Insert an intake row. Duplicate (method, external_id) returns the existing
 * row, making the endpoint idempotent at the API level too.
 */
export async function createIntake(client, userId, payload) {
  validatePayload(payload);
  const {
    method, external_id, order_id = null, payment_stage_id = null,
    amount_cents, currency = 'USD', raw_payload = null,
    signature = null, signature_verified = false, notes = null
  } = payload;

  const { rows } = await client.query(
    `INSERT INTO core.payment_intake
       (method, external_id, order_id, payment_stage_id, amount_cents, currency,
        raw_payload, signature, signature_verified, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (method, external_id)
       DO UPDATE SET updated_at = core.payment_intake.updated_at  -- no-op to RETURNING
     RETURNING id, method, external_id, status, attempt_count, receipt_id, created_at`,
    [
      method, external_id, order_id, payment_stage_id, amount_cents, currency,
      raw_payload ? JSON.stringify(raw_payload) : null, signature, !!signature_verified,
      notes, userId
    ]
  );
  return rows[0];
}

async function lockIntake(client, intakeId) {
  const { rows } = await client.query(
    `SELECT id, method, external_id, order_id, payment_stage_id, amount_cents,
            status, attempt_count, receipt_id
       FROM core.payment_intake WHERE id = $1 FOR UPDATE`,
    [intakeId]
  );
  return rows[0] || null;
}

async function logAttempt(client, intakeId, attemptNumber, userId, status, error, startedAt) {
  await client.query(
    `INSERT INTO audit.payment_attempt
       (intake_id, attempt_number, actor_user_id, started_at, finished_at, status, error_message)
     VALUES ($1,$2,$3,$4, now(), $5, $6)`,
    [intakeId, attemptNumber, userId ?? null, startedAt, status, error ?? null]
  );
}

/**
 * Apply an intake (idempotent).
 *
 * Resolves a payment_stage_id (explicit, or the earliest 'invoiced' stage of the order),
 * calls recordReceipt inside a SAVEPOINT, and records the attempt in audit.payment_attempt.
 * On failure, schedules a retry PAYMENT_RETRY_INTERVAL_MINUTES minutes later; after
 * PAYMENT_RETRY_MAX attempts the intake is moved to 'rejected'.
 *
 * Must be called inside a transaction (withTransaction).
 */
export async function processIntake(client, userId, intakeId) {
  const intake = await lockIntake(client, intakeId);
  if (!intake) throw err(404, 'Intake not found');

  if (intake.status === 'applied') {
    return { intake_id: intakeId, status: 'applied', receipt_id: intake.receipt_id, already: true };
  }
  if (!['received', 'failed'].includes(intake.status)) {
    throw err(409, `Intake is ${intake.status} and cannot be processed`);
  }

  const attemptNumber = intake.attempt_count + 1;
  const startedAt = new Date();

  await client.query(
    `UPDATE core.payment_intake SET status='processing', updated_at=now() WHERE id=$1`,
    [intakeId]
  );

  await client.query('SAVEPOINT intake_apply');

  try {
    let stageId = intake.payment_stage_id;
    if (!stageId) {
      const { rows } = await client.query(
        `SELECT id FROM core.payment_stage
          WHERE order_id = $1 AND status = 'invoiced'
          ORDER BY sequence LIMIT 1`,
        [intake.order_id]
      );
      stageId = rows[0]?.id;
    }
    if (!stageId) throw new Error('No invoiced payment stage available for this order');

    const receipt = await recordReceipt(client, userId, intake.order_id, stageId, {
      payment_method: intake.method,
      reference: intake.external_id,
      amount_cents: Number(intake.amount_cents)
    });

    await client.query(
      `UPDATE core.payment_intake
          SET status = 'applied',
              receipt_id = $2,
              payment_stage_id = $3,
              attempt_count = $4,
              last_attempt_at = now(),
              next_attempt_at = NULL,
              last_error = NULL,
              updated_at = now()
        WHERE id = $1`,
      [intakeId, receipt.id, stageId, attemptNumber]
    );
    await client.query('RELEASE SAVEPOINT intake_apply');
    await logAttempt(client, intakeId, attemptNumber, userId, 'ok', null, startedAt);
    return { intake_id: intakeId, status: 'applied', receipt_id: receipt.id, attempt: attemptNumber };
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT intake_apply');
    const isFinal = attemptNumber >= config.paymentRetryMax;
    const nextStatus = isFinal ? 'rejected' : 'failed';
    const nextAttemptAt = isFinal
      ? null
      : new Date(Date.now() + config.paymentRetryIntervalMinutes * 60_000);

    await client.query(
      `UPDATE core.payment_intake
          SET status = $2,
              attempt_count = $3,
              last_attempt_at = now(),
              next_attempt_at = $4,
              last_error = $5,
              updated_at = now()
        WHERE id = $1`,
      [intakeId, nextStatus, attemptNumber, nextAttemptAt, e.message]
    );
    await logAttempt(client, intakeId, attemptNumber, userId, isFinal ? 'rejected' : 'failed', e.message, startedAt);
    return {
      intake_id: intakeId, status: nextStatus, attempt: attemptNumber,
      error: e.message, next_attempt_at: nextAttemptAt
    };
  }
}

/**
 * Retry-due intakes — called by the background sweep every minute.
 */
export async function sweepPaymentRetries(client, userId, { now = new Date() } = {}) {
  const { rows } = await client.query(
    `SELECT id FROM core.payment_intake
      WHERE status = 'failed'
        AND next_attempt_at IS NOT NULL
        AND next_attempt_at <= $1
      ORDER BY next_attempt_at
      FOR UPDATE SKIP LOCKED
      LIMIT 50`,
    [now]
  );
  const results = [];
  for (const r of rows) {
    try {
      results.push(await processIntake(client, userId, r.id));
    } catch (e) {
      results.push({ intake_id: r.id, error: e.message });
    }
  }
  return { processed: results.length, results };
}

/**
 * Compensating entry: reverse an applied intake by issuing a manual refund
 * against its receipt's stage. Keeps the ledger balanced.
 */
export async function compensateIntake(client, userId, intakeId, { reason } = {}) {
  const intake = await lockIntake(client, intakeId);
  if (!intake) throw err(404, 'Intake not found');
  if (intake.status !== 'applied') throw err(409, `Cannot compensate an intake in status ${intake.status}`);
  if (!intake.receipt_id) throw err(409, 'Intake has no receipt to reverse');

  const sRes = await client.query(
    `SELECT payment_stage_id FROM core.receipt WHERE id = $1`,
    [intake.receipt_id]
  );
  const stageId = sRes.rows[0]?.payment_stage_id;
  if (!stageId) throw err(409, 'Receipt is not linked to a payment stage');

  const refund = await issueManualRefund(client, userId, intake.order_id, stageId, {
    reason: 'manual'
  });

  await client.query(
    `UPDATE core.payment_intake
        SET status = 'compensated',
            last_error = $2,
            updated_at = now()
      WHERE id = $1`,
    [intakeId, reason || 'compensating entry']
  );

  await logAttempt(client, intakeId, intake.attempt_count, userId, 'ok',
    `compensated via refund ${refund.refund_number}`, new Date());

  return { intake_id: intakeId, status: 'compensated', refund };
}

/**
 * Reconciliation: compare the payment intake totals against the receipt/refund
 * totals for the same window. Mismatches indicate a consistency problem.
 */
export async function reconciliationReport(client, { from = null, to = null, scope }) {
  const args = [];
  const conds = [];
  if (from) { args.push(from); conds.push(`i.created_at >= $${args.length}`); }
  if (to)   { args.push(to);   conds.push(`i.created_at <  $${args.length}`); }
  if (scope && !scope.all) {
    if (!scope.cityIds.length) return emptyReport();
    args.push(scope.cityIds); conds.push(`eo.city_id = ANY($${args.length}::int[])`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const intakeRes = await client.query(
    `SELECT i.status, i.method,
            COUNT(*)                           AS count,
            COALESCE(SUM(i.amount_cents), 0)   AS total_cents
       FROM core.payment_intake i
  LEFT JOIN core.event_order eo ON eo.id = i.order_id
       ${where}
      GROUP BY i.status, i.method
      ORDER BY i.status, i.method`,
    args
  );

  const receiptRes = await client.query(
    `SELECT r.payment_method,
            COUNT(*) AS count,
            COALESCE(SUM(r.amount_cents), 0) AS total_cents
       FROM core.receipt r
       JOIN core.event_order eo ON eo.id = r.order_id
      ${where.replace(/i\.created_at/g, 'r.paid_at').replace(/i\./g, 'r.')}
      GROUP BY r.payment_method`,
    args
  );

  const refundRes = await client.query(
    `SELECT rf.reason,
            COUNT(*) AS count,
            COALESCE(SUM(rf.amount_cents), 0) AS total_cents
       FROM core.refund rf
       JOIN core.event_order eo ON eo.id = rf.order_id
      ${where.replace(/i\.created_at/g, 'rf.issued_at').replace(/i\./g, 'rf.')}
      GROUP BY rf.reason`,
    args
  );

  const appliedIntakeTotal = intakeRes.rows
    .filter((r) => r.status === 'applied')
    .reduce((a, r) => a + Number(r.total_cents), 0);
  const receiptTotal = receiptRes.rows.reduce((a, r) => a + Number(r.total_cents), 0);
  const refundTotal  = refundRes.rows.reduce((a, r) => a + Number(r.total_cents), 0);

  const netPayments = receiptTotal - refundTotal;
  const mismatch    = appliedIntakeTotal !== receiptTotal;

  return {
    window: { from, to },
    intakes:  intakeRes.rows,
    receipts: receiptRes.rows,
    refunds:  refundRes.rows,
    totals: {
      applied_intakes_cents: appliedIntakeTotal,
      receipts_cents:        receiptTotal,
      refunds_cents:         refundTotal,
      net_payments_cents:    netPayments
    },
    consistent: !mismatch,
    notes: mismatch
      ? 'Applied-intake total does not match receipt total — investigate.'
      : 'Applied-intake total matches receipt total.'
  };
}

function emptyReport() {
  return {
    window: {}, intakes: [], receipts: [], refunds: [],
    totals: { applied_intakes_cents: 0, receipts_cents: 0, refunds_cents: 0, net_payments_cents: 0 },
    consistent: true, notes: 'No cities in scope.'
  };
}
