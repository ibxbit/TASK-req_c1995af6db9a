// Auto-audit every authenticated mutation (POST / PUT / PATCH / DELETE).
// Writes a row into audit.permission_event with action prefixed `http.*`,
// capturing user_id, username, workstation, method, path, and response status.
// Domain-specific logPermissionEvent calls continue to run alongside and record
// richer context (entity_id, metadata) — both coexist in the same table.

import fp from 'fastify-plugin';
import { logPermissionEvent } from '../rbac/audit.js';

const TRACKED = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Routes whose content is already audited elsewhere (login writes its own row).
const SKIP_PATHS = [
  '/auth/login'
];

export default fp(async function auditMutationsPlugin(app) {
  app.addHook('onResponse', async (request, reply) => {
    try {
      if (!TRACKED.has(request.method)) return;
      if (!request.user) return;
      if (reply.statusCode >= 400) return;
      if (SKIP_PATHS.some((p) => request.url.startsWith(p))) return;

      const routePath = request.routeOptions?.url || request.url;
      await logPermissionEvent({
        user: request.user,
        permissionCode: `http.${request.method.toLowerCase()}`,
        action: `${request.method} ${routePath}`,
        resource: request.url,
        entity_type: 'http',
        entity_id: routePath,
        granted: true,
        request,
        metadata: { status: reply.statusCode }
      });
    } catch (err) {
      request.log.error({ err }, 'audit-mutations hook failed');
    }
  });
});
