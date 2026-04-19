import fp from 'fastify-plugin';
import { verifyToken } from './tokens.js';
import { query } from '../db.js';

async function loadUserContext(userId) {
  const userRes = await query(
    `SELECT id, username, email, full_name, is_active
       FROM core.app_user WHERE id = $1`,
    [userId]
  );
  const user = userRes.rows[0];
  if (!user || !user.is_active) return null;

  const [permsRes, rolesRes, citiesRes] = await Promise.all([
    query(`SELECT code, layer FROM core.v_user_permission WHERE user_id = $1`, [userId]),
    query(
      `SELECT r.code, r.name
         FROM core.user_role ur
         JOIN core.role r ON r.id = ur.role_id
        WHERE ur.user_id = $1`,
      [userId]
    ),
    query(
      `SELECT c.id, c.code, c.name
         FROM core.user_city uc
         JOIN core.city c ON c.id = uc.city_id
        WHERE uc.user_id = $1`,
      [userId]
    )
  ]);

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.full_name,
    roles: rolesRes.rows,
    permissions: new Set(permsRes.rows.map((r) => r.code)),
    assignedCityIds: citiesRes.rows.map((r) => r.id),
    assignedCities: citiesRes.rows
  };
}

export default fp(async function authPlugin(app) {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return;

    const token = header.slice(7);
    try {
      const decoded = verifyToken(token);
      const ctx = await loadUserContext(decoded.sub);
      if (ctx) request.user = ctx;
    } catch {
      // Invalid/expired token -> request.user stays null
    }
  });
});
