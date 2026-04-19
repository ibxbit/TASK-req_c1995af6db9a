import { pool, query, withTransaction } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission, getCityScope, assertCityAccess } from '../rbac/enforce.js';
import { logPermissionEvent } from '../rbac/audit.js';
import {
  createEventOrder,
  loadOrderAggregate,
  recordReceipt,
  issueManualRefund,
  cancelEventOrder
} from '../services/orders.js';

function sendErr(reply, err) {
  if (err.status) return reply.code(err.status).send({ error: err.message });
  throw err;
}

export default async function orderRoutes(app) {
  // LIST
  app.get('/orders', { preHandler: requirePermission(PERMISSIONS.ORDER_READ) }, async (request) => {
    const scope = getCityScope(request.user);
    if (!scope.all && scope.cityIds.length === 0) return [];
    const { rows } = scope.all
      ? await query(
          `SELECT id, order_number, event_id, city_id, customer_name,
                  total_amount_cents, currency, status, created_at
             FROM core.event_order ORDER BY id DESC`
        )
      : await query(
          `SELECT id, order_number, event_id, city_id, customer_name,
                  total_amount_cents, currency, status, created_at
             FROM core.event_order
            WHERE city_id = ANY($1::int[])
            ORDER BY id DESC`,
          [scope.cityIds]
        );
    return rows;
  });

  // GET ONE (with stages, invoices, receipts, refunds)
  app.get(
    '/orders/:id',
    { preHandler: requirePermission(PERMISSIONS.ORDER_READ) },
    async (request, reply) => {
      const agg = await loadOrderAggregate(pool, request.params.id);
      if (!agg) return reply.code(404).send({ error: 'Not found' });
      if (!assertCityAccess(request.user, agg.city_id)) return reply.code(403).send({ error: 'Forbidden' });
      return agg;
    }
  );

  // CREATE order with configurable stages
  app.post(
    '/orders',
    { preHandler: requirePermission(PERMISSIONS.ORDER_WRITE) },
    async (request, reply) => {
      if (!assertCityAccess(request.user, request.body?.city_id)) {
        return reply.code(403).send({ error: 'City outside assigned scope' });
      }
      try {
        const order = await withTransaction((c) => createEventOrder(c, request.user.id, request.body || {}));
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.ORDER_WRITE,
          resource: `order:${order.id}`,
          action: 'order.create',
          granted: true, request,
          metadata: { event_id: order.event_id, stages: order.stages.length }
        });
        return reply.code(201).send(order);
      } catch (err) {
        return sendErr(reply, err);
      }
    }
  );

  // RECORD RECEIPT for a stage
  app.post(
    '/orders/:id/stages/:stageId/receipts',
    { preHandler: requirePermission(PERMISSIONS.PAYMENT_COLLECT) },
    async (request, reply) => {
      try {
        const result = await withTransaction(async (c) => {
          const oRes = await c.query(`SELECT city_id FROM core.event_order WHERE id=$1 FOR UPDATE`, [request.params.id]);
          if (!oRes.rows[0]) throw Object.assign(new Error('Order not found'), { status: 404 });
          if (!assertCityAccess(request.user, oRes.rows[0].city_id)) {
            throw Object.assign(new Error('Forbidden'), { status: 403 });
          }
          const receipt = await recordReceipt(c, request.user.id, request.params.id, request.params.stageId, request.body || {});
          return { receipt, order: await loadOrderAggregate(c, request.params.id) };
        });
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.PAYMENT_COLLECT,
          resource: `stage:${request.params.stageId}`,
          action: 'payment.collect', granted: true, request,
          metadata: { order_id: request.params.id, receipt_number: result.receipt.receipt_number }
        });
        return reply.code(201).send(result);
      } catch (err) {
        return sendErr(reply, err);
      }
    }
  );

  // CANCEL ORDER (voids unpaid stages + releases active reservations)
  app.post(
    '/orders/:id/cancel',
    { preHandler: requirePermission(PERMISSIONS.ORDER_WRITE) },
    async (request, reply) => {
      try {
        const result = await withTransaction(async (c) => {
          const oRes = await c.query(`SELECT city_id FROM core.event_order WHERE id=$1 FOR UPDATE`, [request.params.id]);
          if (!oRes.rows[0]) throw Object.assign(new Error('Order not found'), { status: 404 });
          if (!assertCityAccess(request.user, oRes.rows[0].city_id)) {
            throw Object.assign(new Error('Forbidden'), { status: 403 });
          }
          const summary = await cancelEventOrder(c, request.user.id, request.params.id, request.body || {});
          return { ...summary, order: await loadOrderAggregate(c, request.params.id) };
        });
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.ORDER_WRITE,
          resource: `order:${request.params.id}`,
          action: 'order.cancel', granted: true, request,
          metadata: { reservationsReleased: result.reservationsReleased, reason: result.reason ?? null }
        });
        return result;
      } catch (err) {
        return sendErr(reply, err);
      }
    }
  );

  // MANUAL REFUND for a stage
  app.post(
    '/orders/:id/stages/:stageId/refund',
    { preHandler: requirePermission(PERMISSIONS.REFUND_ISSUE) },
    async (request, reply) => {
      try {
        const result = await withTransaction(async (c) => {
          const oRes = await c.query(`SELECT city_id FROM core.event_order WHERE id=$1 FOR UPDATE`, [request.params.id]);
          if (!oRes.rows[0]) throw Object.assign(new Error('Order not found'), { status: 404 });
          if (!assertCityAccess(request.user, oRes.rows[0].city_id)) {
            throw Object.assign(new Error('Forbidden'), { status: 403 });
          }
          const refund = await issueManualRefund(c, request.user.id, request.params.id, request.params.stageId, request.body || {});
          return { refund, order: await loadOrderAggregate(c, request.params.id) };
        });
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.REFUND_ISSUE,
          resource: `stage:${request.params.stageId}`,
          action: 'refund.issue', granted: true, request,
          metadata: { order_id: request.params.id, refund_number: result.refund.refund_number }
        });
        return reply.code(201).send(result);
      } catch (err) {
        return sendErr(reply, err);
      }
    }
  );
}
