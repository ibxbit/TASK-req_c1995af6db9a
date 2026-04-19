import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch, loginAdmin } from './_helpers.js';

let token;
test.before(async () => { token = await loginAdmin(); });

test('GET /integrations/consistency returns consistent:true after standard setup', async () => {
  const { status, body } = await apiFetch('/integrations/consistency', { token });
  assert.equal(status, 200);
  assert.ok(body.summary);
  assert.equal(body.consistent, true,
    `inconsistent summary: ${JSON.stringify(body.summary)}`);
});

test('audit events include workstation header', async () => {
  await apiFetch('/auth/me', { token });
  const events = await apiFetch('/audit/events?workstation=test-runner&limit=10', { token });
  assert.equal(events.status, 200);
  assert.ok(events.body.length > 0, 'should have at least one event with workstation=test-runner');
  assert.ok(events.body.every((e) => e.workstation === 'test-runner'));
});

test('GET /audit/retention reports append-only policy', async () => {
  const { status, body } = await apiFetch('/audit/retention', { token });
  assert.equal(status, 200);
  assert.equal(body.retention_years, 7);
});
