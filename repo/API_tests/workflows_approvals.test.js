// API tests — workflows/approvals CRUD + approve/reject/cancel
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'Approvals_Secure12!';
let adminToken;
let warehouseToken; // no approval.submit
let approverToken;  // has approval.approve/reject

before(async () => {
  adminToken = await loginAdmin();

  const wName = uniq('appr-wh');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: wName, email: `${wName}@local`, full_name: 'Appr WH',
            password: PASS, role_codes: ['WAREHOUSE'] }
  });
  const wLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: wName, password: PASS } });
  warehouseToken = wLogin.body.token;

  const aName = uniq('appr-appr');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: aName, email: `${aName}@local`, full_name: 'Approver User',
            password: PASS, role_codes: ['APPROVER'] }
  });
  const aLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: aName, password: PASS } });
  approverToken = aLogin.body.token;
});

// ── GET /workflows/approvals ──────────────────────────────────────────────────
test('GET /workflows/approvals — 401 without token', async () => {
  assert.equal((await apiFetch('/workflows/approvals')).status, 401);
});

test('GET /workflows/approvals — 403 without approval.submit (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/workflows/approvals', { token: warehouseToken })).status, 403);
});

test('GET /workflows/approvals — 200 with admin, returns array', async () => {
  const r = await apiFetch('/workflows/approvals', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── POST /workflows/approvals ─────────────────────────────────────────────────
test('POST /workflows/approvals — 401 without token', async () => {
  assert.equal((await apiFetch('/workflows/approvals', { method: 'POST', body: {} })).status, 401);
});

test('POST /workflows/approvals — 400 missing required fields', async () => {
  const r = await apiFetch('/workflows/approvals', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /workflows/approvals — 201 happy path', async () => {
  const r = await apiFetch('/workflows/approvals', {
    method: 'POST', token: adminToken,
    body: { entity_type: 'event', entity_id: 1, summary: uniq('Approval request') }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.id);
  assert.equal(r.body.status, 'pending');
});

// ── GET /workflows/approvals/:id ──────────────────────────────────────────────
test('GET /workflows/approvals/:id — 404 for missing approval', async () => {
  assert.equal((await apiFetch('/workflows/approvals/999999999', { token: adminToken })).status, 404);
});

test('GET /workflows/approvals/:id — 200 for existing approval', async () => {
  const created = await apiFetch('/workflows/approvals', {
    method: 'POST', token: adminToken,
    body: { entity_type: 'event', entity_id: 1, summary: uniq('Get test') }
  });
  assert.equal(created.status, 201);
  const r = await apiFetch(`/workflows/approvals/${created.body.id}`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, created.body.id);
});

// ── POST /workflows/approvals/:id/approve ────────────────────────────────────
test('POST /workflows/approvals/:id/approve — 401 without token', async () => {
  assert.equal((await apiFetch('/workflows/approvals/1/approve', { method: 'POST' })).status, 401);
});

test('POST /workflows/approvals/:id/approve — 404 for missing approval', async () => {
  const r = await apiFetch('/workflows/approvals/999999999/approve', {
    method: 'POST', token: adminToken, body: { notes: 'LGTM' }
  });
  assert.equal(r.status, 404);
});

test('POST /workflows/approvals/:id/approve — 200 happy path', async () => {
  const created = await apiFetch('/workflows/approvals', {
    method: 'POST', token: adminToken,
    body: { entity_type: 'event', entity_id: 1, summary: uniq('Approve test') }
  });
  assert.equal(created.status, 201);
  const r = await apiFetch(`/workflows/approvals/${created.body.id}/approve`, {
    method: 'POST', token: adminToken, body: { notes: 'Approved in test' }
  });
  assert.ok([200, 201].includes(r.status), `status ${r.status}: ${JSON.stringify(r.body)}`);
});

// ── POST /workflows/approvals/:id/reject ─────────────────────────────────────
test('POST /workflows/approvals/:id/reject — 404 for missing approval', async () => {
  const r = await apiFetch('/workflows/approvals/999999999/reject', {
    method: 'POST', token: adminToken, body: { notes: 'Not approved' }
  });
  assert.equal(r.status, 404);
});

test('POST /workflows/approvals/:id/reject — 200 happy path', async () => {
  const created = await apiFetch('/workflows/approvals', {
    method: 'POST', token: adminToken,
    body: { entity_type: 'event', entity_id: 1, summary: uniq('Reject test') }
  });
  assert.equal(created.status, 201);
  const r = await apiFetch(`/workflows/approvals/${created.body.id}/reject`, {
    method: 'POST', token: adminToken, body: { notes: 'Rejected in test' }
  });
  assert.ok([200, 201].includes(r.status), `status ${r.status}: ${JSON.stringify(r.body)}`);
});

// ── POST /workflows/approvals/:id/cancel ─────────────────────────────────────
test('POST /workflows/approvals/:id/cancel — 404 for missing approval', async () => {
  const r = await apiFetch('/workflows/approvals/999999999/cancel', {
    method: 'POST', token: adminToken
  });
  assert.equal(r.status, 404);
});

test('POST /workflows/approvals/:id/cancel — 200 happy path', async () => {
  const created = await apiFetch('/workflows/approvals', {
    method: 'POST', token: adminToken,
    body: { entity_type: 'event', entity_id: 1, summary: uniq('Cancel test') }
  });
  assert.equal(created.status, 201);
  const r = await apiFetch(`/workflows/approvals/${created.body.id}/cancel`, {
    method: 'POST', token: adminToken
  });
  assert.ok([200, 201].includes(r.status), `status ${r.status}: ${JSON.stringify(r.body)}`);
});
