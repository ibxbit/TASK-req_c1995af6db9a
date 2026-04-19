import { pool, withTransaction } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission } from '../rbac/enforce.js';
import { logPermissionEvent } from '../rbac/audit.js';
import { requireFields } from '../middleware/validate.js';
import {
  submitApproval,
  decideApproval,
  cancelApproval,
  listApprovals,
  getApproval
} from '../services/workflows.js';

function send(reply, err) {
  if (err.status) return reply.code(err.status).send({ error: err.message });
  throw err;
}

export default async function workflowRoutes(app) {
  app.get(
    '/workflows/approvals',
    { preHandler: requirePermission(PERMISSIONS.APPROVAL_SUBMIT) },
    async (request) => listApprovals(pool, request.query || {})
  );

  app.get(
    '/workflows/approvals/:id',
    { preHandler: requirePermission(PERMISSIONS.APPROVAL_SUBMIT) },
    async (request, reply) => {
      const r = await getApproval(pool, request.params.id);
      if (!r) return reply.code(404).send({ error: 'Not found' });
      return r;
    }
  );

  app.post(
    '/workflows/approvals',
    {
      preHandler: [
        requirePermission(PERMISSIONS.APPROVAL_SUBMIT),
        requireFields(['entity_type', 'entity_id', 'summary'])
      ]
    },
    async (request, reply) => {
      try {
        const result = await withTransaction((c) => submitApproval(c, request.user.id, request.body));
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.APPROVAL_SUBMIT,
          resource: `${result.entity_type}:${result.entity_id}`,
          action: 'approval.submit', granted: true, request,
          metadata: { approval_id: result.id }
        });
        return reply.code(201).send(result);
      } catch (err) { return send(reply, err); }
    }
  );

  app.post(
    '/workflows/approvals/:id/approve',
    { preHandler: requirePermission(PERMISSIONS.APPROVAL_APPROVE) },
    async (request, reply) => {
      try {
        const result = await withTransaction((c) =>
          decideApproval(c, request.user.id, request.params.id, 'approved', request.body?.notes)
        );
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.APPROVAL_APPROVE,
          resource: `approval:${request.params.id}`,
          action: 'approval.approve', granted: true, request,
          metadata: { entity_type: result.entity_type, entity_id: result.entity_id }
        });
        return result;
      } catch (err) { return send(reply, err); }
    }
  );

  app.post(
    '/workflows/approvals/:id/reject',
    { preHandler: requirePermission(PERMISSIONS.APPROVAL_REJECT) },
    async (request, reply) => {
      try {
        const result = await withTransaction((c) =>
          decideApproval(c, request.user.id, request.params.id, 'rejected', request.body?.notes)
        );
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.APPROVAL_REJECT,
          resource: `approval:${request.params.id}`,
          action: 'approval.reject', granted: true, request,
          metadata: { entity_type: result.entity_type, entity_id: result.entity_id }
        });
        return result;
      } catch (err) { return send(reply, err); }
    }
  );

  app.post(
    '/workflows/approvals/:id/cancel',
    { preHandler: requirePermission(PERMISSIONS.APPROVAL_SUBMIT) },
    async (request, reply) => {
      try {
        return await withTransaction((c) => cancelApproval(c, request.user.id, request.params.id));
      } catch (err) { return send(reply, err); }
    }
  );
}
