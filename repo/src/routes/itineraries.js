import { pool, query, withTransaction } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission, getCityScope, assertCityAccess } from '../rbac/enforce.js';
import { logPermissionEvent } from '../rbac/audit.js';
import {
  computeIssues,
  loadItineraryAggregate,
  createVersion,
  restoreVersion
} from '../services/itinerary.js';

const FORBIDDEN = Symbol('forbidden');
const NOT_FOUND = Symbol('notFound');

async function loadScoped(client, user, itineraryId) {
  const agg = await loadItineraryAggregate(client, itineraryId);
  if (!agg) return NOT_FOUND;
  if (!assertCityAccess(user, agg.city_id)) return FORBIDDEN;
  return agg;
}

function sendScopeError(reply, result) {
  if (result === NOT_FOUND) return reply.code(404).send({ error: 'Not found' });
  if (result === FORBIDDEN) return reply.code(403).send({ error: 'Forbidden' });
  return null;
}

async function validateOrThrow(client, itineraryId) {
  const agg = await loadItineraryAggregate(client, itineraryId);
  const result = await computeIssues(client, agg.events);
  if (!result.valid) {
    const err = new Error('Validation failed');
    err.status = 422;
    err.issues = result.issues;
    throw err;
  }
}

export default async function itineraryRoutes(app) {
  // ============ LIST ============
  app.get(
    '/itineraries',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_READ) },
    async (request) => {
      const scope = getCityScope(request.user);
      if (!scope.all && scope.cityIds.length === 0) return [];
      const { rows } = scope.all
        ? await query(
            `SELECT id, city_id, owner_user_id, name, itinerary_date, current_version,
                    created_at, updated_at
               FROM core.itinerary
              ORDER BY itinerary_date DESC, id DESC`
          )
        : await query(
            `SELECT id, city_id, owner_user_id, name, itinerary_date, current_version,
                    created_at, updated_at
               FROM core.itinerary
              WHERE city_id = ANY($1::int[])
              ORDER BY itinerary_date DESC, id DESC`,
            [scope.cityIds]
          );
      return rows;
    }
  );

  // ============ CREATE ============
  app.post(
    '/itineraries',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_WRITE) },
    async (request, reply) => {
      const { city_id, name, itinerary_date, starts_on } = request.body || {};
      const iDate = itinerary_date || starts_on;
      if (!city_id || !name || !iDate) {
        return reply.code(400).send({ error: 'city_id, name, itinerary_date required' });
      }
      if (!assertCityAccess(request.user, city_id)) {
        return reply.code(403).send({ error: 'City outside assigned scope' });
      }

      const created = await withTransaction(async (c) => {
        const ins = await c.query(
          `INSERT INTO core.itinerary (city_id, owner_user_id, name, itinerary_date)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [city_id, request.user.id, name, iDate]
        );
        await createVersion(c, ins.rows[0].id, request.user.id, 'Created');
        return loadItineraryAggregate(c, ins.rows[0].id);
      });

      await logPermissionEvent({
        user: request.user,
        permissionCode: PERMISSIONS.ITINERARY_WRITE,
        resource: `itinerary:${created.id}`,
        action: 'itinerary.create',
        granted: true,
        request
      });
      return reply.code(201).send(created);
    }
  );

  // ============ GET ONE ============
  app.get(
    '/itineraries/:id',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_READ) },
    async (request, reply) => {
      const r = await loadScoped(pool, request.user, request.params.id);
      const err = sendScopeError(reply, r);
      if (err) return err;
      return r;
    }
  );

  // ============ UPDATE metadata ============
  app.put(
    '/itineraries/:id',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_WRITE) },
    async (request, reply) => {
      const { name, itinerary_date } = request.body || {};
      try {
        const updated = await withTransaction(async (c) => {
          const r = await loadScoped(c, request.user, request.params.id);
          if (r === NOT_FOUND || r === FORBIDDEN) return r;
          await c.query(
            `UPDATE core.itinerary
                SET name = COALESCE($2, name),
                    itinerary_date = COALESCE($3, itinerary_date),
                    updated_at = now()
              WHERE id = $1`,
            [request.params.id, name || null, itinerary_date || null]
          );
          await createVersion(c, request.params.id, request.user.id, 'Updated metadata');
          return loadItineraryAggregate(c, request.params.id);
        });
        const err = sendScopeError(reply, updated);
        if (err) return err;
        return updated;
      } catch (err) {
        if (err.issues) return reply.code(422).send({ error: err.message, issues: err.issues });
        throw err;
      }
    }
  );

  // ============ VALIDATE (read-only) ============
  app.get(
    '/itineraries/:id/validate',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_READ) },
    async (request, reply) => {
      const r = await loadScoped(pool, request.user, request.params.id);
      const err = sendScopeError(reply, r);
      if (err) return err;
      return computeIssues(pool, r.events);
    }
  );

  // ============ ADD EVENT ============
  app.post(
    '/itineraries/:id/events',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_WRITE) },
    async (request, reply) => {
      const b = request.body || {};
      const start_at = b.start_at || b.starts_at;
      const end_at   = b.end_at   || b.ends_at;
      const title    = b.title    || b.notes || 'Event';
      const { venue_id, notes } = b;
      if (!start_at || !end_at) {
        return reply.code(400).send({ error: 'title, start_at, end_at required' });
      }
      try {
        const result = await withTransaction(async (c) => {
          const r = await loadScoped(c, request.user, request.params.id);
          if (r === NOT_FOUND || r === FORBIDDEN) return r;

          const nextSeq = r.events.length
            ? Math.max(...r.events.map((e) => e.sequence)) + 1
            : 1;
          await c.query(
            `INSERT INTO core.itinerary_event
               (itinerary_id, sequence, title, venue_id, start_at, end_at, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [request.params.id, nextSeq, title, venue_id || null, start_at, end_at, notes || null]
          );
          await validateOrThrow(c, request.params.id);
          await createVersion(c, request.params.id, request.user.id, `Added event: ${title}`);
          return loadItineraryAggregate(c, request.params.id);
        });
        const err = sendScopeError(reply, result);
        if (err) return err;
        return reply.code(201).send(result);
      } catch (err) {
        if (err.issues) return reply.code(422).send({ error: err.message, issues: err.issues });
        throw err;
      }
    }
  );

  // ============ UPDATE EVENT ============
  app.put(
    '/itineraries/:id/events/:eventId',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_WRITE) },
    async (request, reply) => {
      const { title, venue_id, start_at, end_at, notes } = request.body || {};
      try {
        const result = await withTransaction(async (c) => {
          const r = await loadScoped(c, request.user, request.params.id);
          if (r === NOT_FOUND || r === FORBIDDEN) return r;
          const upd = await c.query(
            `UPDATE core.itinerary_event
                SET title    = COALESCE($3, title),
                    venue_id = COALESCE($4, venue_id),
                    start_at = COALESCE($5, start_at),
                    end_at   = COALESCE($6, end_at),
                    notes    = COALESCE($7, notes)
              WHERE id = $1 AND itinerary_id = $2
              RETURNING id`,
            [
              request.params.eventId,
              request.params.id,
              title || null,
              venue_id || null,
              start_at || null,
              end_at || null,
              notes ?? null
            ]
          );
          if (!upd.rows[0]) return NOT_FOUND;
          await validateOrThrow(c, request.params.id);
          await createVersion(c, request.params.id, request.user.id, 'Updated event');
          return loadItineraryAggregate(c, request.params.id);
        });
        const err = sendScopeError(reply, result);
        if (err) return err;
        return result;
      } catch (err) {
        if (err.issues) return reply.code(422).send({ error: err.message, issues: err.issues });
        throw err;
      }
    }
  );

  // ============ DELETE EVENT ============
  app.delete(
    '/itineraries/:id/events/:eventId',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_WRITE) },
    async (request, reply) => {
      try {
        const result = await withTransaction(async (c) => {
          const r = await loadScoped(c, request.user, request.params.id);
          if (r === NOT_FOUND || r === FORBIDDEN) return r;
          const del = await c.query(
            `DELETE FROM core.itinerary_event
              WHERE id = $1 AND itinerary_id = $2 RETURNING id`,
            [request.params.eventId, request.params.id]
          );
          if (!del.rows[0]) return NOT_FOUND;
          await validateOrThrow(c, request.params.id);
          await createVersion(c, request.params.id, request.user.id, 'Removed event');
          return loadItineraryAggregate(c, request.params.id);
        });
        const err = sendScopeError(reply, result);
        if (err) return err;
        return result;
      } catch (err) {
        if (err.issues) return reply.code(422).send({ error: err.message, issues: err.issues });
        throw err;
      }
    }
  );

  // ============ REORDER (drag-and-drop) ============
  app.post(
    '/itineraries/:id/reorder',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_WRITE) },
    async (request, reply) => {
      const { order } = request.body || {};
      if (!Array.isArray(order) || !order.length) {
        return reply.code(400).send({ error: 'order must be a non-empty array of event ids' });
      }
      try {
        const result = await withTransaction(async (c) => {
          const r = await loadScoped(c, request.user, request.params.id);
          if (r === NOT_FOUND || r === FORBIDDEN) return r;
          const currentIds = new Set(r.events.map((e) => Number(e.id)));
          const givenIds = order.map(Number);
          if (
            givenIds.length !== currentIds.size ||
            givenIds.some((id) => !currentIds.has(id))
          ) {
            const e = new Error('order must include exactly the current event ids');
            e.status = 400;
            throw e;
          }
          // offset pass to avoid any transient conflicts with non-null constraints
          await c.query(
            `UPDATE core.itinerary_event
                SET sequence = sequence + 1000000
              WHERE itinerary_id = $1`,
            [request.params.id]
          );
          for (let i = 0; i < givenIds.length; i++) {
            await c.query(
              `UPDATE core.itinerary_event
                  SET sequence = $2
                WHERE id = $1 AND itinerary_id = $3`,
              [givenIds[i], i + 1, request.params.id]
            );
          }
          await validateOrThrow(c, request.params.id);
          await createVersion(c, request.params.id, request.user.id, 'Reordered events');
          return loadItineraryAggregate(c, request.params.id);
        });
        const err = sendScopeError(reply, result);
        if (err) return err;
        return result;
      } catch (err) {
        if (err.status === 400) return reply.code(400).send({ error: err.message });
        if (err.issues) return reply.code(422).send({ error: err.message, issues: err.issues });
        throw err;
      }
    }
  );

  // ============ VERSIONS ============
  app.get(
    '/itineraries/:id/versions',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_READ) },
    async (request, reply) => {
      const r = await loadScoped(pool, request.user, request.params.id);
      const err = sendScopeError(reply, r);
      if (err) return err;
      const { rows } = await query(
        `SELECT v.id, v.version_number, v.changed_by, u.username AS changed_by_username,
                v.change_summary, v.created_at
           FROM core.itinerary_version v
           LEFT JOIN core.app_user u ON u.id = v.changed_by
          WHERE v.itinerary_id = $1
          ORDER BY v.version_number DESC`,
        [request.params.id]
      );
      return rows;
    }
  );

  app.get(
    '/itineraries/:id/versions/:n',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_READ) },
    async (request, reply) => {
      const r = await loadScoped(pool, request.user, request.params.id);
      const err = sendScopeError(reply, r);
      if (err) return err;
      const { rows } = await query(
        `SELECT id, version_number, changed_by, change_summary, snapshot, created_at
           FROM core.itinerary_version
          WHERE itinerary_id = $1 AND version_number = $2`,
        [request.params.id, request.params.n]
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Version not found' });
      return rows[0];
    }
  );

  app.post(
    '/itineraries/:id/versions/:n/restore',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_WRITE) },
    async (request, reply) => {
      try {
        const result = await withTransaction(async (c) => {
          const r = await loadScoped(c, request.user, request.params.id);
          if (r === NOT_FOUND || r === FORBIDDEN) return r;
          await restoreVersion(c, request.params.id, Number(request.params.n), request.user.id);
          return loadItineraryAggregate(c, request.params.id);
        });
        const err = sendScopeError(reply, result);
        if (err) return err;
        await logPermissionEvent({
          user: request.user,
          permissionCode: PERMISSIONS.ITINERARY_WRITE,
          resource: `itinerary:${request.params.id}`,
          action: 'itinerary.restore',
          granted: true,
          request,
          metadata: { restoredFrom: Number(request.params.n) }
        });
        return result;
      } catch (err) {
        if (err.status === 404) return reply.code(404).send({ error: err.message });
        throw err;
      }
    }
  );
}
