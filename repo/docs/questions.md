# Clarifications, Assumptions, Scope Decisions, and Constraints

This document captures the decisions made during implementation that are not directly derivable from reading the code. It traces the highest-specificity requirements from the original prompt to their implementation and records every assumption or scope boundary that influenced design.

---

## Prompt-to-Feature Traceability

### 1. Itinerary schedule validation — 15-minute buffer and overlap detection

**Prompt:** "the UI flags schedule conflicts when events overlap or leave less than a 15-minute buffer between appointments"

**Implementation:** `GET /itineraries/:id/validate` (read-only) and the internal `computeIssues` service called inside every mutating itinerary-event operation (add, update, delete, reorder). Validation runs inside the same database transaction as the mutation; the transaction is rolled back and `422` is returned if the schedule is invalid after the change. Two issue types are produced: `overlap` (windows intersect) and `buffer` (gap between consecutive events is less than 15 minutes). The 15-minute constant is hardcoded in `services/itinerary.js` and is not configurable per-itinerary.

**Scope decision:** Validation is enforced server-side, not just client-side, to prevent invalid schedules from being saved through direct API calls. The validate endpoint is exposed separately so the UI can check without modifying state.

---

### 2. Drive time from venue coordinates with manual fallback

**Prompt:** "trip duration and distance are computed from locally stored venue coordinates when available, otherwise users enter a manual drive time that is carried forward in the schedule"

**Implementation:** `GET /venues/drive-time?origin=<id>&destination=<id>` returns a `source` field indicating `"coordinates"` or `"manual"`. When both venues have `latitude`/`longitude` populated, the service computes drive time from the Haversine distance and a fixed average speed constant (no external API). `POST /venues/drive-time` stores a manual override; once set, the manual value takes precedence and is carried forward for all subsequent itinerary schedule calculations involving those two venues.

**Assumption:** External routing or mapping APIs are explicitly out of scope for the offline-first constraint. Distance is estimated from straight-line coordinates.

---

### 3. Configurable payment stages with named due-rule types

**Prompt:** "configurable payment stages (for example, a $500.00 group deposit per city due within 24 hours and a final balance due 7 days before the first event date)"

**Implementation:** `POST /orders` accepts a `stages` array. Each stage has a `due_rule_type` that determines how the due date is computed at order-creation time:

| `due_rule_type` | Additional field | Example from prompt |
|---|---|---|
| `relative_to_order_creation` | `due_offset_minutes` | "due within 24 hours" → `1440` |
| `relative_to_event_start` | `due_offset_minutes` (negative = before) | "7 days before" → `-10080` |
| `absolute` | `due_at` (ISO datetime) | Fixed calendar date |

The sum of all `stage.amount_cents` must equal `order.total_amount_cents`; the service validates this before insert.

**Scope decision:** Stage templates (reusable named configurations) were not implemented; stages are specified inline per-order. The prompt describes stages as configurable per-order, not as global templates.

---

### 4. Automatic refunds on cancellation and headcount failure

**Prompt:** "triggers refunds when a group event is canceled or fails to meet a configurable minimum headcount by the cutoff date"

**Implementation:**
- `POST /events/:id/cancel` sets `status = 'canceled'` and immediately calls `evaluateRefunds`, which issues refund records for all paid stages of all active orders linked to the event.
- `POST /events/:id/headcount` updates `current_headcount` and calls `evaluateRefunds` if the cutoff has passed and the new count is below `min_headcount`. The response includes a `refund` object with `reason: "headcount_below_minimum"` and the number of refunds issued.
- `POST /events/:id/evaluate-refunds` exposes the same logic as an on-demand operator trigger.

**Scope decision:** `min_headcount` and `headcount_cutoff_at` are set at event-creation time and are not updatable after creation (updating them would create an audit integrity problem). Refund amounts are the full `amount_cents` of each paid stage; partial refunds require the manual `POST /orders/:id/stages/:stageId/refund` endpoint.

---

### 5. Inventory reservation lifecycle — 60-minute payment window

**Prompt:** "stock is reserved at order submission, released on cancellation, and automatically released if the order remains unpaid for 60 minutes"

**Implementation:** `RESERVATION_WINDOW_MINUTES = 60` is a named constant in `services/orders.js`. Reservations are created during `createEventOrder` with `expires_at = now() + 60 minutes`. A background sweep runs every 60 seconds (server startup interval in `server.js`) calling `sweepExpiredReservations`, which transitions any `active` reservation past its `expires_at` to `released`. `POST /inventory/reservations/sweep-expired` exposes the same function for on-demand operator use. When an order is canceled via `POST /orders/:id/cancel`, `releaseReservationsByReference` immediately releases all active reservations for that order's `reference_id`.

---

### 6. Stock ledger — who/when/why/before/after

**Prompt:** "every movement writes an auditable inventory ledger entry with who/when/why and before/after quantities"

**Implementation:** Every inventory write path (inbound, outbound, transfer, cycle count, reservation create/release/fulfill) writes a row to `audit.stock_ledger` containing `actor_user_id`, `occurred_at`, `reason`, `on_hand_before`, `on_hand_after`, `reserved_before`, `reserved_after`, `reference_type`, and `reference_id`. The table is insert-only; a database trigger rejects `UPDATE` and `DELETE` statements. `GET /inventory/ledger` exposes these entries with city-scope filtering.

---

### 7. Low-stock alerts — safety threshold default 10, editable per item

**Prompt:** "raises low-stock alerts when on-hand falls below the safety threshold (default 10 units, editable per item)"

**Implementation:** `core.item` has a `safety_threshold` column defaulting to `10`. `PUT /items/:id` can update it. `GET /inventory/alerts/low-stock` queries `core.v_low_stock_item` (global view for admin) or aggregates `core.v_stock_position` filtered by the user's city scope. An item appears in alerts when its total `available` (on_hand − reserved) across the user's accessible locations falls below its `safety_threshold`. Items the user has never stocked in their city are not surfaced.

---

### 8. WeChat Pay offline adapter — signed callbacks, idempotency, retry logic

**Prompt:** "supports a WeChat Pay–compatible adapter through locally imported transaction and callback files; callbacks are verified using signed payloads with a shared secret, processed idempotently, and retried up to 3 times at 5-minute intervals with compensating entries"

**Implementation:**
- `POST /payments/wechat/import-transactions` imports a local CSV/JSON file; each record is matched against `external_id` for idempotency (duplicate `external_id` values are skipped).
- `POST /payments/wechat/import-callbacks` imports callback files; each callback payload is verified against the configured shared secret before processing.
- Failed intakes (from any method including WeChat) are retried by `sweepPaymentRetries`, which reprocesses records with `status = 'failed'` and `attempt_count < 3` whose `next_attempt_at` has elapsed. The retry interval is 5 minutes (`next_attempt_at = now() + 5 minutes` after each failure).
- After 3 failed attempts, `status` is set to `'failed'` permanently. A `POST /payments/intake/:id/compensate` call issues a compensating refund entry to keep the financial ledger balanced.

**Scope decision:** The WeChat shared secret is stored as an environment variable, not in the database. File paths are relative to the server's configured inbox directory, consistent with the offline/on-prem constraint.

---

### 9. Ingestion scheduler — 6-hour minimum interval, checkpoint resume, policy hooks

**Prompt:** "scheduled jobs that ingest locally stored HTML/CSV exports from job boards, university career portals, and company sites using incremental parsing with checkpoint resume, a default minimum run interval of 6 hours per source, and reserved policy hooks for UA/IP/CAPTCHA handling without requiring any external service"

**Implementation:**
- `core.ingestion_source.min_interval_hours` defaults to `6` and is validated as `>= 6` on create/update.
- `POST /ingestion/sources/tick` (the scheduler tick) skips sources whose `last_run_started_at + min_interval_hours > now()` unless `force: true` is explicitly passed to `POST /ingestion/sources/:id/run`.
- `core.ingestion_checkpoint` stores `last_run_started_at`, `last_record_offset`, and a `cursor` string per source. Runs resume from the last checkpoint on restart.
- `core.ingestion_source` has columns `user_agent`, `ip_hint`, and `captcha_strategy` as reserved hooks; they are stored but not acted on by the current parser implementations (no external service is called).
- The server background worker triggers the tick every 5 minutes (configurable via environment variable).

---

### 10. Authentication security — 12-character minimum, lockout after 5 failures, AES-256 encryption

**Prompt:** "local username/password login with a minimum 12-character password, lockout after 5 failed attempts for 15 minutes, AES-256 encryption at rest for sensitive fields (such as tax IDs and bank routing data)"

**Implementation:**
- `POST /admin/users` enforces a minimum 12-character password at the API layer before hashing with bcryptjs (cost factor 12).
- Failed login counter is tracked in `core.app_user.failed_login_count` and `locked_until`. After 5 consecutive failures, `locked_until = now() + 15 minutes`. A successful login resets both fields. `POST /admin/users/:id/unlock` manually clears the lockout.
- `POST /auth/login` returns `401` (not `404`) for both unknown username and wrong password, preventing username enumeration.
- Vendor `tax_id`, `bank_routing`, and `bank_account` are encrypted with AES-256-GCM (`auth/crypto.js`) before storage. The encryption key is a 32-byte value from the `FIELD_ENCRYPTION_KEY` environment variable. `PUT /vendors/:id/banking` stores only ciphertext; `POST /vendors/:id/banking/reveal` decrypts on-demand and audit-logs every access.

---

### 11. Append-only audit logs retained for 7 years

**Prompt:** "append-only audit logs for key actions retained for 7 years with traceable access records per user and workstation"

**Implementation:**
- `audit.permission_event`, `audit.stock_ledger`, `audit.financial_ledger`, and `audit.payment_attempt` have database triggers that `RAISE EXCEPTION` on any `UPDATE` or `DELETE`.
- `GET /audit/retention` reports the retention policy (7 years) and the age of the oldest record in each table.
- `audit.permission_event` records `user_id`, `username`, `workstation`, `ip_address`, `http_method`, `http_path`, `permission_code`, `action`, `resource`, `entity_type`, `entity_id`, `granted`, `reason`, and `metadata` for every permission-gated operation.
- `GET /audit/stats/by-workstation` allows operators to trace all actions originating from a specific workstation identifier.

**Scope decision:** Workstation is submitted by the client as a request header (`X-Workstation-Id`). The server does not independently verify this value; it is recorded as-is and auditors are responsible for correlating it with physical machine records.

---

### 12. Workflow engine — return-for-changes, multi-step approval, 90-day archiving

**Prompt:** "evaluation workflow engine generates tasks against target objects (vendors, event plans, or collected postings) with timing and visibility controls, validation rules, return-for-changes, multi-node approvals, and automatic archiving after 90 days"

**Implementation:**
- `core.workflow_definition.steps` is a JSON array of step objects, each specifying `step` (integer), `assignee_permission` (the permission code that identifies eligible reviewers), and `label`.
- `POST /workflows/tasks/:id/return` implements return-for-changes: the instance returns to the initiator without moving to `rejected`; the initiator can resubmit via `POST /workflows/instances/:id/resubmit`.
- Visibility is object-level: a user can see an instance only if they initiated it, hold a step's `assignee_permission`, or hold `workflow.define` or `audit.read`.
- The background worker archives workflow instances older than 90 days (sets `status = 'archived'`). Archived instances remain readable via `GET /workflows/instances` but no further task actions are permitted.

**Scope decision:** Parallel steps (fan-out) are not implemented; steps are sequential (step 1 must complete before step 2 tasks are created). The prompt describes multi-node approvals but does not specify parallel vs. sequential; sequential was chosen as the simpler and more auditable path.

---

### 13. Role-based workspaces — menu, button, and data-scope permissions

**Prompt:** "each screen and action gated by menu, button, and data-scope permissions (for example, a recruiter can only see their assigned cities and cannot view finance details)"

**Implementation:**
- Three permission categories are used: `menu.*` (controls which navigation items appear), action permissions (controls which API endpoints are accessible), and `data.*` scope permissions (`data.city.all`, `data.city.assigned`, `data.finance.all`).
- `getCityScope(user)` returns `{ all: boolean, cityIds: number[] }` from the user's permission set. All city-scoped endpoints call this function and filter data accordingly.
- `data.finance.all` is a separate scope for finance data; users without it cannot access `GET /finance/transactions` even if they hold `finance.read`.
- `GET /auth/me` returns the full permission list, allowing the frontend to gate UI elements without additional API calls.

---

## Additional Assumptions

**Offline-first constraint:** No external network calls are made at runtime. Venue coordinate-based drive time, WeChat Pay, and ingestion all operate from locally stored data. The backend has no HTTP client for outbound requests.

**Single-region database:** PostgreSQL is the sole persistence layer. No Redis, message queue, or external cache is used. Background workers are in-process intervals on the Fastify server process.

**JWT expiry:** Tokens have a configurable TTL (default 24 hours from `config.js`). There is no token refresh endpoint; clients must re-authenticate when a token expires. Token revocation is not implemented — logging out on the client simply discards the token.

**Currency:** `currency` defaults to `"USD"` on orders. Multi-currency amounts are stored but the financial ledger does not perform cross-currency conversion. All monetary comparisons (stage totals, balance calculations) assume the same currency within an order.

**Sequence numbers:** Order numbers (`ORD-YYYY-NNNNNN`), invoice numbers (`INV-`), receipt numbers (`RCP-`), and refund numbers (`REF-`) are generated from PostgreSQL sequences (`core.seq_order_number`, etc.). They are globally monotonic within the year, not scoped per city.

**Password hashing:** bcryptjs with cost factor 12. The minimum 12-character password is validated server-side on user creation; bcrypt truncates at 72 bytes, so very long passwords beyond that are not flagged.

**Workflow definitions are versioned but not branched:** `core.workflow_definition` has a `version` column. The system selects the most recent `is_active = true` definition for a given `entity_type` when initiating a new instance. Updating a definition does not affect in-flight instances, which are bound to the definition version at initiation time.

**Ingestion idempotency key:** `core.ingestion_record.external_key` plus `source_id` forms the idempotency key. Re-ingesting the same file produces no duplicates if `external_key` values are stable across imports.
