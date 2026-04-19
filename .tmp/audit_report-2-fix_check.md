# RoadshowOps Fix Check Report (Targeted Re-Check)

## Scope

- Purpose: verify whether the specific fixes you attempted are actually present.
- Method: static-only code/doc/test inspection (no runtime/test execution).

## Fix Status (What You Asked to Fix)

- **1) Eliminate remaining low issues and code/doc/test-fixable gaps**: **Fixed**
  - Workflow instance object visibility enforced in list/detail paths.
  - Drive-time city-scope enforced for both origin and destination on GET/POST.
  - Vendor banking reveal hardened with strict field shape + audit metadata.
  - Evidence: `repo/backend/src/routes/workflow_engine.js:69`, `repo/backend/src/routes/workflow_engine.js:84`, `repo/backend/src/routes/venues.js:42`, `repo/backend/src/routes/venues.js:80`, `repo/backend/src/routes/vendors.js:143`.

- **2) Keep strict authz/data-scope intact**: **Fixed**
  - Object-level checks added for workflow instances.
  - City-scope checks present in inventory, payment intake, integration balance, and drive-time endpoints.
  - Evidence: `repo/backend/src/routes/workflow_engine.js:93`, `repo/backend/src/services/workflow_engine.js:420`, `repo/backend/src/routes/inventory.js:68`, `repo/backend/src/routes/payment_intake.js:35`, `repo/backend/src/routes/integrations.js:50`, `repo/backend/src/routes/venues.js:58`.

- **3) Add/adjust tests for each fix (positive + negative)**: **Fixed**
  - Workflow instance visibility matrix (403/hidden/initiator/elevated/404).
  - Drive-time scope matrix (in-scope success, out-of-scope 403, 400/404 edges, POST 403).
  - Lockout lifecycle (401→423, valid-during-lock 423, unlock, post-unlock success).
  - Vendor reveal RBAC matrix + response field-shape + audit metadata reason.
  - Intake null-city edge cases (city-scoped forbidden, global allowed, cross-scope blocked).
  - Evidence: `repo/API_tests/scope.test.js:249`, `repo/API_tests/scope.test.js:339`, `repo/API_tests/scope.test.js:428`, `repo/API_tests/lockout.test.js:47`, `repo/API_tests/rbac_matrix.test.js:118`, `repo/API_tests/intake_edge.test.js:48`.

- **4) Keep coverage gates >=95% for lines/statements/functions/branches**: **Fixed (static config/doc evidence)**
  - c8 thresholds set to 95 for all four metrics.
  - README reflects 95% gates for all four metrics.
  - Evidence: `repo/backend/.c8rc.json:17`, `repo/backend/.c8rc.json:19`, `repo/backend/.c8rc.json:20`, `repo/README.md:131`, `repo/README.md:133`.

- **5) Update README to match behavior exactly**: **Fixed**
  - README now documents workflow instance visibility, drive-time scope checks, vendor reveal governance, lockout lifecycle, and intake null-city rule.
  - Evidence: `repo/README.md:213`, `repo/README.md:225`, `repo/README.md:230`, `repo/README.md:239`, `repo/README.md:245`.

## Files Changed (Relevant to Verified Fixes)

- `repo/backend/src/routes/workflow_engine.js`
- `repo/backend/src/services/workflow_engine.js`
- `repo/backend/src/routes/venues.js`
- `repo/backend/src/routes/vendors.js`
- `repo/backend/src/routes/payment_intake.js`
- `repo/backend/src/routes/integrations.js`
- `repo/backend/src/routes/inventory.js`
- `repo/backend/.c8rc.json`
- `repo/README.md`
- `repo/API_tests/scope.test.js`
- `repo/API_tests/lockout.test.js`
- `repo/API_tests/rbac_matrix.test.js`
- `repo/API_tests/intake_edge.test.js`
- `repo/unit_tests/workflow_instance_visibility.test.js`

## Tests Added/Updated Per Fix Area

- **Workflow instance authz**: `repo/API_tests/scope.test.js`, `repo/unit_tests/workflow_instance_visibility.test.js`
- **Drive-time scope + edges**: `repo/API_tests/scope.test.js`
- **Vendor reveal governance/RBAC**: `repo/API_tests/rbac_matrix.test.js`
- **Lockout lifecycle**: `repo/API_tests/lockout.test.js`
- **Intake null-city edge**: `repo/API_tests/intake_edge.test.js`
- **Coverage threshold enforcement**: config in `repo/backend/.c8rc.json` (not a runtime test)

## Final “No Open Issues” Checklist (for your requested fix scope)

- [x] Remaining code/doc/test-fixable low issues addressed
- [x] Strict authz and city/data-scope controls preserved/enforced
- [x] Positive + negative tests added for major fixes
- [x] Coverage gates configured at >=95% for all four metrics
- [x] README synchronized with implemented behavior

## Boundary Note

- Runtime-only items (actual timer behavior and browser rendering quality) still require manual verification and are outside static-only proof.
