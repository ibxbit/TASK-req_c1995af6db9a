// Payment-centric views. Mutations (record, refund) live in services/orders.js
// and are re-exposed through routes/payments.js for discoverability.

function whereCity(scope) {
  if (scope.all) return { sql: '', args: [] };
  if (!scope.cityIds.length) return { empty: true };
  return { sql: `WHERE eo.city_id = ANY($1::int[])`, args: [scope.cityIds] };
}

export async function listReceipts(client, scope, { limit = 200 } = {}) {
  const w = whereCity(scope);
  if (w.empty) return [];
  const { rows } = await client.query(
    `SELECT r.id, r.receipt_number, r.invoice_id, r.payment_stage_id, r.order_id,
            r.amount_cents, r.paid_at, r.payment_method, r.reference, r.created_by,
            eo.order_number, eo.city_id
       FROM core.receipt r
       JOIN core.event_order eo ON eo.id = r.order_id
       ${w.sql}
      ORDER BY r.paid_at DESC
      LIMIT $${w.args.length + 1}`,
    [...w.args, Math.min(Number(limit), 1000)]
  );
  return rows;
}

export async function listRefunds(client, scope, { limit = 200 } = {}) {
  const w = whereCity(scope);
  if (w.empty) return [];
  const { rows } = await client.query(
    `SELECT rf.id, rf.refund_number, rf.payment_stage_id, rf.order_id,
            rf.amount_cents, rf.reason, rf.triggered_by, rf.issued_at,
            eo.order_number, eo.city_id
       FROM core.refund rf
       JOIN core.event_order eo ON eo.id = rf.order_id
       ${w.sql}
      ORDER BY rf.issued_at DESC
      LIMIT $${w.args.length + 1}`,
    [...w.args, Math.min(Number(limit), 1000)]
  );
  return rows;
}

export async function getStageDetail(client, stageId) {
  const { rows } = await client.query(
    `SELECT ps.id, ps.order_id, ps.sequence, ps.label, ps.amount_cents,
            ps.due_rule_type, ps.due_offset_minutes, ps.due_at, ps.status,
            inv.invoice_number, inv.issued_at,
            rcp.receipt_number, rcp.paid_at, rcp.payment_method,
            ref.refund_number, ref.reason AS refund_reason, ref.issued_at AS refund_issued_at,
            eo.order_number, eo.city_id
       FROM core.payment_stage ps
       JOIN core.event_order eo ON eo.id = ps.order_id
  LEFT JOIN core.invoice inv ON inv.payment_stage_id = ps.id
  LEFT JOIN core.receipt rcp ON rcp.payment_stage_id = ps.id
  LEFT JOIN core.refund  ref ON ref.payment_stage_id = ps.id
      WHERE ps.id = $1`,
    [stageId]
  );
  return rows[0] || null;
}
