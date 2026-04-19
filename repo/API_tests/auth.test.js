import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, adminUser, adminPass } from './_helpers.js';

test('GET /health returns ok', async () => {
  const { status, body } = await apiFetch('/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
});

test('POST /auth/login with bad creds returns 401', async () => {
  const { status, body } = await apiFetch('/auth/login', {
    method: 'POST', body: { username: adminUser, password: 'wrong-password-definitely' }
  });
  assert.equal(status, 401);
  assert.equal(body.error, 'Invalid credentials');
});

test('POST /auth/login with missing fields returns 400', async () => {
  const { status } = await apiFetch('/auth/login', {
    method: 'POST', body: { username: adminUser }
  });
  assert.equal(status, 400);
});

test('POST /auth/login with correct creds returns a JWT', async () => {
  const { status, body } = await apiFetch('/auth/login', {
    method: 'POST', body: { username: adminUser, password: adminPass }
  });
  assert.equal(status, 200);
  assert.ok(typeof body.token === 'string' && body.token.length > 20);
});

test('GET /auth/me without token returns 401', async () => {
  const { status } = await apiFetch('/auth/me');
  assert.equal(status, 401);
});

test('GET /auth/me with valid token returns user profile + permissions', async () => {
  const loginRes = await apiFetch('/auth/login', {
    method: 'POST', body: { username: adminUser, password: adminPass }
  });
  const token = loginRes.body.token;
  const { status, body } = await apiFetch('/auth/me', { token });
  assert.equal(status, 200);
  assert.equal(body.username, adminUser);
  assert.ok(Array.isArray(body.permissions));
  assert.ok(body.permissions.includes('user.manage'), 'admin must hold user.manage');
});
