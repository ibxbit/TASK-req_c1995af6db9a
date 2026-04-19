-- RoadshowOps - additional least-privilege city-scoped role.
-- Used in production for per-city ops clerks and exercised by the scope tests.
\connect roadshowops

INSERT INTO core.role (code, name, description) VALUES
  ('CITY_CLERK', 'City Operations Clerk',
   'Per-city operations: orders, payments, inventory read. No cross-city access.')
ON CONFLICT (code) DO NOTHING;

-- Re-apply ADMIN = every permission (seed is idempotent; adding a role never
-- widens ADMIN beyond "everything" but keeps it consistent if new perms were
-- added earlier in the same boot).
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM core.role r CROSS JOIN core.permission p
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('CITY_CLERK', 'menu.dashboard'),
  ('CITY_CLERK', 'menu.finance'),
  ('CITY_CLERK', 'menu.inventory'),
  ('CITY_CLERK', 'menu.approvals'),
  ('CITY_CLERK', 'order.read'),
  ('CITY_CLERK', 'payment.collect'),
  ('CITY_CLERK', 'refund.issue'),
  ('CITY_CLERK', 'inventory.read'),
  ('CITY_CLERK', 'workflow.view'),
  ('CITY_CLERK', 'approval.submit'),
  ('CITY_CLERK', 'data.city.assigned')
) AS m(role_code, perm_code)
JOIN core.role       r ON r.code = m.role_code
JOIN core.permission p ON p.code = m.perm_code
ON CONFLICT DO NOTHING;
