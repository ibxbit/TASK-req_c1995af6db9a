import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin, uniq } from './_helpers.js';

let adminToken;
let recruiterToken;
let recruiterUsername;
const recruiterPass = 'RecruiterOnly_1234';

before(async () => {
  adminToken = await loginAdmin();

  // Create a recruiter user (idempotent enough via unique name)
  recruiterUsername = uniq('recruiter');
  const created = await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: {
      username: recruiterUsername,
      email: `${recruiterUsername}@local`,
      full_name: 'API Test Recruiter',
      password: recruiterPass,
      role_codes: ['RECRUITER']
    }
  });
  assert.equal(created.status, 201, `create recruiter: ${JSON.stringify(created.body)}`);

  const login = await apiFetch('/auth/login', {
    method: 'POST', body: { username: recruiterUsername, password: recruiterPass }
  });
  assert.equal(login.status, 200);
  recruiterToken = login.body.token;
});

test('GET /admin/users with admin token succeeds', async () => {
  const { status } = await apiFetch('/admin/users', { token: adminToken });
  assert.equal(status, 200);
});

test('GET /admin/users with recruiter token is forbidden', async () => {
  const { status, body } = await apiFetch('/admin/users', { token: recruiterToken });
  assert.equal(status, 403);
  assert.equal(body.error, 'Forbidden');
});

test('GET /finance/transactions with recruiter token is forbidden (no finance.read)', async () => {
  const { status } = await apiFetch('/finance/transactions', { token: recruiterToken });
  assert.equal(status, 403);
});

test('rejects weak password on user creation', async () => {
  const { status, body } = await apiFetch('/admin/users', {
    method: 'POST', token: adminToken,
    body: {
      username: uniq('weakpw'),
      email: 'weak@local',
      full_name: 'Weak',
      password: 'short',
      role_codes: []
    }
  });
  assert.equal(status, 400);
  assert.match(body.error, /at least 12/);
});

test('GET /admin/audit (AUDIT_READ) requires that permission', async () => {
  const r = await apiFetch('/admin/audit', { token: recruiterToken });
  assert.equal(r.status, 403);
  const a = await apiFetch('/admin/audit', { token: adminToken });
  assert.equal(a.status, 200);
  assert.ok(Array.isArray(a.body));
});
