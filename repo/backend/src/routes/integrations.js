import { query } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission, assertCityAccess } from '../rbac/enforce.js';

// Canonical cross-module contracts surfaced as a single documented endpoint
// set. Writes still go through the owning service (orders, inventory, …);
// these endpoints are read-only consistency + financial-ledger views.

export default async function integrationRoutes(app) {
  // ==================== Financial ledger query ====================
  app.get(
    '/integrations/financial-ledger',
    { preHandler: requirePermission(PERMISSIONS.AUDIT_READ) },
    async (request) => {
      const q = request.query || {};
      const args = [];
      const conds = [];
      if (q.order_id)   { args.push(Number(q.order_id)); conds.push(`order_id  = $${args.length}`); }
      if (q.entry_type) { args.push(q.entry_type);       conds.push(`entry_type = $${args.length}`); }
      if (q.from)       { args.push(q.from);             conds.push(`occurred_at >= $${args.length}`); }
      if (q.to)         { args.push(q.to);               conds.push(`occurred_at <  $${args.length}`); }
      args.push(Math.min(Number(q.limit) || 200, 1000));
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { rows } = await query(
        `SELECT id, entry_type, order_id, payment_stage_id, receipt_id, refund_id,
                amount_cents, currency, reason, actor_user_id, occurred_at, metadata
           FROM audit.financial_ledger
           ${where}
          ORDER BY occurred_at DESC, id DESC
          LIMIT $${args.length}`,
        args
      );
      return rows;
    }
  );

  // Per-order running balance (sum over signed amounts).
  // City scope: city-restricted users only see balances for their own cities.
  app.get(
    '/integrations/orders/:id/balance',
    { preHandler: requirePermission(PERMISSIONS.ORDER_READ) },
    async (request, reply) => {
      const { rows: orderRows } = await query(
        `SELECT id, order_number, total_amount_cents, currency, status, city_id
           FROM core.event_order WHERE id = $1`,
        [request.params.id]
      );
      const order = orderRows[0];
      if (!order) return reply.code(404).send({ error: 'Not found' });
      if (!assertCityAccess(request.user, order.city_id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const { rows: ledgerRows } = await query(
        `SELECT entry_type, COUNT(*) AS count, COALESCE(SUM(amount_cents),0) AS total
           FROM audit.financial_ledger
          WHERE order_id = $1
          GROUP BY entry_type`,
        [request.params.id]
      );
      const receipts = ledgerRows.find((r) => r.entry_type === 'receipt');
      const refunds  = ledgerRows.find((r) => r.entry_type === 'refund');
      const received = Number(receipts?.total || 0);
      const refunded = Number(refunds?.total  || 0); // already negative
      const net      = received + refunded;
      return {
        order_id: order.id,
        order_number: order.order_number,
        currency: order.currency,
        total_amount_cents: Number(order.total_amount_cents),
        received_cents: received,
        refunded_cents: refunded,
        net_cents: net,
        outstanding_cents: Number(order.total_amount_cents) - net,
        status: order.status
      };
    }
  );

  // ==================== Consistency / orphan detection ====================
  app.get(
    '/integrations/consistency',
    { preHandler: requirePermission(PERMISSIONS.AUDIT_READ) },
    async () => {
      const [
        ordersWithoutStages,
        stagesWithoutInvoice,
        paidStagesWithoutReceipt,
        refundedStagesWithoutRefund,
        receiptsWithoutLedger,
        refundsWithoutLedger,
        reservationsOrphaned,
        activeLinesUnreserved,
        fulfilledOrdersUnpaid,
        expiredActiveReservations
      ] = await Promise.all([
        query(`SELECT id, order_number FROM core.event_order eo
                WHERE NOT EXISTS (SELECT 1 FROM core.payment_stage ps WHERE ps.order_id = eo.id)`),
        query(`SELECT id, order_id, label FROM core.payment_stage ps
                WHERE NOT EXISTS (SELECT 1 FROM core.invoice i WHERE i.payment_stage_id = ps.id)`),
        query(`SELECT id, order_id, label FROM core.payment_stage
                WHERE status = 'paid'
                  AND NOT EXISTS (SELECT 1 FROM core.receipt r WHERE r.payment_stage_id = payment_stage.id)`),
        query(`SELECT id, order_id, label FROM core.payment_stage
                WHERE status = 'refunded'
                  AND NOT EXISTS (SELECT 1 FROM core.refund rf WHERE rf.payment_stage_id = payment_stage.id)`),
        query(`SELECT r.id, r.receipt_number FROM core.receipt r
                WHERE NOT EXISTS (SELECT 1 FROM audit.financial_ledger fl WHERE fl.receipt_id = r.id)`),
        query(`SELECT rf.id, rf.refund_number FROM core.refund rf
                WHERE NOT EXISTS (SELECT 1 FROM audit.financial_ledger fl WHERE fl.refund_id = rf.id)`),
        query(`SELECT sr.id FROM core.stock_reservation sr
                WHERE sr.reference_type = 'event_order'
                  AND NOT EXISTS (
                    SELECT 1 FROM core.event_order eo
                     WHERE eo.id::text = sr.reference_id)`),
        query(`SELECT eol.id, eol.order_id FROM core.event_order_line eol
                JOIN core.event_order eo ON eo.id = eol.order_id
               WHERE eo.status = 'active' AND eol.reservation_id IS NULL`),
        query(`SELECT id, order_number FROM core.event_order
                WHERE status = 'fulfilled'
                  AND EXISTS (
                    SELECT 1 FROM core.payment_stage ps
                     WHERE ps.order_id = event_order.id AND ps.status <> 'paid')`),
        query(`SELECT id, expires_at FROM core.stock_reservation
                WHERE status = 'active'
                  AND expires_at IS NOT NULL
                  AND expires_at < now() - interval '5 minutes'`)
      ]);

      const checks = [
        { name: 'orders_without_stages',          rows: ordersWithoutStages.rows },
        { name: 'stages_without_invoice',         rows: stagesWithoutInvoice.rows },
        { name: 'paid_stages_without_receipt',    rows: paidStagesWithoutReceipt.rows },
        { name: 'refunded_stages_without_refund', rows: refundedStagesWithoutRefund.rows },
        { name: 'receipts_without_ledger',        rows: receiptsWithoutLedger.rows },
        { name: 'refunds_without_ledger',         rows: refundsWithoutLedger.rows },
        { name: 'reservations_orphaned',          rows: reservationsOrphaned.rows },
        { name: 'active_lines_unreserved',        rows: activeLinesUnreserved.rows },
        { name: 'fulfilled_orders_with_unpaid_stage', rows: fulfilledOrdersUnpaid.rows },
        { name: 'expired_active_reservations',    rows: expiredActiveReservations.rows }
      ];
      const summary = Object.fromEntries(checks.map((c) => [c.name, c.rows.length]));
      const ok = checks.every((c) => !c.rows.length);
      return {
        consistent: ok,
        summary,
        details: Object.fromEntries(checks.map((c) => [c.name, c.rows]))
      };
    }
  );
}
