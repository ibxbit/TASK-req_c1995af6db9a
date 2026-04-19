import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

let token, cityId, warehouseId, locationId, itemId;

before(async () => {
  token = await loginAdmin();

  // Cities are seeded (NYC, SFO, ...)
  const me = await apiFetch('/auth/me', { token });
  // Admin has data.city.all; we pick the first seeded city via any warehouse-create attempt.
  // Use a known seeded city code — seeds include NYC.
  // Look it up via a lightweight inventory read round-trip: GET /warehouses accepts city_id.
  // Simpler: create a warehouse using city_id=1 which is the first seeded (NYC).
  cityId = 1;

  const wh = await apiFetch('/warehouses', {
    method: 'POST', token,
    body: { city_id: cityId, code: uniq('WH'), name: 'Test WH', address: '1 Test' }
  });
  assert.equal(wh.status, 201, JSON.stringify(wh.body));
  warehouseId = wh.body.id;

  const loc = await apiFetch(`/warehouses/${warehouseId}/locations`, {
    method: 'POST', token, body: { code: 'A1', name: 'Shelf A1' }
  });
  assert.equal(loc.status, 201);
  locationId = loc.body.id;

  const item = await apiFetch('/items', {
    method: 'POST', token,
    body: { sku: uniq('SKU'), name: 'Test Item', safety_threshold: 5 }
  });
  assert.equal(item.status, 201);
  itemId = item.body.id;
});

test('inbound increases on_hand', async () => {
  const r = await apiFetch('/inventory/inbound', {
    method: 'POST', token,
    body: { item_id: itemId, location_id: locationId, quantity: 10 }
  });
  assert.equal(r.status, 201);
  assert.equal(Number(r.body.on_hand), 10);
  assert.equal(Number(r.body.reserved), 0);
});

test('reservation reduces available but not on_hand', async () => {
  const r = await apiFetch('/inventory/reservations', {
    method: 'POST', token,
    body: { item_id: itemId, location_id: locationId, quantity: 4 }
  });
  assert.equal(r.status, 201);

  const list = await apiFetch(`/inventory?item_id=${itemId}&location_id=${locationId}`, { token });
  const row = list.body.find((x) => Number(x.location_id) === Number(locationId));
  assert.equal(Number(row.on_hand), 10);
  assert.equal(Number(row.reserved), 4);
  assert.equal(Number(row.available), 6);
});

test('over-reservation is rejected with 409', async () => {
  const r = await apiFetch('/inventory/reservations', {
    method: 'POST', token,
    body: { item_id: itemId, location_id: locationId, quantity: 999 }
  });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /Insufficient stock/);
});

test('low-stock alerts reflect safety_threshold', async () => {
  // safety threshold is 5. available is 6 currently. Lower on_hand to 5 via outbound.
  const out = await apiFetch('/inventory/outbound', {
    method: 'POST', token,
    body: { item_id: itemId, location_id: locationId, quantity: 5 }
  });
  assert.equal(out.status, 201);

  const alerts = await apiFetch('/inventory/alerts/low-stock', { token });
  assert.equal(alerts.status, 200);
  assert.ok(alerts.body.some((a) => Number(a.item_id) === Number(itemId)));
});

test('append-only stock ledger records before/after', async () => {
  const { status, body } = await apiFetch(`/inventory/ledger?item_id=${itemId}`, { token });
  assert.equal(status, 200);
  assert.ok(body.length > 0);
  for (const row of body) {
    assert.ok(['on_hand_before','on_hand_after','reserved_before','reserved_after']
      .every((k) => row[k] !== undefined));
  }
});
