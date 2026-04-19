// Account lockout: 5 failed attempts → 15-minute lock.
// Thresholds configurable via env (LOCKOUT_THRESHOLD / LOCKOUT_MINUTES).
import { config } from '../config.js';

export async function loadUserForLogin(client, username) {
  const { rows } = await client.query(
    `SELECT id, username, password_hash, is_active, failed_login_count, locked_until
       FROM core.app_user WHERE username = $1 FOR UPDATE`,
    [username]
  );
  return rows[0] || null;
}

export function isLocked(user, { now = new Date() } = {}) {
  if (!user) return { locked: false };
  if (!user.is_active) return { locked: true, reason: 'inactive' };
  if (user.locked_until && new Date(user.locked_until) > now) {
    return { locked: true, reason: 'locked', locked_until: user.locked_until };
  }
  return { locked: false };
}

/**
 * Increment the failure counter. When it reaches the threshold, the account
 * is locked and the counter resets so the next lock cycle is independent.
 */
export async function recordFailedLogin(client, userId) {
  const { rows } = await client.query(
    `UPDATE core.app_user
        SET failed_login_count = CASE
              WHEN failed_login_count + 1 >= $2 THEN 0
              ELSE failed_login_count + 1
            END,
            locked_until = CASE
              WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3)
              ELSE locked_until
            END,
            updated_at = now()
      WHERE id = $1
      RETURNING failed_login_count, locked_until`,
    [userId, config.lockoutThreshold, config.lockoutMinutes]
  );
  return rows[0];
}

export async function recordSuccessfulLogin(client, userId) {
  await client.query(
    `UPDATE core.app_user
        SET failed_login_count = 0,
            locked_until = NULL,
            updated_at = now()
      WHERE id = $1`,
    [userId]
  );
}

export async function adminUnlock(client, userId) {
  const { rows } = await client.query(
    `UPDATE core.app_user
        SET failed_login_count = 0,
            locked_until = NULL,
            updated_at = now()
      WHERE id = $1
      RETURNING id, username`,
    [userId]
  );
  return rows[0] || null;
}
