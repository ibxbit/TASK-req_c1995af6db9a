// Unit tests — services/itinerary.js
// Covers computeIssues (overlap/buffer/drive_time_missing), loadItineraryAggregate,
// createVersion, restoreVersion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from './_fakes.js';
import {
  computeIssues,
  loadItineraryAggregate,
  createVersion,
  restoreVersion,
  MIN_BUFFER_MINUTES
} from '../src/services/itinerary.js';

test('MIN_BUFFER_MINUTES = 15', () => {
  assert.equal(MIN_BUFFER_MINUTES, 15);
});

test('computeIssues — overlap only', async () => {
  const stub = { query: async () => ({ rows: [] }) };
  const events = [
    { id: 1, title: 'A', start_at: '2026-01-01T10:00:00Z', end_at: '2026-01-01T11:00:00Z', venue_id: null },
    { id: 2, title: 'B', start_at: '2026-01-01T10:30:00Z', end_at: '2026-01-01T11:30:00Z', venue_id: null }
  ];
  const r = await computeIssues(stub, events);
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.type === 'overlap'));
});

test('computeIssues — drive_time_missing when coords absent', async () => {
  const client = makeClient([
    { match: /FROM core\.drive_time/, rows: [] },
    { match: /FROM core\.venue/, rows: [{ id: 1, latitude: null, longitude: null }, { id: 2, latitude: null, longitude: null }] }
  ]);
  const r = await computeIssues(client, [
    { id: 1, title: 'A', start_at: '2026-01-01T10:00:00Z', end_at: '2026-01-01T11:00:00Z', venue_id: 1 },
    { id: 2, title: 'B', start_at: '2026-01-01T12:00:00Z', end_at: '2026-01-01T13:00:00Z', venue_id: 2 }
  ]);
  assert.ok(r.issues.some((i) => i.type === 'drive_time_missing'));
});

test('computeIssues — buffer violation captures driveDistanceKm when computed', async () => {
  const client = makeClient([
    { match: /FROM core\.drive_time/, rows: [] },
    { match: /FROM core\.venue/, rows: [{ id: 1, latitude: 40.7128, longitude: -74.0060 }, { id: 2, latitude: 40.7580, longitude: -73.9855 }] }
  ]);
  const events = [
    { id: 1, title: 'A', start_at: '2026-01-01T10:00:00Z', end_at: '2026-01-01T11:00:00Z', venue_id: 1 },
    { id: 2, title: 'B', start_at: '2026-01-01T11:05:00Z', end_at: '2026-01-01T12:00:00Z', venue_id: 2 }
  ];
  const r = await computeIssues(client, events);
  const buf = r.issues.find((i) => i.type === 'buffer');
  assert.ok(buf);
  assert.ok(typeof buf.driveDistanceKm === 'number');
});

test('loadItineraryAggregate returns null when not found', async () => {
  const c = makeClient([{ match: /FROM core\.itinerary WHERE id/, rows: [] }]);
  assert.equal(await loadItineraryAggregate(c, 1), null);
});

test('loadItineraryAggregate composes events', async () => {
  const c = makeClient([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1, owner_user_id: 1, name: 'n', itinerary_date: '2026-01-01', current_version: 0 }] },
    { match: /FROM core\.itinerary_event/, rows: [{ id: 10, sequence: 1, title: 't' }] }
  ]);
  const r = await loadItineraryAggregate(c, 1);
  assert.equal(r.events.length, 1);
});

test('createVersion — throws on missing itinerary', async () => {
  const c = makeClient([{ match: /FROM core\.itinerary WHERE id/, rows: [] }]);
  await assert.rejects(() => createVersion(c, 99, 1, 'x'), /not found/);
});

test('createVersion — inserts + updates', async () => {
  const c = makeClient([
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1, owner_user_id: 1, name: 'n', itinerary_date: '2026-01-01', current_version: 2 }] },
    { match: /FROM core\.itinerary_event/, rows: [] },
    { match: /INSERT INTO core\.itinerary_version/, rows: [] },
    { match: /UPDATE core\.itinerary/, rows: [] }
  ]);
  const n = await createVersion(c, 1, 1);
  assert.equal(n, 3);
});

test('restoreVersion — 404 when version missing', async () => {
  const c = makeClient([{ match: /FROM core\.itinerary_version/, rows: [] }]);
  await assert.rejects(() => restoreVersion(c, 1, 99, 1), /not found/);
});

test('restoreVersion — replays events, updates, and creates new version', async () => {
  const snapshot = {
    id: 1, name: 'n', itinerary_date: '2026-01-01',
    events: [{ sequence: 1, title: 'a', venue_id: null, start_at: '2026-01-01T09:00:00Z', end_at: '2026-01-01T10:00:00Z', notes: null }]
  };
  const c = makeClient([
    { match: /FROM core\.itinerary_version/, rows: [{ snapshot }] },
    { match: /DELETE FROM core\.itinerary_event/, rows: [] },
    { match: /UPDATE core\.itinerary\s+SET name/, rows: [] },
    { match: /INSERT INTO core\.itinerary_event/, rows: [] },
    // createVersion second pass
    { match: /FROM core\.itinerary WHERE id/, rows: [{ id: 1, city_id: 1, owner_user_id: 1, name: 'n', itinerary_date: '2026-01-01', current_version: 1 }] },
    { match: /FROM core\.itinerary_event/, rows: [] },
    { match: /INSERT INTO core\.itinerary_version/, rows: [] },
    { match: /UPDATE core\.itinerary/, rows: [] }
  ]);
  const v = await restoreVersion(c, 1, 5, 1);
  assert.equal(v, 2);
});
