import { query } from '../db.js';
import { config } from '../config.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission } from '../rbac/enforce.js';

function clampLimit(v) { return Math.min(Math.max(Number(v) || 200, 1), 1000); }
function parseBool(v) {
  if (v === undefined || v === null || v === '') return null;
  return v === 'true' || v === '1' || v === true;
}

export default async function auditRoutes(app) {
  // ================== EVENTS (permission_event only — richest data) ==================
  app.get(
    '/audit/events',
    { preHandler: requirePermission(PERMISSIONS.AUDIT_READ) },
    async (request) => {
      const q = request.query || {};
      const args = [];
      const conds = [];
      if (q.user_id)     { args.push(Number(q.user_id));     conds.push(`user_id     = $${args.length}`); }
      if (q.username)    { args.push(q.username);            conds.push(`username    = $${args.length}`); }
      if (q.workstation) { args.push(q.workstation);         conds.push(`workstation = $${args.length}`); }
      if (q.action)      { args.push(q.action + '%');        conds.push(`(action LIKE $${args.length} OR permission_code LIKE $${args.length})`); }
      if (q.entity_type) { args.push(q.entity_type);         conds.push(`entity_type = $${args.length}`); }
      if (q.entity_id)   { args.push(String(q.entity_id));   conds.push(`entity_id   = $${args.length}`); }
      if (q.from)        { args.push(q.from);                conds.push(`occurred_at >= $${args.length}`); }
      if (q.to)          { args.push(q.to);                  conds.push(`occurred_at <  $${args.length}`); }
      const granted = parseBool(q.granted);
      if (granted !== null) { args.push(granted);            conds.push(`granted     = $${args.length}`); }

      args.push(clampLimit(q.limit));
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { rows } = await query(
        `SELECT id, user_id, username, permission_code, action, resource,
                entity_type, entity_id, workstation, ip_address,
                http_method, http_path, granted, reason, metadata, occurred_at
           FROM audit.permission_event
           ${where}
          ORDER BY occurred_at DESC, id DESC
          LIMIT $${args.length}`,
        args
      );
      return rows;
    }
  );

  // ================== UNIFIED LOG (all audit tables via view) ==================
  app.get(
    '/audit/log',
    { preHandler: requirePermission(PERMISSIONS.AUDIT_READ) },
    async (request) => {
      const q = request.query || {};
      const args = [];
      const conds = [];
      if (q.user_id)     { args.push(Number(q.user_id));   conds.push(`user_id     = $${args.length}`); }
      if (q.workstation) { args.push(q.workstation);       conds.push(`workstation = $${args.length}`); }
      if (q.action)      { args.push(q.action + '%');      conds.push(`action LIKE $${args.length}`); }
      if (q.entity_type) { args.push(q.entity_type);       conds.push(`entity_type = $${args.length}`); }
      if (q.entity_id)   { args.push(String(q.entity_id)); conds.push(`entity_id   = $${args.length}`); }
      if (q.source)      { args.push(q.source);            conds.push(`source      = $${args.length}`); }
      if (q.from)        { args.push(q.from);              conds.push(`occurred_at >= $${args.length}`); }
      if (q.to)          { args.push(q.to);                conds.push(`occurred_at <  $${args.length}`); }

      args.push(clampLimit(q.limit));
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { rows } = await query(
        `SELECT source, event_id, user_id, username, action,
                entity_type, entity_id, entity,
                workstation, ip_address, http_method, http_path,
                granted, reason, metadata, occurred_at
           FROM audit.v_audit_log
           ${where}
          ORDER BY occurred_at DESC
          LIMIT $${args.length}`,
        args
      );
      return rows;
    }
  );

  // ================== STATS (breakdowns for ops dashboards) ==================
  app.get(
    '/audit/stats/by-user',
    { preHandler: requirePermission(PERMISSIONS.AUDIT_READ) },
    async () => {
      const { rows } = await query(
        `SELECT user_id, username,
                COUNT(*)                            AS total,
                COUNT(*) FILTER (WHERE granted)     AS granted,
                COUNT(*) FILTER (WHERE NOT granted) AS denied,
                MAX(occurred_at)                    AS last_event
           FROM audit.permission_event
          GROUP BY user_id, username
          ORDER BY total DESC
          LIMIT 200`
      );
      return rows;
    }
  );

  app.get(
    '/audit/stats/by-workstation',
    { preHandler: requirePermission(PERMISSIONS.AUDIT_READ) },
    async () => {
      const { rows } = await query(
        `SELECT workstation,
                COUNT(*)                            AS total,
                COUNT(*) FILTER (WHERE granted)     AS granted,
                COUNT(*) FILTER (WHERE NOT granted) AS denied,
                MIN(occurred_at) AS first_event,
                MAX(occurred_at) AS last_event
           FROM audit.permission_event
          WHERE workstation IS NOT NULL
          GROUP BY workstation
          ORDER BY total DESC
          LIMIT 200`
      );
      return rows;
    }
  );

  app.get(
    '/audit/stats/by-action',
    { preHandler: requirePermission(PERMISSIONS.AUDIT_READ) },
    async () => {
      const { rows } = await query(
        `SELECT COALESCE(action, permission_code) AS action,
                COUNT(*)                            AS total,
                COUNT(*) FILTER (WHERE NOT granted) AS denied,
                MAX(occurred_at)                    AS last_event
           FROM audit.permission_event
          GROUP BY COALESCE(action, permission_code)
          ORDER BY total DESC
          LIMIT 200`
      );
      return rows;
    }
  );

  // ================== RETENTION STATUS ==================
  app.get(
    '/audit/retention',
    { preHandler: requirePermission(PERMISSIONS.AUDIT_READ) },
    async () => {
      const { rows } = await query(
        `SELECT
            (SELECT MIN(occurred_at) FROM audit.permission_event) AS oldest_permission_event,
            (SELECT MIN(occurred_at) FROM audit.stock_ledger)     AS oldest_stock_ledger,
            (SELECT MIN(started_at)  FROM audit.payment_attempt)  AS oldest_payment_attempt,
            (SELECT MIN(started_at)  FROM audit.ingestion_run)    AS oldest_ingestion_run`
      );
      return {
        retention_years: config.auditRetentionYears,
        ...rows[0],
        note: 'Tables are append-only. After retention elapses, export to cold storage and drop partitions out-of-band.'
      };
    }
  );
}
