-- RoadshowOps - Orders module seed (permissions + role mappings)
-- Run: psql -U postgres -d roadshowops -f database/seeds/003_orders_seed.sql

\connect roadshowops

INSERT INTO core.permission (code, layer, description) VALUES
  ('event.read',      'action', 'Read events'),
  ('event.write',     'action', 'Create/update/cancel events'),
  ('order.read',      'action', 'Read event orders'),
  ('order.write',     'action', 'Create/update event orders'),
  ('payment.collect', 'action', 'Record payments (receipts)'),
  ('refund.issue',    'action', 'Issue refunds')
ON CONFLICT (code) DO NOTHING;

-- Re-apply Administrator: all permissions
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM core.role r CROSS JOIN core.permission p
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('OPS_MGR', 'event.read'),   ('OPS_MGR', 'event.write'),
  ('OPS_MGR', 'order.read'),   ('OPS_MGR', 'order.write'),

  ('FINANCE', 'event.read'),
  ('FINANCE', 'order.read'),   ('FINANCE', 'order.write'),
  ('FINANCE', 'payment.collect'),
  ('FINANCE', 'refund.issue'),

  ('APPROVER','event.read'),   ('APPROVER','order.read')
) AS m(role_code, perm_code)
JOIN core.role       r ON r.code = m.role_code
JOIN core.permission p ON p.code = m.perm_code
ON CONFLICT DO NOTHING;
