-- RoadshowOps - Approval/ingestion permissions
\connect roadshowops

INSERT INTO core.permission (code, layer, description) VALUES
  ('approval.submit', 'action', 'Submit entities for approval'),
  ('data.ingest',     'action', 'Bulk ingest data from local files or JSON payloads')
ON CONFLICT (code) DO NOTHING;

-- Re-apply Administrator: all permissions
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM core.role r CROSS JOIN core.permission p
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('OPS_MGR',   'approval.submit'), ('OPS_MGR',   'data.ingest'),
  ('FINANCE',   'approval.submit'),
  ('RECRUITER', 'approval.submit'),
  ('APPROVER',  'approval.submit')
) AS m(role_code, perm_code)
JOIN core.role       r ON r.code = m.role_code
JOIN core.permission p ON p.code = m.perm_code
ON CONFLICT DO NOTHING;
