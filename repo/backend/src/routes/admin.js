import { query } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission } from '../rbac/enforce.js';
import { hashPassword, validatePasswordStrength } from '../auth/password.js';
import { adminUnlock } from '../auth/lockout.js';
import { withTransaction } from '../db.js';
import { logPermissionEvent } from '../rbac/audit.js';

export default async function adminRoutes(app) {
  app.get(
    '/admin/users',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async () => {
      const { rows } = await query(
        `SELECT u.id, u.username, u.email, u.full_name, u.is_active,
                COALESCE(ARRAY_AGG(r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
           FROM core.app_user u
           LEFT JOIN core.user_role ur ON ur.user_id = u.id
           LEFT JOIN core.role r       ON r.id       = ur.role_id
          GROUP BY u.id
          ORDER BY u.id`
      );
      return rows;
    }
  );

  app.post(
    '/admin/users',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const { username, email, full_name, password, role_codes = [], city_codes = [] } =
        request.body || {};
      if (!username || !email || !full_name || !password) {
        return reply.code(400).send({ error: 'username, email, full_name, password required' });
      }
      try { validatePasswordStrength(password); }
      catch (e) { return reply.code(e.status || 400).send({ error: e.message }); }

      const password_hash = await hashPassword(password);

      let created;
      try {
        created = await withTransaction(async (c) => {
          const ins = await c.query(
            `INSERT INTO core.app_user (username, email, full_name, password_hash)
             VALUES ($1,$2,$3,$4) RETURNING id, username, email, full_name`,
            [username, email, full_name, password_hash]
          );
          const userId = ins.rows[0].id;

          if (role_codes.length) {
            await c.query(
              `INSERT INTO core.user_role (user_id, role_id)
               SELECT $1, r.id FROM core.role r WHERE r.code = ANY($2::text[])`,
              [userId, role_codes]
            );
          }
          if (city_codes.length) {
            await c.query(
              `INSERT INTO core.user_city (user_id, city_id)
               SELECT $1, c.id FROM core.city c WHERE c.code = ANY($2::text[])`,
              [userId, city_codes]
            );
          }
          return ins.rows[0];
        });
      } catch (e) {
        if (e.code === '23505') {
          return reply.code(409).send({ error: 'Username or email already exists' });
        }
        throw e;
      }

      await logPermissionEvent({
        user: request.user,
        permissionCode: PERMISSIONS.USER_MANAGE,
        resource: `user:${created.id}`,
        action: 'user.create',
        granted: true,
        request,
        metadata: { role_codes, city_codes }
      });

      return reply.code(201).send(created);
    }
  );

  app.post(
    '/admin/users/:id/unlock',
    { preHandler: requirePermission(PERMISSIONS.USER_MANAGE) },
    async (request, reply) => {
      const result = await withTransaction((c) => adminUnlock(c, request.params.id));
      if (!result) return reply.code(404).send({ error: 'Not found' });
      await logPermissionEvent({
        user: request.user, permissionCode: PERMISSIONS.USER_MANAGE,
        resource: `user:${request.params.id}`,
        action: 'user.unlock', granted: true, request
      });
      return result;
    }
  );

  app.get(
    '/admin/audit',
    { preHandler: requirePermission(PERMISSIONS.AUDIT_READ) },
    async (request) => {
      const limit = Math.min(Number(request.query.limit || 100), 500);
      const { rows } = await query(
        `SELECT id, user_id, username, permission_code, resource, action,
                entity_type, entity_id, workstation, granted, reason,
                http_method, http_path, ip_address, metadata, occurred_at
           FROM audit.permission_event
          ORDER BY occurred_at DESC
          LIMIT $1`,
        [limit]
      );
      return rows;
    }
  );
}
