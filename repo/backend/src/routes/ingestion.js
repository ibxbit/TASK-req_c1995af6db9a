import { withTransaction } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission } from '../rbac/enforce.js';
import { logPermissionEvent } from '../rbac/audit.js';
import { check } from '../middleware/validate.js';
import { runIngestion, supportedResources } from '../services/ingestion.js';

function send(reply, err) {
  if (err.status) return reply.code(err.status).send({ error: err.message });
  throw err;
}

export default async function ingestionRoutes(app) {
  app.get(
    '/ingestion/resources',
    { preHandler: requirePermission(PERMISSIONS.DATA_INGEST) },
    async () => ({ resources: supportedResources() })
  );

  app.post(
    '/ingestion/:resource',
    {
      preHandler: [
        requirePermission(PERMISSIONS.DATA_INGEST),
        check((req) =>
          Array.isArray(req.body?.records) ? null : ['body.records must be an array']
        )
      ]
    },
    async (request, reply) => {
      try {
        const result = await withTransaction((c) =>
          runIngestion(c, request.user.id, request.params.resource, request.body.records)
        );
        await logPermissionEvent({
          user: request.user, permissionCode: PERMISSIONS.DATA_INGEST,
          resource: `ingestion_run:${result.run_id}`,
          action: 'data.ingest', granted: true, request,
          metadata: { resource: result.resource, totals: result.totals }
        });
        return reply.code(201).send({ ...result, ...(result.totals || {}) });
      } catch (err) { return send(reply, err); }
    }
  );
}
