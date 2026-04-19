import { pool } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission, getCityScope, assertCityAccess } from '../rbac/enforce.js';
import { listReceipts, listRefunds, getStageDetail } from '../services/payments.js';

export default async function paymentRoutes(app) {
  app.get(
    '/payments/receipts',
    { preHandler: requirePermission(PERMISSIONS.ORDER_READ) },
    async (request) => listReceipts(pool, getCityScope(request.user), request.query || {})
  );

  app.get(
    '/payments/refunds',
    { preHandler: requirePermission(PERMISSIONS.ORDER_READ) },
    async (request) => listRefunds(pool, getCityScope(request.user), request.query || {})
  );

  app.get(
    '/payments/stages/:stageId',
    { preHandler: requirePermission(PERMISSIONS.ORDER_READ) },
    async (request, reply) => {
      const stage = await getStageDetail(pool, request.params.stageId);
      if (!stage) return reply.code(404).send({ error: 'Not found' });
      if (!assertCityAccess(request.user, stage.city_id)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      return stage;
    }
  );
}
