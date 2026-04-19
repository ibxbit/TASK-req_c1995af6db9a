// API tests — candidates CRUD
// Covers GET /candidates, POST /candidates (happy, 400, 401, 403, city-scope)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'Candidates_Secure12!';
let adminToken;
let recruiterToken; // has candidate.read/write, data.city.assigned (NYC)
let warehouseToken; // no candidate.read

before(async () => {
  adminToken = await loginAdmin();

  // RECRUITER with NYC scope
  const rName = uniq('cand-rec');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: rName, email: `${rName}@local`, full_name: 'Cand Rec',
            password: PASS, role_codes: ['RECRUITER'], city_codes: ['NYC'] }
  });
  const rLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: rName, password: PASS } });
  assert.equal(rLogin.status, 200);
  recruiterToken = rLogin.body.token;

  // WAREHOUSE — no candidate.read
  const wName = uniq('cand-wh');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: wName, email: `${wName}@local`, full_name: 'Cand WH',
            password: PASS, role_codes: ['WAREHOUSE'] }
  });
  const wLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: wName, password: PASS } });
  assert.equal(wLogin.status, 200);
  warehouseToken = wLogin.body.token;
});

// ── GET /candidates ───────────────────────────────────────────────────────────
test('GET /candidates — 401 without token', async () => {
  assert.equal((await apiFetch('/candidates')).status, 401);
});

test('GET /candidates — 403 without candidate.read (WAREHOUSE)', async () => {
  assert.equal((await apiFetch('/candidates', { token: warehouseToken })).status, 403);
});

test('GET /candidates — 200 with admin, returns array', async () => {
  const r = await apiFetch('/candidates', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

test('GET /candidates — 200 with city-scoped recruiter, returns filtered list', async () => {
  const r = await apiFetch('/candidates', { token: recruiterToken });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body));
});

// ── POST /candidates ──────────────────────────────────────────────────────────
test('POST /candidates — 401 without token', async () => {
  const r = await apiFetch('/candidates', {
    method: 'POST', body: { city_id: 1, full_name: 'Test' }
  });
  assert.equal(r.status, 401);
});

test('POST /candidates — 403 without candidate.write (WAREHOUSE)', async () => {
  const r = await apiFetch('/candidates', {
    method: 'POST', token: warehouseToken,
    body: { city_id: 1, full_name: 'Test' }
  });
  assert.equal(r.status, 403);
});

test('POST /candidates — 400 missing required fields', async () => {
  const r = await apiFetch('/candidates', {
    method: 'POST', token: adminToken, body: {}
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /city_id|full_name/);
});

test('POST /candidates — 400 missing full_name', async () => {
  const r = await apiFetch('/candidates', {
    method: 'POST', token: adminToken, body: { city_id: 1 }
  });
  assert.equal(r.status, 400);
});

test('POST /candidates — 201 happy path (admin)', async () => {
  const r = await apiFetch('/candidates', {
    method: 'POST', token: adminToken,
    body: { city_id: 1, full_name: uniq('Alice Test'), email: 'alice@test.local', status: 'new' }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.id);
  assert.equal(Number(r.body.city_id), 1);
});

test('POST /candidates — 201 from recruiter for in-scope city (NYC=1)', async () => {
  const r = await apiFetch('/candidates', {
    method: 'POST', token: recruiterToken,
    body: { city_id: 1, full_name: uniq('Scoped Cand') }
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

test('POST /candidates — 403 from recruiter for out-of-scope city (SFO=2)', async () => {
  const r = await apiFetch('/candidates', {
    method: 'POST', token: recruiterToken,
    body: { city_id: 2, full_name: 'Out Of Scope' }
  });
  assert.equal(r.status, 403);
});
