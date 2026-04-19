// Approval workflow lifecycle.
// Any module can submit an entity for review; Approvers decide.

function err(status, message) {
  return Object.assign(new Error(message), { status });
}

export async function submitApproval(client, userId, { entity_type, entity_id, summary, payload = null }) {
  if (!entity_type || entity_id == null || !summary) {
    throw err(400, 'entity_type, entity_id and summary are required');
  }
  const { rows } = await client.query(
    `INSERT INTO core.approval_request
       (entity_type, entity_id, summary, payload, requested_by)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, entity_type, entity_id, summary, payload,
               status, requested_by, created_at`,
    [entity_type, String(entity_id), summary, payload ? JSON.stringify(payload) : null, userId]
  );
  return rows[0];
}

export async function decideApproval(client, userId, requestId, decision, notes) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw err(400, "decision must be 'approved' or 'rejected'");
  }
  const check = await client.query(`SELECT status FROM core.approval_request WHERE id = $1`, [requestId]);
  if (!check.rows[0]) throw err(404, 'Not found');
  if (check.rows[0].status !== 'pending') throw err(409, 'Request is already decided');
  const { rows } = await client.query(
    `UPDATE core.approval_request
        SET status = $2, decided_by = $3, decided_at = now(),
            decision_notes = $4, updated_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING id, entity_type, entity_id, summary, status,
                requested_by, decided_by, decided_at, decision_notes`,
    [requestId, decision, userId, notes ?? null]
  );
  if (!rows[0]) throw err(409, 'Request is already decided');
  return rows[0];
}

export async function cancelApproval(client, userId, requestId) {
  const check = await client.query(`SELECT status, requested_by FROM core.approval_request WHERE id = $1`, [requestId]);
  if (!check.rows[0]) throw err(404, 'Not found');
  const { rows } = await client.query(
    `UPDATE core.approval_request
        SET status = 'canceled', updated_at = now()
      WHERE id = $1 AND status = 'pending' AND requested_by = $2
      RETURNING id, status`,
    [requestId, userId]
  );
  if (!rows[0]) throw err(409, 'Only the requester can cancel a pending request');
  return rows[0];
}

export async function listApprovals(client, { status = null, limit = 100 } = {}) {
  const args = [];
  let where = '';
  if (status) { args.push(status); where = `WHERE ar.status = $1`; }
  args.push(Math.min(Number(limit), 500));
  const { rows } = await client.query(
    `SELECT ar.id, ar.entity_type, ar.entity_id, ar.summary, ar.status,
            ar.requested_by, ru.username AS requested_by_username,
            ar.decided_by,  du.username AS decided_by_username,
            ar.decided_at, ar.decision_notes, ar.created_at, ar.updated_at
       FROM core.approval_request ar
       JOIN core.app_user ru ON ru.id = ar.requested_by
  LEFT JOIN core.app_user du ON du.id = ar.decided_by
       ${where}
      ORDER BY ar.created_at DESC
      LIMIT $${args.length}`,
    args
  );
  return rows;
}

export async function getApproval(client, requestId) {
  const { rows } = await client.query(
    `SELECT ar.*, ru.username AS requested_by_username,
            du.username AS decided_by_username
       FROM core.approval_request ar
       JOIN core.app_user ru ON ru.id = ar.requested_by
  LEFT JOIN core.app_user du ON du.id = ar.decided_by
      WHERE ar.id = $1`,
    [requestId]
  );
  return rows[0] || null;
}
