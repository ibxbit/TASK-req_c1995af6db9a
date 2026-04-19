// Bootstrap an initial Administrator user.
// Usage:
//   ADMIN_USERNAME=admin ADMIN_EMAIL=admin@local ADMIN_NAME="Admin" \
//   ADMIN_PASSWORD='changeMe!' node src/scripts/create-admin.js

import { pool, withTransaction } from '../db.js';
import { hashPassword, validatePasswordStrength } from '../auth/password.js';

const username = process.env.ADMIN_USERNAME || 'admin';
const email    = process.env.ADMIN_EMAIL    || 'admin@local';
const fullName = process.env.ADMIN_NAME     || 'System Administrator';
const password = process.env.ADMIN_PASSWORD;

if (!password) {
  console.error('ADMIN_PASSWORD env var is required');
  process.exit(1);
}

try {
  validatePasswordStrength(password);
  const password_hash = await hashPassword(password);

  const created = await withTransaction(async (c) => {
    const ins = await c.query(
      `INSERT INTO core.app_user (username, email, full_name, password_hash)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             email = EXCLUDED.email,
             full_name = EXCLUDED.full_name,
             is_active = TRUE,
             updated_at = now()
       RETURNING id, username`,
      [username, email, fullName, password_hash]
    );
    const userId = ins.rows[0].id;

    await c.query(
      `INSERT INTO core.user_role (user_id, role_id)
       SELECT $1, r.id FROM core.role r WHERE r.code = 'ADMIN'
       ON CONFLICT DO NOTHING`,
      [userId]
    );
    return ins.rows[0];
  });

  console.log(`Administrator ready: ${created.username} (id=${created.id})`);
} catch (err) {
  console.error('Failed to create admin:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
