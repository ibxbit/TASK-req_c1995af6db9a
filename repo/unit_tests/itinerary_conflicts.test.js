// Unit tests — itinerary conflict detector (overlap + 15-minute buffer).
// computeIssues only calls the DB when events have venue_ids, so for this
// test we pass null venue_ids and stub the client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeIssues } from '../src/services/itinerary.js';

const stubClient = { query: async () => ({ rows: [] }) };

const mk = (id, start, end, venue_id = null) => ({
  id, title: `event-${id}`, start_at: start, end_at: end, venue_id
});

test('detects overlapping events', async () => {
  const events = [
    mk(1, '2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z'),
    mk(2, '2026-01-01T10:30:00Z', '2026-01-01T11:30:00Z')
  ];
  const result = await computeIssues(stubClient, events);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.type === 'overlap'));
});

test('enforces 15-min buffer between consecutive events', async () => {
  const events = [
    mk(1, '2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z'),
    mk(2, '2026-01-01T11:05:00Z', '2026-01-01T12:00:00Z') // only 5 min gap
  ];
  const result = await computeIssues(stubClient, events);
  const buffer = result.issues.find((i) => i.type === 'buffer');
  assert.ok(buffer, 'expected buffer issue');
  assert.equal(buffer.requiredMinutes, 15);
  assert.equal(buffer.actualMinutes, 5);
});

test('no issues when buffer is satisfied', async () => {
  const events = [
    mk(1, '2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z'),
    mk(2, '2026-01-01T11:20:00Z', '2026-01-01T12:00:00Z')
  ];
  const result = await computeIssues(stubClient, events);
  assert.equal(result.valid, true);
  assert.equal(result.issues.length, 0);
});

test('single event is always valid', async () => {
  const events = [ mk(1, '2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z') ];
  const result = await computeIssues(stubClient, events);
  assert.equal(result.valid, true);
});

test('empty schedule is valid', async () => {
  const result = await computeIssues(stubClient, []);
  assert.equal(result.valid, true);
});
