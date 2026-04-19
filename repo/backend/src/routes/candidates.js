import { query } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission, getCityScope, assertCityAccess } from '../rbac/enforce.js';
import { logPermissionEvent } from '../rbac/audit.js';

export default async function candidateRoutes(app) {
  // LIST (data-level row filtering by city scope)
  app.get(
    '/candidates',
    { preHandler: requirePermission(PERMISSIONS.CANDIDATE_READ) },
    async (request) => {
      const scope = getCityScope(request.user);

      if (scope.all) {
        const { rows } = await query(
          `SELECT id, city_id, full_name, email, status, created_at
             FROM core.candidate ORDER BY id DESC`
        );
        return rows;
      }

      if (scope.cityIds.length === 0) return [];

      const { rows } = await query(
        `SELECT id, city_id, full_name, email, status, created_at
           FROM core.candidate
          WHERE city_id = ANY($1::int[])
          ORDER BY id DESC`,
        [scope.cityIds]
      );
      return rows;
    }
  );

  // CREATE (data-level enforcement: city must be within user scope)
  app.post(
    '/candidates',
    { preHandler: requirePermission(PERMISSIONS.CANDIDATE_WRITE) },
    async (request, reply) => {
      const { city_id, full_name, email, status } = request.body || {};
      if (!city_id || !full_name) {
        return reply.code(400).send({ error: 'city_id and full_name required' });
      }

      if (!assertCityAccess(request.user, city_id)) {
        await logPermissionEvent({
          user: request.user,
          permissionCode: 'data.city.scope',
          resource: `city:${city_id}`,
          action: 'candidate.create',
          granted: false,
          reason: 'City outside user scope',
          request
        });
        return reply.code(403).send({ error: 'City outside assigned scope' });
      }

      const { rows } = await query(
        `INSERT INTO core.candidate (city_id, full_name, email, status, created_by)
         VALUES ($1,$2,$3,COALESCE($4,'new'),$5)
         RETURNING id, city_id, full_name, email, status, created_at`,
        [city_id, full_name, email || null, status || null, request.user.id]
      );

      await logPermissionEvent({
        user: request.user,
        permissionCode: PERMISSIONS.CANDIDATE_WRITE,
        resource: `candidate:${rows[0].id}`,
        action: 'candidate.create',
        granted: true,
        request,
        metadata: { city_id }
      });

      return reply.code(201).send(rows[0]);
    }
  );
}
