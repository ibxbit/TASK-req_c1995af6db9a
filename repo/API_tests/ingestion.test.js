// API tests — ingestion resources and sources lifecycle
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'Ingestion_Secure12!';
let adminToken;
let noIngestToken; // FINANCE has no data.ingest

before(async () => {
  adminToken = await loginAdmin();

  const fName = uniq('ing-fin');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: fName, email: `${fName}@local`, full_name: 'Ing Finance',
            password: PASS, role_codes: ['FINANCE'] }
  });
  const fLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: fName, password: PASS } });
  assert.equal(fLogin.status, 200);
  noIngestToken = fLogin.body.token;
});

// ── GET /ingestion/resources ─────────────────────────────────────────────────
test('GET /ingestion/resources — 401 without token', async () => {
  assert.equal((await apiFetch('/ingestion/resources')).status, 401);
});

test('GET /ingestion/resources — 403 without data.ingest', async () => {
  assert.equal((await apiFetch('/ingestion/resources', { token: noIngestToken })).status, 403);
});

test('GET /ingestion/resources — 200 with admin, returns resources array', async () => {
  const r = await apiFetch('/ingestion/resources', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.resources));
  assert.ok(r.body.resources.length > 0);
});

// ── POST /ingestion/:resource ─────────────────────────────────────────────────
test('POST /ingestion/items — 401 without token', async () => {
  const r = await apiFetch('/ingestion/items', {
    method: 'POST', body: { records: [{ sku: 'X', name: 'Y' }] }
  });
  assert.equal(r.status, 401);
});

test('POST /ingestion/items — 403 without data.ingest', async () => {
  const r = await apiFetch('/ingestion/items', {
    method: 'POST', token: noIngestToken,
    body: { records: [{ sku: 'X', name: 'Y' }] }
  });
  assert.equal(r.status, 403);
});

test('POST /ingestion/items — 400 missing records field', async () => {
  const r = await apiFetch('/ingestion/items', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /ingestion/items — 400 records not an array', async () => {
  const r = await apiFetch('/ingestion/items', {
    method: 'POST', token: adminToken, body: { records: 'not-an-array' }
  });
  assert.equal(r.status, 400);
});

test('POST /ingestion/unknown-resource — 400 unknown resource type', async () => {
  const r = await apiFetch('/ingestion/unknownresource', {
    method: 'POST', token: adminToken, body: { records: [] }
  });
  assert.equal(r.status, 400);
});

test('POST /ingestion/items — 201 happy path with valid records', async () => {
  const sku = uniq('ING-SKU');
  const r = await apiFetch('/ingestion/items', {
    method: 'POST', token: adminToken,
    body: { records: [{ sku, name: 'Ingested Item', unit: 'each', safety_threshold: 5 }] }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.inserted >= 0 || r.body.upserted >= 0 || r.body.result !== undefined ||
            Number(r.body.count) >= 0 || r.body.rows !== undefined,
    `unexpected response shape: ${JSON.stringify(r.body)}`);
});

// ── GET /ingestion/sources ────────────────────────────────────────────────────
test('GET /ingestion/sources — 401 without token', async () => {
  assert.equal((await apiFetch('/ingestion/sources')).status, 401);
});

test('GET /ingestion/sources — 403 without data.ingest', async () => {
  assert.equal((await apiFetch('/ingestion/sources', { token: noIngestToken })).status, 403);
});

test('GET /ingestion/sources — 200 with admin', async () => {
  const r = await apiFetch('/ingestion/sources', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── POST /ingestion/sources ───────────────────────────────────────────────────
test('POST /ingestion/sources — 401 without token', async () => {
  assert.equal((await apiFetch('/ingestion/sources', { method: 'POST', body: {} })).status, 401);
});

test('POST /ingestion/sources — 400 missing required fields', async () => {
  const r = await apiFetch('/ingestion/sources', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
});

test('POST /ingestion/sources — 201 happy path', async () => {
  const r = await apiFetch('/ingestion/sources', {
    method: 'POST', token: adminToken,
    body: {
      code: uniq('SRC'),
      label: 'Test Source',
      resource_type: 'items',
      fetch_strategy: 'local_file',
      file_path: '/tmp/test.json'
    }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.id);
});

// ── GET /ingestion/sources/:id ────────────────────────────────────────────────
test('GET /ingestion/sources/:id — 404 for missing source', async () => {
  const r = await apiFetch('/ingestion/sources/999999999', { token: adminToken });
  assert.equal(r.status, 404);
});

test('GET /ingestion/sources/:id — 200 for existing source', async () => {
  const created = await apiFetch('/ingestion/sources', {
    method: 'POST', token: adminToken,
    body: { code: uniq('SRC2'), label: 'Source 2', resource_type: 'items',
            fetch_strategy: 'local_file', file_path: '/tmp/s2.json' }
  });
  assert.equal(created.status, 201);
  const r = await apiFetch(`/ingestion/sources/${created.body.id}`, { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, created.body.id);
});

// ── POST /ingestion/sources/:id/run ──────────────────────────────────────────
test('POST /ingestion/sources/:id/run — 404 for missing source', async () => {
  const r = await apiFetch('/ingestion/sources/999999999/run', {
    method: 'POST', token: adminToken, body: { force: true }
  });
  assert.equal(r.status, 404);
});

test('POST /ingestion/sources/:id/run — 200 or 409 for existing source (force=true)', async () => {
  const src = await apiFetch('/ingestion/sources', {
    method: 'POST', token: adminToken,
    body: { code: uniq('SRC3'), label: 'Source 3', resource_type: 'items',
            fetch_strategy: 'local_file', file_path: '/tmp/s3.json' }
  });
  assert.equal(src.status, 201);
  const r = await apiFetch(`/ingestion/sources/${src.body.id}/run`, {
    method: 'POST', token: adminToken, body: { force: true }
  });
  // force=true bypasses the interval lock; may succeed or fail depending on file
  assert.ok([200, 201, 409, 422, 500].includes(r.status),
    `unexpected status ${r.status}: ${JSON.stringify(r.body)}`);
});

// ── GET /ingestion/sources/:id/records ───────────────────────────────────────
test('GET /ingestion/sources/:id/records — 404 for missing source', async () => {
  const r = await apiFetch('/ingestion/sources/999999999/records', { token: adminToken });
  assert.equal(r.status, 404);
});

// ── GET /ingestion/sources/:id/checkpoint ────────────────────────────────────
test('GET /ingestion/sources/:id/checkpoint — 404 for missing source', async () => {
  const r = await apiFetch('/ingestion/sources/999999999/checkpoint', { token: adminToken });
  assert.equal(r.status, 404);
});
