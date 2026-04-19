// Drive-time resolution with cache (manual or computed) + haversine fallback.

const URBAN_KM_PER_HOUR = 40;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function pair(a, b) {
  const x = Number(a), y = Number(b);
  return x < y ? [x, y] : [y, x];
}

/**
 * Resolve drive time between two venues.
 *  { minutes, source, distance_km }
 *    source:       'none' (same venue or missing), 'manual', 'computed', 'manual_required'
 *    distance_km:  non-null only when we computed from coordinates; null otherwise
 *                  (manual entries do not imply a known distance).
 */
export async function resolveDriveTime(client, originVenueId, destinationVenueId) {
  if (!originVenueId || !destinationVenueId) {
    return { minutes: 0, source: 'none', distance_km: null };
  }
  const [lo, hi] = pair(originVenueId, destinationVenueId);
  if (lo === hi) return { minutes: 0, source: 'none', distance_km: null };

  const cached = await client.query(
    `SELECT minutes, source FROM core.drive_time
      WHERE origin_venue_id = $1 AND destination_venue_id = $2`,
    [lo, hi]
  );
  if (cached.rows[0]) {
    return {
      minutes: cached.rows[0].minutes,
      source: cached.rows[0].source,
      distance_km: null
    };
  }

  const vres = await client.query(
    `SELECT id, latitude, longitude FROM core.venue WHERE id = ANY($1::int[])`,
    [[lo, hi]]
  );
  const va = vres.rows.find((r) => r.id === lo);
  const vb = vres.rows.find((r) => r.id === hi);
  if (
    va?.latitude != null && va?.longitude != null &&
    vb?.latitude != null && vb?.longitude != null
  ) {
    const km = haversineKm(
      Number(va.latitude), Number(va.longitude),
      Number(vb.latitude), Number(vb.longitude)
    );
    const minutes = Math.max(1, Math.ceil((km / URBAN_KM_PER_HOUR) * 60));
    return {
      minutes,
      source: 'computed',
      distance_km: Math.round(km * 100) / 100
    };
  }

  return { minutes: null, source: 'manual_required', distance_km: null };
}

export async function setManualDriveTime(client, originVenueId, destinationVenueId, minutes, userId) {
  const [lo, hi] = pair(originVenueId, destinationVenueId);
  if (lo === hi) throw Object.assign(new Error('Origin and destination must differ'), { status: 400 });
  const res = await client.query(
    `INSERT INTO core.drive_time
       (origin_venue_id, destination_venue_id, minutes, source, created_by)
     VALUES ($1,$2,$3,'manual',$4)
     ON CONFLICT (origin_venue_id, destination_venue_id) DO UPDATE
       SET minutes = EXCLUDED.minutes,
           source  = 'manual',
           updated_at = now()
     RETURNING origin_venue_id, destination_venue_id, minutes, source`,
    [lo, hi, minutes, userId]
  );
  return res.rows[0];
}
