// Payment-intake city-scope edge cases: intake rows with no linked order
// (order_id = null → city_id = null in the scope guard).
// Rule: guardIntakeCity requires data.city.all when city_id is null;
//       city-scoped users get 403; global users pass the guard.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'IntakeEdge_Secure12!';

let adminToken;
let clerkToken;   // CITY_CLERK (NYC) — has payment.collect + refund.issue, data.city.assigned

before(async () => {
  adminToken = await loginAdmin();

  const clerkName = uniq('intake-edge-clerk');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: {
      username: clerkName,
      email: `${clerkName}@local`,
      full_name: 'Intake Edge Clerk',
      password: PASS,
      role_codes: ['CITY_CLERK'],
      city_codes: ['NYC']
    }
  });
  const login = await apiFetch('/auth/login', {
    method: 'POST', body: { username: clerkName, password: PASS }
  });
  assert.equal(login.status, 200, `clerk login: ${JSON.stringify(login.body)}`);
  clerkToken = login.body.token;
});

// Helper: create an unlinked intake (no order_id → city_id = null)
async function createUnlinkedIntake() {
  const r = await apiFetch('/payments/intake', {
    method: 'POST', token: adminToken,
    body: { method: 'cash', external_id: uniq('UNLINKED'), amount_cents: 500 }
  });
  assert.equal(r.status, 201,
    `create unlinked intake: ${JSON.stringify(r.body)}`);
  return r.body.intake.id;
}

// ── city-scoped user → 403 on process ────────────────────────────────────────
test('intake null-city — city-scoped user (CITY_CLERK) gets 403 on process', async () => {
  const intakeId = await createUnlinkedIntake();
  const r = await apiFetch(`/payments/intake/${intakeId}/process`, {
    method: 'POST', token: clerkToken
  });
  assert.equal(r.status, 403,
    `city-scoped user must get 403 on unlinked intake process; got ${r.status} body=${JSON.stringify(r.body)}`);
});

// ── city-scoped user → 403 on compensate ─────────────────────────────────────
test('intake null-city — city-scoped user (CITY_CLERK) gets 403 on compensate', async () => {
  const intakeId = await createUnlinkedIntake();
  const r = await apiFetch(`/payments/intake/${intakeId}/compensate`, {
    method: 'POST', token: clerkToken, body: { reason: 'test reversal' }
  });
  assert.equal(r.status, 403,
    `city-scoped user must get 403 on unlinked intake compensate; got ${r.status}`);
});

// ── global user (data.city.all) passes the scope guard ───────────────────────
test('intake null-city — global user (admin, data.city.all) passes scope guard on process', async () => {
  const intakeId = await createUnlinkedIntake();
  const r = await apiFetch(`/payments/intake/${intakeId}/process`, {
    method: 'POST', token: adminToken
  });
  // Scope guard passed; result may be 200/409/404 depending on intake state — not 403
  assert.notEqual(r.status, 403,
    `global user must NOT get 403 on unlinked intake; got ${r.status} body=${JSON.stringify(r.body)}`);
});

// ── cross-scope bypass: city-scoped user cannot access a different city's linked intake ──
test('intake scope — city-scoped user cannot process out-of-scope linked intake (403)', async () => {
  // Create an event + order in SFO (city 2) and an intake linked to it
  const iso = (h) => new Date(Date.now() + h * 3600_000).toISOString();
  const ev = await apiFetch('/events', {
    method: 'POST', token: adminToken,
    body: { city_id: 2, name: uniq('SFO-Edge'), starts_at: iso(240),
            headcount_cutoff_at: iso(72), min_headcount: 1 }
  });
  assert.equal(ev.status, 201);
  const order = await apiFetch('/orders', {
    method: 'POST', token: adminToken,
    body: { event_id: ev.body.id, city_id: 2, customer_name: 'Edge Test',
            total_amount_cents: 1000,
            stages: [{ label: 'Full', amount_cents: 1000,
                       due_rule_type: 'relative_to_order', due_offset_minutes: 60 }] }
  });
  assert.equal(order.status, 201);
  const intake = await apiFetch('/payments/intake', {
    method: 'POST', token: adminToken,
    body: { method: 'cash', external_id: uniq('SFO-INT'),
            order_id: order.body.id,
            payment_stage_id: order.body.stages[0].id,
            amount_cents: 1000 }
  });
  assert.equal(intake.status, 201);
  const intakeId = intake.body.intake.id;

  // NYC-only clerk cannot process SFO intake (city_id != null, assertCityAccess fails)
  const r = await apiFetch(`/payments/intake/${intakeId}/process`, {
    method: 'POST', token: clerkToken
  });
  assert.equal(r.status, 403,
    `NYC clerk must get 403 on SFO intake; got ${r.status} body=${JSON.stringify(r.body)}`);
});
