import { pool, query, withTransaction } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission, assertCityAccess } from '../rbac/enforce.js';
import {
  loadItineraryAggregate,
  createVersion,
  computeIssues
} from '../services/itinerary.js';

export default async function templateRoutes(app) {
  app.get(
    '/itinerary-templates',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_READ) },
    async () => {
      const { rows } = await query(
        `SELECT id, name, description, created_by, created_at
           FROM core.itinerary_template ORDER BY name`
      );
      return rows;
    }
  );

  app.get(
    '/itinerary-templates/:id',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_READ) },
    async (request, reply) => {
      const { rows: tRows } = await query(
        `SELECT id, name, description, created_by, created_at
           FROM core.itinerary_template WHERE id = $1`,
        [request.params.id]
      );
      if (!tRows[0]) return reply.code(404).send({ error: 'Not found' });
      const { rows: eRows } = await query(
        `SELECT id, sequence, title, default_duration_minutes,
                offset_from_start_minutes, default_notes
           FROM core.itinerary_template_event
          WHERE template_id = $1
          ORDER BY sequence`,
        [request.params.id]
      );
      return { ...tRows[0], events: eRows };
    }
  );

  app.post(
    '/itinerary-templates',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_TEMPLATE_MANAGE) },
    async (request, reply) => {
      const { name, description, events = [] } = request.body || {};
      if (!name) return reply.code(400).send({ error: 'name required' });
      if (!Array.isArray(events)) return reply.code(400).send({ error: 'events must be an array' });

      const created = await withTransaction(async (c) => {
        const ins = await c.query(
          `INSERT INTO core.itinerary_template (name, description, created_by)
           VALUES ($1,$2,$3) RETURNING id, name, description, created_at`,
          [name, description || null, request.user.id]
        );
        const templateId = ins.rows[0].id;
        for (let i = 0; i < events.length; i++) {
          const e = events[i];
          await c.query(
            `INSERT INTO core.itinerary_template_event
               (template_id, sequence, title, default_duration_minutes,
                offset_from_start_minutes, default_notes)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [
              templateId,
              e.sequence ?? i + 1,
              e.title,
              e.default_duration_minutes,
              e.offset_from_start_minutes ?? 0,
              e.default_notes ?? null
            ]
          );
        }
        return ins.rows[0];
      });
      return reply.code(201).send(created);
    }
  );

  // Apply a template to an existing itinerary, using a base start timestamp.
  app.post(
    '/itinerary-templates/:id/apply',
    { preHandler: requirePermission(PERMISSIONS.ITINERARY_WRITE) },
    async (request, reply) => {
      const { itinerary_id, start_at } = request.body || {};
      if (!itinerary_id || !start_at) {
        return reply.code(400).send({ error: 'itinerary_id and start_at required' });
      }

      try {
        const result = await withTransaction(async (c) => {
          const itinRes = await c.query(
            `SELECT id, city_id FROM core.itinerary WHERE id = $1`,
            [itinerary_id]
          );
          const itin = itinRes.rows[0];
          if (!itin) return { __status: 404 };
          if (!assertCityAccess(request.user, itin.city_id)) return { __status: 403 };

          const tRes = await c.query(
            `SELECT id FROM core.itinerary_template WHERE id = $1`,
            [request.params.id]
          );
          if (!tRes.rows[0]) return { __status: 404, __msg: 'Template not found' };

          const { rows: tEvents } = await c.query(
            `SELECT sequence, title, default_duration_minutes,
                    offset_from_start_minutes, default_notes
               FROM core.itinerary_template_event
              WHERE template_id = $1 ORDER BY sequence`,
            [request.params.id]
          );

          const existing = await c.query(
            `SELECT COALESCE(MAX(sequence),0) AS max_seq
               FROM core.itinerary_event WHERE itinerary_id = $1`,
            [itinerary_id]
          );
          let seq = existing.rows[0].max_seq;

          const base = new Date(start_at);
          for (const e of tEvents) {
            seq += 1;
            const s = new Date(base.getTime() + e.offset_from_start_minutes * 60000);
            const en = new Date(s.getTime() + e.default_duration_minutes * 60000);
            await c.query(
              `INSERT INTO core.itinerary_event
                 (itinerary_id, sequence, title, venue_id, start_at, end_at, notes)
               VALUES ($1,$2,$3,NULL,$4,$5,$6)`,
              [itinerary_id, seq, e.title, s.toISOString(), en.toISOString(), e.default_notes]
            );
          }

          const agg = await loadItineraryAggregate(c, itinerary_id);
          const v = await computeIssues(c, agg.events);
          if (!v.valid) {
            const err = new Error('Validation failed after applying template');
            err.issues = v.issues;
            throw err;
          }
          await createVersion(c, itinerary_id, request.user.id, `Applied template ${request.params.id}`);
          return loadItineraryAggregate(c, itinerary_id);
        });

        if (result.__status === 404) return reply.code(404).send({ error: result.__msg || 'Not found' });
        if (result.__status === 403) return reply.code(403).send({ error: 'Forbidden' });
        return result;
      } catch (err) {
        if (err.issues) return reply.code(422).send({ error: err.message, issues: err.issues });
        throw err;
      }
    }
  );
}
