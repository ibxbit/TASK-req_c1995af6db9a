// Workflow engine — generic over (entity_type, entity_id).
// States:  running -> approved | rejected | returned | canceled -> archived
// Per-step validation runs at the moment an approver decides 'approved';
// failure marks the instance rejected and records the errors on the task.

function err(status, message) {
  return Object.assign(new Error(message), { status });
}

// ----------------------------------------------------------------------------
// Validation rule engine (minimal, extensible)
// ----------------------------------------------------------------------------
export function evaluateRules(rules, payload) {
  const errors = [];
  if (!Array.isArray(rules)) return errors;
  const p = payload || {};
  for (const r of rules) {
    const v = p[r.field];
    switch (r.op) {
      case 'required':
        if (v == null || v === '') errors.push(`${r.field} is required`);
        break;
      case 'equals':
        if (v !== r.value) errors.push(`${r.field} must equal ${JSON.stringify(r.value)}`);
        break;
      case 'lte':
        if (v == null || Number(v) > Number(r.value)) errors.push(`${r.field} must be ≤ ${r.value}`);
        break;
      case 'gte':
        if (v == null || Number(v) < Number(r.value)) errors.push(`${r.field} must be ≥ ${r.value}`);
        break;
      case 'regex':
        if (v == null || !new RegExp(r.value).test(String(v))) errors.push(`${r.field} did not match /${r.value}/`);
        break;
      default:
        errors.push(`Unknown rule op '${r.op}'`);
    }
  }
  return errors;
}

// ----------------------------------------------------------------------------
// Definition management
// ----------------------------------------------------------------------------
export async function createDefinition(client, userId, { code, version = 1, entity_type, description, steps }) {
  if (!code || !entity_type) throw err(400, 'code and entity_type required');
  if (!Array.isArray(steps) || !steps.length) throw err(400, 'steps[] required');

  const def = await client.query(
    `INSERT INTO core.workflow_definition (code, version, entity_type, description, created_by)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, code, version, entity_type, description, is_active, created_at`,
    [code, version, entity_type, description ?? null, userId]
  );
  const definitionId = def.rows[0].id;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s.name || !s.assignee_permission) {
      throw err(400, `step[${i}] requires name and assignee_permission`);
    }
    await client.query(
      `INSERT INTO core.workflow_step
         (definition_id, sequence, name, assignee_permission, sla_hours, validation_rules)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        definitionId,
        s.sequence ?? i + 1,
        s.name,
        s.assignee_permission,
        s.sla_hours ?? 72,
        s.validation_rules ? JSON.stringify(s.validation_rules) : null
      ]
    );
  }
  return loadDefinition(client, definitionId);
}

export async function loadDefinition(client, id) {
  const d = await client.query(
    `SELECT id, code, version, entity_type, description, is_active, created_at
       FROM core.workflow_definition WHERE id = $1`,
    [id]
  );
  if (!d.rows[0]) return null;
  const steps = await client.query(
    `SELECT id, sequence, name, assignee_permission, sla_hours, validation_rules
       FROM core.workflow_step WHERE definition_id = $1
      ORDER BY sequence`,
    [id]
  );
  return { ...d.rows[0], steps: steps.rows };
}

async function resolveDefinition(client, { definition_id, definition_code }) {
  if (definition_id) {
    const res = await client.query(
      `SELECT id FROM core.workflow_definition WHERE id = $1 AND is_active = TRUE`,
      [definition_id]
    );
    return res.rows[0] || null;
  }
  if (definition_code) {
    const res = await client.query(
      `SELECT id FROM core.workflow_definition
        WHERE code = $1 AND is_active = TRUE
        ORDER BY version DESC LIMIT 1`,
      [definition_code]
    );
    return res.rows[0] || null;
  }
  return null;
}

async function firstStep(client, definitionId) {
  const { rows } = await client.query(
    `SELECT id, sequence, name, assignee_permission, sla_hours, validation_rules
       FROM core.workflow_step WHERE definition_id = $1
      ORDER BY sequence LIMIT 1`,
    [definitionId]
  );
  return rows[0] || null;
}

async function nextStep(client, definitionId, afterSequence) {
  const { rows } = await client.query(
    `SELECT id, sequence, name, assignee_permission, sla_hours, validation_rules
       FROM core.workflow_step
      WHERE definition_id = $1 AND sequence > $2
      ORDER BY sequence LIMIT 1`,
    [definitionId, afterSequence]
  );
  return rows[0] || null;
}

async function createTask(client, instanceId, step) {
  const dueAt = new Date(Date.now() + step.sla_hours * 3600_000);
  const { rows } = await client.query(
    `INSERT INTO core.workflow_task (instance_id, step_id, due_at)
     VALUES ($1,$2,$3)
     RETURNING id, due_at`,
    [instanceId, step.id, dueAt]
  );
  return rows[0];
}

// ----------------------------------------------------------------------------
// Instance lifecycle
// ----------------------------------------------------------------------------
export async function initiateInstance(client, userId, payload) {
  const { entity_type, entity_id, summary = null, payload: body = null } = payload;
  if (!entity_type || entity_id == null) throw err(400, 'entity_type and entity_id required');

  const def = await resolveDefinition(client, payload);
  if (!def) throw err(404, 'No active workflow definition found');

  const step = await firstStep(client, def.id);
  if (!step) throw err(500, 'Definition has no steps');

  const ins = await client.query(
    `INSERT INTO core.workflow_instance
       (definition_id, entity_type, entity_id, summary, payload,
        status, current_step_id, initiated_by)
     VALUES ($1,$2,$3,$4,$5,'running',$6,$7)
     RETURNING id, definition_id, entity_type, entity_id, status, current_step_id, initiated_at`,
    [def.id, entity_type, String(entity_id), summary,
     body ? JSON.stringify(body) : null, step.id, userId]
  );
  await createTask(client, ins.rows[0].id, step);
  return loadInstance(client, ins.rows[0].id);
}

export async function loadInstance(client, id) {
  const i = await client.query(
    `SELECT wi.id, wi.definition_id, wd.code AS definition_code, wi.entity_type, wi.entity_id,
            wi.summary, wi.payload, wi.status, wi.current_step_id,
            wi.initiated_by, wi.initiated_at, wi.decided_at, wi.archived_at, wi.updated_at
       FROM core.workflow_instance wi
       JOIN core.workflow_definition wd ON wd.id = wi.definition_id
      WHERE wi.id = $1`,
    [id]
  );
  if (!i.rows[0]) return null;
  const tasks = await client.query(
    `SELECT wt.id, wt.step_id, ws.sequence, ws.name AS step_name, ws.assignee_permission,
            wt.status, wt.decision, wt.decided_by, wt.decided_at, wt.decision_notes,
            wt.validation_errors, wt.due_at, wt.created_at,
            (wt.status = 'open' AND wt.due_at < now()) AS is_overdue
       FROM core.workflow_task wt
       JOIN core.workflow_step ws ON ws.id = wt.step_id
      WHERE wt.instance_id = $1
      ORDER BY ws.sequence, wt.id`,
    [id]
  );
  return { ...i.rows[0], tasks: tasks.rows };
}

export async function listInstances(client, { status = null, entity_type = null, limit = 100, user = null } = {}) {
  const args = [];
  const conds = [];
  if (status)      { args.push(status);      conds.push(`wi.status = $${args.length}`); }
  if (entity_type) { args.push(entity_type); conds.push(`wi.entity_type = $${args.length}`); }

  if (user) {
    const perms = [...user.permissions];
    args.push(Number(user.id));
    const uidIdx = args.length;
    args.push(perms);
    const permsIdx = args.length;
    conds.push(`(
      wi.initiated_by = $${uidIdx}
      OR EXISTS (
        SELECT 1 FROM core.workflow_task wt2
          JOIN core.workflow_step ws2 ON ws2.id = wt2.step_id
         WHERE wt2.instance_id = wi.id
           AND ws2.assignee_permission = ANY($${permsIdx}::text[])
      )
    )`);
  }

  args.push(Math.min(Number(limit), 500));
  const { rows } = await client.query(
    `SELECT wi.id, wd.code AS definition_code, wi.entity_type, wi.entity_id,
            wi.summary, wi.status, wi.current_step_id,
            wi.initiated_by, wi.initiated_at, wi.decided_at
       FROM core.workflow_instance wi
       JOIN core.workflow_definition wd ON wd.id = wi.definition_id
       ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
      ORDER BY wi.initiated_at DESC
      LIMIT $${args.length}`,
    args
  );
  return rows;
}

async function lockTask(client, taskId) {
  const { rows } = await client.query(
    `SELECT wt.id, wt.instance_id, wt.step_id, wt.status,
            ws.sequence, ws.assignee_permission, ws.validation_rules,
            wi.definition_id, wi.payload AS instance_payload, wi.status AS instance_status
       FROM core.workflow_task wt
       JOIN core.workflow_step ws ON ws.id = wt.step_id
       JOIN core.workflow_instance wi ON wi.id = wt.instance_id
      WHERE wt.id = $1 FOR UPDATE`,
    [taskId]
  );
  return rows[0] || null;
}

// ----------------------------------------------------------------------------
// Core decision handler (approve / reject / return_for_changes)
// ----------------------------------------------------------------------------
export async function decideTask(client, user, taskId, decision, notes) {
  if (!['approved', 'rejected', 'returned_for_changes'].includes(decision)) {
    throw err(400, "decision must be 'approved', 'rejected', or 'returned_for_changes'");
  }
  const t = await lockTask(client, taskId);
  if (!t) throw err(404, 'Task not found');
  if (t.status !== 'open') throw err(409, `Task is ${t.status}`);
  if (t.instance_status !== 'running') throw err(409, `Instance is ${t.instance_status}`);

  if (!user.permissions.has(t.assignee_permission)) {
    throw err(403, `Permission '${t.assignee_permission}' required to decide this task`);
  }

  if (decision === 'approved') {
    const validationErrors = evaluateRules(t.validation_rules, t.instance_payload);
    if (validationErrors.length) {
      await completeTask(client, t.id, 'completed', 'rejected', user.id, notes, validationErrors);
      await closeInstance(client, t.instance_id, 'rejected');
      return {
        task_id: t.id, decision: 'rejected_by_validation',
        validation_errors: validationErrors,
        instance_status: 'rejected'
      };
    }

    await completeTask(client, t.id, 'completed', 'approved', user.id, notes, null);
    const next = await nextStep(client, t.definition_id, t.sequence);
    if (next) {
      const newTask = await createTask(client, t.instance_id, next);
      await client.query(
        `UPDATE core.workflow_instance
            SET current_step_id = $2, updated_at = now()
          WHERE id = $1`,
        [t.instance_id, next.id]
      );
      return { task_id: t.id, decision: 'approved', next_step_id: next.id, new_task_id: newTask.id };
    }
    await closeInstance(client, t.instance_id, 'approved');
    return { task_id: t.id, decision: 'approved', instance_status: 'approved' };
  }

  if (decision === 'rejected') {
    await completeTask(client, t.id, 'completed', 'rejected', user.id, notes, null);
    await closeInstance(client, t.instance_id, 'rejected');
    return { task_id: t.id, decision: 'rejected', instance_status: 'rejected' };
  }

  // returned_for_changes
  await completeTask(client, t.id, 'completed', 'returned_for_changes', user.id, notes, null);
  await client.query(
    `UPDATE core.workflow_instance
        SET status = 'returned', current_step_id = NULL, updated_at = now()
      WHERE id = $1`,
    [t.instance_id]
  );
  return { task_id: t.id, decision: 'returned_for_changes', instance_status: 'returned' };
}

async function completeTask(client, taskId, status, decision, userId, notes, validationErrors) {
  await client.query(
    `UPDATE core.workflow_task
        SET status = $2, decision = $3, decided_by = $4, decided_at = now(),
            decision_notes = $5, validation_errors = $6
      WHERE id = $1`,
    [taskId, status, decision, userId, notes ?? null,
     validationErrors ? JSON.stringify(validationErrors) : null]
  );
}

async function closeInstance(client, instanceId, status) {
  await client.query(
    `UPDATE core.workflow_instance
        SET status = $2, current_step_id = NULL, decided_at = now(), updated_at = now()
      WHERE id = $1`,
    [instanceId, status]
  );
}

export async function resubmitInstance(client, userId, instanceId, { payload = null, summary = null } = {}) {
  const { rows } = await client.query(
    `SELECT id, definition_id, status, initiated_by
       FROM core.workflow_instance WHERE id = $1 FOR UPDATE`,
    [instanceId]
  );
  const inst = rows[0];
  if (!inst) throw err(404, 'Instance not found');
  if (inst.status !== 'returned') throw err(409, `Cannot resubmit: instance is ${inst.status}`);
  if (inst.initiated_by !== userId) throw err(403, 'Only the initiator may resubmit');

  const step = await firstStep(client, inst.definition_id);
  if (!step) throw err(500, 'Definition has no steps');

  await client.query(
    `UPDATE core.workflow_instance
        SET status = 'running',
            current_step_id = $2,
            payload   = COALESCE($3, payload),
            summary   = COALESCE($4, summary),
            decided_at = NULL,
            updated_at = now()
      WHERE id = $1`,
    [
      instanceId, step.id,
      payload ? JSON.stringify(payload) : null,
      summary
    ]
  );
  await createTask(client, instanceId, step);
  return loadInstance(client, instanceId);
}

export async function cancelInstance(client, userId, instanceId) {
  const { rows } = await client.query(
    `SELECT id, status, initiated_by FROM core.workflow_instance WHERE id = $1 FOR UPDATE`,
    [instanceId]
  );
  const inst = rows[0];
  if (!inst) throw err(404, 'Instance not found');
  if (!['running', 'returned'].includes(inst.status)) {
    throw err(409, `Cannot cancel: instance is ${inst.status}`);
  }
  if (inst.initiated_by !== userId) throw err(403, 'Only the initiator may cancel');

  await client.query(
    `UPDATE core.workflow_task
        SET status = 'canceled'
      WHERE instance_id = $1 AND status = 'open'`,
    [instanceId]
  );
  await closeInstance(client, instanceId, 'canceled');
  return { instance_id: instanceId, status: 'canceled' };
}

// ----------------------------------------------------------------------------
// Object-level visibility check for a single task.
// A user may view a task only if they hold the step's assignee_permission, OR
// they initiated the parent instance (their own submission). Callers also
// allowing anyone holding WORKFLOW_DEFINE / AUDIT_READ can pass `allowRoles`.
// ----------------------------------------------------------------------------
export async function loadTaskForUser(client, user, taskId, { allowRoles = [] } = {}) {
  const { rows } = await client.query(
    `SELECT wt.id, wt.instance_id, wt.step_id, ws.name AS step_name, ws.assignee_permission,
            wt.status, wt.decision, wt.decision_notes, wt.validation_errors,
            wt.due_at, wt.created_at, wt.decided_at, wt.decided_by,
            wi.entity_type, wi.entity_id, wi.initiated_by
       FROM core.workflow_task wt
       JOIN core.workflow_step ws     ON ws.id = wt.step_id
       JOIN core.workflow_instance wi ON wi.id = wt.instance_id
      WHERE wt.id = $1`,
    [taskId]
  );
  const row = rows[0];
  if (!row) return { status: 404 };

  const isAssignee    = user.permissions.has(row.assignee_permission);
  const isInitiator   = Number(row.initiated_by) === Number(user.id);
  const hasAllowRole  = allowRoles.some((p) => user.permissions.has(p));
  const visible       = isAssignee || isInitiator || hasAllowRole;
  if (!visible) return { status: 403 };
  return { status: 200, task: row };
}

// ----------------------------------------------------------------------------
// Object-level visibility check for a workflow instance.
// Returns true when the user is the initiator, holds any task's assignee_permission,
// or (when allowElevated=true) holds an elevated role — callers determine elevation.
// ----------------------------------------------------------------------------
export function checkInstanceVisibility(instance, user) {
  if (Number(instance.initiated_by) === Number(user.id)) return true;
  if (instance.tasks?.some(t => user.permissions.has(t.assignee_permission))) return true;
  return false;
}

// ----------------------------------------------------------------------------
// Visibility-filtered task queries
// ----------------------------------------------------------------------------
export async function listTasksForUser(client, user, { status = 'open', limit = 100 } = {}) {
  const perms = [...user.permissions];
  if (!perms.length) return [];
  const { rows } = await client.query(
    `SELECT wt.id, wt.instance_id, wt.step_id, ws.sequence, ws.name AS step_name,
            ws.assignee_permission, wt.status, wt.due_at, wt.created_at,
            wi.entity_type, wi.entity_id, wi.summary,
            (wt.status = 'open' AND wt.due_at < now()) AS is_overdue
       FROM core.workflow_task wt
       JOIN core.workflow_step ws     ON ws.id = wt.step_id
       JOIN core.workflow_instance wi ON wi.id = wt.instance_id
      WHERE wt.status = $1
        AND ws.assignee_permission = ANY($2::text[])
      ORDER BY wt.due_at
      LIMIT $3`,
    [status, perms, Math.min(Number(limit), 500)]
  );
  return rows;
}

// ----------------------------------------------------------------------------
// Auto-archive (90 days after decision)
// ----------------------------------------------------------------------------
export async function archiveOldWorkflows(client, { olderThanDays = 90 } = {}) {
  const res = await client.query(
    `UPDATE core.workflow_instance
        SET status = 'archived',
            archived_at = now(),
            updated_at  = now()
      WHERE status IN ('approved','rejected','canceled')
        AND decided_at IS NOT NULL
        AND decided_at < now() - make_interval(days => $1)
      RETURNING id`,
    [olderThanDays]
  );
  return { archived: res.rowCount };
}
