// Event order + payment-stage + refund domain logic.
import {
  createReservation,
  confirmReservationsByReference,
  releaseReservationsByReference
} from './inventory.js';
import { recordReceiptEntry, recordRefundEntry } from './financial_ledger.js';

export const RESERVATION_WINDOW_MINUTES = 60;

const NUMBER_CONFIG = {
  order:   { seq: 'seq_order_number',   prefix: 'ORD' },
  invoice: { seq: 'seq_invoice_number', prefix: 'INV' },
  receipt: { seq: 'seq_receipt_number', prefix: 'RCP' },
  refund:  { seq: 'seq_refund_number',  prefix: 'REF' }
};

export async function nextNumber(client, kind) {
  const cfg = NUMBER_CONFIG[kind];
  if (!cfg) throw new Error(`Unknown numbering kind: ${kind}`);
  const { rows } = await client.query(`SELECT nextval('core.${cfg.seq}') AS n`);
  const year = new Date().getFullYear();
  return `${cfg.prefix}-${year}-${String(rows[0].n).padStart(6, '0')}`;
}

function err(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

export function computeStageDueAt({ due_rule_type, due_offset_minutes, due_at }, orderCreatedAt, eventStartsAt) {
  if (due_rule_type === 'absolute') {
    if (!due_at) throw err(400, 'absolute due rule requires due_at');
    return new Date(due_at);
  }
  if (!Number.isInteger(due_offset_minutes)) {
    throw err(400, `${due_rule_type} requires integer due_offset_minutes`);
  }
  const base = due_rule_type === 'relative_to_event_start' ? eventStartsAt : orderCreatedAt;
  return new Date(base.getTime() + due_offset_minutes * 60000);
}

export async function createEventOrder(client, userId, payload) {
  const {
    event_id, city_id,
    customer_name, customer_email = null, customer_phone = null,
    total_amount_cents, currency = 'USD',
    stages,
    line_items = []
  } = payload;

  if (!event_id || !city_id || !customer_name || total_amount_cents == null || !Array.isArray(stages) || !stages.length) {
    throw err(400, 'event_id, city_id, customer_name, total_amount_cents and non-empty stages[] are required');
  }
  if (!Array.isArray(line_items)) throw err(400, 'line_items must be an array');
  const sum = stages.reduce((a, s) => a + Number(s.amount_cents || 0), 0);
  if (sum !== Number(total_amount_cents)) {
    throw err(400, `Stage total (${sum}) does not match order total (${total_amount_cents})`);
  }

  const eRes = await client.query(
    `SELECT id, city_id, starts_at, status FROM core.event WHERE id = $1 FOR UPDATE`,
    [event_id]
  );
  const event = eRes.rows[0];
  if (!event) throw err(404, 'Event not found');
  if (event.city_id !== Number(city_id)) throw err(400, 'city_id does not match event city');
  if (event.status === 'canceled') throw err(400, 'Cannot create an order for a canceled event');
  const eventStartsAt = new Date(event.starts_at);

  const orderNumber = await nextNumber(client, 'order');
  const oRes = await client.query(
    `INSERT INTO core.event_order
       (order_number, event_id, city_id, customer_name, customer_email, customer_phone,
        total_amount_cents, currency, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, created_at`,
    [orderNumber, event_id, city_id, customer_name, customer_email, customer_phone,
     total_amount_cents, currency, userId]
  );
  const orderId = oRes.rows[0].id;
  const orderCreatedAt = new Date(oRes.rows[0].created_at);

  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    if (!s.label || s.amount_cents == null || !s.due_rule_type) {
      throw err(400, 'Each stage needs label, amount_cents, due_rule_type');
    }
    const dueAt = computeStageDueAt(s, orderCreatedAt, eventStartsAt);

    const stageRes = await client.query(
      `INSERT INTO core.payment_stage
         (order_id, sequence, label, amount_cents,
          due_rule_type, due_offset_minutes, due_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'invoiced')
       RETURNING id`,
      [
        orderId,
        s.sequence ?? i + 1,
        s.label,
        s.amount_cents,
        s.due_rule_type,
        s.due_offset_minutes ?? null,
        dueAt
      ]
    );
    const stageId = stageRes.rows[0].id;

    const invoiceNumber = await nextNumber(client, 'invoice');
    await client.query(
      `INSERT INTO core.invoice
         (invoice_number, payment_stage_id, order_id, amount_cents, due_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [invoiceNumber, stageId, orderId, s.amount_cents, dueAt, userId]
    );
  }

  // Reserve stock for each line item with a 60-min payment window.
  // If any line fails (insufficient stock), the surrounding transaction rolls back the whole order.
  if (line_items.length) {
    const expiresAt = new Date(Date.now() + RESERVATION_WINDOW_MINUTES * 60_000);
    for (const li of line_items) {
      if (!li.item_id || !li.location_id || !Number.isInteger(li.quantity) || li.quantity <= 0) {
        throw err(400, 'Each line_item needs item_id, location_id and positive integer quantity');
      }
      const reservation = await createReservation(client, userId, {
        item_id: li.item_id,
        location_id: li.location_id,
        quantity: li.quantity,
        reference_type: 'event_order',
        reference_id: String(orderId),
        expires_at: expiresAt
      });
      await client.query(
        `INSERT INTO core.event_order_line
           (order_id, item_id, location_id, quantity, reservation_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [orderId, li.item_id, li.location_id, li.quantity, reservation.id]
      );
    }
  }

  return loadOrderAggregate(client, orderId);
}

export async function loadOrderAggregate(client, orderId) {
  const oRes = await client.query(
    `SELECT id, order_number, event_id, city_id, customer_name, customer_email, customer_phone,
            total_amount_cents, currency, status, created_by, created_at, updated_at
       FROM core.event_order WHERE id = $1`,
    [orderId]
  );
  const order = oRes.rows[0];
  if (!order) return null;

  const stagesRes = await client.query(
    `SELECT ps.id, ps.sequence, ps.label, ps.amount_cents,
            ps.due_rule_type, ps.due_offset_minutes, ps.due_at, ps.status,
            inv.id  AS invoice_id,  inv.invoice_number,  inv.issued_at,
            rcp.id  AS receipt_id,  rcp.receipt_number,  rcp.paid_at,
            rcp.payment_method,     rcp.reference,
            ref.id  AS refund_id,   ref.refund_number,   ref.amount_cents AS refund_amount_cents,
            ref.reason AS refund_reason, ref.issued_at   AS refund_issued_at
       FROM core.payment_stage ps
  LEFT JOIN core.invoice  inv ON inv.payment_stage_id = ps.id
  LEFT JOIN core.receipt  rcp ON rcp.payment_stage_id = ps.id
  LEFT JOIN core.refund   ref ON ref.payment_stage_id = ps.id
      WHERE ps.order_id = $1
      ORDER BY ps.sequence`,
    [orderId]
  );

  const linesRes = await client.query(
    `SELECT eol.id, eol.item_id, eol.location_id, eol.quantity, eol.reservation_id,
            i.sku, i.name AS item_name,
            sr.status AS reservation_status, sr.expires_at AS reservation_expires_at
       FROM core.event_order_line eol
       JOIN core.item i ON i.id = eol.item_id
  LEFT JOIN core.stock_reservation sr ON sr.id = eol.reservation_id
      WHERE eol.order_id = $1
      ORDER BY eol.id`,
    [orderId]
  );

  return { ...order, stages: stagesRes.rows, line_items: linesRes.rows };
}

export async function recordReceipt(client, userId, orderId, stageId, { payment_method = null, reference = null, amount_cents = null }) {
  const stageRes = await client.query(
    `SELECT ps.id, ps.order_id, ps.amount_cents, ps.status,
            inv.id AS invoice_id, eo.currency
       FROM core.payment_stage ps
  LEFT JOIN core.invoice     inv ON inv.payment_stage_id = ps.id
       JOIN core.event_order eo  ON eo.id = ps.order_id
      WHERE ps.id = $1 FOR UPDATE OF ps, eo`,
    [stageId]
  );
  const stage = stageRes.rows[0];
  if (!stage || Number(stage.order_id) !== Number(orderId)) throw err(404, 'Stage not found for order');
  if (!stage.invoice_id) throw err(409, 'Stage has no invoice; cannot record receipt');
  if (stage.status !== 'invoiced') throw err(409, `Stage is not invoiced (current: ${stage.status})`);

  const amount = amount_cents != null ? Number(amount_cents) : Number(stage.amount_cents);
  if (amount !== Number(stage.amount_cents)) {
    throw err(400, 'Partial payments are not supported — amount must match invoiced amount');
  }

  const receiptNumber = await nextNumber(client, 'receipt');
  const rRes = await client.query(
    `INSERT INTO core.receipt
       (receipt_number, invoice_id, payment_stage_id, order_id, amount_cents,
        payment_method, reference, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, receipt_number, paid_at`,
    [receiptNumber, stage.invoice_id, stageId, orderId, amount, payment_method, reference, userId]
  );

  await client.query(
    `UPDATE core.payment_stage SET status='paid', updated_at=now() WHERE id=$1`,
    [stageId]
  );

  // First payment arrival confirms reservations for this order (clears 60-min expiry).
  await confirmReservationsByReference(client, 'event_order', orderId);

  await recordReceiptEntry(client, {
    order_id: orderId,
    payment_stage_id: stageId,
    receipt_id: rRes.rows[0].id,
    amount_cents: amount,
    currency: stage.currency,
    reason: `stage.paid:${stageId}`,
    actor_user_id: userId,
    metadata: { payment_method, reference }
  });

  await maybeFulfillOrder(client, orderId);
  return rRes.rows[0];
}

async function maybeFulfillOrder(client, orderId) {
  const { rows } = await client.query(
    `SELECT bool_and(status = 'paid') AS all_paid
       FROM core.payment_stage WHERE order_id = $1`,
    [orderId]
  );
  if (rows[0]?.all_paid) {
    await client.query(
      `UPDATE core.event_order SET status='fulfilled', updated_at=now()
        WHERE id=$1 AND status='active'`,
      [orderId]
    );
  }
}

/**
 * Core refund trigger. Evaluates event against configured rules and issues refunds
 * for every paid stage of every still-active order under that event.
 *   reason: 'event_canceled' | 'headcount_miss' | null
 */
export async function evaluateRefunds(client, eventId, triggeredBy, userId, { now = new Date(), manualReason = null } = {}) {
  const eRes = await client.query(
    `SELECT id, min_headcount, current_headcount, headcount_cutoff_at, status
       FROM core.event WHERE id = $1 FOR UPDATE`,
    [eventId]
  );
  const event = eRes.rows[0];
  if (!event) throw err(404, 'Event not found');

  let reason = manualReason;
  if (!reason) {
    if (event.status === 'canceled') reason = 'event_canceled';
    else if (now >= new Date(event.headcount_cutoff_at) && event.current_headcount < event.min_headcount) {
      reason = 'headcount_miss';
    }
  }
  if (!reason) return { reason: null, refundsCreated: 0, ordersAffected: 0 };

  const { rows: orders } = await client.query(
    `SELECT id, currency FROM core.event_order
      WHERE event_id = $1 AND status NOT IN ('canceled','refunded')
      FOR UPDATE`,
    [eventId]
  );

  let refundsCreated = 0;
  let ordersAffected = 0;

  for (const o of orders) {
    const stagesRes = await client.query(
      `SELECT id, amount_cents, status FROM core.payment_stage
        WHERE order_id = $1 FOR UPDATE`,
      [o.id]
    );

    let anyRefund = false;
    for (const s of stagesRes.rows) {
      if (s.status === 'paid') {
        const refundNumber = await nextNumber(client, 'refund');
        const rIns = await client.query(
          `INSERT INTO core.refund
             (refund_number, payment_stage_id, order_id, amount_cents, reason, triggered_by, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING id`,
          [refundNumber, s.id, o.id, s.amount_cents, reason, triggeredBy, userId]
        );
        await client.query(
          `UPDATE core.payment_stage SET status='refunded', updated_at=now() WHERE id=$1`,
          [s.id]
        );
        await recordRefundEntry(client, {
          order_id: o.id,
          payment_stage_id: s.id,
          refund_id: rIns.rows[0].id,
          amount_cents: Number(s.amount_cents),
          currency: o.currency,
          reason: `auto:${reason}`,
          actor_user_id: userId,
          metadata: { triggered_by: triggeredBy }
        });
        refundsCreated++;
        anyRefund = true;
      } else if (s.status === 'pending' || s.status === 'invoiced') {
        await client.query(
          `UPDATE core.payment_stage SET status='voided', updated_at=now() WHERE id=$1`,
          [s.id]
        );
      }
    }

    await client.query(
      `UPDATE core.event_order
          SET status = $2, updated_at = now()
        WHERE id = $1`,
      [o.id, anyRefund ? 'refunded' : 'canceled']
    );

    // Always release any still-active reservations for the affected order.
    await releaseReservationsByReference(
      client, userId, 'event_order', o.id,
      reason === 'event_canceled' ? 'order_canceled' : 'headcount_miss'
    );
    ordersAffected++;
  }

  return { reason, refundsCreated, ordersAffected };
}

export async function issueManualRefund(client, userId, orderId, stageId, { reason = 'manual' } = {}) {
  const stageRes = await client.query(
    `SELECT ps.id, ps.order_id, ps.amount_cents, ps.status, eo.currency
       FROM core.payment_stage ps
       JOIN core.event_order eo ON eo.id = ps.order_id
      WHERE ps.id = $1 FOR UPDATE`,
    [stageId]
  );
  const stage = stageRes.rows[0];
  if (!stage || Number(stage.order_id) !== Number(orderId)) throw err(404, 'Stage not found for order');
  if (stage.status !== 'paid') throw err(409, `Stage is not paid (current: ${stage.status})`);

  const refundNumber = await nextNumber(client, 'refund');
  const rRes = await client.query(
    `INSERT INTO core.refund
       (refund_number, payment_stage_id, order_id, amount_cents, reason, triggered_by, created_by)
     VALUES ($1,$2,$3,$4,$5,'user',$6)
     RETURNING id, refund_number, issued_at`,
    [refundNumber, stageId, orderId, stage.amount_cents, reason, userId]
  );
  await client.query(
    `UPDATE core.payment_stage SET status='refunded', updated_at=now() WHERE id=$1`,
    [stageId]
  );
  await recordRefundEntry(client, {
    order_id: orderId,
    payment_stage_id: stageId,
    refund_id: rRes.rows[0].id,
    amount_cents: Number(stage.amount_cents),
    currency: stage.currency,
    reason: `manual:${reason}`,
    actor_user_id: userId
  });

  const { rows } = await client.query(
    `SELECT bool_and(status IN ('refunded','voided','canceled')) AS all_closed,
            bool_or(status = 'refunded')  AS any_refunded
       FROM core.payment_stage WHERE order_id = $1`,
    [orderId]
  );
  const nextStatus = rows[0].all_closed
    ? (rows[0].any_refunded ? 'refunded' : 'canceled')
    : (rows[0].any_refunded ? 'partially_refunded' : 'active');
  await client.query(
    `UPDATE core.event_order SET status=$2, updated_at=now() WHERE id=$1`,
    [orderId, nextStatus]
  );
  return rRes.rows[0];
}

/**
 * Cancel an order manually. Voids unpaid stages, releases active reservations,
 * and leaves paid stages untouched (use issueManualRefund separately for refunds).
 */
export async function cancelEventOrder(client, userId, orderId, { reason = null } = {}) {
  const oRes = await client.query(
    `SELECT id, status FROM core.event_order WHERE id = $1 FOR UPDATE`,
    [orderId]
  );
  const o = oRes.rows[0];
  if (!o) throw err(404, 'Order not found');
  if (['canceled', 'refunded'].includes(o.status)) {
    throw err(409, `Order is already ${o.status}`);
  }

  await client.query(
    `UPDATE core.payment_stage
        SET status = 'voided', updated_at = now()
      WHERE order_id = $1 AND status IN ('pending','invoiced')`,
    [orderId]
  );

  const released = await releaseReservationsByReference(
    client, userId, 'event_order', orderId, 'order_canceled'
  );

  const { rows } = await client.query(
    `SELECT bool_or(status = 'paid') AS any_paid
       FROM core.payment_stage WHERE order_id = $1`,
    [orderId]
  );
  const nextStatus = rows[0]?.any_paid ? 'partially_refunded' : 'canceled';
  await client.query(
    `UPDATE core.event_order SET status=$2, updated_at=now() WHERE id=$1`,
    [orderId, nextStatus]
  );
  return { orderId, status: nextStatus, reservationsReleased: released, reason };
}
