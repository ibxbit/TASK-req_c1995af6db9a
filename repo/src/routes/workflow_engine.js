import { pool, query, withTransaction } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission } from '../rbac/enforce.js';
import { logPermissionEvent } from '../rbac/audit.js';
import { requireFields } from '../middleware/validate.js';
import {
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
  checkInstanceVisibility
} from '../services/workflow_engine.js';

function send(reply, err) {
  if (err.status) return reply.code(err.status).send({ error: err.message });
  throw err;
}

export default async function workflowEngineRoutes(app) {
  // ================== DEFINITIONS ==================
  app.get(
    '/workflows/definitions',
    { preHandler: requirePermission(PERMISSIONS.WORKFLOW_VIEW) },
    async () => {
      const { rows } = await query(
        `SELECT id, code, version, entity_type, description, is_active, created_at
           FROM core.workflow_definition
          ORDER BY entity_type, code, version DESC`
      );
      return rows;
    }
  );

  app.get(
    '/workflows/definitions/:id',
    { preHandler: requirePermission(PERMISSIONS.WORKFLOW_VIEW) },
    async (request, reply) => {
      const def = await loadDefinition(pool, request.params.id);
      if (!def) return reply.code(404).send({ error: 'Not found' });
      return def;
    }
  );

  app.post(
    '/workflows/definitions',
    {
      preHandler: [
        requirePermission(PERMISSIONS.WORKFLOW_DEFINE),
        requireFields(['code', 'entity_type', 'steps'])
      ]
    },
    async (request, reply) => {
      try {
        const def = await withTransaction((c) => createDefinition(c, request.user.id, request.body));
        return reply.code(201).send(def);
      } catch (err) { return send(reply, err); }
    }
  );

  // ================== INSTANCES ==================
  // List is visibility-filtered: non-elevated users see only instances they initiated
  // or have an assignee-permission for. Elevated users (workflow.define / audit.read) see all.
  app.get(
    '/workflows/instances',
    { preHandler: requirePermission(PERMISSIONS.WORKFLOW_VIEW) },
    async (request) => {
      const { user } = request;
      const isElevated = user.permissions.has(PERMISSIONS.WORKFLOW_DEFINE) ||
                         user.permissions.has(PERMISSIONS.AUDIT_READ);
      return listInstances(pool, {
        ...(request.query || {}),
        user: isElevated ? null : user
      });
    }
  );

  // Detail applies the same object-level policy; non-visible instances return 403.
  app.get(
    '/workflows/instances/:id',
    { preHandler: requirePermission(PERMISSIONS.WORKFLOW_VIEW) },
    async (request, reply) => {
      const inst = await loadInstance(pool, request.params.id);
      if (!inst) return reply.code(404).send({ error: 'Not found' });
      const { user } = request;
      const isElevated = user.permissions.has(PERMISSIONS.WORKFLOW_DEFINE) ||
                         user.permissions.has(PERMISSIONS.AUDIT_READ);
      if (!isElevated && !checkInstanceVisibility(inst, user)) {
        await logPermissionEvent({
          user, permissionCode: PERMISSIONS.WORKFLOW_VIEW,
          resource: `workflow_instance:${request.params.id}`,
          action: 'workflow.instance.view', granted: false,
          reason: 'Instance not visible to this user', request
        });
        return reply.code(403).send({ error: 'Forbidden' });
      }
      return inst;
    }
  );

  app.post(
    '/workflows/instances',
    {
      preHandler: [
        requirePermission(PERMISSIONS.APPROVAL_SUBMIT),
        requireFields(['entity_type', 'entity_id'])
      ]
    },
    async (request, reply) => {
      try {
        const inst = await withTransaction((c) => initiateInstance(c, request.user.id, request.body));
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.APPROVAL_SUBMIT,
          resource: `${inst.entity_type}:${inst.entity_id}`,
          action: 'workflow.initiate', granted: true, request,
          metadata: { instance_id: inst.id, definition_code: inst.definition_code }
        });
        return reply.code(201).send(inst);
      } catch (err) { return send(reply, err); }
    }
  );

  app.post(
    '/workflows/instances/:id/resubmit',
    { preHandler: requirePermission(PERMISSIONS.APPROVAL_SUBMIT) },
    async (request, reply) => {
      try {
        return await withTransaction((c) =>
          resubmitInstance(c, request.user.id, request.params.id, request.body || {})
        );
      } catch (err) { return send(reply, err); }
    }
  );

  app.post(
    '/workflows/instances/:id/cancel',
    { preHandler: requirePermission(PERMISSIONS.APPROVAL_SUBMIT) },
    async (request, reply) => {
      try {
        return await withTransaction((c) => cancelInstance(c, request.user.id, request.params.id));
      } catch (err) { return send(reply, err); }
    }
  );

  // ================== TASKS ==================
  // Visibility: only tasks whose step's assignee_permission the user holds.
  app.get(
    '/workflows/tasks/mine',
    { preHandler: requirePermission(PERMISSIONS.WORKFLOW_VIEW) },
    async (request) =>
      listTasksForUser(pool, request.user, request.query || {})
  );

  // Object-level visibility: the task is exposed only to
  //   (a) users holding the step's assignee_permission,
  //   (b) the instance initiator,
  //   (c) holders of WORKFLOW_DEFINE / AUDIT_READ (workflow owners / auditors).
  // Everyone else sees 403 regardless of WORKFLOW_VIEW.
  app.get(
    '/workflows/tasks/:id',
    { preHandler: requirePermission(PERMISSIONS.WORKFLOW_VIEW) },
    async (request, reply) => {
      const res = await loadTaskForUser(pool, request.user, request.params.id, {
        allowRoles: [PERMISSIONS.WORKFLOW_DEFINE, PERMISSIONS.AUDIT_READ]
      });
      if (res.status === 404) return reply.code(404).send({ error: 'Not found' });
      if (res.status === 403) {
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.WORKFLOW_VIEW,
          resource: `task:${request.params.id}`,
          action: 'workflow.task.view', granted: false,
          reason: 'Task not visible to this user', request
        });
        return reply.code(403).send({ error: 'Forbidden' });
      }
      return res.task;
    }
  );

  const decideHandler = (decision, permKey) => async (request, reply) => {
    try {
      const result = await withTransaction((c) =>
        decideTask(c, request.user, request.params.id, decision, request.body?.notes)
      );
      await logPermissionEvent({
        user: request.user, permissionCode: PERMISSIONS[permKey],
        resource: `task:${request.params.id}`,
        action: `workflow.${decision}`,
        granted: true, request,
        metadata: result
      });
      return result;
    } catch (err) { return send(reply, err); }
  };

  app.post('/workflows/tasks/:id/approve',
    { preHandler: requirePermission(PERMISSIONS.APPROVAL_APPROVE) },
    decideHandler('approved', 'APPROVAL_APPROVE'));

  app.post('/workflows/tasks/:id/reject',
    { preHandler: requirePermission(PERMISSIONS.APPROVAL_REJECT) },
    decideHandler('rejected', 'APPROVAL_REJECT'));

  app.post('/workflows/tasks/:id/return',
    { preHandler: requirePermission(PERMISSIONS.APPROVAL_REJECT) },
    decideHandler('returned_for_changes', 'APPROVAL_REJECT'));
}
