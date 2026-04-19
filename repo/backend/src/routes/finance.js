import { query } from '../db.js';
import { PERMISSIONS } from '../rbac/permissions.js';
import { requirePermission, getCityScope } from '../rbac/enforce.js';

export default async function financeRoutes(app) {
  // Recruiters lack finance.read and will be rejected with 403.
  app.get(
    '/finance/transactions',
    { preHandler: requirePermission(PERMISSIONS.FINANCE_READ) },
    async (request) => {
      const scope = getCityScope(request.user);

      if (scope.all) {
        const { rows } = await query(
          `SELECT id, city_id, kind, amount_cents, description, created_at
             FROM core.finance_transaction ORDER BY id DESC`
        );
        return rows;
      }

      if (scope.cityIds.length === 0) return [];

      const { rows } = await query(
        `SELECT id, city_id, kind, amount_cents, description, created_at
           FROM core.finance_transaction
          WHERE city_id = ANY($1::int[])
          ORDER BY id DESC`,
        [scope.cityIds]
      );
      return rows;
    }
  );
}
