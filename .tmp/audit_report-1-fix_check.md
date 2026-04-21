# Fix Check Report: Static Audit Errors

This report reviews the previously encountered errors from the static audit and checks whether each is now fixed, with evidence from code, tests, and documentation.

---

## 1. Sensitive-data exposure hardening (`/vendors/:id/banking/reveal`)
**Status:** Fixed
- **Evidence:**
  - [API_tests/rbac_matrix.test.js](repo/API_tests/rbac_matrix.test.js): Tests for 401, 403, 404, 200, field filtering, audit metadata, and `reason`.
  - [README.md](repo/README.md): Documents vendor reveal governance, permission, audit, and reason field.

## 2. Auth lockout lifecycle edge-case coverage
**Status:** Fixed
- **Evidence:**
  - [API_tests/lockout.test.js](repo/API_tests/lockout.test.js): Tests for 5 failed attempts → 423, valid during lockout → 423, admin unlock, and post-unlock login.
  - [README.md](repo/README.md): Documents lockout lifecycle and admin unlock.

## 3. Payment-intake unlinked/null-city edge coverage
**Status:** Fixed
- **Evidence:**
  - [API_tests/intake_edge.test.js](repo/API_tests/intake_edge.test.js): Tests for city-scoped user 403, global user allowed, and cross-scope bypass.
  - [README.md](repo/README.md): Documents intake unlinked/null-city rule.

## 4. Route-level RBAC regression matrix for critical endpoints
**Status:** Fixed
- **Evidence:**
  - [API_tests/rbac_matrix.test.js](repo/API_tests/rbac_matrix.test.js): Negative tests for workflow instance, drive-time, vendor banking, admin audit/users (401/403/404).
  - [API_tests/scope.test.js](repo/API_tests/scope.test.js): Additional 404/403/400/200 edge cases for drive-time, workflow, etc.

## 5. Documentation synchronization
**Status:** Fixed
- **Evidence:**
  - [README.md](repo/README.md): Security invariants and edge-case behavior are explicit and accurate for all above items. Test inventory section lists new/updated tests.

## 6. Coverage quality (thresholds)
**Status:** Fixed
- **Evidence:**
  - [backend/coverage/coverage-summary.json](repo/backend/coverage/coverage-summary.json): 98.8%+ lines/statements, 100% functions, 95%+ branches. New tests are meaningful and tied to security/business risk.

---

## Residual Non-code Boundaries

The following items were surfaced in the original audit as outside static-only proof. They are tracked here with explicit status:

| Issue | Status | Notes |
|-------|--------|-------|
| UI runtime behaviors (browser aesthetics, drag-and-drop timers, rendering quality) | **Open** | Requires manual browser verification; not addressable by static code/test changes. |
| Integration with external systems beyond locally-imported file adapters | **Open** | No external service calls in scope; any future integration requires manual smoke testing. |

**All code/test/documentation-fixable errors from the previous audit are now fully addressed. The two Open items above are runtime-only and cannot be closed by static evidence.**
