// Unit tests — services/workflow_engine.js
// Covers rules engine, createDefinition, loadDefinition, resolveDefinition,
// initiateInstance, loadInstance, listInstances, decideTask (approve/reject/return),
// resubmitInstance, cancelInstance, listTasksForUser, loadTaskForUser,
// archiveOldWorkflows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from './_fakes.js';
import {
  evaluateRules,
  createDefinition,
  loadDefinition,
  initiateInstance,
  loadInstance,
  listInstances,
  decideTask,
  resubmitInstance,
  cancelInstance,
  listTasksForUser,
  loadTaskForUser,
  archiveOldWorkflows
} from '../src/services/workflow_engine.js';

test('evaluateRules — non-array is noop', () => {
  assert.deepEqual(evaluateRules(null, {}), []);
});

test('evaluateRules — required/equals/lte/gte/regex/unknown', () => {
  const rules = [
    { field: 'name', op: 'required' },
    { field: 'flag', op: 'equals', value: 'yes' },
    { field: 'n',    op: 'lte', value: 10 },
    { field: 'm',    op: 'gte', value: 1 },
    { field: 'email',op: 'regex', value: '^\\S+@\\S+$' },
    { field: 'x',    op: 'mystery' }
  ];
  const e = evaluateRules(rules, { flag: 'no', n: 20, m: 0, email: 'bad' });
  assert.ok(e.length >= 5);
  const empty = evaluateRules(rules, { name: 'n', flag: 'yes', n: 5, m: 2, email: 'a@b' });
  assert.ok(empty.some((msg) => /mystery/.test(msg)));
});

test('createDefinition validates inputs', async () => {
  const c = makeClient([]);
  await assert.rejects(() => createDefinition(c, 1, { entity_type: 'v', steps: [{ name: 'a', assignee_permission: 'p' }] }), /code and entity_type/);
  await assert.rejects(() => createDefinition(c, 1, { code: 'c', entity_type: 'v' }), /steps/);

  // Step validation happens after INSERT, so supply a client that passes the insert.
  const c2 = makeClient([
    { match: /INSERT INTO core\.workflow_definition/, rows: [{ id: 1 }] }
  ]);
  await assert.rejects(() => createDefinition(c2, 1, { code: 'c', entity_type: 'v', steps: [{}] }), /step\[0\]/);
});

test('createDefinition inserts def + steps and loads back', async () => {
  const c = makeClient([
    { match: /INSERT INTO core\.workflow_definition/, rows: [{ id: 7, code: 'c', version: 1, entity_type: 'v', description: 'd', is_active: true, created_at: new Date() }] },
    { match: /INSERT INTO core\.workflow_step/, rows: [] },
    { match: /FROM core\.workflow_definition WHERE id = \$1/, rows: [{ id: 7, code: 'c', version: 1, entity_type: 'v', description: 'd', is_active: true, created_at: new Date() }] },
    { match: /FROM core\.workflow_step WHERE definition_id/, rows: [{ id: 1, sequence: 1, name: 'step', assignee_permission: 'p', sla_hours: 72, validation_rules: null }] }
  ]);
  const d = await createDefinition(c, 1, { code: 'c', entity_type: 'v', description: 'd', steps: [
    { name: 's1', assignee_permission: 'p1' },
    { name: 's2', assignee_permission: 'p2', sequence: 5, sla_hours: 10, validation_rules: [{ field: 'x', op: 'required' }] }
  ]});
  assert.equal(d.id, 7);
});

test('loadDefinition returns null when missing', async () => {
  const c = makeClient([{ match: /FROM core\.workflow_definition/, rows: [] }]);
  assert.equal(await loadDefinition(c, 99), null);
});

test('initiateInstance — validation + definition resolution', async () => {
  // Missing inputs
  const c0 = makeClient([]);
  await assert.rejects(() => initiateInstance(c0, 1, {}), /entity_type and entity_id/);

  // No active definition found (by id)
  const c1 = makeClient([
    { match: /FROM core\.workflow_definition WHERE id = \$1 AND is_active/, rows: [] }
  ]);
  await assert.rejects(() => initiateInstance(c1, 1, { entity_type: 'v', entity_id: '1', definition_id: 10 }), /No active workflow definition/);

  // No active definition by code
  const c2 = makeClient([
    { match: /FROM core\.workflow_definition\s+WHERE code = \$1 AND is_active/, rows: [] }
  ]);
  await assert.rejects(() => initiateInstance(c2, 1, { entity_type: 'v', entity_id: '1', definition_code: 'x' }), /No active workflow definition/);

  // Definition resolved but has no steps
  const c3 = makeClient([
    { match: /FROM core\.workflow_definition WHERE id = \$1 AND is_active/, rows: [{ id: 1 }] },
    { match: /FROM core\.workflow_step WHERE definition_id = \$1\s+ORDER BY sequence LIMIT 1/, rows: [] }
  ]);
  await assert.rejects(() => initiateInstance(c3, 1, { entity_type: 'v', entity_id: '1', definition_id: 1 }), /no steps/);
});

test('initiateInstance — happy path creates instance + first task', async () => {
  const c = makeClient([
    { match: /FROM core\.workflow_definition WHERE id = \$1 AND is_active/, rows: [{ id: 1 }] },
    { match: /FROM core\.workflow_step WHERE definition_id = \$1\s+ORDER BY sequence LIMIT 1/, rows: [{ id: 10, sequence: 1, name: 'approve', assignee_permission: 'approval.approve', sla_hours: 72, validation_rules: null }] },
    { match: /INSERT INTO core\.workflow_instance/, rows: [{ id: 99, definition_id: 1, entity_type: 'v', entity_id: '9', status: 'running', current_step_id: 10, initiated_at: new Date() }] },
    { match: /INSERT INTO core\.workflow_task/, rows: [{ id: 1, due_at: new Date() }] },
    // loadInstance aggregates
    { match: /FROM core\.workflow_instance wi\s+JOIN core\.workflow_definition wd/, rows: [{ id: 99, definition_id: 1, definition_code: 'c', entity_type: 'v', entity_id: '9', status: 'running' }] },
    { match: /FROM core\.workflow_task wt\s+JOIN core\.workflow_step ws/, rows: [] }
  ]);
  const inst = await initiateInstance(c, 1, { entity_type: 'v', entity_id: 9, summary: 's', payload: { x: 1 }, definition_id: 1 });
  assert.equal(inst.id, 99);
});

test('loadInstance returns null when not found', async () => {
  const c = makeClient([{ match: /FROM core\.workflow_instance wi/, rows: [] }]);
  assert.equal(await loadInstance(c, 1), null);
});

test('listInstances — filters + limit', async () => {
  const c = makeClient([{ match: /FROM core\.workflow_instance wi/, rows: [{ id: 1 }] }]);
  const r = await listInstances(c, { status: 'running', entity_type: 'v', limit: 10 });
  assert.equal(r.length, 1);
});

test('listInstances — no filters', async () => {
  const c = makeClient([{ match: /FROM core\.workflow_instance wi/, rows: [] }]);
  const r = await listInstances(c);
  assert.equal(r.length, 0);
});

test('decideTask — bad decision / missing task / wrong statuses / missing permission', async () => {
  await assert.rejects(
    () => decideTask(makeClient([]), { id: 1, permissions: new Set() }, 1, 'invalid'),
    /decision must be/
  );

  const none = makeClient([{ match: /FOR UPDATE/, rows: [] }]);
  await assert.rejects(
    () => decideTask(none, { id: 1, permissions: new Set() }, 1, 'approved'),
    /Task not found/
  );

  const closedTask = makeClient([{ match: /FOR UPDATE/, rows: [{ id: 1, instance_id: 1, step_id: 1, status: 'completed', sequence: 1, assignee_permission: 'p', instance_payload: null, instance_status: 'running', definition_id: 1 }] }]);
  await assert.rejects(() => decideTask(closedTask, { id: 1, permissions: new Set(['p']) }, 1, 'approved'), /Task is completed/);

  const closedInst = makeClient([{ match: /FOR UPDATE/, rows: [{ id: 1, instance_id: 1, step_id: 1, status: 'open', sequence: 1, assignee_permission: 'p', instance_payload: null, instance_status: 'approved', definition_id: 1 }] }]);
  await assert.rejects(() => decideTask(closedInst, { id: 1, permissions: new Set(['p']) }, 1, 'approved'), /Instance is approved/);

  const noPerm = makeClient([{ match: /FOR UPDATE/, rows: [{ id: 1, instance_id: 1, step_id: 1, status: 'open', sequence: 1, assignee_permission: 'p', instance_payload: null, instance_status: 'running', definition_id: 1 }] }]);
  await assert.rejects(() => decideTask(noPerm, { id: 1, permissions: new Set() }, 1, 'approved'), /required to decide/);
});

test('decideTask — approved closes instance when no next step', async () => {
  const c = makeClient([
    { match: /FOR UPDATE/, rows: [{ id: 1, instance_id: 1, step_id: 1, status: 'open', sequence: 1, assignee_permission: 'p', instance_payload: {}, instance_status: 'running', definition_id: 1, validation_rules: null }] },
    { match: /UPDATE core\.workflow_task/, rows: [] },
    { match: /FROM core\.workflow_step\s+WHERE definition_id = \$1 AND sequence > \$2/, rows: [] },
    { match: /UPDATE core\.workflow_instance\s+SET status = \$2/, rows: [] }
  ]);
  const r = await decideTask(c, { id: 1, permissions: new Set(['p']) }, 1, 'approved');
  assert.equal(r.instance_status, 'approved');
});

test('decideTask — approved advances to next step', async () => {
  const c = makeClient([
    { match: /FOR UPDATE/, rows: [{ id: 1, instance_id: 1, step_id: 1, status: 'open', sequence: 1, assignee_permission: 'p', instance_payload: {}, instance_status: 'running', definition_id: 1, validation_rules: null }] },
    { match: /UPDATE core\.workflow_task/, rows: [] },
    { match: /FROM core\.workflow_step\s+WHERE definition_id = \$1 AND sequence > \$2/, rows: [{ id: 2, sequence: 2, name: 's2', assignee_permission: 'p2', sla_hours: 24, validation_rules: null }] },
    { match: /INSERT INTO core\.workflow_task/, rows: [{ id: 99, due_at: new Date() }] },
    { match: /UPDATE core\.workflow_instance\s+SET current_step_id = \$2/, rows: [] }
  ]);
  const r = await decideTask(c, { id: 1, permissions: new Set(['p']) }, 1, 'approved');
  assert.equal(r.decision, 'approved');
  assert.equal(r.next_step_id, 2);
});

test('decideTask — approved but validation fails -> rejects instance', async () => {
  const c = makeClient([
    { match: /FOR UPDATE/, rows: [{ id: 1, instance_id: 1, step_id: 1, status: 'open', sequence: 1, assignee_permission: 'p', instance_payload: {}, instance_status: 'running', definition_id: 1, validation_rules: [{ field: 'name', op: 'required' }] }] },
    { match: /UPDATE core\.workflow_task/, rows: [] },
    { match: /UPDATE core\.workflow_instance\s+SET status = \$2/, rows: [] }
  ]);
  const r = await decideTask(c, { id: 1, permissions: new Set(['p']) }, 1, 'approved', 'notes');
  assert.equal(r.decision, 'rejected_by_validation');
});

test('decideTask — rejected closes instance', async () => {
  const c = makeClient([
    { match: /FOR UPDATE/, rows: [{ id: 1, instance_id: 1, step_id: 1, status: 'open', sequence: 1, assignee_permission: 'p', instance_payload: {}, instance_status: 'running', definition_id: 1, validation_rules: null }] },
    { match: /UPDATE core\.workflow_task/, rows: [] },
    { match: /UPDATE core\.workflow_instance\s+SET status = \$2/, rows: [] }
  ]);
  const r = await decideTask(c, { id: 1, permissions: new Set(['p']) }, 1, 'rejected');
  assert.equal(r.instance_status, 'rejected');
});

test('decideTask — returned_for_changes sets instance returned', async () => {
  const c = makeClient([
    { match: /FOR UPDATE/, rows: [{ id: 1, instance_id: 1, step_id: 1, status: 'open', sequence: 1, assignee_permission: 'p', instance_payload: {}, instance_status: 'running', definition_id: 1, validation_rules: null }] },
    { match: /UPDATE core\.workflow_task/, rows: [] },
    { match: /UPDATE core\.workflow_instance\s+SET status = 'returned'/, rows: [] }
  ]);
  const r = await decideTask(c, { id: 1, permissions: new Set(['p']) }, 1, 'returned_for_changes');
  assert.equal(r.instance_status, 'returned');
});

test('resubmitInstance — 404 / 409 / 403 / happy', async () => {
  const none = makeClient([{ match: /FROM core\.workflow_instance WHERE id = \$1 FOR UPDATE/, rows: [] }]);
  await assert.rejects(() => resubmitInstance(none, 1, 1), /not found/);

  const notReturned = makeClient([{ match: /FROM core\.workflow_instance WHERE id = \$1 FOR UPDATE/, rows: [{ id: 1, status: 'running', initiated_by: 1, definition_id: 1 }] }]);
  await assert.rejects(() => resubmitInstance(notReturned, 1, 1), /Cannot resubmit/);

  const notInitiator = makeClient([{ match: /FROM core\.workflow_instance WHERE id = \$1 FOR UPDATE/, rows: [{ id: 1, status: 'returned', initiated_by: 99, definition_id: 1 }] }]);
  await assert.rejects(() => resubmitInstance(notInitiator, 1, 1), /Only the initiator/);

  const noSteps = makeClient([
    { match: /FROM core\.workflow_instance WHERE id = \$1 FOR UPDATE/, rows: [{ id: 1, status: 'returned', initiated_by: 1, definition_id: 1 }] },
    { match: /FROM core\.workflow_step WHERE definition_id = \$1\s+ORDER BY sequence LIMIT 1/, rows: [] }
  ]);
  await assert.rejects(() => resubmitInstance(noSteps, 1, 1), /no steps/);

  const ok = makeClient([
    { match: /FROM core\.workflow_instance WHERE id = \$1 FOR UPDATE/, rows: [{ id: 1, status: 'returned', initiated_by: 1, definition_id: 1 }] },
    { match: /FROM core\.workflow_step WHERE definition_id = \$1\s+ORDER BY sequence LIMIT 1/, rows: [{ id: 10, sequence: 1, name: 's', assignee_permission: 'p', sla_hours: 24 }] },
    { match: /UPDATE core\.workflow_instance\s+SET status = 'running'/, rows: [] },
    { match: /INSERT INTO core\.workflow_task/, rows: [{ id: 2, due_at: new Date() }] },
    { match: /FROM core\.workflow_instance wi\s+JOIN core\.workflow_definition wd/, rows: [{ id: 1, definition_id: 1, definition_code: 'c', entity_type: 'v', entity_id: '1', status: 'running' }] },
    { match: /FROM core\.workflow_task wt\s+JOIN core\.workflow_step ws/, rows: [] }
  ]);
  const r = await resubmitInstance(ok, 1, 1, { payload: { a: 1 }, summary: 's' });
  assert.equal(r.id, 1);
});

test('cancelInstance — 404 / 409 / 403 / happy', async () => {
  const none = makeClient([{ match: /FROM core\.workflow_instance WHERE id = \$1 FOR UPDATE/, rows: [] }]);
  await assert.rejects(() => cancelInstance(none, 1, 1), /not found/);

  const done = makeClient([{ match: /FROM core\.workflow_instance WHERE id = \$1 FOR UPDATE/, rows: [{ id: 1, status: 'approved', initiated_by: 1 }] }]);
  await assert.rejects(() => cancelInstance(done, 1, 1), /Cannot cancel/);

  const other = makeClient([{ match: /FROM core\.workflow_instance WHERE id = \$1 FOR UPDATE/, rows: [{ id: 1, status: 'running', initiated_by: 2 }] }]);
  await assert.rejects(() => cancelInstance(other, 1, 1), /Only the initiator/);

  const ok = makeClient([
    { match: /FROM core\.workflow_instance WHERE id = \$1 FOR UPDATE/, rows: [{ id: 1, status: 'running', initiated_by: 1 }] },
    { match: /UPDATE core\.workflow_task\s+SET status = 'canceled'/, rows: [] },
    { match: /UPDATE core\.workflow_instance\s+SET status = \$2/, rows: [] }
  ]);
  const r = await cancelInstance(ok, 1, 1);
  assert.equal(r.status, 'canceled');
});

test('listTasksForUser — empty when no perms', async () => {
  const r = await listTasksForUser(makeClient([]), { id: 1, permissions: new Set() });
  assert.deepEqual(r, []);
});

test('listTasksForUser — matches tasks', async () => {
  const c = makeClient([{ match: /FROM core\.workflow_task wt/, rows: [{ id: 1 }] }]);
  const r = await listTasksForUser(c, { id: 1, permissions: new Set(['p']) });
  assert.equal(r.length, 1);
});

test('loadTaskForUser — 404 / 403 / 200 variants', async () => {
  const none = makeClient([{ match: /FROM core\.workflow_task wt/, rows: [] }]);
  assert.equal((await loadTaskForUser(none, { id: 1, permissions: new Set() }, 1)).status, 404);

  const row = { id: 1, assignee_permission: 'p', initiated_by: 5 };
  const forbidden = makeClient([{ match: /FROM core\.workflow_task wt/, rows: [row] }]);
  assert.equal((await loadTaskForUser(forbidden, { id: 2, permissions: new Set() }, 1)).status, 403);
});

test('archiveOldWorkflows — default days', async () => {
  const c = makeClient([{ match: /UPDATE core\.workflow_instance\s+SET status = 'archived'/, rows: [{ id: 1 }, { id: 2 }] }]);
  const r = await archiveOldWorkflows(c);
  assert.equal(r.archived, 2);
});
