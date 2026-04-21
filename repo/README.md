# RoadshowOps Operations Suite

**Project Type: fullstack** — Fastify REST API (backend) + Svelte 4 SPA (frontend) + PostgreSQL 16 (database).

Offline-first, on-prem operations platform for multi-city recruiting roadshows.
Fastify + PostgreSQL + Svelte. Fully offline — no external APIs, no SaaS, no
internet calls at runtime.

---

## 1. One-click start

```bash
docker compose up
```

That is the only command required. On first run the Postgres volume
initializes, the backend applies **every migration** (`database/migrations/*.sql`)
in lexical order, then **every seed** (`database/seeds/*.sql`) in lexical order,
then runs a schema-integrity verifier, then bootstraps an administrator
account, and finally starts the API. The frontend dev server is brought up
alongside and begins proxying `/api` to the backend.

**Bootstrap failure semantics.** Every SQL file is applied with
`ON_ERROR_STOP=1`. Any failure — a broken migration, a missing object, a
failed seed — aborts startup immediately with a non-zero exit and a
`[entrypoint] FATAL:` line in the logs. There are no silent skips. After all
migrations and seeds have run, `src/scripts/verify-schema.js` asserts that
every runtime-required table, view, column, and audit source is present; if
anything is missing the container exits before Fastify is started.

`database/schema.sql` is retained as a **partial snapshot** of migrations
001..007 for reference/baseline diffing only — it is *not* part of the boot
path. The canonical source of truth for the schema is `database/migrations/`.

No manual `.env` edits and no manual SQL imports are needed.

To stop: `docker compose down`. To wipe state and start clean: `docker compose down -v`.

---

## 2. Services

| Service   | URL                          | Purpose                                 |
|-----------|------------------------------|-----------------------------------------|
| Frontend  | http://localhost:3000        | Svelte UI (Vite dev server)             |
| API       | http://localhost:4000        | Fastify REST backend                    |
| Database  | localhost:5432               | PostgreSQL 16 (user `postgres` / `postgres`, db `roadshowops`) |

Default administrator (configurable via `docker-compose.yml` env):

- Username: `admin`
- Password: `RoadshowOpsAdmin1!`

Health check: `curl http://localhost:4000/health`

### Role credentials

The seeded database includes only the `admin` account. Create test accounts for other roles using `POST /admin/users` (requires `admin` token). Example credentials used in automated tests:

| Role        | Example username | Example password      | Key permissions                                                    |
|-------------|------------------|-----------------------|--------------------------------------------------------------------|
| ADMIN       | `admin`          | `RoadshowOpsAdmin1!`  | All permissions, all cities                                        |
| WAREHOUSE   | `wh-user`        | `Warehouse_Secure1!`  | inventory.read/write/issue, data.city.assigned                     |
| RECRUITER   | `rec-user`       | `Recruiter_Secure1!`  | candidate.read/write, itinerary.read/write, venue.read/write       |
| FINANCE     | `fin-user`       | `Finance_Secure12!`   | finance.read/write, order.read/write, payment.collect, refund.issue|
| APPROVER    | `appr-user`      | `Approver_Secure1!`   | approval.approve/reject, audit.read, order.read, data.city.all     |
| CITY_CLERK  | `clerk-user`     | `CityClerk_Secure1!`  | order.read, payment.collect, refund.issue, data.city.assigned      |

Password policy enforced on all accounts: minimum 12 characters, at least one uppercase letter, one digit, and one special character.

---

## 3. Verify core features

1. Open http://localhost:3000 and sign in as `admin` with the default password.
2. The top navigation shows every menu available to your role. Recruiter /
   Warehouse Clerk / Finance Analyst / Approver accounts can be created via
   **Admin** (or `POST /admin/users`) and will see only the menus their role
   entitles them to.
3. **Inventory** — open the Inventory menu. The table auto-refreshes every
   5 seconds. Create a warehouse, a location, and an item via the API:
   ```bash
   TOKEN=$(curl -s -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"RoadshowOpsAdmin1!"}' \
     http://localhost:4000/auth/login | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token')
   curl -s -X POST http://localhost:4000/warehouses \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"city_id":1,"code":"WH1","name":"Manhattan"}'
   ```
   Reservations (`POST /inventory/reservations`) visibly decrease `available`
   on the dashboard within one polling cycle.
4. **Recruiting → Itineraries** — create an itinerary, add events whose times
   overlap or fall within 15 minutes of each other — the conflict panel shows
   the exact violation (`overlap`, `buffer`, `drive_time_missing`).
5. **Finance → Orders** — create an order with staged payments, then record a
   receipt (`POST /orders/:id/stages/:stageId/receipts`). The stage flips to
   `paid`, reservations for that order are confirmed (60-min expiry cleared),
   and an entry appears in the immutable financial ledger
   (`GET /integrations/financial-ledger?order_id=...`).
6. **Approvals** — the task inbox lists only tasks whose step permission the
   signed-in user holds. Decide one; the workflow instance advances or closes.
7. **Audit** — every request you just made is queryable at
   `GET /audit/events?workstation=…&user_id=…&action=…`. Audit tables are
   append-only at the DB trigger level (`UPDATE/DELETE/TRUNCATE` are rejected).
8. **Consistency** — `GET /integrations/consistency` runs 10 cross-module
   orphan and state-divergence checks and returns `{ consistent: true }` on a
   freshly seeded database.

---

## 4. Run tests

### Required: single Docker command (covers all test suites)

```bash
./run_tests.sh
```

The only command needed. Idempotently brings up the compose stack, waits for
`/health`, and runs **all** test suites inside their respective containers —
no host-side npm install or Node.js installation required beyond Docker:

| Step | What runs | Container |
|------|-----------|-----------|
| [3/5] | Backend unit tests (`unit_tests/`) | `backend` |
| [4/5] | Backend API tests (`API_tests/`) against live Postgres | `backend` |
| [5/5] | Frontend unit tests (`frontend/src/**/*.test.js`) | `frontend` |

The frontend container's Dockerfile runs `npm install` during `docker build`,
so Vitest and all testing libraries are already present when the container
starts — `run_tests.sh` just calls `npx vitest run` inside it.

Expected terminal output (all suites passing):
```
[3/5] Running backend unit tests (unit_tests/)...
✔  N tests passed, 0 failed
[4/5] Running backend API tests (API_tests/)...
✔  N tests passed, 0 failed
[5/5] Running frontend unit tests (frontend/src/**/*.test.js)...
✔ src/App.test.js                     4 tests
✔ src/lib/Guard.test.js               5 tests
✔ src/lib/api.test.js                11 tests
✔ src/lib/DashboardWorkspace.test.js  4 tests
✔ src/lib/permissions.test.js         9 tests
✔ src/lib/session.test.js             9 tests
OK: all tests passed.
```

### 4.1 Coverage thresholds

`npm run coverage:check` enforces on backend production code (`backend/src/**`,
excluding bootstrap wiring — `server.js`, `db.js`, `config.js`, `scripts/`):

| Metric     | Threshold | Current (last run) |
|------------|-----------|--------------------|
| Lines      | ≥ 95 %    | 98.84 %            |
| Statements | ≥ 95 %    | 98.84 %            |
| Functions  | ≥ 95 %    | 100.00 %           |
| Branches   | ≥ 95 %    | 95.17 %            |

All four metrics are held at **95 %** and enforced by `coverage:check`.
Branch coverage uses c8's V8-native counting (every short-circuit `||`,
optional chaining `?.`, and default-parameter expression becomes two
branches). The additional visibility and city-scope code paths added in
the hardening pass are fully covered by the new unit and API tests.

Mocks used by unit tests (`unit_tests/_fakes.js`, `unit_tests/_route_harness.js`)
intercept `pool.query` and `pool.connect` at the module level. They are
scoped to test-only imports and cannot activate in a production run — the
real `pg.Pool` in `src/db.js` is what gets shipped.

### 4.2 Test inventory

- `unit_tests/`
  - `password.test.js` — password policy (min length 12, uppercase, digit, special character)
  - `crypto.test.js` — AES-256-GCM round-trip, IV freshness, tamper detection, masking
  - `itinerary_conflicts.test.js` — overlap detection + 15-minute buffer enforcement
  - `drive_time.test.js` — resolver returns `distance_km` when computing from coordinates, `null` otherwise
  - `workflow_task_visibility.test.js` — `loadTaskForUser` enforces assignee / initiator / allowed-role visibility
  - `workflow_instance_visibility.test.js` — `checkInstanceVisibility` and user-filtered `listInstances`; covers all visibility branches
  - `services_*.test.js` — unit coverage of every service module with mocked DB clients
  - `routes_*.test.js` — unit coverage of every route module via the route harness (includes drive-time city-scope 404/403 and workflow instance 403 branches)
  - `infra.test.js` — auth/rbac/middleware/plugins
- `API_tests/`
  - `auth.test.js` — login, bad creds 401, `/auth/me`
  - `rbac.test.js` — admin can hit `/admin/users`, recruiter cannot; weak password rejected
  - `lockout.test.js` — full lockout lifecycle: 4× bad → 401, 5th → 423, valid-during-lock → 423, admin unlock → 200, login after unlock → 200
  - `rbac_matrix.test.js` — 401 (no token) and 403 (wrong permission) matrix for workflow instances, drive-time, vendor banking reveal/write, admin audit/users; authorized vendor reveal returns exact response fields and logs reason in audit metadata
  - `audit_stats.test.js` — GET /audit/events, /audit/log, /audit/stats/by-user, /audit/stats/by-workstation, /audit/stats/by-action, /audit/retention; 401/403/200 per endpoint
  - `candidates.test.js` — GET/POST /candidates: 401/403/400/201; city-scope enforcement; WAREHOUSE user blocked
  - `events.test.js` — GET/POST /events, GET /events/:id, POST /events/:id/headcount (400/404/200), POST /events/:id/cancel (200 + 409 re-cancel), POST /events/:id/evaluate-refunds
  - `ingestion.test.js` — GET /ingestion/resources, POST /ingestion/:resource (401/403/400/201/unknown-resource), GET/POST /ingestion/sources, GET /ingestion/sources/:id, POST /ingestion/sources/:id/run, GET .../records, GET .../checkpoint
  - `items.test.js` — GET/POST/PUT /items: 401/403/400/404/201/200; FINANCE user blocked on writes
  - `inventory.test.js` — inbound → reserve → over-reserve 409 → low-stock alert → append-only ledger
  - `inventory_ops.test.js` — POST /inventory/transfer (401/400/201), POST /inventory/cycle-counts (401/400/201), POST/GET reservations, release, fulfill, sweep-expired, GET /inventory/movements
  - `itineraries.test.js` — GET/POST /itineraries, GET/PUT /itineraries/:id, /validate, /events (400/201), /reorder (400), /versions, /versions/:n
  - `itinerary_templates.test.js` — GET/POST /itinerary-templates (401/403/400/201), GET /itinerary-templates/:id (404/200), POST /itinerary-templates/:id/apply (404/200)
  - `orders_list.test.js` — GET /orders (401/403/200), GET /orders/:id (401/404), POST /orders/:id/cancel (401/404/200)
  - `orders_payments.test.js` — create order + stages, record receipt, verify financial ledger, manual refund, duplicate receipt rejected
  - `payments_read.test.js` — GET /payments/receipts, /refunds (401/403/200), GET /payments/stages/:id (401/404), GET/POST /payments/intake (401/403/400/200/201), GET /payments/intake/:id (401/404/200), POST /payments/intake/sweep-retries, POST /payments/wechat/import-transactions/import-callbacks (401/400), GET /payments/reconciliation (401/403/200)
  - `vendors.test.js` — GET/POST /vendors (401/403/400/201), GET/PUT /vendors/:id/banking (401/404/200), POST /vendors/:id/banking/reveal (401/404/200)
  - `venues.test.js` — GET/POST /venues (401/403/400/201), GET/POST /venues/drive-time (401/400/200)
  - `warehouses.test.js` — GET/POST /warehouses (401/403/400/201), GET /warehouses/:id (404/200), POST /warehouses/:id/locations (400/201)
  - `workflows_approvals.test.js` — GET/POST /workflows/approvals (401/403/400/201), GET /workflows/approvals/:id (404/200), POST /workflows/approvals/:id/approve (401/404/200), /reject (404/200), /cancel (404/200)
  - `workflow_engine.test.js` — GET/POST /workflows/definitions (401/403/400/201), GET /workflows/definitions/:id (404/200), GET/POST /workflows/instances (401/403/400/201), GET /workflows/instances/:id (404), POST .../cancel (404), .../resubmit (404), GET /workflows/tasks/mine (401/403/200), GET /workflows/tasks/:id (404), POST .../approve/reject/return (404)
  - `consistency.test.js` — `/integrations/consistency` is clean, workstation header captured, retention policy reports 7 years
  - `scope.test.js` — city scope on inventory reads (low-stock / ledger / movements), payment-intake `process` / `compensate`, `/integrations/orders/:id/balance`; object-level visibility on `/workflows/tasks/:id` and `/workflows/instances/:id` (Cases A–D); drive-time city-scope matrix (in-scope success, out-of-scope origin 403, mixed-scope 403, POST out-of-scope 403); explicit 404 for non-existent instance; drive-time 400/404 edge cases; `distance_km` exposed on `/venues/drive-time`
  - `intake_edge.test.js` — unlinked intake (order_id = null): city-scoped user → 403 on process and compensate; global user (data.city.all) → passes scope guard; cross-scope bypass check (city 1 clerk cannot process city 2 intake)
  - `bootstrap_integrity.test.js` — required tables, views, and audit sources are reachable after bootstrap

- `frontend/src/` — run via `./run_tests.sh` (step 5) or `cd frontend && npm test`
  - `App.test.js` — unauthenticated state: title rendered, "Sign in" heading + button visible, no "Sign out" button
  - `lib/session.test.js` — token/me store init from localStorage, setSession, clearSession, permissions derived store, isAuthed, getToken (9 tests)
  - `lib/permissions.test.js` — PERMISSIONS constants, MENU_ITEMS structure (8 items), can() true/false/null-me, visibleMenu filtering (9 tests)
  - `lib/api.test.js` — getWorkstation generate+cache, setWorkstation store/clear, Authorization header present/absent, X-Workstation header, JSON body serialisation, 401 clears session, error thrown on non-ok, data returned on success (11 tests)
  - `lib/Guard.test.js` — hide mode: renders slot when permission held, hides when lacking, hides when unauthenticated; disable mode: .guard-disabled+aria-disabled when lacking, no wrapper when permitted (5 tests)
  - `lib/DashboardWorkspace.test.js` — welcome heading with full name, role name rendered, assigned city listed, accessible menu area shown (4 tests)

---

## 5. Directory layout

```
repo/
├── docker-compose.yml
├── README.md
├── run_tests.sh
├── unit_tests/
├── API_tests/
├── backend/
│   ├── Dockerfile
│   ├── docker-entrypoint.sh
│   ├── package.json
│   └── src/
│       ├── server.js
│       ├── config.js, db.js
│       ├── auth/        (JWT, bcrypt, lockout, field encryption)
│       ├── rbac/        (permissions, enforce, audit)
│       ├── middleware/  (validate, auto-audit mutations)
│       ├── services/    (business logic — orders, inventory, itinerary, workflow engine, payments, ingestion…)
│       ├── routes/      (thin Fastify handlers)
│       └── scripts/     (create-admin bootstrap)
├── frontend/
│   ├── Dockerfile
│   ├── vite.config.js
│   └── src/
│       ├── App.svelte
│       └── lib/         (api, session, permissions, Guard, itinerary, inventory, orders, workflows)
└── database/
    ├── schema.sql       (partial 001..007 snapshot — reference only, NOT applied at boot)
    ├── migrations/      (001…013 — applied in lexical order on every container start)
    ├── seeds/           (permissions, role mappings, sample cities/venues, workflow definitions, scoped roles)
    └── init.sql
```

Every module is city-scoped (row-level), RBAC-gated at the route layer, and
audit-logged — business logic sits in `services/`, routes stay thin, and DB
constraints (FKs, CHECKs, append-only triggers) are the last line of defence.

---

## 6. Security / scope invariants (enforced + tested)

- **Workflow instance object-level visibility.** `GET /workflows/instances/:id`
  and `GET /workflows/instances` enforce per-object visibility: a user may see
  an instance only if they are the initiator, hold a step's
  `assignee_permission` (any task in the instance), or are elevated
  (`workflow.define` / `audit.read`). All other users receive `403` on the
  detail endpoint and the instance is excluded from the list response.
  Visibility logic is centralized in `checkInstanceVisibility` (service layer)
  and the SQL-level `listInstances` filter.
- **Workflow task object-level visibility.** `GET /workflows/tasks/:id` returns
  the task only to (a) users holding the step's `assignee_permission`, (b) the
  instance initiator, or (c) holders of `workflow.define` / `audit.read`.
  Everyone else gets `403`, even with `workflow.view`.
- **Drive-time city scope.** `GET /venues/drive-time` and
  `POST /venues/drive-time` resolve the `city_id` of both the origin and
  destination venue and call `assertCityAccess` on each before processing.
  If either venue is outside the user's assigned scope → `403`. Unknown venue
  IDs return `404`. Users with `data.city.all` pass both checks unconditionally.
- **Vendor banking reveal governance.** `POST /vendors/:id/banking/reveal`
  requires `vendor.banking.read` (FINANCE / ADMIN only). Every invocation is
  audit-logged with the list of revealed fields and an optional `reason`
  justification supplied in the request body (`{ "reason": "..." }`). The
  response contains exactly four fields: `vendor_id`, `tax_id`,
  `bank_routing`, `bank_account`. Missing `reason` is accepted (logged as
  `null`); it is recommended but not enforced so as not to break existing
  integrations. All failure paths return the correct status: `401` (no token),
  `403` (wrong permission), `404` (vendor not found).
- **Password complexity.** `validatePasswordStrength` enforces: minimum 12
  characters (configurable via `PASSWORD_MIN_LENGTH`), at least one uppercase
  letter, at least one digit, and at least one special character. Violations
  return `400`. Applied on `POST /admin/users` and `POST /auth/register`.
  Duplicate username or email returns `409` instead of a raw DB error.
- **Account lockout lifecycle.** Five consecutive failed login attempts lock
  the account for 15 minutes (configurable via `LOCKOUT_THRESHOLD` /
  `LOCKOUT_MINUTES`). While locked, even valid credentials return `423` with a
  `locked_until` timestamp. `POST /admin/users/:id/unlock` (requires
  `user.manage`) clears the lock immediately; the next login with correct
  credentials returns `200`. Each lock/unlock event is audit-logged.
- **Payment-intake city scope.** `POST /payments/intake/:id/process` and
  `/compensate` resolve `intake → order → city_id` and enforce
  `assertCityAccess` before mutating. Non-global users attempting an
  out-of-scope intake get `403`. Intakes with no linked order (`order_id =
  null`, city_id null) are treated as unscoped: only users holding
  `data.city.all` may act on them; all city-scoped users receive `403`.
- **Inventory city scope on reads.** `/inventory/alerts/low-stock`,
  `/inventory/ledger`, and `/inventory/movements` filter by the user's
  assigned cities. Admin / `data.city.all` users see every city.
- **Integrations order balance.** `GET /integrations/orders/:id/balance`
  enforces `assertCityAccess` against the order's city.

## 7. API additions

- `GET /venues/drive-time?origin=&destination=` returns
  `{ minutes, source, distance_km }`. `distance_km` is a non-null number when
  `source === 'computed'` (i.e. we haversined from venue coordinates) and
  `null` for `manual`, `manual_required`, and `none`. Both origin and
  destination venue IDs must exist (`404` otherwise) and must be within the
  caller's assigned city scope (`403` otherwise). Consumers of drive time
  (itinerary conflict detector) surface the distance on the `buffer` issue as
  `driveDistanceKm`.
- `POST /venues/drive-time` persists a manual drive time; applies the same
  venue existence (`404`) and city scope (`403`) checks as the GET endpoint.

## 8. Frontend role workspaces

Every menu entry maps to a permission-gated workspace in the UI:

| Menu        | Permission       | Workspace component                              |
|-------------|------------------|--------------------------------------------------|
| Dashboard   | `menu.dashboard` | `lib/DashboardWorkspace.svelte`                  |
| Recruiting  | `candidate.read` | `lib/itinerary/Itineraries.svelte`               |
| Roadshows   | `menu.roadshow`  | `lib/roadshow/RoadshowWorkspace.svelte`          |
| Inventory   | `inventory.read` | `lib/inventory/InventoryDashboard.svelte`        |
| Finance     | `finance.read`   | `lib/orders/OrdersView.svelte`                   |
| Approvals   | `menu.approvals` | `lib/workflows/TaskInbox.svelte`                 |
| Audit       | `audit.read`     | `lib/audit/AuditWorkspace.svelte`                |
| Admin       | `menu.admin`     | `lib/admin/AdminWorkspace.svelte`                |

Views outside a user's permission set render a "not available to your role"
placeholder; they are never populated with upstream data.
