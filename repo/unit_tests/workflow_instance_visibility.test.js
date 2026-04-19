// Unit tests — workflow instance object-level visibility.
// Proves checkInstanceVisibility and the user-filtered listInstances path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkInstanceVisibility, listInstances } from '../src/services/workflow_engine.js';

// ---------------------------------------------------------------------------
// checkInstanceVisibility
// ---------------------------------------------------------------------------
const instance = {
  id: 1,
  initiated_by: 55,
  tasks: [
    { id: 1, assignee_permission: 'approval.approve', status: 'open' }
  ]
};

test('checkInstanceVisibility — initiator can see instance', () => {
  const user = { id: 55, permissions: new Set(['workflow.view']) };
  assert.equal(checkInstanceVisibility(instance, user), true);
});

test('checkInstanceVisibility — assignee permission grants visibility', () => {
  const user = { id: 99, permissions: new Set(['approval.approve']) };
  assert.equal(checkInstanceVisibility(instance, user), true);
});

test('checkInstanceVisibility — non-assignee non-initiator is hidden', () => {
  const user = { id: 99, permissions: new Set(['workflow.view']) };
  assert.equal(checkInstanceVisibility(instance, user), false);
});

test('checkInstanceVisibility — no tasks means only initiator matches', () => {
  const inst = { id: 2, initiated_by: 55, tasks: [] };
  assert.equal(checkInstanceVisibility(inst, { id: 55, permissions: new Set() }), true);
  assert.equal(checkInstanceVisibility(inst, { id: 99, permissions: new Set(['approval.approve']) }), false);
});

test('checkInstanceVisibility — string initiated_by coerced correctly', () => {
  const inst = { id: 3, initiated_by: '55', tasks: [] };
  assert.equal(checkInstanceVisibility(inst, { id: 55, permissions: new Set() }), true);
  assert.equal(checkInstanceVisibility(inst, { id: 56, permissions: new Set() }), false);
});

test('checkInstanceVisibility — multiple tasks, user holds one permission', () => {
  const inst = {
    id: 4,
    initiated_by: 99,
    tasks: [
      { id: 1, assignee_permission: 'approval.approve' },
      { id: 2, assignee_permission: 'finance.sign' }
    ]
  };
  const user = { id: 1, permissions: new Set(['finance.sign']) };
  assert.equal(checkInstanceVisibility(inst, user), true);
});

// ---------------------------------------------------------------------------
// listInstances — user-filtered path
// ---------------------------------------------------------------------------
function makeQueryClient(rows) {
  return {
    query: async () => ({ rows })
  };
}

test('listInstances — no user filter returns all rows', async () => {
  const r = await listInstances(makeQueryClient([{ id: 1 }, { id: 2 }]));
  assert.equal(r.length, 2);
});

test('listInstances — null user (elevated caller) omits visibility subquery', async () => {
  let capturedSql = '';
  const client = { query: async (sql) => { capturedSql = sql; return { rows: [] }; } };
  await listInstances(client, { user: null });
  assert.ok(!capturedSql.includes('EXISTS'), 'elevated path must not add EXISTS visibility subquery');
});

test('listInstances — user filter adds visibility WHERE clause', async () => {
  let capturedSql = '';
  const client = { query: async (sql) => { capturedSql = sql; return { rows: [] }; } };
  const user = { id: 42, permissions: new Set(['approval.approve']) };
  await listInstances(client, { user });
  assert.ok(capturedSql.includes('initiated_by'), 'should include initiator check');
  assert.ok(capturedSql.includes('EXISTS'), 'should use EXISTS subquery for assignee check');
});

test('listInstances — user filter combined with status and entity_type', async () => {
  let capturedSql = '';
  const client = { query: async (sql) => { capturedSql = sql; return { rows: [] }; } };
  const user = { id: 1, permissions: new Set(['workflow.view']) };
  await listInstances(client, { status: 'running', entity_type: 'vendor', user });
  assert.ok(capturedSql.includes('wi.status = $'), 'status filter must be present');
  assert.ok(capturedSql.includes('wi.entity_type = $'), 'entity_type filter must be present');
  assert.ok(capturedSql.includes('initiated_by'), 'visibility filter must be present');
});

test('listInstances — user with empty permissions still adds visibility clause', async () => {
  let capturedSql = '';
  const client = { query: async (sql) => { capturedSql = sql; return { rows: [] }; } };
  const user = { id: 5, permissions: new Set() };
  await listInstances(client, { user });
  assert.ok(capturedSql.includes('initiated_by'), 'visibility clause added even with no perms');
});
