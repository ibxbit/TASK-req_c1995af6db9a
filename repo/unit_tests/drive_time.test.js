// Unit tests — drive-time resolver must expose distance_km alongside minutes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDriveTime, haversineKm } from '../src/services/drive_time.js';

function makeClient({ cached = null, venues = [] } = {}) {
  return {
    query: async (sql) => {
      if (sql.includes('FROM core.drive_time')) {
        return { rows: cached ? [cached] : [] };
      }
      if (sql.includes('FROM core.venue')) {
        return { rows: venues };
      }
      return { rows: [] };
    }
  };
}

test('returns distance_km when computed from coordinates', async () => {
  const venues = [
    { id: 1, latitude: 40.7128, longitude: -74.0060 },
    { id: 2, latitude: 40.7580, longitude: -73.9855 }
  ];
  const client = makeClient({ venues });
  const r = await resolveDriveTime(client, 1, 2);
  assert.equal(r.source, 'computed');
  assert.ok(typeof r.minutes === 'number' && r.minutes > 0);
  assert.ok(typeof r.distance_km === 'number' && r.distance_km > 0,
    `expected distance_km in response; got ${JSON.stringify(r)}`);
});

test('distance_km is null when source is manual (cached row)', async () => {
  const client = makeClient({ cached: { minutes: 30, source: 'manual' } });
  const r = await resolveDriveTime(client, 1, 2);
  assert.equal(r.source, 'manual');
  assert.equal(r.distance_km, null);
});

test('distance_km is null when source is manual_required (no coords)', async () => {
  const venues = [
    { id: 1, latitude: null, longitude: null },
    { id: 2, latitude: null, longitude: null }
  ];
  const client = makeClient({ venues });
  const r = await resolveDriveTime(client, 1, 2);
  assert.equal(r.source, 'manual_required');
  assert.equal(r.distance_km, null);
});

test('haversine distance is roughly correct for a known pair', () => {
  // NYC City Hall ~ Times Square ≈ 5.4 km
  const km = haversineKm(40.7128, -74.0060, 40.7580, -73.9855);
  assert.ok(km > 4 && km < 7, `expected ~5-6 km, got ${km}`);
});
