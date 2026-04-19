// Unit tests — services/inventory.js
// Covers all mutation helpers, reservation lifecycle, sweep, validation errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from './_fakes.js';
import {
  locationCityId,
  recordInbound,
  createReservation,
  releaseReservation,
  confirmReservationsByReference,
  releaseReservationsByReference,
  fulfillReservation,
  recordDirectOutbound,
  recordTransfer,
  recordCycleCount,
  sweepExpiredReservations
} from '../src/services/inventory.js';

function stockClient({ on_hand = 0, reserved = 0, stocks = {} } = {}) {
  // stocks maps `item:loc` → { on_hand, reserved }; default used when unmapped.
  return makeClient([
    { match: /SELECT on_hand, reserved FROM core\.stock/, rows: (p) => {
        const k = `${p[0]}:${p[1]}`;
        const s = stocks[k] ?? { on_hand, reserved };
        return [s];
      }
    },
    { match: /UPDATE core\.stock\s+SET reserved = reserved \+/, rows: [] },
    { match: /INSERT INTO core\.stock \(/, rows: [] },
    { match: /INSERT INTO core\.stock_movement/, rows: [{ id: 999 }] },
    { match: /INSERT INTO audit\.stock_ledger/, rows: [] },
    { match: /INSERT INTO core\.stock_reservation/, rows: [{ id: 55, item_id: 1, location_id: 2, quantity: 3, status: 'active', expires_at: null, created_at: new Date() }] },
    { match: /SELECT id, item_id, location_id, quantity, status, expires_at, reference_type, reference_id/, rows: [{ id: 55, item_id: 1, location_id: 2, quantity: 3, status: 'active', expires_at: null, reference_type: 'event_order', reference_id: '9' }] },
    { match: /UPDATE core\.stock SET on_hand/, rows: [] },
    { match: /UPDATE core\.stock SET reserved/, rows: [] },
    { match: /UPDATE core\.stock\s+SET on_hand\s+= on_hand\s+- \$3,\s+reserved/, rows: [] },
    { match: /UPDATE core\.stock_reservation SET/, rows: [] },
    { match: /SELECT item_id, location_id FROM core\.stock\s+WHERE item_id = \$1 AND location_id IN/, rows: [] },
    { match: /INSERT INTO core\.cycle_count/, rows: [{ id: 77, expected_qty: 10, counted_qty: 8, variance: -2, counted_at: new Date() }] },
    { match: /UPDATE core\.stock_reservation\s+SET expires_at = NULL/, rows: [] },
    { match: /SELECT id FROM core\.stock_reservation\s+WHERE reference_type/, rows: [{ id: 88 }] },
    { match: /SELECT id FROM core\.stock_reservation\s+WHERE status/, rows: [{ id: 99 }] }
  ]);
}

test('locationCityId returns city_id for a location', async () => {
  const client = makeClient([
    { match: /FROM core\.warehouse_location/, rows: [{ city_id: 7 }] }
  ]);
  assert.equal(await locationCityId(client, 1), 7);

  const empty = makeClient([{ match: /.*/, rows: [] }]);
  assert.equal(await locationCityId(empty, 2), null);
});

test('recordInbound validates quantity and item/location', async () => {
  const c = stockClient();
  await assert.rejects(() => recordInbound(c, 1, { item_id: 0, location_id: 1, quantity: 1 }), /required/);
  await assert.rejects(() => recordInbound(c, 1, { item_id: 1, location_id: 0, quantity: 1 }), /required/);
  await assert.rejects(() => recordInbound(c, 1, { item_id: 1, location_id: 1, quantity: -1 }), /required/);
  await assert.rejects(() => recordInbound(c, 1, { item_id: 1, location_id: 1, quantity: 1.5 }), /required/);
});

test('recordInbound happy path + notes', async () => {
  const c = stockClient({ on_hand: 0 });
  const res = await recordInbound(c, 1, { item_id: 1, location_id: 2, quantity: 10, notes: 'hello', reference_type: 'po', reference_id: '42' });
  assert.ok(res); // returns stock row snapshot
});

test('createReservation rejects insufficient stock', async () => {
  const c = stockClient({ on_hand: 5, reserved: 4 }); // available = 1
  await assert.rejects(
    () => createReservation(c, 1, { item_id: 1, location_id: 2, quantity: 2 }),
    /Insufficient stock/
  );
});

test('createReservation happy path with expires_at + no refs', async () => {
  const c = stockClient({ on_hand: 10 });
  const r = await createReservation(c, null, {
    item_id: 1, location_id: 2, quantity: 3,
    expires_at: new Date(Date.now() + 60000)
  });
  assert.equal(r.status, 'active');
});

test('createReservation rejects invalid input', async () => {
  const c = stockClient();
  await assert.rejects(() => createReservation(c, 1, { item_id: 1, location_id: 2, quantity: 0 }), /required/);
});

test('releaseReservation 404 if missing, 409 if not active', async () => {
  const missingClient = makeClient([
    { match: /SELECT id, item_id, location_id, quantity, status/, rows: [] }
  ]);
  await assert.rejects(() => releaseReservation(missingClient, 1, 55), /not found/);

  const fulfilledClient = makeClient([
    { match: /SELECT id, item_id, location_id, quantity, status/, rows: [{ id: 55, item_id: 1, location_id: 2, quantity: 3, status: 'fulfilled', expires_at: null }] }
  ]);
  await assert.rejects(() => releaseReservation(fulfilledClient, 1, 55), /fulfilled/);
});

test('releaseReservation happy path', async () => {
  const c = stockClient({ on_hand: 10, reserved: 3 });
  const r = await releaseReservation(c, 1, 55);
  assert.equal(r.status, 'released');
});

test('confirmReservationsByReference runs UPDATE', async () => {
  const c = stockClient();
  await confirmReservationsByReference(c, 'event_order', 9);
  assert.ok(c.calls.some((x) => /UPDATE core\.stock_reservation\s+SET expires_at = NULL/.test(x.sql)));
});

test('releaseReservationsByReference loops over active rows', async () => {
  const c = stockClient();
  const count = await releaseReservationsByReference(c, 1, 'event_order', 9, 'order_canceled');
  assert.equal(count, 1);
});

test('fulfillReservation 404 and 409', async () => {
  const none = makeClient([{ match: /SELECT id, item_id, location_id, quantity, status/, rows: [] }]);
  await assert.rejects(() => fulfillReservation(none, 1, 10), /not found/);

  const done = makeClient([{ match: /SELECT id, item_id, location_id, quantity, status/, rows: [{ id: 10, status: 'released', item_id: 1, location_id: 2, quantity: 1 }] }]);
  await assert.rejects(() => fulfillReservation(done, 1, 10), /released/);
});

test('fulfillReservation happy path', async () => {
  const c = stockClient({ on_hand: 5, reserved: 3 });
  const r = await fulfillReservation(c, 1, 55);
  assert.equal(r.status, 'fulfilled');
});

test('recordDirectOutbound rejects insufficient stock', async () => {
  const c = stockClient({ on_hand: 2, reserved: 1 });
  await assert.rejects(
    () => recordDirectOutbound(c, 1, { item_id: 1, location_id: 2, quantity: 5 }),
    /Insufficient stock/
  );
});

test('recordDirectOutbound happy path', async () => {
  const c = stockClient({ on_hand: 10 });
  const r = await recordDirectOutbound(c, 1, { item_id: 1, location_id: 2, quantity: 4, notes: 'shipout' });
  assert.ok(r);
});

test('recordDirectOutbound validates input', async () => {
  const c = stockClient();
  await assert.rejects(() => recordDirectOutbound(c, 1, { item_id: 1, location_id: 2, quantity: -1 }), /required/);
});

test('recordTransfer validates input & same location', async () => {
  const c = stockClient();
  await assert.rejects(() => recordTransfer(c, 1, { item_id: 1, from_location_id: 0, to_location_id: 2, quantity: 1 }), /required/);
  await assert.rejects(() => recordTransfer(c, 1, { item_id: 1, from_location_id: 2, to_location_id: 2, quantity: 1 }), /must differ/);
});

test('recordTransfer rejects insufficient source stock', async () => {
  const c = stockClient({ on_hand: 2, reserved: 1 });
  await assert.rejects(
    () => recordTransfer(c, 1, { item_id: 1, from_location_id: 1, to_location_id: 2, quantity: 5 }),
    /Insufficient available stock/
  );
});

test('recordTransfer happy path (both orderings) and notes', async () => {
  const c = stockClient({ on_hand: 20 });
  const r = await recordTransfer(c, 1, { item_id: 1, from_location_id: 3, to_location_id: 2, quantity: 5, notes: 'move' });
  assert.ok(r.source);
  assert.ok(r.destination);

  const c2 = stockClient({ on_hand: 20 });
  const r2 = await recordTransfer(c2, 1, { item_id: 1, from_location_id: 2, to_location_id: 3, quantity: 5 });
  assert.ok(r2);
});

test('recordCycleCount validation and insufficient when reserved > counted', async () => {
  const c = stockClient({ on_hand: 10, reserved: 5 });
  await assert.rejects(() => recordCycleCount(c, 1, { item_id: 1, location_id: 2, counted_qty: -1 }), /required/);
  await assert.rejects(() => recordCycleCount(c, 1, { item_id: 0, location_id: 2, counted_qty: 5 }), /required/);
  await assert.rejects(
    () => recordCycleCount(c, 1, { item_id: 1, location_id: 2, counted_qty: 2 }),
    /below reserved/
  );
});

test('recordCycleCount records variance (positive, negative, zero)', async () => {
  const pos = stockClient({ on_hand: 5 });
  await recordCycleCount(pos, 1, { item_id: 1, location_id: 2, counted_qty: 10, notes: 'topup' });

  const neg = stockClient({ on_hand: 10 });
  await recordCycleCount(neg, 1, { item_id: 1, location_id: 2, counted_qty: 7 });

  // Zero variance skips movement insert; ledger still written.
  const zero = stockClient({ on_hand: 5 });
  await recordCycleCount(zero, 1, { item_id: 1, location_id: 2, counted_qty: 5 });
});

test('sweepExpiredReservations releases all rows it sees', async () => {
  const c = stockClient();
  const r = await sweepExpiredReservations(c, 1);
  assert.ok(r.released >= 1);
  assert.ok(r.checkedAt instanceof Date);
});

test('sweepExpiredReservations accepts a custom now', async () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const c = stockClient();
  const r = await sweepExpiredReservations(c, 1, { now });
  assert.equal(r.checkedAt, now);
});
