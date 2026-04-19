-- RoadshowOps - Workflow engine permissions + sample definitions
\connect roadshowops

-- =========================================================================
-- Permissions
-- =========================================================================
INSERT INTO core.permission (code, layer, description) VALUES
  ('workflow.define', 'action', 'Create and edit workflow definitions'),
  ('workflow.view',   'action', 'View workflow instances and tasks'),
  ('vendor.read',     'action', 'Read vendors'),
  ('vendor.write',    'action', 'Create/update vendors')
ON CONFLICT (code) DO NOTHING;

-- Re-apply Administrator: all permissions
INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM core.role r CROSS JOIN core.permission p
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('OPS_MGR',  'workflow.define'), ('OPS_MGR',  'workflow.view'),
  ('OPS_MGR',  'vendor.read'),     ('OPS_MGR',  'vendor.write'),
  ('FINANCE',  'workflow.view'),   ('FINANCE',  'vendor.read'),
  ('APPROVER', 'workflow.view'),   ('APPROVER', 'vendor.read'),
  ('RECRUITER','workflow.view')
) AS m(role_code, perm_code)
JOIN core.role       r ON r.code = m.role_code
JOIN core.permission p ON p.code = m.perm_code
ON CONFLICT DO NOTHING;

-- =========================================================================
-- Sample definitions (insert if missing)
-- =========================================================================
INSERT INTO core.workflow_definition (code, version, entity_type, description) VALUES
  ('vendor_onboarding_v1',   1, 'vendor',         'Operations review -> Finance approval'),
  ('event_plan_approval_v1', 1, 'event_plan',     'Ops manager approval then finance sign-off'),
  ('collected_data_v1',      1, 'collected_data', 'Auditor review of submitted data')
ON CONFLICT (code, version) DO NOTHING;

-- Steps for vendor_onboarding_v1
INSERT INTO core.workflow_step (definition_id, sequence, name, assignee_permission, sla_hours, validation_rules)
SELECT d.id, s.sequence, s.name, s.assignee_permission, s.sla_hours, s.validation_rules::jsonb
FROM core.workflow_definition d
JOIN (VALUES
  ('vendor_onboarding_v1', 1, 'Operations review', 'approval.approve', 48,
     '[{"field":"legal_name","op":"required"},{"field":"contact_email","op":"required"}]'),
  ('vendor_onboarding_v1', 2, 'Finance approval',  'approval.approve', 72,
     '[{"field":"annual_budget_cents","op":"lte","value":100000000}]')
) AS s(code, sequence, name, assignee_permission, sla_hours, validation_rules)
  ON s.code = d.code
WHERE NOT EXISTS (
  SELECT 1 FROM core.workflow_step ws
   WHERE ws.definition_id = d.id AND ws.sequence = s.sequence
);

-- Steps for event_plan_approval_v1
INSERT INTO core.workflow_step (definition_id, sequence, name, assignee_permission, sla_hours, validation_rules)
SELECT d.id, s.sequence, s.name, s.assignee_permission, s.sla_hours, s.validation_rules::jsonb
FROM core.workflow_definition d
JOIN (VALUES
  ('event_plan_approval_v1', 1, 'Ops manager review', 'approval.approve', 48,
     '[{"field":"name","op":"required"},{"field":"min_headcount","op":"gte","value":1}]'),
  ('event_plan_approval_v1', 2, 'Finance sign-off',   'approval.approve', 72, '[]')
) AS s(code, sequence, name, assignee_permission, sla_hours, validation_rules)
  ON s.code = d.code
WHERE NOT EXISTS (
  SELECT 1 FROM core.workflow_step ws
   WHERE ws.definition_id = d.id AND ws.sequence = s.sequence
);

-- Steps for collected_data_v1
INSERT INTO core.workflow_step (definition_id, sequence, name, assignee_permission, sla_hours, validation_rules)
SELECT d.id, s.sequence, s.name, s.assignee_permission, s.sla_hours, s.validation_rules::jsonb
FROM core.workflow_definition d
JOIN (VALUES
  ('collected_data_v1', 1, 'Auditor review', 'approval.approve', 120,
     '[{"field":"source","op":"required"}]')
) AS s(code, sequence, name, assignee_permission, sla_hours, validation_rules)
  ON s.code = d.code
WHERE NOT EXISTS (
  SELECT 1 FROM core.workflow_step ws
   WHERE ws.definition_id = d.id AND ws.sequence = s.sequence
);
