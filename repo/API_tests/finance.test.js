// API tests — finance transactions endpoint
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

const PASS = 'Finance_Secure12!';
let adminToken;
let financeToken;

before(async () => {
  adminToken = await loginAdmin();

  // FINANCE role: finance.read + data.city.all
  const fName = uniq('fin-user');
  await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: { username: fName, email: `${fName}@local`, full_name: 'Finance Analyst',
            password: PASS, role_codes: ['FINANCE'] }
  });
  const fLogin = await apiFetch('/auth/login', { method: 'POST', body: { username: fName, password: PASS } });
  assert.equal(fLogin.status, 200, `FINANCE login failed: ${JSON.stringify(fLogin.body)}`);
  financeToken = fLogin.body.token;
});

// ── GET /finance/transactions ─────────────────────────────────────────────────
test('GET /finance/transactions — 401 without token', async () => {
  assert.equal((await apiFetch('/finance/transactions')).status, 401);
});

test('GET /finance/transactions — 200 with admin, returns array', async () => {
  const r = await apiFetch('/finance/transactions', { token: adminToken });
  assert.equal(r.status, 200, `unexpected status ${r.status}: ${JSON.stringify(r.body)}`);
  assert.ok(Array.isArray(r.body), `expected array response, got: ${JSON.stringify(r.body)}`);
});

test('GET /finance/transactions — 200 with FINANCE role (data.city.all scope), returns array', async () => {
  const r = await apiFetch('/finance/transactions', { token: financeToken });
  assert.equal(r.status, 200, `unexpected status ${r.status}: ${JSON.stringify(r.body)}`);
  assert.ok(Array.isArray(r.body), `expected array response, got: ${JSON.stringify(r.body)}`);
});
