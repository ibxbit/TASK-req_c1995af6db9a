import { query } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission, getCityScope, assertCityAccess } from '../rbac/enforce.js';

export default async function warehouseRoutes(app) {
  app.get('/warehouses', { preHandler: requirePermission(PERMISSIONS.INVENTORY_READ) }, async (request) => {
    const scope = getCityScope(request.user);
    if (!scope.all && scope.cityIds.length === 0) return [];
    const { rows } = scope.all
      ? await query(
          `SELECT id, city_id, code, name, address, is_active FROM core.warehouse ORDER BY code`
        )
      : await query(
          `SELECT id, city_id, code, name, address, is_active
             FROM core.warehouse WHERE city_id = ANY($1::int[]) ORDER BY code`,
          [scope.cityIds]
        );
    return rows;
  });

  app.get('/warehouses/:id', { preHandler: requirePermission(PERMISSIONS.INVENTORY_READ) }, async (request, reply) => {
    const w = await query(`SELECT * FROM core.warehouse WHERE id = $1`, [request.params.id]);
    if (!w.rows[0]) return reply.code(404).send({ error: 'Not found' });
    if (!assertCityAccess(request.user, w.rows[0].city_id)) return reply.code(403).send({ error: 'Forbidden' });
    const locs = await query(
      `SELECT id, code, name, is_active FROM core.warehouse_location
        WHERE warehouse_id = $1 ORDER BY code`,
      [request.params.id]
    );
    return { ...w.rows[0], locations: locs.rows };
  });

  app.post('/warehouses', { preHandler: requirePermission(PERMISSIONS.INVENTORY_WRITE) }, async (request, reply) => {
    const { city_id, code, name, address } = request.body || {};
    if (!city_id || !code || !name) return reply.code(400).send({ error: 'city_id, code, name required' });
    if (!assertCityAccess(request.user, city_id)) return reply.code(403).send({ error: 'City outside assigned scope' });
    const { rows } = await query(
      `INSERT INTO core.warehouse (city_id, code, name, address)
       VALUES ($1,$2,$3,$4)
       RETURNING id, city_id, code, name, address, is_active`,
      [city_id, code, name, address || null]
    );
    return reply.code(201).send(rows[0]);
  });

  app.post('/warehouses/:id/locations', { preHandler: requirePermission(PERMISSIONS.INVENTORY_WRITE) }, async (request, reply) => {
    const w = await query(`SELECT city_id FROM core.warehouse WHERE id = $1`, [request.params.id]);
    if (!w.rows[0]) return reply.code(404).send({ error: 'Warehouse not found' });
    if (!assertCityAccess(request.user, w.rows[0].city_id)) return reply.code(403).send({ error: 'Forbidden' });
    const { code, name } = request.body || {};
    if (!code) return reply.code(400).send({ error: 'code required' });
    const { rows } = await query(
      `INSERT INTO core.warehouse_location (warehouse_id, code, name)
       VALUES ($1,$2,$3)
       RETURNING id, warehouse_id, code, name, is_active`,
      [request.params.id, code, name || null]
    );
    return reply.code(201).send(rows[0]);
  });
}
