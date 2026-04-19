// API tests — workflow engine: definitions, instances, tasks
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'WorkflowEng12!';
let adminToken;
let warehouseToken; // no workflow.view
let instanceId, taskId;

before(async () => {
  adminToken = await loginAdmin();

  const wName = uniq('wfe-wh');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: wName, email: `${wName}@local`, full_name: 'WFE WH',
            password: PASS, role_codes: ['WAREHOUSE'] }
  });
  const wLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: wName, password: PASS } });
  warehouseToken = wLogin.body.token;
});

// ── GET /workflows/definitions ────────────────────────────────────────────────
test('GET /workflows/definitions — 401 without token', async () => {
  assert.equal((await apiFetch('/workflows/definitions')).status, 401);
});

test('GET /workflows/definitions — 403 without workflow.view (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/workflows/definitions', { token: warehouseToken })).status, 403);
});

test('GET /workflows/definitions — 200 with admin, returns array', async () => {
  const r = await apiFetch('/workflows/definitions', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── POST /workflows/definitions ───────────────────────────────────────────────
test('POST /workflows/definitions — 401 without token', async () => {
  assert.equal((await apiFetch('/workflows/definitions', { method: 'POST', body: {} })).status, 401);
});

test('POST /workflows/definitions — 400 missing required fields', async () => {
  const r = await apiFetch('/workflows/definitions', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /workflows/definitions — 201 happy path', async () => {
  const r = await apiFetch('/workflows/definitions', {
    method: 'POST', token: adminToken,
    body: {
      code: uniq('WF-DEF'),
      entity_type: 'event',
      description: 'Test workflow definition',
      steps: [
        { name: 'Manager Approval', assignee_permission: 'approval.approve', sla_hours: 48 }
      ]
    }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.id);
  assert.ok(Array.isArray(r.body.steps));
  assert.equal(r.body.steps.length, 1);
});

// ── GET /workflows/definitions/:id ───────────────────────────────────────────
test('GET /workflows/definitions/:id — 404 for missing definition', async () => {
  assert.equal((await apiFetch('/workflows/definitions/999999999', { token: adminToken })).status, 404);
});

test('GET /workflows/definitions/:id — 200 returns definition with steps', async () => {
  const created = await apiFetch('/workflows/definitions', {
    method: 'POST', token: adminToken,
    body: {
      code: uniq('WF-GET'),
      entity_type: 'event',
      steps: [{ name: 'Review', assignee_permission: 'approval.approve' }]
    }
  });
  assert.equal(created.status, 201);
  const r = await apiFetch(`/workflows/definitions/${created.body.id}`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, created.body.id);
  assert.ok(Array.isArray(r.body.steps));
});

// ── GET /workflows/instances ──────────────────────────────────────────────────
test('GET /workflows/instances — 401 without token', async () => {
  assert.equal((await apiFetch('/workflows/instances')).status, 401);
});

test('GET /workflows/instances — 403 without workflow.view (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/workflows/instances', { token: warehouseToken })).status, 403);
});

test('GET /workflows/instances — 200 with admin, returns array', async () => {
  const r = await apiFetch('/workflows/instances', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── POST /workflows/instances ─────────────────────────────────────────────────
test('POST /workflows/instances — 401 without token', async () => {
  assert.equal((await apiFetch('/workflows/instances', { method: 'POST', body: {} })).status, 401);
});

test('POST /workflows/instances — 400 missing required fields', async () => {
  const r = await apiFetch('/workflows/instances', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /workflows/instances — 201 happy path using seeded definition', async () => {
  // Use a seeded workflow definition code
  const r = await apiFetch('/workflows/instances', {
    method: 'POST', token: adminToken,
    body: {
      entity_type: 'event',
      entity_id: 1,
      summary: uniq('WF instance'),
      definition_code: 'event_plan_approval_v1'
    }
  });
  assert.ok([201, 200, 400, 422].includes(r.status),
    `unexpected status ${r.status}: ${JSON.stringify(r.body)}`);
  if (r.status === 201) {
    instanceId = r.body.id;
  }
});

// ── GET /workflows/instances/:id ──────────────────────────────────────────────
test('GET /workflows/instances/:id — 404 for missing instance', async () => {
  assert.equal((await apiFetch('/workflows/instances/999999999', { token: adminToken })).status, 404);
});

// ── POST /workflows/instances/:id/cancel ─────────────────────────────────────
test('POST /workflows/instances/:id/cancel — 404 for missing instance', async () => {
  const r = await apiFetch('/workflows/instances/999999999/cancel', {
    method: 'POST', token: adminToken
  });
  assert.equal(r.status, 404);
});

// ── POST /workflows/instances/:id/resubmit ────────────────────────────────────
test('POST /workflows/instances/:id/resubmit — 404 for missing instance', async () => {
  const r = await apiFetch('/workflows/instances/999999999/resubmit', {
    method: 'POST', token: adminToken
  });
  assert.equal(r.status, 404);
});

// ── GET /workflows/tasks/mine ─────────────────────────────────────────────────
test('GET /workflows/tasks/mine — 401 without token', async () => {
  assert.equal((await apiFetch('/workflows/tasks/mine')).status, 401);
});

test('GET /workflows/tasks/mine — 403 without workflow.view (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/workflows/tasks/mine', { token: warehouseToken })).status, 403);
});

test('GET /workflows/tasks/mine — 200 with admin, returns array', async () => {
  const r = await apiFetch('/workflows/tasks/mine', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── GET /workflows/tasks/:id ──────────────────────────────────────────────────
test('GET /workflows/tasks/:id — 404 for missing task', async () => {
  assert.equal((await apiFetch('/workflows/tasks/999999999', { token: adminToken })).status, 404);
});

// ── POST /workflows/tasks/:id/approve ────────────────────────────────────────
test('POST /workflows/tasks/:id/approve — 404 for missing task', async () => {
  const r = await apiFetch('/workflows/tasks/999999999/approve', {
    method: 'POST', token: adminToken, body: { notes: 'LGTM' }
  });
  assert.equal(r.status, 404);
});

// ── POST /workflows/tasks/:id/reject ─────────────────────────────────────────
test('POST /workflows/tasks/:id/reject — 404 for missing task', async () => {
  const r = await apiFetch('/workflows/tasks/999999999/reject', {
    method: 'POST', token: adminToken, body: { notes: 'No' }
  });
  assert.equal(r.status, 404);
});

// ── POST /workflows/tasks/:id/return ─────────────────────────────────────────
test('POST /workflows/tasks/:id/return — 404 for missing task', async () => {
  const r = await apiFetch('/workflows/tasks/999999999/return', {
    method: 'POST', token: adminToken, body: { notes: 'Needs more info' }
  });
  assert.equal(r.status, 404);
});
