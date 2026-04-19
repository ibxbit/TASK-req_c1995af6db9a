import { query, withTransaction } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission } from '../rbac/enforce.js';
import { logPermissionEvent } from '../rbac/audit.js';
import { requireFields } from '../middleware/validate.js';
import { runSource, tickScheduler } from '../services/ingestion_scheduler.js';

function send(reply, err) {
  if (err.status) return reply.code(err.status).send({ error: err.message });
  throw err;
}

export default async function ingestionSourceRoutes(app) {
  app.get(
    '/ingestion/sources',
    { preHandler: requirePermission(PERMISSIONS.DATA_INGEST) },
    async () => {
      const { rows } = await query(
        `SELECT s.id, s.code, s.type, s.format, s.inbox_dir, s.parser_key,
                s.min_interval_hours, s.is_active, s.user_agent, s.ip_hint,
                s.captcha_strategy, s.config, s.created_at,
                cp.last_run_started_at, cp.last_run_finished_at,
                cp.last_file, cp.last_record_offset
           FROM core.ingestion_source s
      LEFT JOIN core.ingestion_checkpoint cp ON cp.source_id = s.id
          ORDER BY s.code`
      );
      return rows;
    }
  );

  app.get(
    '/ingestion/sources/:id',
    { preHandler: requirePermission(PERMISSIONS.DATA_INGEST) },
    async (request, reply) => {
      const { rows } = await query(
        `SELECT s.*, cp.last_run_started_at, cp.last_run_finished_at,
                cp.last_file, cp.last_record_offset, cp.last_file_hash, cp.cursor
           FROM core.ingestion_source s
      LEFT JOIN core.ingestion_checkpoint cp ON cp.source_id = s.id
          WHERE s.id = $1`,
        [request.params.id]
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
      return rows[0];
    }
  );

  app.post(
    '/ingestion/sources',
    {
      preHandler: [
        requirePermission(PERMISSIONS.DATA_INGEST),
        requireFields(['code'])
      ]
    },
    async (request, reply) => {
      const b = request.body;
      if (b.min_interval_hours != null && b.min_interval_hours < 6) {
        return reply.code(400).send({ error: 'min_interval_hours must be >= 6' });
      }
      // Accept aliased field names from clients; fall back to valid constrained defaults
      const type       = b.type       || 'job_board';
      const format     = b.format     || 'html';
      const inbox_dir  = b.inbox_dir  || b.file_path       || '';
      const parser_key = b.parser_key || b.resource_type   || 'generic';
      const { rows } = await query(
        `INSERT INTO core.ingestion_source
           (code, type, format, inbox_dir, parser_key, min_interval_hours,
            is_active, user_agent, ip_hint, captcha_strategy, config, created_by)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,6),
                 COALESCE($7,TRUE),$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          b.code, type, format, inbox_dir, parser_key,
          b.min_interval_hours ?? null, b.is_active ?? null,
          b.user_agent ?? null, b.ip_hint ?? null,
          b.captcha_strategy ?? null,
          b.config ? JSON.stringify(b.config) : null,
          request.user.id
        ]
      );
      return reply.code(201).send(rows[0]);
    }
  );

  app.put(
    '/ingestion/sources/:id',
    { preHandler: requirePermission(PERMISSIONS.DATA_INGEST) },
    async (request, reply) => {
      const b = request.body || {};
      if (b.min_interval_hours != null && b.min_interval_hours < 6) {
        return reply.code(400).send({ error: 'min_interval_hours must be >= 6' });
      }
      const { rows } = await query(
        `UPDATE core.ingestion_source
            SET min_interval_hours = COALESCE($2, min_interval_hours),
                is_active         = COALESCE($3, is_active),
                user_agent        = COALESCE($4, user_agent),
                ip_hint           = COALESCE($5, ip_hint),
                captcha_strategy  = COALESCE($6, captcha_strategy),
                config            = COALESCE($7::jsonb, config),
                inbox_dir         = COALESCE($8, inbox_dir),
                parser_key        = COALESCE($9, parser_key),
                updated_at        = now()
          WHERE id = $1
          RETURNING *`,
        [
          request.params.id,
          b.min_interval_hours ?? null, b.is_active ?? null,
          b.user_agent ?? null, b.ip_hint ?? null,
          b.captcha_strategy ?? null,
          b.config ? JSON.stringify(b.config) : null,
          b.inbox_dir ?? null, b.parser_key ?? null
        ]
      );
      if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
      return rows[0];
    }
  );

  // Manual trigger — rejects if the 6-hour interval has not elapsed unless force=true.
  app.post(
    '/ingestion/sources/:id/run',
    { preHandler: requirePermission(PERMISSIONS.DATA_INGEST) },
    async (request, reply) => {
      try {
        const result = await withTransaction((c) =>
          runSource(c, request.user.id, request.params.id, { force: !!request.body?.force })
        );
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.DATA_INGEST,
          resource: `ingestion_source:${request.params.id}`,
          action: 'ingestion.run', granted: true, request,
          metadata: result.totals
        });
        return reply.code(201).send(result);
      } catch (err) { return send(reply, err); }
    }
  );

  app.post(
    '/ingestion/sources/tick',
    { preHandler: requirePermission(PERMISSIONS.DATA_INGEST) },
    async (request) => withTransaction((c) => tickScheduler(c, request.user.id))
  );

  // Browse staged records
  app.get(
    '/ingestion/sources/:id/records',
    { preHandler: requirePermission(PERMISSIONS.DATA_INGEST) },
    async (request, reply) => {
      const srcCheck = await query(`SELECT id FROM core.ingestion_source WHERE id = $1`, [request.params.id]);
      if (!srcCheck.rows[0]) return reply.code(404).send({ error: 'Not found' });
      const limit = Math.min(Number(request.query?.limit || 100), 500);
      const { rows } = await query(
        `SELECT id, source_id, run_id, external_key, fingerprint, received_at, data
           FROM core.ingestion_record
          WHERE source_id = $1
          ORDER BY received_at DESC
          LIMIT $2`,
        [request.params.id, limit]
      );
      return rows;
    }
  );

  // Read-only checkpoint view (resume state)
  app.get(
    '/ingestion/sources/:id/checkpoint',
    { preHandler: requirePermission(PERMISSIONS.DATA_INGEST) },
    async (request, reply) => {
      const { rows } = await query(
        `SELECT source_id, last_run_started_at, last_run_finished_at,
                last_file, last_record_offset, last_file_hash, cursor, updated_at
           FROM core.ingestion_checkpoint WHERE source_id = $1`,
        [request.params.id]
      );
      if (!rows[0]) return reply.code(404).send({ error: 'No checkpoint yet' });
      return rows[0];
    }
  );
}
