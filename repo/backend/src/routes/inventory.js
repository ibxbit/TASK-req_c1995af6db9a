import { pool, query, withTransaction } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission, getCityScope, assertCityAccess } from '../rbac/enforce.js';
import { logPermissionEvent } from '../rbac/audit.js';
import {
  locationCityId,
  recordInbound,
  recordDirectOutbound,
  recordTransfer,
  recordCycleCount,
  createReservation,
  releaseReservation,
  fulfillReservation,
  sweepExpiredReservations
} from '../services/inventory.js';

function send(reply, err) {
  if (err.status) return reply.code(err.status).send({ error: err.message });
  throw err;
}

async function assertLocationAccess(client, user, locationId, reply) {
  if (!locationId) return reply.code(400).send({ error: 'location_id required' });
  const cityId = await locationCityId(client, locationId);
  if (cityId == null) return reply.code(404).send({ error: `Location ${locationId} not found` });
  if (!assertCityAccess(user, cityId)) return reply.code(403).send({ error: 'Location outside assigned scope' });
  return null;
}

export default async function inventoryRoutes(app) {
  // ===================== READ =====================
  app.get(
    '/inventory',
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_READ) },
    async (request) => {
      const scope = getCityScope(request.user);
      const { item_id, warehouse_id, location_id } = request.query || {};
      const conds = [];
      const args = [];
      if (!scope.all) {
        if (scope.cityIds.length === 0) return [];
        conds.push(`city_id = ANY($${args.length + 1}::int[])`);
        args.push(scope.cityIds);
      }
      if (item_id)      { conds.push(`item_id      = $${args.length + 1}`); args.push(item_id); }
      if (warehouse_id) { conds.push(`warehouse_id = $${args.length + 1}`); args.push(warehouse_id); }
      if (location_id)  { conds.push(`location_id  = $${args.length + 1}`); args.push(location_id); }

      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { rows } = await query(
        `SELECT item_id, sku, name, safety_threshold,
                warehouse_id, warehouse_code, location_id, location_code, city_id,
                on_hand, reserved, available, updated_at
           FROM core.v_stock_position
           ${where}
           ORDER BY sku, warehouse_code, location_code`,
        args
      );
      return rows;
    }
  );

  // Low-stock alerts — aggregated per item, filtered to the user's city scope.
  // City-scoped users only see items with stock rows in their cities that
  // aggregate below safety_threshold. Admin / DATA_CITY_ALL users get a view
  // across all cities. Items the user has never stocked in their city are NOT
  // surfaced — they are not "their" low stock.
  app.get(
    '/inventory/alerts/low-stock',
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_READ) },
    async (request) => {
      const scope = getCityScope(request.user);
      if (!scope.all && !scope.cityIds.length) return [];
      if (scope.all) {
        const { rows } = await query(
          `SELECT * FROM core.v_low_stock_item ORDER BY sku`
        );
        return rows;
      }
      const { rows } = await query(
        `SELECT i.id AS item_id, i.sku, i.name, i.unit, i.safety_threshold,
                COALESCE(SUM(p.on_hand),   0) AS on_hand_total,
                COALESCE(SUM(p.reserved),  0) AS reserved_total,
                COALESCE(SUM(p.available), 0) AS available_total
           FROM core.item i
           JOIN core.v_stock_position p ON p.item_id = i.id
          WHERE i.is_active = TRUE
            AND p.city_id = ANY($1::int[])
          GROUP BY i.id
         HAVING COALESCE(SUM(p.available), 0) < i.safety_threshold
          ORDER BY i.sku`,
        [scope.cityIds]
      );
      return rows;
    }
  );

  // Append-only stock ledger (who/when/why/before/after).
  // City-scoped users only see rows whose location belongs to their city.
  app.get(
    '/inventory/ledger',
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_READ) },
    async (request) => {
      const scope = getCityScope(request.user);
      if (!scope.all && !scope.cityIds.length) return [];
      const limit = Math.min(Number(request.query?.limit || 200), 1000);
      const { item_id, location_id } = request.query || {};
      const conds = [];
      const args = [];
      if (!scope.all) {
        args.push(scope.cityIds);
        conds.push(`w.city_id = ANY($${args.length}::int[])`);
      }
      if (item_id)     { args.push(item_id);     conds.push(`l.item_id     = $${args.length}`); }
      if (location_id) { args.push(location_id); conds.push(`l.location_id = $${args.length}`); }
      args.push(limit);
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const { rows } = await query(
        `SELECT l.id, l.movement_id, l.item_id, l.location_id,
                l.actor_user_id, u.username AS actor_username,
                l.occurred_at, l.reason,
                l.on_hand_before, l.on_hand_after,
                l.reserved_before, l.reserved_after,
                l.reference_type, l.reference_id,
                w.city_id
           FROM audit.stock_ledger l
      LEFT JOIN core.app_user u ON u.id = l.actor_user_id
           JOIN core.warehouse_location wl ON wl.id = l.location_id
           JOIN core.warehouse          w  ON w.id  = wl.warehouse_id
           ${where}
          ORDER BY l.occurred_at DESC, l.id DESC
          LIMIT $${args.length}`,
        args
      );
      return rows;
    }
  );

  // Manual sweep (also runs on a background interval; exposed for on-demand operator use)
  app.post(
    '/inventory/reservations/sweep-expired',
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_ISSUE) },
    async (request) => {
      return withTransaction((c) => sweepExpiredReservations(c, request.user.id));
    }
  );

  // Recent movements (audit).
  // City-scoped users only see movements where either the source or destination
  // warehouse is in one of their cities; transfers between two out-of-scope cities
  // are hidden. Admin/all-city users see everything.
  app.get(
    '/inventory/movements',
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_READ) },
    async (request) => {
      const scope = getCityScope(request.user);
      if (!scope.all && !scope.cityIds.length) return [];
      const limit = Math.min(Number(request.query?.limit || 100), 500);
      const args = [];
      let cityCond = '';
      if (!scope.all) {
        args.push(scope.cityIds);
        cityCond = `WHERE (wf.city_id = ANY($${args.length}::int[])
                        OR wt.city_id = ANY($${args.length}::int[]))`;
      }
      args.push(limit);
      const { rows } = await query(
        `SELECT m.id, m.movement_type, m.item_id, m.from_location_id, m.to_location_id,
                m.quantity, m.reference_type, m.reference_id, m.notes,
                m.created_by, m.created_at,
                wf.city_id AS from_city_id,
                wt.city_id AS to_city_id
           FROM core.stock_movement m
      LEFT JOIN core.warehouse_location wlf ON wlf.id = m.from_location_id
      LEFT JOIN core.warehouse          wf  ON wf.id  = wlf.warehouse_id
      LEFT JOIN core.warehouse_location wlt ON wlt.id = m.to_location_id
      LEFT JOIN core.warehouse          wt  ON wt.id  = wlt.warehouse_id
           ${cityCond}
          ORDER BY m.created_at DESC
          LIMIT $${args.length}`,
        args
      );
      return rows;
    }
  );

  // ===================== INBOUND =====================
  app.post(
    '/inventory/inbound',
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_WRITE) },
    async (request, reply) => {
      const body = request.body || {};
      const denied = await assertLocationAccess(pool, request.user, body.location_id, reply);
      if (denied) return denied;
      try {
        const result = await withTransaction((c) => recordInbound(c, request.user.id, body));
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.INVENTORY_WRITE,
          resource: `stock:${body.item_id}@${body.location_id}`,
          action: 'inventory.inbound', granted: true, request,
          metadata: { quantity: body.quantity }
        });
        return reply.code(201).send(result);
      } catch (err) { return send(reply, err); }
    }
  );

  // ===================== OUTBOUND =====================
  // Direct outbound (no prior reservation)
  app.post(
    '/inventory/outbound',
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_ISSUE) },
    async (request, reply) => {
      const body = request.body || {};
      const denied = await assertLocationAccess(pool, request.user, body.location_id, reply);
      if (denied) return denied;
      try {
        const result = await withTransaction((c) => recordDirectOutbound(c, request.user.id, body));
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.INVENTORY_ISSUE,
          resource: `stock:${body.item_id}@${body.location_id}`,
          action: 'inventory.outbound', granted: true, request,
          metadata: { quantity: body.quantity }
        });
        return reply.code(201).send(result);
      } catch (err) { return send(reply, err); }
    }
  );

  // ===================== TRANSFER =====================
  app.post(
    '/inventory/transfer',
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_WRITE) },
    async (request, reply) => {
      const body = request.body || {};
      const d1 = await assertLocationAccess(pool, request.user, body.from_location_id, reply);
      if (d1) return d1;
      const d2 = await assertLocationAccess(pool, request.user, body.to_location_id, reply);
      if (d2) return d2;
      try {
        const result = await withTransaction((c) => recordTransfer(c, request.user.id, body));
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.INVENTORY_WRITE,
          resource: `stock:${body.item_id}`, action: 'inventory.transfer',
          granted: true, request,
          metadata: { from: body.from_location_id, to: body.to_location_id, quantity: body.quantity }
        });
        return reply.code(201).send(result);
      } catch (err) { return send(reply, err); }
    }
  );

  // ===================== CYCLE COUNT =====================
  app.post(
    '/inventory/cycle-counts',
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_WRITE) },
    async (request, reply) => {
      const body = request.body || {};
      const denied = await assertLocationAccess(pool, request.user, body.location_id, reply);
      if (denied) return denied;
      try {
        const result = await withTransaction((c) => recordCycleCount(c, request.user.id, body));
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.INVENTORY_WRITE,
          resource: `stock:${body.item_id}@${body.location_id}`,
          action: 'inventory.cycle_count', granted: true, request,
          metadata: { counted_qty: body.counted_qty, variance: result.variance }
        });
        return reply.code(201).send(result);
      } catch (err) { return send(reply, err); }
    }
  );

  // ===================== RESERVATIONS =====================
  app.post(
    '/inventory/reservations',
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_ISSUE) },
    async (request, reply) => {
      const body = request.body || {};
      const denied = await assertLocationAccess(pool, request.user, body.location_id, reply);
      if (denied) return denied;
      try {
        const result = await withTransaction((c) => createReservation(c, request.user.id, body));
        return reply.code(201).send(result);
      } catch (err) { return send(reply, err); }
    }
  );

  app.post(
    '/inventory/reservations/:id/release',
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_ISSUE) },
    async (request, reply) => {
      try {
        const result = await withTransaction((c) => releaseReservation(c, request.user.id, request.params.id));
        return result;
      } catch (err) { return send(reply, err); }
    }
  );

  app.post(
    '/inventory/reservations/:id/fulfill',
    { preHandler: requirePermission(PERMISSIONS.INVENTORY_ISSUE) },
    async (request, reply) => {
      try {
        const result = await withTransaction((c) => fulfillReservation(c, request.user.id, request.params.id));
        return result;
      } catch (err) { return send(reply, err); }
    }
  );
}
