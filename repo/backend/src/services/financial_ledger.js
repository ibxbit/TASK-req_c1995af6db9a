// Append-only financial-ledger writes.
// Callers inside withTransaction only — DB triggers block any UPDATE/DELETE,
// so an aborted outer transaction is the only way a ledger row disappears.

export async function recordReceiptEntry(client, {
  order_id, payment_stage_id, receipt_id,
  amount_cents, currency = 'USD',
  reason = null, actor_user_id = null, metadata = null
}) {
  if (!receipt_id) throw new Error('receipt_id required');
  if (!(amount_cents > 0)) throw new Error('receipt amount must be positive');
  await client.query(
    `INSERT INTO audit.financial_ledger
       (entry_type, order_id, payment_stage_id, receipt_id,
        amount_cents, currency, reason, actor_user_id, metadata)
     VALUES ('receipt', $1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      order_id, payment_stage_id, receipt_id,
      amount_cents, currency, reason, actor_user_id,
      metadata ? JSON.stringify(metadata) : null
    ]
  );
}

export async function recordRefundEntry(client, {
  order_id, payment_stage_id, refund_id,
  amount_cents, currency = 'USD',
  reason = null, actor_user_id = null, metadata = null
}) {
  if (!refund_id) throw new Error('refund_id required');
  if (!(amount_cents > 0)) throw new Error('refund amount must be positive (will be stored as negative)');
  await client.query(
    `INSERT INTO audit.financial_ledger
       (entry_type, order_id, payment_stage_id, refund_id,
        amount_cents, currency, reason, actor_user_id, metadata)
     VALUES ('refund', $1,$2,$3, $4, $5, $6, $7, $8)`,
    [
      order_id, payment_stage_id, refund_id,
      -amount_cents, currency, reason, actor_user_id,
      metadata ? JSON.stringify(metadata) : null
    ]
  );
}
