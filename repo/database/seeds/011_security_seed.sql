-- RoadshowOps - Banking permissions for vendor sensitive-data access
\connect roadshowops

INSERT INTO core.permission (code, layer, description) VALUES
  ('vendor.banking.read',  'action', 'Reveal decrypted vendor banking/tax fields'),
  ('vendor.banking.write', 'action', 'Set/update vendor banking/tax fields')
ON CONFLICT (code) DO NOTHING;

-- Re-apply Administrator: all permissions
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM core.role r CROSS JOIN core.permission p
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('FINANCE', 'vendor.banking.read'),
  ('FINANCE', 'vendor.banking.write')
) AS m(role_code, perm_code)
JOIN core.role       r ON r.code = m.role_code
JOIN core.permission p ON p.code = m.perm_code
ON CONFLICT DO NOTHING;
