// API tests — items list/create/update
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'Items_Secure12!';
let adminToken;
let financeToken; // has finance.read but NOT inventory.write

before(async () => {
  adminToken = await loginAdmin();

  const fName = uniq('item-fin');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: fName, email: `${fName}@local`, full_name: 'Item Fin',
            password: PASS, role_codes: ['FINANCE'] }
  });
  const fLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: fName, password: PASS } });
  assert.equal(fLogin.status, 200);
  financeToken = fLogin.body.token;
});

// ── GET /items ────────────────────────────────────────────────────────────────
test('GET /items — 401 without token', async () => {
  assert.equal((await apiFetch('/items')).status, 401);
});

test('GET /items — 403 without inventory.read (FINANCE has no inventory.read)', async () => {
  assert.equal((await apiFetch('/items', { token: financeToken })).status, 403);
});

test('GET /items — 200 with admin, returns array', async () => {
  const r = await apiFetch('/items', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── POST /items ───────────────────────────────────────────────────────────────
test('POST /items — 401 without token', async () => {
  assert.equal((await apiFetch('/items', { method: 'POST', body: {} })).status, 401);
});

test('POST /items — 403 without inventory.write (FINANCE)', async () => {
  const r = await apiFetch('/items', {
    method: 'POST', token: financeToken,
    body: { sku: 'X', name: 'Y' }
  });
  assert.equal(r.status, 403);
});

test('POST /items — 400 missing sku and name', async () => {
  const r = await apiFetch('/items', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /sku|name/);
});

test('POST /items — 400 invalid safety_threshold', async () => {
  const r = await apiFetch('/items', {
    method: 'POST', token: adminToken,
    body: { sku: uniq('S'), name: 'Bad', safety_threshold: -1 }
  });
  assert.equal(r.status, 400);
});

test('POST /items — 201 happy path', async () => {
  const sku = uniq('SKU-API');
  const r = await apiFetch('/items', {
    method: 'POST', token: adminToken,
    body: { sku, name: 'API Test Item', unit: 'box', safety_threshold: 10 }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.id);
  assert.equal(r.body.sku, sku);
});

// ── PUT /items/:id ────────────────────────────────────────────────────────────
test('PUT /items/:id — 401 without token', async () => {
  assert.equal((await apiFetch('/items/1', { method: 'PUT', body: {} })).status, 401);
});

test('PUT /items/:id — 403 without inventory.write (FINANCE)', async () => {
  const r = await apiFetch('/items/1', {
    method: 'PUT', token: financeToken, body: { name: 'new name' }
  });
  assert.equal(r.status, 403);
});

test('PUT /items/:id — 400 invalid safety_threshold', async () => {
  const item = await apiFetch('/items', {
    method: 'POST', token: adminToken,
    body: { sku: uniq('PUT-SKU'), name: 'Put Test Item' }
  });
  assert.equal(item.status, 201);
  const r = await apiFetch(`/items/${item.body.id}`, {
    method: 'PUT', token: adminToken, body: { safety_threshold: -5 }
  });
  assert.equal(r.status, 400);
});

test('PUT /items/:id — 404 for non-existent item', async () => {
  const r = await apiFetch('/items/999999999', {
    method: 'PUT', token: adminToken, body: { name: 'Missing' }
  });
  assert.equal(r.status, 404);
});

test('PUT /items/:id — 200 happy path updates name and threshold', async () => {
  const item = await apiFetch('/items', {
    method: 'POST', token: adminToken,
    body: { sku: uniq('UPD-SKU'), name: 'Original Name', safety_threshold: 5 }
  });
  assert.equal(item.status, 201);
  const r = await apiFetch(`/items/${item.body.id}`, {
    method: 'PUT', token: adminToken,
    body: { name: 'Updated Name', safety_threshold: 20 }
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'Updated Name');
  assert.equal(Number(r.body.safety_threshold), 20);
});
