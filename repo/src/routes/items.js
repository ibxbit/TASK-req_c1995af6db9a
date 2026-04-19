import { query } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission } from '../rbac/enforce.js';
import { logPermissionEvent } from '../rbac/audit.js';

export default async function itemRoutes(app) {
  app.get('/items', { preHandler: requirePermission(PERMISSIONS.INVENTORY_READ) }, async () => {
    const { rows } = await query(
      `SELECT id, sku, name, unit, safety_threshold, is_active, created_at, updated_at
         FROM core.item ORDER BY sku`
    );
    return rows;
  });

  app.post('/items', { preHandler: requirePermission(PERMISSIONS.INVENTORY_WRITE) }, async (request, reply) => {
    const { sku, name, unit, safety_threshold } = request.body || {};
    if (!sku || !name) return reply.code(400).send({ error: 'sku and name required' });
    if (safety_threshold != null && (!Number.isInteger(safety_threshold) || safety_threshold < 0)) {
      return reply.code(400).send({ error: 'safety_threshold must be a non-negative integer' });
    }
    const { rows } = await query(
      `INSERT INTO core.item (sku, name, unit, safety_threshold)
       VALUES ($1,$2,COALESCE($3,'each'),COALESCE($4, 10))
       RETURNING id, sku, name, unit, safety_threshold, is_active`,
      [sku, name, unit || null, safety_threshold ?? null]
    );
    return reply.code(201).send(rows[0]);
  });

  // Editable safety threshold (and basic fields) per item
  app.put('/items/:id', { preHandler: requirePermission(PERMISSIONS.INVENTORY_WRITE) }, async (request, reply) => {
    const { name, unit, safety_threshold, is_active } = request.body || {};
    if (safety_threshold != null && (!Number.isInteger(safety_threshold) || safety_threshold < 0)) {
      return reply.code(400).send({ error: 'safety_threshold must be a non-negative integer' });
    }
    const { rows } = await query(
      `UPDATE core.item
          SET name             = COALESCE($2, name),
              unit             = COALESCE($3, unit),
              safety_threshold = COALESCE($4, safety_threshold),
              is_active        = COALESCE($5, is_active),
              updated_at       = now()
        WHERE id = $1
        RETURNING id, sku, name, unit, safety_threshold, is_active`,
      [request.params.id, name || null, unit || null, safety_threshold ?? null, is_active ?? null]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Not found' });
    await logPermissionEvent({
      user: request.user, permissionCode: PERMISSIONS.INVENTORY_WRITE,
      resource: `item:${rows[0].id}`, action: 'item.update',
      granted: true, request,
      metadata: { safety_threshold: rows[0].safety_threshold }
    });
    return rows[0];
  });
}
