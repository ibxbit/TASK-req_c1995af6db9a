import { withTransaction } from '../db.js';
import { verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/tokens.js';
import {
  loadUserForLogin,
  isLocked,
  recordFailedLogin,
  recordSuccessfulLogin
} from '../auth/lockout.js';
import { requireAuth } from '../rbac/enforce.js';
import { logPermissionEvent } from '../rbac/audit.js';

export default async function authRoutes(app) {
  app.post('/auth/login', async (request, reply) => {
    const { username, password } = request.body || {};
    if (!username || !password) {
      return reply.code(400).send({ error: 'username and password required' });
    }

    const outcome = await withTransaction(async (c) => {
      const user = await loadUserForLogin(c, username);
      const lock = isLocked(user);
      if (lock.locked) {
        return { status: 'locked', user, lock };
      }
      if (!user) {
        // Enumeration-safe: same 401 as bad password.
        return { status: 'invalid', user: null };
      }
      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        const after = await recordFailedLogin(c, user.id);
        return {
          status: after.locked_until ? 'locked_now' : 'invalid',
          user,
          locked_until: after.locked_until,
          failed_count: after.failed_login_count
        };
      }
      await recordSuccessfulLogin(c, user.id);
      return { status: 'ok', user };
    });

    const auditUser = outcome.user ? { id: outcome.user.id, username: outcome.user.username } : null;
    await logPermissionEvent({
      user: auditUser,
      permissionCode: 'auth.login',
      granted: outcome.status === 'ok',
      reason: outcome.status === 'ok' ? null : outcome.status,
      request,
      metadata: {
        attemptedUsername: username,
        ...(outcome.locked_until ? { locked_until: outcome.locked_until } : {})
      }
    });

    if (outcome.status === 'locked' || outcome.status === 'locked_now') {
      return reply.code(423).send({
        error: 'Account is locked',
        locked_until: outcome.lock?.locked_until ?? outcome.locked_until ?? null,
        reason: outcome.lock?.reason ?? 'locked'
      });
    }
    if (outcome.status !== 'ok') {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = signToken({ sub: outcome.user.id, username: outcome.user.username });
    return { token };
  });

  app.get('/auth/me', { preHandler: requireAuth() }, async (request) => {
    const u = request.user;
    return {
      id: u.id,
      username: u.username,
      email: u.email,
      fullName: u.fullName,
      roles: u.roles,
      permissions: [...u.permissions],
      assignedCities: u.assignedCities
    };
  });
}
