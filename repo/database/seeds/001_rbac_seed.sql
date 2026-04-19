-- RoadshowOps - RBAC seed data (roles, permissions, mappings, sample cities)
-- Run: psql -U postgres -d roadshowops -f database/seeds/001_rbac_seed.sql

\connect roadshowops

-- =========================================================================
-- Roles
-- =========================================================================
INSERT INTO core.role (code, name, description) VALUES
  ('ADMIN',      'Administrator',       'Full system access'),
  ('OPS_MGR',    'Operations Manager',  'Manage roadshows, recruiting, inventory, approvals'),
  ('RECRUITER',  'Recruiter',           'Manage candidates for assigned cities only'),
  ('WAREHOUSE',  'Warehouse Clerk',     'Manage inventory for assigned cities'),
  ('FINANCE',    'Finance Analyst',     'Manage financial transactions and reporting'),
  ('APPROVER',   'Approver/Auditor',    'Approve submissions and audit activity')
ON CONFLICT (code) DO NOTHING;

-- =========================================================================
-- Permissions
-- =========================================================================
INSERT INTO core.permission (code, layer, description) VALUES
  -- Menu layer
  ('menu.dashboard',   'menu',   'View dashboard menu'),
  ('menu.recruiting',  'menu',   'View recruiting menu'),
  ('menu.roadshow',    'menu',   'View roadshow menu'),
  ('menu.inventory',   'menu',   'View inventory menu'),
  ('menu.finance',     'menu',   'View finance menu'),
  ('menu.approvals',   'menu',   'View approvals menu'),
  ('menu.audit',       'menu',   'View audit menu'),
  ('menu.admin',       'menu',   'View administration menu'),

  -- Action layer
  ('candidate.read',   'action', 'Read candidates'),
  ('candidate.write',  'action', 'Create/update candidates'),
  ('roadshow.read',    'action', 'Read roadshows'),
  ('roadshow.write',   'action', 'Create/update roadshows'),
  ('inventory.read',   'action', 'Read inventory'),
  ('inventory.write',  'action', 'Create/update inventory'),
  ('inventory.issue',  'action', 'Issue inventory items'),
  ('finance.read',     'action', 'Read financial data'),
  ('finance.write',    'action', 'Create/update financial transactions'),
  ('approval.approve', 'action', 'Approve submissions'),
  ('approval.reject',  'action', 'Reject submissions'),
  ('audit.read',       'action', 'Read audit log'),
  ('user.manage',      'action', 'Manage users'),
  ('role.manage',      'action', 'Manage roles and permissions'),

  -- Data layer
  ('data.city.all',      'data', 'Access all cities'),
  ('data.city.assigned', 'data', 'Access only cities assigned to user'),
  ('data.finance.all',   'data', 'Access all financial data')
ON CONFLICT (code) DO NOTHING;

-- =========================================================================
-- Role -> Permission mappings
-- =========================================================================

-- Administrator: all permissions
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM core.role r
CROSS JOIN core.permission p
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

-- Non-admin role mappings
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  -- Operations Manager
  ('OPS_MGR','menu.dashboard'),('OPS_MGR','menu.recruiting'),('OPS_MGR','menu.roadshow'),
  ('OPS_MGR','menu.inventory'),('OPS_MGR','menu.approvals'),
  ('OPS_MGR','candidate.read'),('OPS_MGR','candidate.write'),
  ('OPS_MGR','roadshow.read'),('OPS_MGR','roadshow.write'),
  ('OPS_MGR','inventory.read'),
  ('OPS_MGR','approval.approve'),('OPS_MGR','approval.reject'),
  ('OPS_MGR','data.city.all'),

  -- Recruiter (city-scoped, NO finance)
  ('RECRUITER','menu.dashboard'),('RECRUITER','menu.recruiting'),
  ('RECRUITER','candidate.read'),('RECRUITER','candidate.write'),
  ('RECRUITER','data.city.assigned'),

  -- Warehouse Clerk (city-scoped)
  ('WAREHOUSE','menu.dashboard'),('WAREHOUSE','menu.inventory'),
  ('WAREHOUSE','inventory.read'),('WAREHOUSE','inventory.write'),('WAREHOUSE','inventory.issue'),
  ('WAREHOUSE','data.city.assigned'),

  -- Finance Analyst
  ('FINANCE','menu.dashboard'),('FINANCE','menu.finance'),
  ('FINANCE','finance.read'),('FINANCE','finance.write'),
  ('FINANCE','data.city.all'),('FINANCE','data.finance.all'),

  -- Approver/Auditor
  ('APPROVER','menu.dashboard'),('APPROVER','menu.approvals'),('APPROVER','menu.audit'),
  ('APPROVER','menu.finance'),('APPROVER','menu.recruiting'),('APPROVER','menu.roadshow'),
  ('APPROVER','menu.inventory'),
  ('APPROVER','approval.approve'),('APPROVER','approval.reject'),('APPROVER','audit.read'),
  ('APPROVER','candidate.read'),('APPROVER','roadshow.read'),
  ('APPROVER','inventory.read'),('APPROVER','finance.read'),
  ('APPROVER','data.city.all'),('APPROVER','data.finance.all')
) AS m(role_code, perm_code)
JOIN core.role       r ON r.code = m.role_code
JOIN core.permission p ON p.code = m.perm_code
ON CONFLICT DO NOTHING;

-- =========================================================================
-- Sample cities (multi-city roadshow)
-- =========================================================================
INSERT INTO core.city (code, name) VALUES
  ('NYC', 'New York'),
  ('SFO', 'San Francisco'),
  ('CHI', 'Chicago'),
  ('AUS', 'Austin'),
  ('SEA', 'Seattle')
ON CONFLICT (code) DO NOTHING;
