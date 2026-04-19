// Tests for object/city scope enforcement on the high-risk paths fixed in
// this revision:
//   - inventory scoped reads (low-stock, ledger, movements)
//   - payment-intake process/compensate
//   - integrations order balance
//   - workflow task object-level visibility
//   - drive-time distance_km exposure
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const CLERK_PASS = 'ClerkOnly_12345!';
const CLERK2_PASS = 'Clerk2Only_12345!';

let adminToken;
let clerkCity1Token; // CITY_CLERK, cities=[NYC]
let clerkCity2Token; // CITY_CLERK, cities=[SFO]
let warehouseCity1Token;
const warehousePass = 'Warehouse_12345!';

// Context created inline (city 1 / city 2)
const ctx = {
  city1: { id: 1, code: 'NYC' },
  city2: { id: 2, code: 'SFO' }
};

async function createUser(token, { roles, cities, pwd }) {
  const username = uniq('scope');
  const body = {
    username,
    email: `${username}@local`,
    full_name: 'Scope Test User',
    password: pwd,
    role_codes: roles,
    city_codes: cities
  };
  const r = await apiFetch('/admin/users', { method: 'POST', token, body });
  assert.equal(r.status, 201, `create user: ${JSON.stringify(r.body)}`);
  const login = await apiFetch('/auth/login', {
    method: 'POST', body: { username, password: pwd }
  });
  assert.equal(login.status, 200);
  return login.body.token;
}

before(async () => {
  adminToken = await loginAdmin();

  clerkCity1Token = await createUser(adminToken, {
    roles: ['CITY_CLERK'], cities: ['NYC'], pwd: CLERK_PASS
  });
  clerkCity2Token = await createUser(adminToken, {
    roles: ['CITY_CLERK'], cities: ['SFO'], pwd: CLERK2_PASS
  });
  warehouseCity1Token = await createUser(adminToken, {
    roles: ['WAREHOUSE'], cities: ['NYC'], pwd: warehousePass
  });
  recruiterCity1Token = await createUser(adminToken, {
    roles: ['RECRUITER'], cities: ['NYC'], pwd: RECRUITER_PASS
  });
  recruiterCity2Token = await createUser(adminToken, {
    roles: ['RECRUITER'], cities: ['SFO'], pwd: RECRUITER2_PASS
  });
});

// ============================================================================
// Drive-time distance exposure
// ============================================================================
test('GET /venues/drive-time exposes distance_km when coordinates known', async () => {
  const v1 = await apiFetch('/venues', {
    method: 'POST', token: adminToken,
    body: { city_id: ctx.city1.id, name: uniq('Origin'), latitude: 40.7128, longitude: -74.0060 }
  });
  const v2 = await apiFetch('/venues', {
    method: 'POST', token: adminToken,
    body: { city_id: ctx.city1.id, name: uniq('Dest'), latitude: 40.7580, longitude: -73.9855 }
  });
  assert.equal(v1.status, 201);
  assert.equal(v2.status, 201);
  const r = await apiFetch(`/venues/drive-time?origin=${v1.body.id}&destination=${v2.body.id}`, {
    token: adminToken
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'computed');
  assert.ok(typeof r.body.distance_km === 'number' && r.body.distance_km > 0,
    `expected positive distance_km, got ${JSON.stringify(r.body)}`);
});

// ============================================================================
// Inventory scoped reads
// ============================================================================
test('low-stock / ledger / movements: city-scoped user only sees own city', async () => {
  // Set up: a warehouse + location + item in city 2 with low stock.
  const wh = await apiFetch('/warehouses', {
    method: 'POST', token: adminToken,
    body: { city_id: ctx.city2.id, code: uniq('WH2'), name: 'C2 WH' }
  });
  assert.equal(wh.status, 201);
  const loc = await apiFetch(`/warehouses/${wh.body.id}/locations`, {
    method: 'POST', token: adminToken, body: { code: 'A1', name: 'A1' }
  });
  assert.equal(loc.status, 201);
  const item = await apiFetch('/items', {
    method: 'POST', token: adminToken,
    body: { sku: uniq('ITM2'), name: 'Scope item', safety_threshold: 100 }
  });
  assert.equal(item.status, 201);
  await apiFetch('/inventory/inbound', {
    method: 'POST', token: adminToken,
    body: { item_id: item.body.id, location_id: loc.body.id, quantity: 5 }
  });

  // City-1 clerk MUST NOT see city-2 ledger/movements.
  const ledger = await apiFetch('/inventory/ledger', { token: warehouseCity1Token });
  assert.equal(ledger.status, 200);
  for (const row of ledger.body) {
    assert.notEqual(Number(row.location_id), Number(loc.body.id),
      'city-scoped user saw ledger row outside their city');
  }

  const moves = await apiFetch('/inventory/movements', { token: warehouseCity1Token });
  assert.equal(moves.status, 200);
  for (const m of moves.body) {
    assert.notEqual(Number(m.to_location_id), Number(loc.body.id),
      'city-scoped user saw movement outside their city');
  }

  const alerts = await apiFetch('/inventory/alerts/low-stock', { token: warehouseCity1Token });
  assert.equal(alerts.status, 200);
  // City1 user should not see the city2 item (no stock rows in city1 -> item not included).
  assert.ok(!alerts.body.some((a) => Number(a.item_id) === Number(item.body.id)),
    'city-scoped user saw low-stock alert for item whose stock is only in other city');

  // Admin sees everything.
  const adminAlerts = await apiFetch('/inventory/alerts/low-stock', { token: adminToken });
  assert.ok(adminAlerts.body.some((a) => Number(a.item_id) === Number(item.body.id)));
});

// ============================================================================
// Payment intake scope + integrations balance scope
// ============================================================================
test('payment intake process/compensate enforces city scope; integrations balance too', async () => {
  // Create an event + order in city 2 using admin.
  const iso = (h) => new Date(Date.now() + h * 3600_000).toISOString();
  const ev = await apiFetch('/events', {
    method: 'POST', token: adminToken,
    body: { city_id: ctx.city2.id, name: uniq('C2Ev'), starts_at: iso(240),
            headcount_cutoff_at: iso(72), min_headcount: 1 }
  });
  assert.equal(ev.status, 201);
  const order = await apiFetch('/orders', {
    method: 'POST', token: adminToken,
    body: {
      event_id: ev.body.id, city_id: ctx.city2.id, customer_name: 'Scope Test',
      total_amount_cents: 10000,
      stages: [{ label: 'Full', amount_cents: 10000, due_rule_type: 'relative_to_order', due_offset_minutes: 60 }]
    }
  });
  assert.equal(order.status, 201);
  const orderId = order.body.id;
  const stageId = order.body.stages[0].id;

  // Admin creates intake linked to that order; this may immediately apply.
  const intake = await apiFetch('/payments/intake', {
    method: 'POST', token: adminToken,
    body: {
      method: 'cash',
      external_id: uniq('EXT'),
      order_id: orderId,
      payment_stage_id: stageId,
      amount_cents: 10000
    }
  });
  assert.equal(intake.status, 201, JSON.stringify(intake.body));
  const intakeId = intake.body.intake.id;

  // City-1 clerk is out of scope for the city-2 intake.
  const proc = await apiFetch(`/payments/intake/${intakeId}/process`, {
    method: 'POST', token: clerkCity1Token
  });
  assert.equal(proc.status, 403, JSON.stringify(proc.body));

  const comp = await apiFetch(`/payments/intake/${intakeId}/compensate`, {
    method: 'POST', token: clerkCity1Token, body: { reason: 'manual' }
  });
  assert.equal(comp.status, 403);

  // City-2 clerk is in scope — process is allowed (may 2xx or 409 if already applied,
  // but not 403).
  const procAllowed = await apiFetch(`/payments/intake/${intakeId}/process`, {
    method: 'POST', token: clerkCity2Token
  });
  assert.notEqual(procAllowed.status, 403,
    `in-scope process was wrongly forbidden: ${JSON.stringify(procAllowed.body)}`);

  // Integrations order balance scope
  const balForbidden = await apiFetch(`/integrations/orders/${orderId}/balance`, {
    token: clerkCity1Token
  });
  assert.equal(balForbidden.status, 403);
  const balAllowed = await apiFetch(`/integrations/orders/${orderId}/balance`, {
    token: clerkCity2Token
  });
  assert.equal(balAllowed.status, 200);
});

// ============================================================================
// Workflow task object-level visibility
// ============================================================================
test('workflow task object-level visibility — 403 for non-visible task, 200 for visible', async () => {
  // Use the seeded workflow definition 'vendor_onboarding_v1' (step 1 assignee: approval.approve).
  const instance = await apiFetch('/workflows/instances', {
    method: 'POST', token: adminToken,
    body: {
      definition_code: 'vendor_onboarding_v1',
      entity_type: 'vendor', entity_id: uniq('vend-'),
      summary: 'Scope visibility test',
      payload: { legal_name: 'Acme', contact_email: 'ops@acme.local' }
    }
  });
  assert.equal(instance.status, 201, JSON.stringify(instance.body));
  const taskId = instance.body.tasks?.[0]?.id;
  assert.ok(taskId, 'initiate should create first task');

  // CITY_CLERK has workflow.view but NOT approval.approve, and is not the initiator.
  const forbidden = await apiFetch(`/workflows/tasks/${taskId}`, { token: clerkCity1Token });
  assert.equal(forbidden.status, 403,
    `non-assignee should be forbidden; got ${forbidden.status} / ${JSON.stringify(forbidden.body)}`);

  // Admin has approval.approve (and every other perm) -> visible.
  const visible = await apiFetch(`/workflows/tasks/${taskId}`, { token: adminToken });
  assert.equal(visible.status, 200);
  assert.equal(Number(visible.body.id), Number(taskId));
});

// ============================================================================
// Workflow instance object-level visibility matrix
// CITY_CLERK has workflow.view + approval.submit but NOT workflow.define/audit.read
// ============================================================================

let recruiterCity1Token;
let recruiterCity2Token;
const RECRUITER_PASS = 'Recruiter_12345!';
const RECRUITER2_PASS = 'Recruiter2_12345!';

test('workflow instance visibility — Case A: non-initiator non-assignee gets 403 for detail', async () => {
  // Admin creates instance; clerkCity1 is neither initiator nor assignee
  const inst = await apiFetch('/workflows/instances', {
    method: 'POST', token: adminToken,
    body: {
      definition_code: 'vendor_onboarding_v1',
      entity_type: 'vendor', entity_id: uniq('inst-a-'),
      summary: 'Visibility Case A'
    }
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.body));
  const instId = inst.body.id;

  // clerkCity1 has workflow.view but is not initiator or approval.approve holder
  const forbidden = await apiFetch(`/workflows/instances/${instId}`, { token: clerkCity1Token });
  assert.equal(forbidden.status, 403,
    `Case A: non-visible user should get 403; got ${forbidden.status} body=${JSON.stringify(forbidden.body)}`);
});

test('workflow instance visibility — Case B: non-visible instance hidden from list', async () => {
  const inst = await apiFetch('/workflows/instances', {
    method: 'POST', token: adminToken,
    body: {
      definition_code: 'vendor_onboarding_v1',
      entity_type: 'vendor', entity_id: uniq('inst-b-'),
      summary: 'Visibility Case B unique marker'
    }
  });
  assert.equal(inst.status, 201);
  const instId = inst.body.id;

  // clerkCity1 should not see this instance in their list
  const list = await apiFetch('/workflows/instances', { token: clerkCity1Token });
  assert.equal(list.status, 200);
  assert.ok(
    !list.body.some(i => Number(i.id) === Number(instId)),
    `Case B: non-visible instance ${instId} must not appear in clerk's list`
  );
});

test('workflow instance visibility — Case C: initiator can see their own instance', async () => {
  // clerkCity1 (CITY_CLERK) has approval.submit so can initiate
  const inst = await apiFetch('/workflows/instances', {
    method: 'POST', token: clerkCity1Token,
    body: {
      definition_code: 'vendor_onboarding_v1',
      entity_type: 'vendor', entity_id: uniq('inst-c-'),
      summary: 'Visibility Case C — clerk initiated'
    }
  });
  assert.equal(inst.status, 201,
    `Case C: clerk should be able to initiate; got ${inst.status} body=${JSON.stringify(inst.body)}`);
  const instId = inst.body.id;

  // Initiator can see their own instance (detail)
  const detail = await apiFetch(`/workflows/instances/${instId}`, { token: clerkCity1Token });
  assert.equal(detail.status, 200,
    `Case C: initiator should get 200; got ${detail.status} body=${JSON.stringify(detail.body)}`);

  // Initiator's instance appears in their list
  const list = await apiFetch('/workflows/instances', { token: clerkCity1Token });
  assert.equal(list.status, 200);
  assert.ok(
    list.body.some(i => Number(i.id) === Number(instId)),
    'Case C: initiator must see their own instance in list'
  );
});

test('workflow instance visibility — Case D: elevated user (workflow.define) can see any instance', async () => {
  const inst = await apiFetch('/workflows/instances', {
    method: 'POST', token: adminToken,
    body: {
      definition_code: 'vendor_onboarding_v1',
      entity_type: 'vendor', entity_id: uniq('inst-d-'),
      summary: 'Visibility Case D'
    }
  });
  assert.equal(inst.status, 201);
  const instId = inst.body.id;

  // Admin has workflow.define → elevated → always visible
  const detail = await apiFetch(`/workflows/instances/${instId}`, { token: adminToken });
  assert.equal(detail.status, 200,
    `Case D: elevated user should get 200; got ${detail.status}`);
});

// ============================================================================
// Drive-time city-scope matrix
// RECRUITER is city-scoped and has venue.read + venue.write
// ============================================================================
test('drive-time city scope — in-scope origin+destination -> success with distance_km', async () => {
  // Create two NYC venues with coordinates
  const v1 = await apiFetch('/venues', {
    method: 'POST', token: adminToken,
    body: { city_id: ctx.city1.id, name: uniq('DT-NYC-1'), latitude: 40.7128, longitude: -74.0060 }
  });
  const v2 = await apiFetch('/venues', {
    method: 'POST', token: adminToken,
    body: { city_id: ctx.city1.id, name: uniq('DT-NYC-2'), latitude: 40.7580, longitude: -73.9855 }
  });
  assert.equal(v1.status, 201);
  assert.equal(v2.status, 201);

  // recruiterCity1 (NYC only) can access both NYC venues
  const r = await apiFetch(`/venues/drive-time?origin=${v1.body.id}&destination=${v2.body.id}`, {
    token: recruiterCity1Token
  });
  assert.equal(r.status, 200,
    `in-scope pair should succeed; got ${r.status} body=${JSON.stringify(r.body)}`);
  assert.equal(r.body.source, 'computed');
  assert.ok(typeof r.body.distance_km === 'number' && r.body.distance_km > 0,
    `expected positive distance_km for computed source; got ${JSON.stringify(r.body)}`);
});

test('drive-time city scope — out-of-scope origin -> 403', async () => {
  // SFO venue (out of scope for NYC recruiter)
  const vSFO = await apiFetch('/venues', {
    method: 'POST', token: adminToken,
    body: { city_id: ctx.city2.id, name: uniq('DT-SFO'), latitude: 37.7749, longitude: -122.4194 }
  });
  const vNYC = await apiFetch('/venues', {
    method: 'POST', token: adminToken,
    body: { city_id: ctx.city1.id, name: uniq('DT-NYC-src'), latitude: 40.7128, longitude: -74.0060 }
  });
  assert.equal(vSFO.status, 201);
  assert.equal(vNYC.status, 201);

  // origin = SFO venue (city 2), recruiterCity1 only has city 1 -> 403
  const r = await apiFetch(`/venues/drive-time?origin=${vSFO.body.id}&destination=${vNYC.body.id}`, {
    token: recruiterCity1Token
  });
  assert.equal(r.status, 403,
    `out-of-scope origin should yield 403; got ${r.status} body=${JSON.stringify(r.body)}`);
});

test('drive-time city scope — mixed scope pair (origin ok, destination out of scope) -> 403', async () => {
  const vNYC = await apiFetch('/venues', {
    method: 'POST', token: adminToken,
    body: { city_id: ctx.city1.id, name: uniq('DT-NYC-mix'), latitude: 40.7128, longitude: -74.0060 }
  });
  const vSFO = await apiFetch('/venues', {
    method: 'POST', token: adminToken,
    body: { city_id: ctx.city2.id, name: uniq('DT-SFO-mix'), latitude: 37.7749, longitude: -122.4194 }
  });
  assert.equal(vNYC.status, 201);
  assert.equal(vSFO.status, 201);

  // origin = NYC (ok), destination = SFO (forbidden for recruiterCity1) -> 403
  const r = await apiFetch(`/venues/drive-time?origin=${vNYC.body.id}&destination=${vSFO.body.id}`, {
    token: recruiterCity1Token
  });
  assert.equal(r.status, 403,
    `mixed-scope pair should yield 403; got ${r.status} body=${JSON.stringify(r.body)}`);
});

test('drive-time city scope — POST set manual: out-of-scope venue -> 403', async () => {
  const vNYC = await apiFetch('/venues', {
    method: 'POST', token: adminToken,
    body: { city_id: ctx.city1.id, name: uniq('DT-NYC-post'), latitude: 40.7128, longitude: -74.0060 }
  });
  const vSFO = await apiFetch('/venues', {
    method: 'POST', token: adminToken,
    body: { city_id: ctx.city2.id, name: uniq('DT-SFO-post'), latitude: 37.7749, longitude: -122.4194 }
  });
  assert.equal(vNYC.status, 201);
  assert.equal(vSFO.status, 201);

  // recruiterCity1 tries to set drive time involving SFO venue -> 403
  const r = await apiFetch('/venues/drive-time', {
    method: 'POST', token: recruiterCity1Token,
    body: { origin_venue_id: vNYC.body.id, destination_venue_id: vSFO.body.id, minutes: 60 }
  });
  assert.equal(r.status, 403,
    `out-of-scope POST should yield 403; got ${r.status} body=${JSON.stringify(r.body)}`);
});

// ============================================================================
// Workflow instance — explicit 404 case
// ============================================================================
test('workflow instance — non-existent id returns 404', async () => {
  const r = await apiFetch('/workflows/instances/999999999', { token: adminToken });
  assert.equal(r.status, 404,
    `non-existent instance should yield 404; got ${r.status} body=${JSON.stringify(r.body)}`);
});

// ============================================================================
// Drive-time — 400 (missing params) and 404 (unknown venue) edge cases
// ============================================================================
test('drive-time — missing query params returns 400', async () => {
  const r = await apiFetch('/venues/drive-time', { token: adminToken });
  assert.equal(r.status, 400,
    `missing origin/destination should yield 400; got ${r.status} body=${JSON.stringify(r.body)}`);
});

test('drive-time — unknown venue id returns 404', async () => {
  const r = await apiFetch('/venues/drive-time?origin=999999998&destination=999999999', {
    token: adminToken
  });
  assert.equal(r.status, 404,
    `unknown venue ids should yield 404; got ${r.status} body=${JSON.stringify(r.body)}`);
});
