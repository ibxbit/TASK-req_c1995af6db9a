// API tests — payments read endpoints: receipts, refunds, stages, intake, reconciliation
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'PayRead_Secure12!';
let adminToken;
let warehouseToken; // no order.read or payment.collect
let txFilename;
let cbFilename;

before(async () => {
  adminToken = await loginAdmin();

  const wName = uniq('pay-wh');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: wName, email: `${wName}@local`, full_name: 'Pay WH',
            password: PASS, role_codes: ['WAREHOUSE'] }
  });
  const wLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: wName, password: PASS } });
  warehouseToken = wLogin.body.token;

  // Create temp WeChat import files for handler-path tests.
  // The backend reads from WECHAT_IMPORT_DIR; empty arrays produce a valid 201 with totals.
  const wechatDir = process.env.WECHAT_IMPORT_DIR || '/app/wechat_imports';
  fs.mkdirSync(wechatDir, { recursive: true });
  txFilename = `test-tx-${Date.now()}.json`;
  cbFilename = `test-cb-${Date.now()}.json`;
  fs.writeFileSync(path.join(wechatDir, txFilename), JSON.stringify({ transactions: [] }));
  fs.writeFileSync(path.join(wechatDir, cbFilename), JSON.stringify({ callbacks: [] }));
});

// ── GET /payments/receipts ────────────────────────────────────────────────────
test('GET /payments/receipts — 401 without token', async () => {
  assert.equal((await apiFetch('/payments/receipts')).status, 401);
});

test('GET /payments/receipts — 403 without order.read (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/payments/receipts', { token: warehouseToken })).status, 403);
});

test('GET /payments/receipts — 200 with admin, returns array', async () => {
  const r = await apiFetch('/payments/receipts', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── GET /payments/refunds ─────────────────────────────────────────────────────
test('GET /payments/refunds — 401 without token', async () => {
  assert.equal((await apiFetch('/payments/refunds')).status, 401);
});

test('GET /payments/refunds — 403 without order.read (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/payments/refunds', { token: warehouseToken })).status, 403);
});

test('GET /payments/refunds — 200 with admin, returns array', async () => {
  const r = await apiFetch('/payments/refunds', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── GET /payments/stages/:stageId ─────────────────────────────────────────────
test('GET /payments/stages/:stageId — 401 without token', async () => {
  assert.equal((await apiFetch('/payments/stages/1')).status, 401);
});

test('GET /payments/stages/:stageId — 404 for missing stage', async () => {
  assert.equal((await apiFetch('/payments/stages/999999999', { token: adminToken })).status, 404);
});

// ── GET /payments/intake ──────────────────────────────────────────────────────
test('GET /payments/intake — 401 without token', async () => {
  assert.equal((await apiFetch('/payments/intake')).status, 401);
});

test('GET /payments/intake — 403 without payment.collect (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/payments/intake', { token: warehouseToken })).status, 403);
});

test('GET /payments/intake — 200 with admin, returns array', async () => {
  const r = await apiFetch('/payments/intake', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── GET /payments/intake/:id ──────────────────────────────────────────────────
test('GET /payments/intake/:id — 401 without token', async () => {
  assert.equal((await apiFetch('/payments/intake/1')).status, 401);
});

test('GET /payments/intake/:id — 404 for missing intake', async () => {
  assert.equal((await apiFetch('/payments/intake/999999999', { token: adminToken })).status, 404);
});

test('GET /payments/intake/:id — 200 for created intake', async () => {
  const created = await apiFetch('/payments/intake', {
    method: 'POST', token: adminToken,
    body: { method: 'cash', external_id: uniq('INT-READ'), amount_cents: 1000 }
  });
  assert.equal(created.status, 201);
  const id = created.body.intake?.id || created.body.id;
  const r = await apiFetch(`/payments/intake/${id}`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(r.body.id || r.body.intake);
});

// ── POST /payments/intake — basic 400/201 ─────────────────────────────────────
test('POST /payments/intake — 401 without token', async () => {
  assert.equal((await apiFetch('/payments/intake', { method: 'POST', body: {} })).status, 401);
});

test('POST /payments/intake — 400 missing required fields', async () => {
  const r = await apiFetch('/payments/intake', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

// ── POST /payments/intake/sweep-retries ───────────────────────────────────────
test('POST /payments/intake/sweep-retries — 401 without token', async () => {
  assert.equal((await apiFetch('/payments/intake/sweep-retries', { method: 'POST' })).status, 401);
});

test('POST /payments/intake/sweep-retries — 200 with admin', async () => {
  const r = await apiFetch('/payments/intake/sweep-retries', {
    method: 'POST', token: adminToken
  });
  assert.equal(r.status, 200, `sweep-retries status ${r.status}: ${JSON.stringify(r.body)}`);
  assert.equal(typeof r.body.processed, 'number', 'response should include numeric processed count');
  assert.ok(Array.isArray(r.body.results), 'response should include results array');
});

// ── POST /payments/wechat/import-transactions ─────────────────────────────────
test('POST /payments/wechat/import-transactions — 401 without token', async () => {
  assert.equal((await apiFetch('/payments/wechat/import-transactions', { method: 'POST', body: {} })).status, 401);
});

test('POST /payments/wechat/import-transactions — 400 missing filename', async () => {
  const r = await apiFetch('/payments/wechat/import-transactions', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /payments/wechat/import-transactions — 201 empty transactions file', async () => {
  const r = await apiFetch('/payments/wechat/import-transactions', {
    method: 'POST', token: adminToken,
    body: { filename: txFilename }
  });
  assert.equal(r.status, 201, `unexpected status ${r.status}: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.filename, txFilename, 'response filename should match request');
  assert.equal(typeof r.body.totals, 'object', 'response should include totals object');
  assert.equal(r.body.totals.received, 0, 'empty file should have 0 received');
  assert.ok(Array.isArray(r.body.imported), 'response should include imported array');
  assert.ok(Array.isArray(r.body.rejected), 'response should include rejected array');
});

// ── POST /payments/wechat/import-callbacks ────────────────────────────────────
test('POST /payments/wechat/import-callbacks — 401 without token', async () => {
  assert.equal((await apiFetch('/payments/wechat/import-callbacks', { method: 'POST', body: {} })).status, 401);
});

test('POST /payments/wechat/import-callbacks — 400 missing filename', async () => {
  const r = await apiFetch('/payments/wechat/import-callbacks', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /payments/wechat/import-callbacks — 201 empty callbacks file', async () => {
  const r = await apiFetch('/payments/wechat/import-callbacks', {
    method: 'POST', token: adminToken,
    body: { filename: cbFilename }
  });
  assert.equal(r.status, 201, `unexpected status ${r.status}: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.filename, cbFilename, 'response filename should match request');
  assert.equal(typeof r.body.totals, 'object', 'response should include totals object');
  assert.equal(r.body.totals.received, 0, 'empty file should have 0 received');
  assert.ok(Array.isArray(r.body.applied), 'response should include applied array');
});

// ── GET /payments/reconciliation ──────────────────────────────────────────────
test('GET /payments/reconciliation — 401 without token', async () => {
  assert.equal((await apiFetch('/payments/reconciliation')).status, 401);
});

test('GET /payments/reconciliation — 403 without audit.read (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/payments/reconciliation', { token: warehouseToken })).status, 403);
});

test('GET /payments/reconciliation — 200 with admin', async () => {
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const r = await apiFetch(`/payments/reconciliation?from=${from}&to=${to}`, { token: adminToken });
  assert.equal(r.status, 200, `reconciliation status ${r.status}: ${JSON.stringify(r.body)}`);
  assert.ok(r.body !== null && typeof r.body === 'object' && !Array.isArray(r.body),
    `expected object response, got: ${JSON.stringify(r.body)}`);
});
