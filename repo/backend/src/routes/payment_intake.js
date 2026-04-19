import { pool, query, withTransaction } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission, getCityScope, assertCityAccess } from '../rbac/enforce.js';
import { logPermissionEvent } from '../rbac/audit.js';
import { requireFields } from '../middleware/validate.js';
import {
  createIntake,
  processIntake,
  compensateIntake,
  sweepPaymentRetries,
  reconciliationReport
} from '../services/payment_intake.js';
import { importTransactions, importCallbacks } from '../services/wechat_adapter.js';

function send(reply, err) {
  if (err.status) return reply.code(err.status).send({ error: err.message });
  throw err;
}

// Resolve intake -> order -> city_id. Null if the intake has no linked order
// (offline cash receipt captured before order is known); callers decide how
// to treat that — we fall back to requiring DATA_CITY_ALL so unscoped rows
// are never exposed to a city-scoped user by accident.
async function loadIntakeCity(intakeId) {
  const { rows } = await query(
    `SELECT pi.id, eo.city_id
       FROM core.payment_intake pi
  LEFT JOIN core.event_order eo ON eo.id = pi.order_id
      WHERE pi.id = $1`,
    [intakeId]
  );
  return rows[0] || null;
}

async function guardIntakeCity(request, reply, intakeId) {
  const intake = await loadIntakeCity(intakeId);
  if (!intake) {
    reply.code(404).send({ error: 'Not found' });
    return false;
  }
  if (intake.city_id == null) {
    // Unlinked intake — only users with full city scope may act on it.
    // getCityScope returns { all: true } only for DATA_CITY_ALL holders.
    if (!request.user.permissions.has(PERMISSIONS.DATA_CITY_ALL)) {
      reply.code(403).send({ error: 'Forbidden' });
      return false;
    }
    return true;
  }
  if (!assertCityAccess(request.user, intake.city_id)) {
    await logPermissionEvent({
      user: request.user, permissionCode: PERMISSIONS.PAYMENT_COLLECT,
      resource: `intake:${intakeId}`, action: 'payment.intake.scope_check',
      granted: false, reason: 'city scope', request,
      metadata: { city_id: intake.city_id }
    });
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export default async function paymentIntakeRoutes(app) {
  // ============ LIST ============
  app.get(
    '/payments/intake',
    { preHandler: requirePermission(PERMISSIONS.PAYMENT_COLLECT) },
    async (request) => {
      const scope = getCityScope(request.user);
      const args = [];
      const conds = [];
      if (!scope.all) {
        if (!scope.cityIds.length) return [];
        args.push(scope.cityIds);
        conds.push(`eo.city_id = ANY($${args.length}::int[])`);
      }
      if (request.query?.status) {
        args.push(request.query.status);
        conds.push(`pi.status = $${args.length}`);
      }
      if (request.query?.method) {
        args.push(request.query.method);
        conds.push(`pi.method = $${args.length}`);
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { rows } = await query(
        `SELECT pi.id, pi.method, pi.external_id, pi.order_id, pi.payment_stage_id,
                pi.amount_cents, pi.currency, pi.status, pi.attempt_count,
                pi.next_attempt_at, pi.last_error, pi.receipt_id,
                pi.created_at, eo.order_number, eo.city_id
           FROM core.payment_intake pi
      LEFT JOIN core.event_order eo ON eo.id = pi.order_id
           ${where}
          ORDER BY pi.id DESC
          LIMIT 200`,
        args
      );
      return rows;
    }
  );

  app.get(
    '/payments/intake/:id',
    { preHandler: requirePermission(PERMISSIONS.PAYMENT_COLLECT) },
    async (request, reply) => {
      const { rows } = await query(
        `SELECT pi.*, eo.city_id, eo.order_number
           FROM core.payment_intake pi
      LEFT JOIN core.event_order eo ON eo.id = pi.order_id
          WHERE pi.id = $1`,
        [request.params.id]
      );
      const intake = rows[0];
      if (!intake) return reply.code(404).send({ error: 'Not found' });
      if (intake.city_id != null && !assertCityAccess(request.user, intake.city_id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const attempts = await query(
        `SELECT attempt_number, started_at, finished_at, status, error_message
           FROM audit.payment_attempt
          WHERE intake_id = $1
          ORDER BY started_at`,
        [request.params.id]
      );
      return { ...intake, attempts: attempts.rows };
    }
  );

  // ============ CREATE (cash / check / ACH, or any manual) ============
  app.post(
    '/payments/intake',
    {
      preHandler: [
        requirePermission(PERMISSIONS.PAYMENT_COLLECT),
        requireFields(['method', 'external_id', 'amount_cents'])
      ]
    },
    async (request, reply) => {
      try {
        const result = await withTransaction(async (c) => {
          const intake = await createIntake(c, request.user.id, request.body || {});
          // Try to apply immediately; failures go to retry queue automatically.
          const processed = await processIntake(c, request.user.id, intake.id);
          return { intake, processed };
        });
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.PAYMENT_COLLECT,
          resource: `intake:${result.intake.id}`,
          action: 'payment.intake.create',
          granted: true, request,
          metadata: { method: result.intake.method, result: result.processed.status }
        });
        return reply.code(201).send(result);
      } catch (err) { return send(reply, err); }
    }
  );

  // ============ MANUAL PROCESS / RETRY ============
  app.post(
    '/payments/intake/:id/process',
    { preHandler: requirePermission(PERMISSIONS.PAYMENT_COLLECT) },
    async (request, reply) => {
      if (!(await guardIntakeCity(request, reply, request.params.id))) return;
      try {
        const result = await withTransaction((c) => processIntake(c, request.user.id, request.params.id));
        return result;
      } catch (err) { return send(reply, err); }
    }
  );

  // ============ COMPENSATE (reversal via refund) ============
  app.post(
    '/payments/intake/:id/compensate',
    { preHandler: requirePermission(PERMISSIONS.REFUND_ISSUE) },
    async (request, reply) => {
      if (!(await guardIntakeCity(request, reply, request.params.id))) return;
      try {
        const result = await withTransaction((c) =>
          compensateIntake(c, request.user.id, request.params.id, request.body || {})
        );
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.REFUND_ISSUE,
          resource: `intake:${request.params.id}`,
          action: 'payment.intake.compensate',
          granted: true, request,
          metadata: { refund_number: result.refund.refund_number }
        });
        return reply.code(201).send(result);
      } catch (err) { return send(reply, err); }
    }
  );

  // ============ MANUAL RETRY SWEEP ============
  app.post(
    '/payments/intake/sweep-retries',
    { preHandler: requirePermission(PERMISSIONS.PAYMENT_COLLECT) },
    async (request) =>
      withTransaction((c) => sweepPaymentRetries(c, request.user.id))
  );

  // ============ WECHAT FILE IMPORT ============
  app.post(
    '/payments/wechat/import-transactions',
    {
      preHandler: [
        requirePermission(PERMISSIONS.PAYMENT_COLLECT),
        requireFields(['filename'])
      ]
    },
    async (request, reply) => {
      try {
        const result = await withTransaction((c) =>
          importTransactions(c, request.user.id, request.body.filename)
        );
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.PAYMENT_COLLECT,
          resource: `wechat:${request.body.filename}`,
          action: 'payment.wechat.import_transactions',
          granted: true, request,
          metadata: result.totals
        });
        return reply.code(201).send(result);
      } catch (err) { return send(reply, err); }
    }
  );

  app.post(
    '/payments/wechat/import-callbacks',
    {
      preHandler: [
        requirePermission(PERMISSIONS.PAYMENT_COLLECT),
        requireFields(['filename'])
      ]
    },
    async (request, reply) => {
      try {
        const result = await withTransaction((c) =>
          importCallbacks(c, request.user.id, request.body.filename)
        );
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.PAYMENT_COLLECT,
          resource: `wechat:${request.body.filename}`,
          action: 'payment.wechat.import_callbacks',
          granted: true, request,
          metadata: result.totals
        });
        return reply.code(201).send(result);
      } catch (err) { return send(reply, err); }
    }
  );

  // ============ RECONCILIATION ============
  app.get(
    '/payments/reconciliation',
    { preHandler: requirePermission(PERMISSIONS.AUDIT_READ) },
    async (request) => {
      const scope = getCityScope(request.user);
      const { from, to } = request.query || {};
      return reconciliationReport(pool, { from: from || null, to: to || null, scope });
    }
  );
}
