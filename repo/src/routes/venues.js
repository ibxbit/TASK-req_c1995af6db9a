import { pool, query, withTransaction } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission, getCityScope, assertCityAccess } from '../rbac/enforce.js';
import { logPermissionEvent } from '../rbac/audit.js';
import { resolveDriveTime, setManualDriveTime } from '../services/drive_time.js';

export default async function venueRoutes(app) {
  // LIST venues (city-scoped)
  app.get('/venues', { preHandler: requirePermission(PERMISSIONS.VENUE_READ) }, async (request) => {
    const scope = getCityScope(request.user);
    if (!scope.all && scope.cityIds.length === 0) return [];
    const { rows } = scope.all
      ? await query(
          `SELECT id, city_id, name, address, latitude, longitude FROM core.venue ORDER BY name`
        )
      : await query(
          `SELECT id, city_id, name, address, latitude, longitude
             FROM core.venue WHERE city_id = ANY($1::int[]) ORDER BY name`,
          [scope.cityIds]
        );
    return rows;
  });

  // CREATE venue
  app.post('/venues', { preHandler: requirePermission(PERMISSIONS.VENUE_WRITE) }, async (request, reply) => {
    const { city_id, name, address, latitude, longitude } = request.body || {};
    if (!city_id || !name) return reply.code(400).send({ error: 'city_id and name required' });
    if (!assertCityAccess(request.user, city_id)) {
      return reply.code(403).send({ error: 'City outside assigned scope' });
    }
    const { rows } = await query(
      `INSERT INTO core.venue (city_id, name, address, latitude, longitude)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, city_id, name, address, latitude, longitude`,
      [city_id, name, address || null, latitude ?? null, longitude ?? null]
    );
    return reply.code(201).send(rows[0]);
  });

  // GET resolved drive time (cached, computed, or manual_required)
  // Resolves both venue city IDs and enforces city scope before delegating to the service.
  app.get('/venues/drive-time', { preHandler: requirePermission(PERMISSIONS.VENUE_READ) }, async (request, reply) => {
    const { origin, destination } = request.query;
    if (!origin || !destination) {
      return reply.code(400).send({ error: 'origin and destination query params required' });
    }

    const { rows: venues } = await query(
      `SELECT id, city_id FROM core.venue WHERE id = ANY($1::int[])`,
      [[Number(origin), Number(destination)]]
    );
    const originVenue = venues.find(v => v.id === Number(origin));
    const destVenue   = venues.find(v => v.id === Number(destination));
    if (!originVenue || !destVenue) {
      return reply.code(404).send({ error: 'One or both venues not found' });
    }

    if (!assertCityAccess(request.user, originVenue.city_id)) {
      await logPermissionEvent({
        user: request.user, permissionCode: PERMISSIONS.VENUE_READ,
        resource: `venue:${origin}`, action: 'drive_time.read', granted: false,
        reason: 'Origin venue outside assigned city scope', request
      });
      return reply.code(403).send({ error: 'Origin venue outside assigned city scope' });
    }
    if (!assertCityAccess(request.user, destVenue.city_id)) {
      await logPermissionEvent({
        user: request.user, permissionCode: PERMISSIONS.VENUE_READ,
        resource: `venue:${destination}`, action: 'drive_time.read', granted: false,
        reason: 'Destination venue outside assigned city scope', request
      });
      return reply.code(403).send({ error: 'Destination venue outside assigned city scope' });
    }

    return resolveDriveTime(pool, Number(origin), Number(destination));
  });

  // POST manual drive time (persisted for future use)
  // Resolves both venue city IDs and enforces city scope before persisting.
  app.post('/venues/drive-time', { preHandler: requirePermission(PERMISSIONS.VENUE_WRITE) }, async (request, reply) => {
    const { origin_venue_id, destination_venue_id, minutes } = request.body || {};
    if (!origin_venue_id || !destination_venue_id || minutes == null) {
      return reply.code(400).send({ error: 'origin_venue_id, destination_venue_id, minutes required' });
    }
    if (!Number.isInteger(minutes) || minutes < 0) {
      return reply.code(400).send({ error: 'minutes must be a non-negative integer' });
    }

    const { rows: venues } = await query(
      `SELECT id, city_id FROM core.venue WHERE id = ANY($1::int[])`,
      [[Number(origin_venue_id), Number(destination_venue_id)]]
    );
    const originVenue = venues.find(v => v.id === Number(origin_venue_id));
    const destVenue   = venues.find(v => v.id === Number(destination_venue_id));
    if (!originVenue || !destVenue) {
      return reply.code(404).send({ error: 'One or both venues not found' });
    }

    if (!assertCityAccess(request.user, originVenue.city_id)) {
      return reply.code(403).send({ error: 'Origin venue outside assigned city scope' });
    }
    if (!assertCityAccess(request.user, destVenue.city_id)) {
      return reply.code(403).send({ error: 'Destination venue outside assigned city scope' });
    }

    try {
      const saved = await withTransaction((c) =>
        setManualDriveTime(c, origin_venue_id, destination_venue_id, minutes, request.user.id)
      );
      await logPermissionEvent({
        user: request.user,
        permissionCode: PERMISSIONS.VENUE_WRITE,
        resource: `drive_time:${saved.origin_venue_id}-${saved.destination_venue_id}`,
        action: 'drive_time.set_manual',
        granted: true,
        request,
        metadata: { minutes }
      });
      return saved;
    } catch (err) {
      if (err.status === 400) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });
}
