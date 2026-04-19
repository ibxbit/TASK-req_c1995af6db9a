import { query } from '../db.js';

export async function logPermissionEvent({
  user,
  permissionCode,
  resource = null,
  action = null,
  entity_type = null,
  entity_id = null,
  granted,
  reason = null,
  request = null,
  metadata = null
}) {
  try {
    const workstation =
      request?.headers?.['x-workstation'] ??
      request?.headers?.['X-Workstation'] ??
      null;
    await query(
      `INSERT INTO audit.permission_event
         (user_id, username, permission_code, resource, action,
          entity_type, entity_id,
          granted, reason,
          http_method, http_path, ip_address, workstation, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        user?.id ?? null,
        user?.username ?? null,
        permissionCode,
        resource,
        action,
        entity_type,
        entity_id != null ? String(entity_id) : null,
        granted,
        reason,
        request?.method ?? null,
        request?.url ?? null,
        request?.ip ?? null,
        workstation,
        metadata ? JSON.stringify(metadata) : null
      ]
    );
  } catch (err) {
    request?.log?.error({ err }, 'Failed to write audit event');
  }
}
