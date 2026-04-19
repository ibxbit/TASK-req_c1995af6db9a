import { PERMISSIONS } from './permissions.js';
import { logPermissionEvent } from './audit.js';

export function requireAuth() {
  return async (request, reply) => {
    if (!request.user) {
      await logPermissionEvent({
        user: null,
        permissionCode: 'auth.required',
        granted: false,
        reason: 'Missing or invalid token',
        request
      });
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  };
}

export function requirePermission(permissionCode) {
  return async (request, reply) => {
    if (!request.user) {
      await logPermissionEvent({
        user: null,
        permissionCode,
        granted: false,
        reason: 'Missing or invalid token',
        request
      });
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const ok = request.user.permissions.has(permissionCode);
    await logPermissionEvent({
      user: request.user,
      permissionCode,
      granted: ok,
      reason: ok ? null : 'Permission denied',
      request
    });

    if (!ok) return reply.code(403).send({ error: 'Forbidden', permission: permissionCode });
  };
}

/**
 * Returns the row-level city scope for a user.
 *   { all: true }                     -> may see all cities
 *   { all: false, cityIds: [1,2,3] }  -> restricted to these city ids
 *   { all: false, cityIds: [] }       -> no access to any city
 */
export function getCityScope(user) {
  if (user.permissions.has(PERMISSIONS.DATA_CITY_ALL)) return { all: true, cityIds: null };
  if (user.permissions.has(PERMISSIONS.DATA_CITY_ASSIGNED)) {
    return { all: false, cityIds: user.assignedCityIds };
  }
  return { all: false, cityIds: [] };
}

export function assertCityAccess(user, cityId) {
  const scope = getCityScope(user);
  if (scope.all) return true;
  return scope.cityIds.includes(Number(cityId));
}

export function canAccessFinance(user) {
  return user.permissions.has(PERMISSIONS.FINANCE_READ);
}
