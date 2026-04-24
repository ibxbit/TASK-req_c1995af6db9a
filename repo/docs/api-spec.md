# RoadshowOps API Specification

## Overview

| Property | Value |
|---|---|
| Base URL | `http://<host>:3000` |
| Auth | `Authorization: Bearer <JWT>` on all routes except `POST /auth/login` and `GET /health` |
| Content-Type | `application/json` |
| Timestamps | ISO 8601 UTC strings |
| Monetary values | Integer cents (e.g. `50000` = $500.00) |
| City scoping | Enforced server-side; users with `data.city.assigned` see only rows in their assigned cities. Users with `data.city.all` bypass the filter. Scoped endpoints return `[]` (not 403) when a user has no cities assigned. |

---

## Common Error Shapes

```json
{ "error": "Human-readable message" }
{ "error": "Validation failed", "issues": [{ "type": "overlap", ... }] }
```

| Status | Meaning |
|---|---|
| 400 | Missing or invalid required field |
| 401 | Missing or invalid JWT |
| 403 | Permission denied or city out of scope |
| 404 | Resource not found |
| 409 | Conflict (e.g. duplicate username, already-canceled resource) |
| 422 | Domain validation failure (returned with `issues` array) |
| 423 | Account locked after too many failed logins |

---

## Permission Codes

### Menu (8)
`menu.dashboard`, `menu.recruiting`, `menu.roadshow`, `menu.inventory`, `menu.finance`, `menu.approvals`, `menu.audit`, `menu.admin`

### Action (36)
| Code | Scope |
|---|---|
| `candidate.read` / `candidate.write` | Candidates |
| `itinerary.read` / `itinerary.write` / `itinerary.template.manage` | Itineraries |
| `venue.read` / `venue.write` | Venues |
| `event.read` / `event.write` | Events |
| `order.read` / `order.write` | Orders |
| `payment.collect` | Record receipts and intake |
| `refund.issue` | Issue refunds |
| `approval.submit` / `approval.approve` / `approval.reject` | Approvals |
| `inventory.read` / `inventory.write` / `inventory.issue` | Inventory |
| `finance.read` / `finance.write` | Finance |
| `workflow.define` / `workflow.view` | Workflow engine |
| `vendor.read` / `vendor.write` / `vendor.banking.read` / `vendor.banking.write` | Vendors |
| `roadshow.read` / `roadshow.write` | Roadshows |
| `data.ingest` | Ingestion |
| `audit.read` | Audit logs |
| `user.manage` / `role.manage` | Admin |

### Data-scope (3)
`data.city.all`, `data.city.assigned`, `data.finance.all`

---

## Health

### `GET /health`
No authentication required.

**Response 200**
```json
{ "status": "ok" }
```

---

## Authentication

### `POST /auth/login`
No `Authorization` header required.

**Request**
```json
{ "username": "admin", "password": "RoadshowOpsAdmin1!" }
```

**Response 200**
```json
{ "token": "<JWT>" }
```

**Error cases**
- `400` — `username` or `password` missing
- `401` — invalid credentials (enumeration-safe; also returned for unknown username)
- `423` — account locked after 5 failed attempts
  ```json
  { "error": "Account is locked", "locked_until": "2024-04-21T10:15:00Z", "reason": "locked" }
  ```

---

### `GET /auth/me`
Requires: valid JWT.

**Response 200**
```json
{
  "id": 1,
  "username": "admin",
  "email": "admin@example.com",
  "fullName": "Administrator",
  "roles": ["admin"],
  "permissions": ["menu.dashboard", "order.read", "..."],
  "assignedCities": [1, 2]
}
```

---

## Admin

### `GET /admin/users`
Requires: `user.manage`

**Response 200** — array of user objects with roles and city assignments.

---

### `POST /admin/users`
Requires: `user.manage`

**Request**
```json
{
  "username": "alice",
  "email": "alice@example.com",
  "password": "MinTwelveChars1!",
  "full_name": "Alice Smith",
  "roles": ["recruiter"],
  "city_ids": [1, 3]
}
```

**Response 201** — created user object (no password hash).

**Error**: `409` if username already exists.

---

### `POST /admin/users/:id/unlock`
Requires: `user.manage`

**Response 200** — updated user object with `locked_until: null`.

---

### `GET /admin/audit`
Requires: `user.manage`

**Response 200** — recent permission events (same shape as `GET /audit/events`).

---

## Candidates

### `GET /candidates`
Requires: `candidate.read` · City-scoped

**Response 200**
```json
[
  {
    "id": 1,
    "city_id": 2,
    "full_name": "Jane Doe",
    "email": "jane@example.com",
    "status": "active",
    "created_by": 3,
    "created_at": "2024-04-01T09:00:00Z"
  }
]
```

---

### `POST /candidates`
Requires: `candidate.write` · City-scoped

**Request**
```json
{ "city_id": 2, "full_name": "Jane Doe", "email": "jane@example.com" }
```

**Response 201** — created candidate object.

---

## Events

### `GET /events`
Requires: `event.read` · City-scoped

**Response 200**
```json
[
  {
    "id": 5,
    "city_id": 1,
    "name": "Boston Job Fair",
    "starts_at": "2024-05-15T09:00:00Z",
    "ends_at": "2024-05-15T17:00:00Z",
    "min_headcount": 20,
    "headcount_cutoff_at": "2024-05-08T17:00:00Z",
    "current_headcount": 18,
    "status": "active",
    "canceled_at": null,
    "canceled_reason": null
  }
]
```

---

### `POST /events`
Requires: `event.write` · City-scoped

**Request** (`ends_at` optional)
```json
{
  "city_id": 1,
  "name": "Boston Job Fair",
  "starts_at": "2024-05-15T09:00:00Z",
  "ends_at": "2024-05-15T17:00:00Z",
  "min_headcount": 20,
  "headcount_cutoff_at": "2024-05-08T17:00:00Z"
}
```

**Response 201** — created event object.

---

### `GET /events/:id`
Requires: `event.read` · City-scoped

**Response 200** — single event object (all columns).

---

### `POST /events/:id/headcount`
Requires: `event.write` · City-scoped

Updates `current_headcount`. If the cutoff has passed and the new count is below `min_headcount`, auto-refunds are triggered.

**Request**
```json
{ "current_headcount": 14 }
```

**Response 200**
```json
{
  "event": { "...": "updated event" },
  "refund": { "reason": "headcount_below_minimum", "refundsIssued": 3 }
}
```
`refund.reason` is `null` when no auto-refund was triggered.

---

### `POST /events/:id/cancel`
Requires: `event.write` · City-scoped

Cancels the event and triggers refunds on all paid stages of related orders.

**Request** (`reason` optional)
```json
{ "reason": "Venue unavailable" }
```

**Response 200**
```json
{
  "event": { "status": "canceled", "canceled_at": "2024-04-21T10:00:00Z", "...": "..." },
  "refund": { "refundsIssued": 5 }
}
```

**Error**: `409` if event is already canceled.

---

### `POST /events/:id/evaluate-refunds`
Requires: `refund.issue` · City-scoped

Manual operator sweep that re-evaluates refund eligibility.

**Response 200** — refund summary object.

---

## Finance

### `GET /finance/transactions`
Requires: `finance.read` · City-scoped

**Response 200** — array of financial transaction records.

---

## Itineraries

### `GET /itineraries`
Requires: `itinerary.read` · City-scoped

**Response 200**
```json
[
  {
    "id": 50,
    "city_id": 1,
    "owner_user_id": 3,
    "name": "Boston Roadshow 2024",
    "itinerary_date": "2024-05-15",
    "current_version": 4,
    "created_at": "2024-04-01T08:00:00Z",
    "updated_at": "2024-04-10T14:30:00Z"
  }
]
```

---

### `POST /itineraries`
Requires: `itinerary.write` · City-scoped

Accepts `itinerary_date` or the alias `starts_on`.

**Request**
```json
{ "city_id": 1, "name": "Boston Roadshow 2024", "itinerary_date": "2024-05-15" }
```

**Response 201** — full itinerary aggregate (see `GET /itineraries/:id`).

---

### `GET /itineraries/:id`
Requires: `itinerary.read` · City-scoped

**Response 200**
```json
{
  "id": 50,
  "city_id": 1,
  "owner_user_id": 3,
  "name": "Boston Roadshow 2024",
  "itinerary_date": "2024-05-15",
  "current_version": 4,
  "events": [
    {
      "id": 101,
      "sequence": 1,
      "title": "Welcome Reception",
      "venue_id": 12,
      "start_at": "2024-05-15T09:00:00Z",
      "end_at": "2024-05-15T10:00:00Z",
      "notes": "Light refreshments"
    }
  ],
  "created_at": "2024-04-01T08:00:00Z",
  "updated_at": "2024-04-10T14:30:00Z"
}
```

---

### `PUT /itineraries/:id`
Requires: `itinerary.write` · City-scoped

Updates `name` and/or `itinerary_date`. Both fields are optional (omit to leave unchanged). Saves a new version snapshot on success.

**Request**
```json
{ "name": "Boston Roadshow 2024 – Revised", "itinerary_date": "2024-05-16" }
```

**Response 200** — updated itinerary aggregate.

---

### `GET /itineraries/:id/validate`
Requires: `itinerary.read` · City-scoped

Read-only schedule check. Does not modify state.

**Response 200**
```json
{
  "valid": false,
  "issues": [
    {
      "type": "overlap",
      "event1_id": 101,
      "event2_id": 102,
      "message": "Events 101 and 102 overlap"
    },
    {
      "type": "buffer",
      "event1_id": 102,
      "event2_id": 103,
      "minutes_apart": 5,
      "message": "Only 5 minutes between events (15 min required)"
    }
  ]
}
```

Issue types: `overlap` (time windows intersect), `buffer` (gap < 15 minutes).

---

### `POST /itineraries/:id/events`
Requires: `itinerary.write` · City-scoped

Appends an event. Accepts `start_at`/`starts_at` and `end_at`/`ends_at` aliases. `title` defaults to `"Event"` if omitted.

**Request**
```json
{
  "title": "Panel Interview",
  "venue_id": 12,
  "start_at": "2024-05-15T11:00:00Z",
  "end_at": "2024-05-15T12:00:00Z",
  "notes": "Room B"
}
```

**Response 201** — full itinerary aggregate.

**Error**: `422` with `issues` array if the new event causes an overlap or violates the 15-minute buffer rule. The insert is rolled back.

---

### `PUT /itineraries/:id/events/:eventId`
Requires: `itinerary.write` · City-scoped

Partial update — only supplied fields are changed. Runs validation after update; rolls back and returns `422` if schedule is invalid.

**Request** (all fields optional)
```json
{ "title": "Panel Interview", "start_at": "2024-05-15T11:30:00Z", "end_at": "2024-05-15T12:30:00Z" }
```

**Response 200** — updated itinerary aggregate.

---

### `DELETE /itineraries/:id/events/:eventId`
Requires: `itinerary.write` · City-scoped

Removes the event and re-validates the remaining schedule. Returns `422` if the deletion itself somehow introduces an issue (unusual but guarded).

**Response 200** — updated itinerary aggregate.

---

### `POST /itineraries/:id/reorder`
Requires: `itinerary.write` · City-scoped

Drag-and-drop reorder. `order` must contain exactly the current set of event IDs.

**Request**
```json
{ "order": [103, 101, 102] }
```

**Response 200** — updated itinerary aggregate with sequences reassigned 1…N.

**Error**: `400` if `order` does not match the current event ID set; `422` if the new sequence causes scheduling conflicts.

---

### `GET /itineraries/:id/versions`
Requires: `itinerary.read` · City-scoped

**Response 200**
```json
[
  {
    "id": 204,
    "version_number": 4,
    "changed_by": 3,
    "changed_by_username": "alice",
    "change_summary": "Added event: Panel Interview",
    "created_at": "2024-04-10T14:30:00Z"
  }
]
```

---

### `GET /itineraries/:id/versions/:n`
Requires: `itinerary.read` · City-scoped

Returns version `n` including the full JSON snapshot of the itinerary at that point.

**Response 200**
```json
{
  "id": 200,
  "version_number": 1,
  "changed_by": 3,
  "change_summary": "Created",
  "snapshot": { "...": "itinerary aggregate at version 1" },
  "created_at": "2024-04-01T08:00:00Z"
}
```

---

### `POST /itineraries/:id/versions/:n/restore`
Requires: `itinerary.write` · City-scoped

Restores the itinerary to the state captured in version `n`. Creates a new version recording the restore.

**Response 200** — itinerary aggregate reflecting the restored state.

---

## Itinerary Templates

### `GET /itinerary-templates`
Requires: `itinerary.read`

**Response 200** — array of template summary objects.

---

### `GET /itinerary-templates/:id`
Requires: `itinerary.read`

**Response 200** — template with `events` array (relative time offsets, not absolute timestamps).

---

### `POST /itinerary-templates`
Requires: `itinerary.template.manage`

**Request**
```json
{
  "name": "Standard 3-Stop Roadshow",
  "description": "Morning check-in, afternoon interviews, evening reception",
  "events": [
    { "title": "Check-In", "offset_minutes": 0, "duration_minutes": 60 }
  ]
}
```

**Response 201** — created template with events.

---

### `POST /itinerary-templates/:id/apply`
Requires: `itinerary.write`

Applies the template to an existing itinerary, anchoring event times to `base_start_at`.

**Request**
```json
{ "itinerary_id": 50, "base_start_at": "2024-05-15T08:00:00Z" }
```

**Response 200** — updated itinerary aggregate.

---

## Venues

### `GET /venues`
Requires: `venue.read` · City-scoped

**Response 200**
```json
[
  {
    "id": 12,
    "city_id": 1,
    "name": "Marriott Copley",
    "address": "110 Huntington Ave, Boston MA",
    "latitude": 42.3467,
    "longitude": -71.0772
  }
]
```

---

### `POST /venues`
Requires: `venue.write` · City-scoped

**Request** (`address`, `latitude`, `longitude` optional)
```json
{ "city_id": 1, "name": "Marriott Copley", "address": "110 Huntington Ave", "latitude": 42.3467, "longitude": -71.0772 }
```

**Response 201** — created venue.

---

### `GET /venues/drive-time?origin=<id>&destination=<id>`
Requires: `venue.read` · City-scoped (both venues must be in accessible cities)

Returns the stored drive time between two venues (computed from coordinates when both venues have lat/long; otherwise falls back to a manually set override).

**Response 200**
```json
{ "origin_venue_id": 12, "destination_venue_id": 15, "minutes": 18, "source": "coordinates" }
```
`source` is `"coordinates"` or `"manual"`.

---

### `POST /venues/drive-time`
Requires: `venue.write` · City-scoped

Sets or overrides the manual drive time between two venues. This override is used instead of coordinates going forward.

**Request**
```json
{ "origin_venue_id": 12, "destination_venue_id": 15, "minutes": 22 }
```

**Response 200** — stored drive-time record.

---

## Orders

### `GET /orders`
Requires: `order.read` · City-scoped

**Response 200**
```json
[
  {
    "id": 123,
    "order_number": "ORD-2024-000001",
    "event_id": 5,
    "city_id": 1,
    "customer_name": "Acme Corp",
    "total_amount_cents": 150000,
    "currency": "USD",
    "status": "active",
    "created_at": "2024-04-21T10:00:00Z"
  }
]
```

---

### `GET /orders/:id`
Requires: `order.read` · City-scoped

Returns the full order aggregate with stages, invoices, receipts, and refunds.

**Response 200**
```json
{
  "id": 123,
  "order_number": "ORD-2024-000001",
  "event_id": 5,
  "city_id": 1,
  "customer_name": "Acme Corp",
  "customer_email": "acme@example.com",
  "customer_phone": "+16175550100",
  "total_amount_cents": 150000,
  "currency": "USD",
  "status": "active",
  "created_at": "2024-04-21T10:00:00Z",
  "stages": [
    {
      "id": 456,
      "label": "Deposit",
      "amount_cents": 50000,
      "status": "paid",
      "due_at": "2024-04-22T10:00:00Z",
      "invoice": { "id": 700, "invoice_number": "INV-2024-000001" },
      "receipts": [{ "id": 789, "receipt_number": "RCP-2024-000001", "amount_cents": 50000, "received_at": "2024-04-21T14:00:00Z" }],
      "refunds": []
    }
  ]
}
```

---

### `POST /orders`
Requires: `order.write` · City-scoped

Creates an order with configurable payment stages. The sum of all `stage.amount_cents` must equal `total_amount_cents`.

**Stage due rules**

| `due_rule_type` | Additional field required | Meaning |
|---|---|---|
| `absolute` | `due_at` (ISO datetime) | Fixed deadline |
| `relative_to_order_creation` | `due_offset_minutes` (integer) | Offset from order created_at |
| `relative_to_event_start` | `due_offset_minutes` (negative = before event) | Offset from event starts_at |

**Request**
```json
{
  "city_id": 1,
  "event_id": 5,
  "customer_name": "Acme Corp",
  "customer_email": "acme@example.com",
  "customer_phone": "+16175550100",
  "total_amount_cents": 150000,
  "currency": "USD",
  "stages": [
    {
      "label": "Deposit",
      "amount_cents": 50000,
      "due_rule_type": "relative_to_order_creation",
      "due_offset_minutes": 1440
    },
    {
      "label": "Final Balance",
      "amount_cents": 100000,
      "due_rule_type": "relative_to_event_start",
      "due_offset_minutes": -10080
    }
  ],
  "line_items": []
}
```

`customer_email`, `customer_phone`, `currency` (default `"USD"`), and `line_items` are optional.

Stock reservations are created at order submission and auto-released after 60 minutes if unpaid.

**Response 201** — full order aggregate.

---

### `POST /orders/:id/stages/:stageId/receipts`
Requires: `payment.collect` · City-scoped

Records a payment receipt for a stage and marks the stage `paid`.

**Request** (`notes` optional)
```json
{
  "receipt_number": "RCP-2024-000001",
  "received_at": "2024-04-21T14:00:00Z",
  "notes": "Cash received at front desk"
}
```

**Response 201**
```json
{
  "receipt": {
    "id": 789,
    "payment_stage_id": 456,
    "receipt_number": "RCP-2024-000001",
    "amount_cents": 50000,
    "received_at": "2024-04-21T14:00:00Z"
  },
  "order": { "...": "full order aggregate" }
}
```

---

### `POST /orders/:id/cancel`
Requires: `order.write` · City-scoped

Voids all unpaid stages and releases all active stock reservations linked to the order.

**Request** (`reason` optional)
```json
{ "reason": "Customer withdrew" }
```

**Response 200**
```json
{
  "reservationsReleased": 2,
  "reason": "Customer withdrew",
  "order": { "status": "canceled", "...": "..." }
}
```

---

### `POST /orders/:id/stages/:stageId/refund`
Requires: `refund.issue` · City-scoped

Issues a manual refund for a paid stage.

**Request** (`notes` optional)
```json
{ "notes": "Event rescheduled" }
```

**Response 201**
```json
{
  "refund": {
    "id": 900,
    "refund_number": "REF-2024-000001",
    "payment_stage_id": 456,
    "amount_cents": 50000
  },
  "order": { "...": "full order aggregate" }
}
```

---

## Payments

### `GET /payments/receipts`
Requires: `payment.collect` · City-scoped

**Response 200** — array of receipt records.

---

### `GET /payments/refunds`
Requires: `refund.issue` · City-scoped

**Response 200** — array of refund records.

---

### `GET /payments/stages/:stageId`
Requires: `order.read` · City-scoped

**Response 200** — payment stage with invoice, receipts, and refunds.

---

## Payment Intake

Supports offline cash, check, and ACH reference payments, and a WeChat Pay–compatible adapter via locally imported files.

### `GET /payments/intake`
Requires: `payment.collect` · City-scoped

**Query params** (all optional): `status` (`pending`|`success`|`failed`|`compensated`), `method` (`cash`|`check`|`ach`|`wechat`)

**Response 200**
```json
[
  {
    "id": 1,
    "method": "cash",
    "external_id": "CASH-2024-0421-001",
    "order_id": 123,
    "payment_stage_id": 456,
    "amount_cents": 50000,
    "currency": "USD",
    "status": "success",
    "attempt_count": 1,
    "next_attempt_at": null,
    "last_error": null,
    "receipt_id": 789,
    "created_at": "2024-04-21T14:00:00Z",
    "order_number": "ORD-2024-000001",
    "city_id": 1
  }
]
```

---

### `GET /payments/intake/:id`
Requires: `payment.collect` · City-scoped

**Response 200** — intake record plus `attempts` array:
```json
{
  "...": "intake fields",
  "attempts": [
    {
      "attempt_number": 1,
      "started_at": "2024-04-21T14:00:00Z",
      "finished_at": "2024-04-21T14:00:01Z",
      "status": "success",
      "error_message": null
    }
  ]
}
```

---

### `POST /payments/intake`
Requires: `payment.collect`

Creates an intake record and immediately attempts to process it. Failed attempts are queued for automatic retry (up to 3 attempts at 5-minute intervals). `order_id` and `payment_stage_id` are optional for unlinked cash receipts.

**Request**
```json
{
  "method": "cash",
  "external_id": "CASH-2024-0421-001",
  "amount_cents": 50000,
  "order_id": 123,
  "payment_stage_id": 456
}
```

**Response 201**
```json
{
  "intake": {
    "id": 1,
    "method": "cash",
    "external_id": "CASH-2024-0421-001",
    "amount_cents": 50000,
    "status": "pending"
  },
  "processed": { "status": "success", "receipt_id": 789 }
}
```

---

### `POST /payments/intake/:id/process`
Requires: `payment.collect` · City-scoped

Manually retries a failed or pending intake.

**Response 200** — process result object.

---

### `POST /payments/intake/:id/compensate`
Requires: `refund.issue` · City-scoped

Reverses a processed intake by issuing a compensating refund entry.

**Request** (`reason` optional)
```json
{ "reason": "Duplicate payment" }
```

**Response 201**
```json
{
  "refund": { "refund_number": "REF-2024-000002", "...": "..." }
}
```

---

### `POST /payments/intake/sweep-retries`
Requires: `payment.collect`

On-demand trigger of the automatic retry sweep (also runs on a background interval).

**Response 200** — sweep summary.

---

### `POST /payments/wechat/import-transactions`
Requires: `payment.collect`

Imports a locally stored WeChat Pay transaction export file. Records are processed idempotently by `external_id`.

**Request**
```json
{ "filename": "wechat_txn_20240421.csv" }
```

**Response 201**
```json
{
  "totals": { "imported": 42, "skipped": 3, "errors": 0 }
}
```

---

### `POST /payments/wechat/import-callbacks`
Requires: `payment.collect`

Imports a locally stored WeChat Pay callback file. Callbacks are verified using signed payloads with the configured shared secret before processing.

**Request**
```json
{ "filename": "wechat_cb_20240421.json" }
```

**Response 201**
```json
{
  "totals": { "imported": 15, "skipped": 1, "errors": 0 }
}
```

---

### `GET /payments/reconciliation`
Requires: `audit.read` · City-scoped

**Query params** (optional): `from` (ISO date), `to` (ISO date)

**Response 200** — reconciliation report comparing intake amounts against financial ledger entries, grouped by method.

---

## Items

### `GET /items`
Requires: `inventory.read`

**Response 200**
```json
[
  {
    "id": 10,
    "sku": "CHAIR-FOLD-01",
    "name": "Folding Chair",
    "unit": "each",
    "safety_threshold": 10,
    "is_active": true
  }
]
```

---

### `POST /items`
Requires: `inventory.write`

**Request** (`unit` defaults to `"each"`, `safety_threshold` defaults to `10`)
```json
{ "sku": "CHAIR-FOLD-01", "name": "Folding Chair", "unit": "each", "safety_threshold": 10 }
```

**Response 201** — created item.

---

### `PUT /items/:id`
Requires: `inventory.write`

Partial update — `name`, `unit`, `safety_threshold`, `is_active`. All optional.

**Response 200** — updated item.

---

## Inventory

All inventory write operations record an append-only ledger entry in `audit.stock_ledger` with actor, timestamp, reason, and before/after quantities.

### `GET /inventory`
Requires: `inventory.read` · City-scoped

**Query params** (all optional): `item_id`, `warehouse_id`, `location_id`

**Response 200**
```json
[
  {
    "item_id": 10,
    "sku": "CHAIR-FOLD-01",
    "name": "Folding Chair",
    "safety_threshold": 10,
    "warehouse_id": 3,
    "warehouse_code": "BOS-WH1",
    "location_id": 7,
    "location_code": "A1",
    "city_id": 1,
    "on_hand": 150,
    "reserved": 20,
    "available": 130,
    "updated_at": "2024-04-20T08:00:00Z"
  }
]
```

---

### `GET /inventory/alerts/low-stock`
Requires: `inventory.read` · City-scoped

Returns items where `available < safety_threshold` within the user's city scope.

**Response 200**
```json
[
  {
    "item_id": 10,
    "sku": "CHAIR-FOLD-01",
    "name": "Folding Chair",
    "unit": "each",
    "safety_threshold": 10,
    "on_hand_total": 8,
    "reserved_total": 3,
    "available_total": 5
  }
]
```

---

### `GET /inventory/ledger`
Requires: `inventory.read` · City-scoped

**Query params** (all optional): `item_id`, `location_id`, `limit` (max 1000, default 200)

**Response 200**
```json
[
  {
    "id": 1001,
    "movement_id": 500,
    "item_id": 10,
    "location_id": 7,
    "actor_user_id": 3,
    "actor_username": "alice",
    "occurred_at": "2024-04-20T08:00:00Z",
    "reason": "inbound",
    "on_hand_before": 100,
    "on_hand_after": 150,
    "reserved_before": 20,
    "reserved_after": 20,
    "reference_type": "purchase_order",
    "reference_id": "PO-001",
    "city_id": 1
  }
]
```

---

### `GET /inventory/movements`
Requires: `inventory.read` · City-scoped

**Query params** (optional): `limit` (max 500, default 100)

**Response 200** — array of movement records with `from_city_id` and `to_city_id`.

---

### `POST /inventory/inbound`
Requires: `inventory.write` · City-scoped (location must be in an accessible city)

**Request**
```json
{ "item_id": 10, "location_id": 7, "quantity": 50, "reason": "purchase_order" }
```

**Response 201**
```json
{
  "id": 500,
  "item_id": 10,
  "location_id": 7,
  "quantity": 50,
  "on_hand_before": 100,
  "on_hand_after": 150
}
```

---

### `POST /inventory/outbound`
Requires: `inventory.issue` · City-scoped

Direct outbound without a prior reservation.

**Request**
```json
{ "item_id": 10, "location_id": 7, "quantity": 5, "reason": "event_supply", "notes": "Optional" }
```

**Response 201** — movement record with before/after quantities.

---

### `POST /inventory/transfer`
Requires: `inventory.write` · City-scoped (both locations must be accessible)

**Request**
```json
{ "item_id": 10, "from_location_id": 7, "to_location_id": 9, "quantity": 20, "notes": "Rebalance" }
```

**Response 201** — transfer movement record.

---

### `POST /inventory/cycle-counts`
Requires: `inventory.write` · City-scoped

Records the result of a physical count. Writes a ledger entry with the variance (positive or negative adjustment).

**Request**
```json
{ "item_id": 10, "location_id": 7, "counted_qty": 145 }
```

**Response 201**
```json
{
  "item_id": 10,
  "location_id": 7,
  "on_hand_before": 150,
  "on_hand_after": 145,
  "variance": -5
}
```

---

### `POST /inventory/reservations`
Requires: `inventory.issue` · City-scoped

Reserves stock at a location, decrementing `available` but not `on_hand`. Reservations expire after 60 minutes if not fulfilled.

**Request**
```json
{
  "item_id": 10,
  "location_id": 7,
  "quantity": 20,
  "reference_type": "event_order",
  "reference_id": "123"
}
```

**Response 201**
```json
{
  "id": 2001,
  "item_id": 10,
  "location_id": 7,
  "quantity": 20,
  "status": "active",
  "expires_at": "2024-04-21T11:00:00Z"
}
```

---

### `POST /inventory/reservations/:id/release`
Requires: `inventory.issue`

Releases a reservation, restoring `available`.

**Response 200** — updated reservation with `status: "released"`.

---

### `POST /inventory/reservations/:id/fulfill`
Requires: `inventory.issue`

Fulfills a reservation, converting reserved quantity to an outbound movement and reducing `on_hand`.

**Response 200** — updated reservation with `status: "fulfilled"`.

---

### `POST /inventory/reservations/sweep-expired`
Requires: `inventory.issue`

Manually triggers the expired-reservation sweep (also runs automatically every 60 seconds).

**Response 200** — sweep summary with count of released reservations.

---

## Warehouses

### `GET /warehouses`
Requires: `inventory.read` · City-scoped

**Response 200**
```json
[{ "id": 3, "city_id": 1, "code": "BOS-WH1", "name": "Boston Warehouse 1", "address": "10 Industrial Way" }]
```

---

### `GET /warehouses/:id`
Requires: `inventory.read` · City-scoped

**Response 200** — warehouse with nested `locations` array.

---

### `POST /warehouses`
Requires: `inventory.write` · City-scoped

**Request** (`address` optional)
```json
{ "city_id": 1, "code": "BOS-WH2", "name": "Boston Warehouse 2", "address": "20 Industrial Way" }
```

**Response 201** — created warehouse.

---

### `POST /warehouses/:id/locations`
Requires: `inventory.write` · City-scoped

**Request** (`name` optional)
```json
{ "code": "A2", "name": "Aisle 2" }
```

**Response 201** — created warehouse location.

---

## Vendors

Sensitive banking fields (tax ID, routing number, account number) are encrypted at rest with AES-256-GCM. The list and detail endpoints never return plaintext values; use `POST /vendors/:id/banking/reveal` for a one-time decrypted read (audit-logged).

### `GET /vendors`
Requires: `vendor.read`

**Response 200**
```json
[
  {
    "id": 5,
    "code": "CATER-001",
    "legal_name": "Boston Catering Co.",
    "contact_email": "orders@boscatering.com",
    "contact_phone": "+16175550200",
    "status": "active",
    "has_tax_id": true,
    "has_bank_routing": true,
    "bank_account_last4": "7890",
    "bank_account_masked": "****7890",
    "created_at": "2024-03-01T09:00:00Z"
  }
]
```

---

### `POST /vendors`
Requires: `vendor.write`

**Request** (`contact_email`, `contact_phone` optional)
```json
{ "code": "CATER-001", "legal_name": "Boston Catering Co.", "contact_email": "orders@boscatering.com" }
```

**Response 201** — created vendor (no banking fields).

---

### `GET /vendors/:id/banking`
Requires: `vendor.read`

Returns masked values only. Last 4 digits of account number are shown; other fields show only the trailing 4 characters.

**Response 200**
```json
{
  "vendor_id": 5,
  "tax_id": "****6789",
  "bank_routing": "****0248",
  "bank_account": "****7890",
  "updated_at": "2024-03-15T10:00:00Z"
}
```

---

### `PUT /vendors/:id/banking`
Requires: `vendor.banking.write`

All fields optional; omit to leave unchanged. Each supplied field is encrypted with AES-256-GCM before storage. Audit-logged.

**Request**
```json
{ "tax_id": "12-3456789", "bank_routing": "121000248", "bank_account": "1234567890" }
```

**Response 200**
```json
{ "vendor_id": 5, "bank_account_last4": "7890" }
```

---

### `POST /vendors/:id/banking/reveal`
Requires: `vendor.banking.read`

Decrypts and returns all banking fields in plaintext. Always audit-logged with the caller's identity and optional reason.

**Request** (`reason` optional but recommended)
```json
{ "reason": "Wire transfer authorization for PO-2024-0421" }
```

**Response 200**
```json
{
  "vendor_id": 5,
  "tax_id": "12-3456789",
  "bank_routing": "121000248",
  "bank_account": "1234567890"
}
```

---

## Workflows (Legacy Approval Module)

### `GET /workflows/approvals`
Requires: `approval.submit`

**Response 200** — array of approval records.

---

### `GET /workflows/approvals/:id`
Requires: `approval.submit`

**Response 200** — approval detail.

---

### `POST /workflows/approvals`
Requires: `approval.submit`

**Request**
```json
{ "entity_type": "event_order", "entity_id": "123", "summary": "Approval for large group booking" }
```

**Response 201** — created approval.

---

### `POST /workflows/approvals/:id/approve`
Requires: `approval.approve`

**Request** (`notes` optional)
```json
{ "notes": "Approved — within budget" }
```

**Response 200** — updated approval.

---

### `POST /workflows/approvals/:id/reject`
Requires: `approval.reject`

**Request** (`notes` optional)
```json
{ "notes": "Over budget threshold" }
```

**Response 200** — updated approval.

---

### `POST /workflows/approvals/:id/cancel`
Requires: `approval.submit`

**Response 200** — updated approval with `status: "canceled"`.

---

## Workflow Engine

### `GET /workflows/definitions`
Requires: `workflow.define`

**Response 200** — array of definition summaries.

---

### `GET /workflows/definitions/:id`
Requires: `workflow.define`

**Response 200** — definition with full `steps` JSON.

---

### `POST /workflows/definitions`
Requires: `workflow.define`

**Request**
```json
{
  "code": "event_order_approval",
  "entity_type": "event_order",
  "steps": [
    { "step": 1, "assignee_permission": "approval.approve", "label": "Manager Review" }
  ]
}
```

**Response 201** — created definition.

---

### `GET /workflows/instances`
Requires: `workflow.view`

Visibility-filtered: returns instances where the user initiated them, holds an assignee permission for any step, or holds `workflow.define` or `audit.read`.

**Response 200** — array of instance summaries.

---

### `GET /workflows/instances/:id`
Requires: `workflow.view`

Object-level visibility check (same rules as list).

**Response 200** — instance with current step, status, and tasks.

---

### `POST /workflows/instances`
Requires: `workflow.view`

Initiates a new workflow instance against an entity. The system selects the active definition matching `entity_type`.

**Request**
```json
{ "entity_type": "event_order", "entity_id": "123" }
```

**Response 201**
```json
{
  "id": 1001,
  "definition_code": "event_order_approval",
  "entity_type": "event_order",
  "entity_id": "123",
  "initiator_user_id": 3,
  "current_step": 1,
  "status": "pending",
  "tasks": [
    { "id": 5001, "step": 1, "assignee_permission": "approval.approve", "status": "pending" }
  ]
}
```

---

### `POST /workflows/instances/:id/resubmit`
Requires: `workflow.view`

Resubmits a failed instance from the current step.

**Response 200** — updated instance.

---

### `POST /workflows/instances/:id/cancel`
Requires: `workflow.define`

**Response 200** — updated instance with `status: "canceled"`.

---

### `GET /workflows/tasks/mine`
Requires: any assignee permission

Returns tasks assigned to the current user (matched by the step's `assignee_permission`).

**Response 200** — array of task objects.

---

### `GET /workflows/tasks/:id`
Requires: task visibility (assignee permission, instance initiator, or elevated)

**Response 200** — task detail with instance context.

---

### `POST /workflows/tasks/:id/approve`
Requires: assignee permission for the step

**Request** (`notes` optional)
```json
{ "notes": "Looks good" }
```

**Response 200** — updated workflow instance.

---

### `POST /workflows/tasks/:id/reject`
Requires: assignee permission for the step

**Request** (`notes` optional)
```json
{ "notes": "Missing documentation" }
```

**Response 200** — updated workflow instance with `status: "rejected"`.

---

### `POST /workflows/tasks/:id/return`
Requires: assignee permission for the step

Returns the instance to the initiator for changes without rejection.

**Request** (`notes` optional)
```json
{ "notes": "Please attach the signed contract" }
```

**Response 200** — updated workflow instance.

---

## Audit

All audit tables are append-only (enforced by database triggers). Data is retained for 7 years.

### `GET /audit/events`
Requires: `audit.read`

**Query params** (all optional): `user_id`, `username`, `workstation`, `action`, `entity_type`, `entity_id`, `from` (ISO), `to` (ISO), `granted` (`true`|`false`), `limit` (default 200)

**Response 200**
```json
[
  {
    "id": 1,
    "user_id": 3,
    "username": "alice",
    "permission_code": "order.write",
    "action": "order.create",
    "resource": "order:123",
    "entity_type": "event_order",
    "entity_id": "123",
    "workstation": "WS-BOS-01",
    "ip_address": "192.168.1.100",
    "http_method": "POST",
    "http_path": "/orders",
    "granted": true,
    "reason": null,
    "metadata": { "event_id": 5, "stages": 2 },
    "occurred_at": "2024-04-21T10:00:00Z"
  }
]
```

---

### `GET /audit/log`
Requires: `audit.read`

Unified view across all audit tables (permission events, stock ledger mutations, financial ledger entries, payment attempts, ingestion runs).

**Response 200** — array of unified audit entries with a `source_table` discriminator.

---

### `GET /audit/stats/by-user`
Requires: `audit.read`

**Response 200** — aggregated permission event counts grouped by user.

---

### `GET /audit/stats/by-workstation`
Requires: `audit.read`

**Response 200** — aggregated counts grouped by workstation identifier.

---

### `GET /audit/stats/by-action`
Requires: `audit.read`

**Response 200** — aggregated counts grouped by action code.

---

### `GET /audit/retention`
Requires: `audit.read`

**Response 200**
```json
{
  "policy_years": 7,
  "tables": [
    { "table": "audit.permission_event", "oldest_record": "2017-04-21T00:00:00Z", "row_count": 4200000 }
  ]
}
```

---

## Ingestion

### `GET /ingestion/resources`
Requires: `data.ingest`

**Response 200** — array of supported resource type strings (e.g. `"candidate"`, `"event"`).

---

### `POST /ingestion/:resource`
Requires: `data.ingest`

Bulk-ingests records for `resource` (e.g. `POST /ingestion/candidate`).

**Request**
```json
{ "records": [{ "full_name": "Jane Doe", "email": "jane@example.com", "city_id": 1 }] }
```

**Response 200** — ingestion summary with `inserted`, `updated`, `skipped` counts.

---

## Ingestion Sources

### `GET /ingestion/sources`
Requires: `data.ingest`

**Response 200** — array of source records with latest checkpoint info.

---

### `GET /ingestion/sources/:id`
Requires: `data.ingest`

**Response 200** — source detail with full checkpoint state.

---

### `POST /ingestion/sources`
Requires: `data.ingest`

**Request** (only `code` is required)
```json
{
  "code": "linkedin-boston",
  "type": "html",
  "format": "job_board",
  "inbox_dir": "/data/inbox/linkedin",
  "parser_key": "linkedin_v1",
  "min_interval_hours": 6,
  "is_active": true,
  "user_agent": null,
  "ip_hint": null,
  "captcha_strategy": null,
  "config": {}
}
```

`min_interval_hours` must be ≥ 6 (default 6). `user_agent`, `ip_hint`, and `captcha_strategy` are reserved policy hooks for UA/IP/CAPTCHA handling.

**Response 201** — created source.

---

### `PUT /ingestion/sources/:id`
Requires: `data.ingest`

Partial update of source configuration.

**Response 200** — updated source.

---

### `POST /ingestion/sources/:id/run`
Requires: `data.ingest`

Manually triggers a run. Respects `min_interval_hours` unless `force=true` is passed in the body.

**Request** (`force` optional)
```json
{ "force": false }
```

**Response 200** — run result with ingestion totals.

---

### `POST /ingestion/sources/tick`
Requires: `data.ingest`

Scheduler tick: runs all active sources whose last run was more than `min_interval_hours` ago. Called automatically every 5 minutes by the server background worker.

**Response 200** — array of per-source run results.

---

### `GET /ingestion/sources/:id/records`
Requires: `data.ingest`

Browses staged ingestion records. `limit` max 500.

**Response 200** — array of ingestion record objects.

---

### `GET /ingestion/sources/:id/checkpoint`
Requires: `data.ingest`

**Response 200**
```json
{
  "source_id": 3,
  "last_run_started_at": "2024-04-21T08:00:00Z",
  "last_record_offset": 1200,
  "cursor": "page_token_abc123"
}
```

---

## Integrations

### `GET /integrations/financial-ledger`
Requires: `finance.read`

**Query params** (all optional): `order_id`, `entry_type`, `from` (ISO), `to` (ISO), `limit` (default 200)

**Response 200** — array of immutable financial ledger entries (receipt and refund records; insert-only by DB trigger).

---

### `GET /integrations/orders/:id/balance`
Requires: `order.read` · City-scoped

**Response 200**
```json
{
  "order_id": 123,
  "total_amount_cents": 150000,
  "received_cents": 50000,
  "refunded_cents": 0,
  "net_cents": 50000,
  "outstanding_cents": 100000
}
```

---

### `GET /integrations/consistency`
Requires: `audit.read`

Runs 10 cross-module orphan checks (e.g. orders without stages, paid stages without receipts, receipts without ledger entries).

**Response 200**
```json
{
  "consistent": true,
  "summary": {
    "orders_without_stages": 0,
    "stages_without_invoice": 0,
    "paid_stages_without_receipt": 0,
    "receipts_without_ledger": 0
  },
  "details": {}
}
```
