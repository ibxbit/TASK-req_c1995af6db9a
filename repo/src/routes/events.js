import { pool, query, withTransaction } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission, getCityScope, assertCityAccess } from '../rbac/enforce.js';
import { logPermissionEvent } from '../rbac/audit.js';
import { evaluateRefunds } from '../services/orders.js';

export default async function eventRoutes(app) {
  // LIST
  app.get('/events', { preHandler: requirePermission(PERMISSIONS.EVENT_READ) }, async (request) => {
    const scope = getCityScope(request.user);
    if (!scope.all && scope.cityIds.length === 0) return [];
    const { rows } = scope.all
      ? await query(
          `SELECT id, city_id, name, starts_at, ends_at, min_headcount,
                  headcount_cutoff_at, current_headcount, status, canceled_at, canceled_reason
             FROM core.event ORDER BY starts_at DESC`
        )
      : await query(
          `SELECT id, city_id, name, starts_at, ends_at, min_headcount,
                  headcount_cutoff_at, current_headcount, status, canceled_at, canceled_reason
             FROM core.event WHERE city_id = ANY($1::int[])
             ORDER BY starts_at DESC`,
          [scope.cityIds]
        );
    return rows;
  });

  // CREATE
  app.post('/events', { preHandler: requirePermission(PERMISSIONS.EVENT_WRITE) }, async (request, reply) => {
    const { city_id, name, starts_at, ends_at, min_headcount, headcount_cutoff_at } = request.body || {};
    if (!city_id || !name || !starts_at || min_headcount == null || !headcount_cutoff_at) {
      return reply.code(400).send({
        error: 'city_id, name, starts_at, min_headcount, headcount_cutoff_at required'
      });
    }
    if (!assertCityAccess(request.user, city_id)) {
      return reply.code(403).send({ error: 'City outside assigned scope' });
    }
    const { rows } = await query(
      `INSERT INTO core.event
         (city_id, name, starts_at, ends_at, min_headcount, headcount_cutoff_at, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active')
       RETURNING id, city_id, name, starts_at, ends_at, min_headcount,
                 headcount_cutoff_at, current_headcount, status`,
      [city_id, name, starts_at, ends_at || null, min_headcount, headcount_cutoff_at, request.user.id]
    );
    return reply.code(201).send(rows[0]);
  });

  // GET ONE
  app.get('/events/:id', { preHandler: requirePermission(PERMISSIONS.EVENT_READ) }, async (request, reply) => {
    const { rows } = await query(`SELECT * FROM core.event WHERE id = $1`, [request.params.id]);
    const ev = rows[0];
    if (!ev) return reply.code(404).send({ error: 'Not found' });
    if (!assertCityAccess(request.user, ev.city_id)) return reply.code(403).send({ error: 'Forbidden' });
    return ev;
  });

  // UPDATE HEADCOUNT — may auto-trigger refund if cutoff passed and short of min
  app.post(
    '/events/:id/headcount',
    { preHandler: requirePermission(PERMISSIONS.EVENT_WRITE) },
    async (request, reply) => {
      const count = Number(request.body?.current_headcount);
      if (!Number.isInteger(count) || count < 0) {
        return reply.code(400).send({ error: 'current_headcount (non-negative integer) required' });
      }
      const result = await withTransaction(async (c) => {
        const evRes = await c.query(`SELECT * FROM core.event WHERE id=$1 FOR UPDATE`, [request.params.id]);
        const ev = evRes.rows[0];
        if (!ev) return { __status: 404 };
        if (!assertCityAccess(request.user, ev.city_id)) return { __status: 403 };
        await c.query(
          `UPDATE core.event SET current_headcount=$2, updated_at=now() WHERE id=$1`,
          [ev.id, count]
        );
        const refund = await evaluateRefunds(c, ev.id, 'system', request.user.id);
        const updated = (await c.query(`SELECT * FROM core.event WHERE id=$1`, [ev.id])).rows[0];
        return { event: updated, refund };
      });
      if (result.__status === 404) return reply.code(404).send({ error: 'Not found' });
      if (result.__status === 403) return reply.code(403).send({ error: 'Forbidden' });
      if (result.refund.reason) {
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.EVENT_WRITE,
          resource: `event:${request.params.id}`,
          action: 'event.auto_refund',
          granted: true, request,
          metadata: result.refund
        });
      }
      return result;
    }
  );

  // CANCEL — triggers refunds
  app.post(
    '/events/:id/cancel',
    { preHandler: requirePermission(PERMISSIONS.EVENT_WRITE) },
    async (request, reply) => {
      const { reason } = request.body || {};
      const result = await withTransaction(async (c) => {
        const evRes = await c.query(`SELECT * FROM core.event WHERE id=$1 FOR UPDATE`, [request.params.id]);
        const ev = evRes.rows[0];
        if (!ev) return { __status: 404 };
        if (!assertCityAccess(request.user, ev.city_id)) return { __status: 403 };
        if (ev.status === 'canceled') return { __status: 409, __msg: 'Event already canceled' };
        await c.query(
          `UPDATE core.event
              SET status='canceled', canceled_at=now(), canceled_reason=$2, updated_at=now()
            WHERE id=$1`,
          [ev.id, reason || null]
        );
        const refund = await evaluateRefunds(c, ev.id, 'system', request.user.id);
        const updated = (await c.query(`SELECT * FROM core.event WHERE id=$1`, [ev.id])).rows[0];
        return { event: updated, refund };
      });
      if (result.__status) {
        return reply.code(result.__status).send({ error: result.__msg || (result.__status === 404 ? 'Not found' : 'Forbidden') });
      }
      await logPermissionEvent({
        user: request.user, permissionCode: PERMISSIONS.EVENT_WRITE,
        resource: `event:${request.params.id}`,
        action: 'event.cancel', granted: true, request,
        metadata: { reason: reason || null, refund: result.refund }
      });
      return result;
    }
  );

  // MANUAL REFUND SWEEP (e.g., nightly operator task)
  app.post(
    '/events/:id/evaluate-refunds',
    { preHandler: requirePermission(PERMISSIONS.REFUND_ISSUE) },
    async (request, reply) => {
      const result = await withTransaction(async (c) => {
        const evRes = await c.query(`SELECT id, city_id FROM core.event WHERE id=$1 FOR UPDATE`, [request.params.id]);
        const ev = evRes.rows[0];
        if (!ev) return { __status: 404 };
        if (!assertCityAccess(request.user, ev.city_id)) return { __status: 403 };
        return evaluateRefunds(c, ev.id, 'user', request.user.id);
      });
      if (result.__status) {
        return reply.code(result.__status).send({ error: result.__status === 404 ? 'Not found' : 'Forbidden' });
      }
      return result;
    }
  );
}
