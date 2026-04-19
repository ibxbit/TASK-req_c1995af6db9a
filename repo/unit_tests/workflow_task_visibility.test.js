// Unit tests — workflow task object-level visibility.
// Proves loadTaskForUser returns 403 for non-assignee non-initiator users.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTaskForUser } from '../src/services/workflow_engine.js';

function makeClient(taskRow) {
  return {
    query: async () => ({ rows: taskRow ? [taskRow] : [] })
  };
}

const taskRow = {
  id: 101,
  instance_id: 42,
  step_id: 7,
  step_name: 'Ops review',
  assignee_permission: 'approval.approve',
  status: 'open',
  decision: null,
  decision_notes: null,
  validation_errors: null,
  due_at: new Date(),
  created_at: new Date(),
  decided_at: null,
  decided_by: null,
  entity_type: 'vendor',
  entity_id: '9',
  initiated_by: 55
};

test('returns the task when user holds the step assignee permission', async () => {
  const user = { id: 1, permissions: new Set(['approval.approve']) };
  const r = await loadTaskForUser(makeClient(taskRow), user, 101);
  assert.equal(r.status, 200);
  assert.equal(r.task.id, 101);
});

test('returns the task to the instance initiator', async () => {
  const user = { id: 55, permissions: new Set(['workflow.view']) };
  const r = await loadTaskForUser(makeClient(taskRow), user, 101);
  assert.equal(r.status, 200);
});

test('returns 403 when user is neither assignee nor initiator', async () => {
  const user = { id: 2, permissions: new Set(['workflow.view']) };
  const r = await loadTaskForUser(makeClient(taskRow), user, 101);
  assert.equal(r.status, 403);
  assert.equal(r.task, undefined);
});

test('allowRoles widens access (e.g. auditor)', async () => {
  const user = { id: 2, permissions: new Set(['workflow.view', 'audit.read']) };
  const r = await loadTaskForUser(makeClient(taskRow), user, 101, {
    allowRoles: ['audit.read']
  });
  assert.equal(r.status, 200);
});

test('returns 404 when task row is absent', async () => {
  const user = { id: 1, permissions: new Set(['approval.approve']) };
  const r = await loadTaskForUser(makeClient(null), user, 999);
  assert.equal(r.status, 404);
});
