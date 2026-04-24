# Test Coverage Audit

## Project Type Detection
- Declared type: `fullstack` (`repo/README.md:3`)
- Inference check: structure confirms backend (`repo/src`, `repo/API_tests`, `repo/unit_tests`) + frontend (`repo/frontend/src`, frontend test files).

## Backend Endpoint Inventory

Total discovered endpoints: **116**

### `server.js`
- `GET /health`

### `routes/auth.js`
- `POST /auth/login`
- `GET /auth/me`

### `routes/admin.js`
- `GET /admin/users`
- `POST /admin/users`
- `POST /admin/users/:id/unlock`
- `GET /admin/audit`

### `routes/audit.js`
- `GET /audit/events`
- `GET /audit/log`
- `GET /audit/stats/by-user`
- `GET /audit/stats/by-workstation`
- `GET /audit/stats/by-action`
- `GET /audit/retention`

### `routes/candidates.js`
- `GET /candidates`
- `POST /candidates`

### `routes/events.js`
- `GET /events`
- `POST /events`
- `GET /events/:id`
- `POST /events/:id/headcount`
- `POST /events/:id/cancel`
- `POST /events/:id/evaluate-refunds`

### `routes/finance.js`
- `GET /finance/transactions`

### `routes/ingestion.js`
- `GET /ingestion/resources`
- `POST /ingestion/:resource`

### `routes/ingestion_sources.js`
- `GET /ingestion/sources`
- `GET /ingestion/sources/:id`
- `POST /ingestion/sources`
- `PUT /ingestion/sources/:id`
- `POST /ingestion/sources/:id/run`
- `POST /ingestion/sources/tick`
- `GET /ingestion/sources/:id/records`
- `GET /ingestion/sources/:id/checkpoint`

### `routes/integrations.js`
- `GET /integrations/financial-ledger`
- `GET /integrations/orders/:id/balance`
- `GET /integrations/consistency`

### `routes/inventory.js`
- `GET /inventory`
- `GET /inventory/alerts/low-stock`
- `GET /inventory/ledger`
- `POST /inventory/reservations/sweep-expired`
- `GET /inventory/movements`
- `POST /inventory/inbound`
- `POST /inventory/outbound`
- `POST /inventory/transfer`
- `POST /inventory/cycle-counts`
- `POST /inventory/reservations`
- `POST /inventory/reservations/:id/release`
- `POST /inventory/reservations/:id/fulfill`

### `routes/items.js`
- `GET /items`
- `POST /items`
- `PUT /items/:id`

### `routes/itineraries.js`
- `GET /itineraries`
- `POST /itineraries`
- `GET /itineraries/:id`
- `PUT /itineraries/:id`
- `GET /itineraries/:id/validate`
- `POST /itineraries/:id/events`
- `PUT /itineraries/:id/events/:eventId`
- `DELETE /itineraries/:id/events/:eventId`
- `POST /itineraries/:id/reorder`
- `GET /itineraries/:id/versions`
- `GET /itineraries/:id/versions/:n`
- `POST /itineraries/:id/versions/:n/restore`

### `routes/itinerary_templates.js`
- `GET /itinerary-templates`
- `GET /itinerary-templates/:id`
- `POST /itinerary-templates`
- `POST /itinerary-templates/:id/apply`

### `routes/orders.js`
- `GET /orders`
- `GET /orders/:id`
- `POST /orders`
- `POST /orders/:id/stages/:stageId/receipts`
- `POST /orders/:id/cancel`
- `POST /orders/:id/stages/:stageId/refund`

### `routes/payment_intake.js`
- `GET /payments/intake`
- `GET /payments/intake/:id`
- `POST /payments/intake`
- `POST /payments/intake/:id/process`
- `POST /payments/intake/:id/compensate`
- `POST /payments/intake/sweep-retries`
- `POST /payments/wechat/import-transactions`
- `POST /payments/wechat/import-callbacks`
- `GET /payments/reconciliation`

### `routes/payments.js`
- `GET /payments/receipts`
- `GET /payments/refunds`
- `GET /payments/stages/:stageId`

### `routes/vendors.js`
- `GET /vendors`
- `POST /vendors`
- `GET /vendors/:id/banking`
- `PUT /vendors/:id/banking`
- `POST /vendors/:id/banking/reveal`

### `routes/venues.js`
- `GET /venues`
- `POST /venues`
- `GET /venues/drive-time`
- `POST /venues/drive-time`

### `routes/warehouses.js`
- `GET /warehouses`
- `GET /warehouses/:id`
- `POST /warehouses`
- `POST /warehouses/:id/locations`

### `routes/workflows.js`
- `GET /workflows/approvals`
- `GET /workflows/approvals/:id`
- `POST /workflows/approvals`
- `POST /workflows/approvals/:id/approve`
- `POST /workflows/approvals/:id/reject`
- `POST /workflows/approvals/:id/cancel`

### `routes/workflow_engine.js`
- `GET /workflows/definitions`
- `GET /workflows/definitions/:id`
- `POST /workflows/definitions`
- `GET /workflows/instances`
- `GET /workflows/instances/:id`
- `POST /workflows/instances`
- `POST /workflows/instances/:id/resubmit`
- `POST /workflows/instances/:id/cancel`
- `GET /workflows/tasks/mine`
- `GET /workflows/tasks/:id`
- `POST /workflows/tasks/:id/approve`
- `POST /workflows/tasks/:id/reject`
- `POST /workflows/tasks/:id/return`

## API Test Mapping Table

Legend:
- **Covered=yes** requires evidence request reaches route handler with permission path (strict definition).
- **HTTP tested but not covered** means endpoint path is called, but only blocked by preHandler/validation before handler execution.

| Endpoint | Covered | Test Type | Test Files | Evidence |
|---|---|---|---|---|
| `GET /health` | yes | true no-mock HTTP | `API_tests/auth.test.js` | `test('GET /health returns ok'...)` (`API_tests/auth.test.js:5`) |
| `POST /auth/login` | yes | true no-mock HTTP | `API_tests/auth.test.js`, `API_tests/lockout.test.js` | success + lockout lifecycle (`API_tests/auth.test.js:26`, `API_tests/lockout.test.js:35`) |
| `GET /auth/me` | yes | true no-mock HTTP | `API_tests/auth.test.js`, `API_tests/consistency.test.js` | authenticated profile read (`API_tests/auth.test.js:39`) |
| `GET /admin/users` | yes | true no-mock HTTP | `API_tests/rbac.test.js`, `API_tests/rbac_matrix.test.js` | admin 200 + recruiter 403 (`API_tests/rbac.test.js:34`) |
| `POST /admin/users` | yes | true no-mock HTTP | multiple | user creation used in setup (`API_tests/rbac.test.js:15`, many `before(...)`) |
| `POST /admin/users/:id/unlock` | yes | true no-mock HTTP | `API_tests/lockout.test.js`, `API_tests/bootstrap_integrity.test.js` | explicit unlock 200 (`API_tests/lockout.test.js:69`) |
| `GET /admin/audit` | yes | true no-mock HTTP | `API_tests/rbac.test.js`, `API_tests/rbac_matrix.test.js` | admin 200 (`API_tests/rbac.test.js:65`) |
| `GET /audit/events` | yes | true no-mock HTTP | `API_tests/audit_stats.test.js`, `API_tests/consistency.test.js` | admin 200 + filters (`API_tests/audit_stats.test.js:33`) |
| `GET /audit/log` | yes | true no-mock HTTP | `API_tests/audit_stats.test.js`, `API_tests/bootstrap_integrity.test.js` | admin 200 (`API_tests/audit_stats.test.js:60`) |
| `GET /audit/stats/by-user` | yes | true no-mock HTTP | `API_tests/audit_stats.test.js` | admin 200 (`API_tests/audit_stats.test.js:75`) |
| `GET /audit/stats/by-workstation` | yes | true no-mock HTTP | `API_tests/audit_stats.test.js` | admin 200 (`API_tests/audit_stats.test.js:95`) |
| `GET /audit/stats/by-action` | yes | true no-mock HTTP | `API_tests/audit_stats.test.js` | admin 200 (`API_tests/audit_stats.test.js:110`) |
| `GET /audit/retention` | yes | true no-mock HTTP | `API_tests/audit_stats.test.js`, `API_tests/consistency.test.js` | admin 200 with retention fields (`API_tests/audit_stats.test.js:125`) |
| `GET /candidates` | yes | true no-mock HTTP | `API_tests/candidates.test.js` | admin/recruiter 200 (`API_tests/candidates.test.js:47`) |
| `POST /candidates` | yes | true no-mock HTTP | `API_tests/candidates.test.js` | 201 happy path + scope checks (`API_tests/candidates.test.js:90`) |
| `GET /events` | yes | true no-mock HTTP | `API_tests/events.test.js` | admin 200 (`API_tests/events.test.js:35`) |
| `POST /events` | yes | true no-mock HTTP | `API_tests/events.test.js` | 201 happy path (`API_tests/events.test.js:61`) |
| `GET /events/:id` | yes | true no-mock HTTP | `API_tests/events.test.js` | 200 created event (`API_tests/events.test.js:81`) |
| `POST /events/:id/headcount` | yes | true no-mock HTTP | `API_tests/events.test.js` | 200 happy path (`API_tests/events.test.js:118`) |
| `POST /events/:id/cancel` | yes | true no-mock HTTP | `API_tests/events.test.js` | 200 + 409 re-cancel (`API_tests/events.test.js:144`) |
| `POST /events/:id/evaluate-refunds` | yes | true no-mock HTTP | `API_tests/events.test.js` | 200 valid event (`API_tests/events.test.js:175`) |
| `GET /finance/transactions` | yes | true no-mock HTTP | `API_tests/finance.test.js`, `API_tests/rbac.test.js` | admin/finance success path + auth checks (`API_tests/finance.test.js:30`, `API_tests/finance.test.js:36`) |
| `GET /ingestion/resources` | yes | true no-mock HTTP | `API_tests/ingestion.test.js` | admin 200 (`API_tests/ingestion.test.js:33`) |
| `POST /ingestion/:resource` | yes | true no-mock HTTP | `API_tests/ingestion.test.js` | 201 for `/ingestion/items` (`API_tests/ingestion.test.js:77`) |
| `GET /ingestion/sources` | yes | true no-mock HTTP | `API_tests/ingestion.test.js` | admin 200 (`API_tests/ingestion.test.js:99`) |
| `GET /ingestion/sources/:id` | yes | true no-mock HTTP | `API_tests/ingestion.test.js` | 200 existing source (`API_tests/ingestion.test.js:138`) |
| `POST /ingestion/sources` | yes | true no-mock HTTP | `API_tests/ingestion.test.js` | 201 happy path (`API_tests/ingestion.test.js:117`) |
| `PUT /ingestion/sources/:id` | yes | true no-mock HTTP | `API_tests/ingestion.test.js` | 200 update (`API_tests/ingestion.test.js:218`) |
| `POST /ingestion/sources/:id/run` | yes | true no-mock HTTP | `API_tests/ingestion.test.js` | 201 run (`API_tests/ingestion.test.js:158`) |
| `POST /ingestion/sources/tick` | yes | true no-mock HTTP | `API_tests/ingestion.test.js` | 200 tick (`API_tests/ingestion.test.js:248`) |
| `GET /ingestion/sources/:id/records` | yes | true no-mock HTTP | `API_tests/ingestion.test.js` | 404 missing source after auth (`API_tests/ingestion.test.js:181`) |
| `GET /ingestion/sources/:id/checkpoint` | yes | true no-mock HTTP | `API_tests/ingestion.test.js` | 404 missing source after auth (`API_tests/ingestion.test.js:187`) |
| `GET /integrations/financial-ledger` | yes | true no-mock HTTP | `API_tests/orders_payments.test.js`, `API_tests/bootstrap_integrity.test.js` | ledger query (`API_tests/orders_payments.test.js:77`) |
| `GET /integrations/orders/:id/balance` | yes | true no-mock HTTP | `API_tests/orders_payments.test.js`, `API_tests/scope.test.js` | balance checks (`API_tests/orders_payments.test.js:82`) |
| `GET /integrations/consistency` | yes | true no-mock HTTP | `API_tests/consistency.test.js` | consistent true assertion (`API_tests/consistency.test.js:8`) |
| `GET /inventory` | yes | true no-mock HTTP | `API_tests/inventory.test.js`, `API_tests/inventory_ops.test.js` | filtered inventory read (`API_tests/inventory.test.js:56`) |
| `GET /inventory/alerts/low-stock` | yes | true no-mock HTTP | `API_tests/inventory.test.js`, `API_tests/scope.test.js` | alerts assertion (`API_tests/inventory.test.js:72`) |
| `GET /inventory/ledger` | yes | true no-mock HTTP | `API_tests/inventory.test.js`, `API_tests/scope.test.js` | append-only ledger read (`API_tests/inventory.test.js:85`) |
| `POST /inventory/reservations/sweep-expired` | yes | true no-mock HTTP | `API_tests/inventory_ops.test.js` | 200 admin sweep (`API_tests/inventory_ops.test.js:150`) |
| `GET /inventory/movements` | yes | true no-mock HTTP | `API_tests/inventory_ops.test.js`, `API_tests/scope.test.js` | 200 array (`API_tests/inventory_ops.test.js:158`) |
| `POST /inventory/inbound` | yes | true no-mock HTTP | `API_tests/inventory.test.js`, `API_tests/inventory_ops.test.js` | on_hand increase (`API_tests/inventory.test.js:39`) |
| `POST /inventory/outbound` | yes | true no-mock HTTP | `API_tests/inventory.test.js` | outbound used for stock decrease (`API_tests/inventory.test.js:74`) |
| `POST /inventory/transfer` | yes | true no-mock HTTP | `API_tests/inventory_ops.test.js` | 201 transfer (`API_tests/inventory_ops.test.js:62`) |
| `POST /inventory/cycle-counts` | yes | true no-mock HTTP | `API_tests/inventory_ops.test.js` | 201 cycle count (`API_tests/inventory_ops.test.js:85`) |
| `POST /inventory/reservations` | yes | true no-mock HTTP | `API_tests/inventory.test.js`, `API_tests/inventory_ops.test.js` | reservation creation (`API_tests/inventory.test.js:49`) |
| `POST /inventory/reservations/:id/release` | yes | true no-mock HTTP | `API_tests/inventory_ops.test.js` | release 200/201 (`API_tests/inventory_ops.test.js:109`) |
| `POST /inventory/reservations/:id/fulfill` | yes | true no-mock HTTP | `API_tests/inventory_ops.test.js` | fulfill happy path (`API_tests/inventory_ops.test.js:131`) |
| `GET /items` | yes | true no-mock HTTP | `API_tests/items.test.js` | admin 200 (`API_tests/items.test.js:33`) |
| `POST /items` | yes | true no-mock HTTP | `API_tests/items.test.js` | 201 happy path (`API_tests/items.test.js:68`) |
| `PUT /items/:id` | yes | true no-mock HTTP | `API_tests/items.test.js` | 200 update (`API_tests/items.test.js:110`) |
| `GET /itineraries` | yes | true no-mock HTTP | `API_tests/itineraries.test.js` | admin 200 (`API_tests/itineraries.test.js:34`) |
| `POST /itineraries` | yes | true no-mock HTTP | `API_tests/itineraries.test.js` | 201 create (`API_tests/itineraries.test.js:52`) |
| `GET /itineraries/:id` | yes | true no-mock HTTP | `API_tests/itineraries.test.js` | created itinerary 200 (`API_tests/itineraries.test.js:67`) |
| `PUT /itineraries/:id` | yes | true no-mock HTTP | `API_tests/itineraries.test.js` | update 200 (`API_tests/itineraries.test.js:86`) |
| `GET /itineraries/:id/validate` | yes | true no-mock HTTP | `API_tests/itineraries.test.js` | valid/issues response (`API_tests/itineraries.test.js:104`) |
| `POST /itineraries/:id/events` | yes | true no-mock HTTP | `API_tests/itineraries.test.js` | add event 201 (`API_tests/itineraries.test.js:129`) |
| `PUT /itineraries/:id/events/:eventId` | yes | true no-mock HTTP | `API_tests/itineraries.test.js` | event update 200 (`API_tests/itineraries.test.js:202`) |
| `DELETE /itineraries/:id/events/:eventId` | yes | true no-mock HTTP | `API_tests/itineraries.test.js` | delete event 200 (`API_tests/itineraries.test.js:245`) |
| `POST /itineraries/:id/reorder` | yes | true no-mock HTTP | `API_tests/itineraries.test.js` | reorder validation branch (`API_tests/itineraries.test.js:145`) |
| `GET /itineraries/:id/versions` | yes | true no-mock HTTP | `API_tests/itineraries.test.js` | versions list 200 (`API_tests/itineraries.test.js:162`) |
| `GET /itineraries/:id/versions/:n` | yes | true no-mock HTTP | `API_tests/itineraries.test.js` | version-not-found branch (`API_tests/itineraries.test.js:174`) |
| `POST /itineraries/:id/versions/:n/restore` | yes | true no-mock HTTP | `API_tests/itineraries.test.js` | restore 200 (`API_tests/itineraries.test.js:285`) |
| `GET /itinerary-templates` | yes | true no-mock HTTP | `API_tests/itinerary_templates.test.js` | admin 200 (`API_tests/itinerary_templates.test.js:32`) |
| `GET /itinerary-templates/:id` | yes | true no-mock HTTP | `API_tests/itinerary_templates.test.js` | existing template 200 (`API_tests/itinerary_templates.test.js:70`) |
| `POST /itinerary-templates` | yes | true no-mock HTTP | `API_tests/itinerary_templates.test.js` | create 201 (`API_tests/itinerary_templates.test.js:50`) |
| `POST /itinerary-templates/:id/apply` | yes | true no-mock HTTP | `API_tests/itinerary_templates.test.js` | apply template (`API_tests/itinerary_templates.test.js:99`) |
| `GET /orders` | yes | true no-mock HTTP | `API_tests/orders_list.test.js` | admin 200 (`API_tests/orders_list.test.js:34`) |
| `GET /orders/:id` | yes | true no-mock HTTP | `API_tests/orders_list.test.js`, `API_tests/orders_payments.test.js` | 404 branch with admin (`API_tests/orders_list.test.js:45`) |
| `POST /orders` | yes | true no-mock HTTP | `API_tests/orders_payments.test.js`, `API_tests/orders_list.test.js` | create order 201 (`API_tests/orders_payments.test.js:29`) |
| `POST /orders/:id/stages/:stageId/receipts` | yes | true no-mock HTTP | `API_tests/orders_payments.test.js` | receipt record 201 (`API_tests/orders_payments.test.js:66`) |
| `POST /orders/:id/cancel` | yes | true no-mock HTTP | `API_tests/orders_list.test.js` | cancel 200 (`API_tests/orders_list.test.js:61`) |
| `POST /orders/:id/stages/:stageId/refund` | yes | true no-mock HTTP | `API_tests/orders_payments.test.js` | refund 201 (`API_tests/orders_payments.test.js:87`) |
| `GET /payments/intake` | yes | true no-mock HTTP | `API_tests/payments_read.test.js` | admin 200 (`API_tests/payments_read.test.js:71`) |
| `GET /payments/intake/:id` | yes | true no-mock HTTP | `API_tests/payments_read.test.js` | created intake read 200 (`API_tests/payments_read.test.js:86`) |
| `POST /payments/intake` | yes | true no-mock HTTP | `API_tests/payments_read.test.js`, `API_tests/scope.test.js`, `API_tests/intake_edge.test.js` | create intake 201 (`API_tests/payments_read.test.js:87`) |
| `POST /payments/intake/:id/process` | yes | true no-mock HTTP | `API_tests/scope.test.js`, `API_tests/intake_edge.test.js` | scope enforcement + allowed path (`API_tests/scope.test.js:178`) |
| `POST /payments/intake/:id/compensate` | yes | true no-mock HTTP | `API_tests/scope.test.js`, `API_tests/intake_edge.test.js` | compensate scope checks (`API_tests/scope.test.js:183`) |
| `POST /payments/intake/sweep-retries` | yes | true no-mock HTTP | `API_tests/payments_read.test.js` | admin 200 (`API_tests/payments_read.test.js:115`) |
| `POST /payments/wechat/import-transactions` | yes | true no-mock HTTP | `API_tests/payments_read.test.js` | handler-path success with real import file (`API_tests/payments_read.test.js:149`) |
| `POST /payments/wechat/import-callbacks` | yes | true no-mock HTTP | `API_tests/payments_read.test.js` | handler-path success with real callback file (`API_tests/payments_read.test.js:174`) |
| `GET /payments/reconciliation` | yes | true no-mock HTTP | `API_tests/payments_read.test.js` | admin request with query (`API_tests/payments_read.test.js:155`) |
| `GET /payments/receipts` | yes | true no-mock HTTP | `API_tests/payments_read.test.js` | admin 200 (`API_tests/payments_read.test.js:32`) |
| `GET /payments/refunds` | yes | true no-mock HTTP | `API_tests/payments_read.test.js` | admin 200 (`API_tests/payments_read.test.js:47`) |
| `GET /payments/stages/:stageId` | yes | true no-mock HTTP | `API_tests/payments_read.test.js` | authorized 404 for missing stage (`API_tests/payments_read.test.js:58`) |
| `GET /vendors` | yes | true no-mock HTTP | `API_tests/vendors.test.js`, `API_tests/bootstrap_integrity.test.js` | admin 200 (`API_tests/vendors.test.js:32`) |
| `POST /vendors` | yes | true no-mock HTTP | `API_tests/vendors.test.js` | create vendor 201 (`API_tests/vendors.test.js:50`) |
| `GET /vendors/:id/banking` | yes | true no-mock HTTP | `API_tests/vendors.test.js` | masked banking read (`API_tests/vendors.test.js:69`) |
| `PUT /vendors/:id/banking` | yes | true no-mock HTTP | `API_tests/vendors.test.js`, `API_tests/rbac_matrix.test.js` | update banking (`API_tests/vendors.test.js:84`) |
| `POST /vendors/:id/banking/reveal` | yes | true no-mock HTTP | `API_tests/vendors.test.js`, `API_tests/rbac_matrix.test.js` | reveal + audit metadata (`API_tests/rbac_matrix.test.js:117`) |
| `GET /venues` | yes | true no-mock HTTP | `API_tests/venues.test.js` | admin 200 (`API_tests/venues.test.js:32`) |
| `POST /venues` | yes | true no-mock HTTP | `API_tests/venues.test.js`, `API_tests/scope.test.js` | create venue (`API_tests/venues.test.js:50`) |
| `GET /venues/drive-time` | yes | true no-mock HTTP | `API_tests/venues.test.js`, `API_tests/scope.test.js`, `API_tests/rbac_matrix.test.js` | computed distance and scope matrix (`API_tests/scope.test.js:69`) |
| `POST /venues/drive-time` | yes | true no-mock HTTP | `API_tests/venues.test.js`, `API_tests/scope.test.js` | manual drive-time set and scope checks (`API_tests/venues.test.js:82`) |
| `GET /warehouses` | yes | true no-mock HTTP | `API_tests/warehouses.test.js` | admin 200 (`API_tests/warehouses.test.js:32`) |
| `GET /warehouses/:id` | yes | true no-mock HTTP | `API_tests/warehouses.test.js` | existing warehouse 200 (`API_tests/warehouses.test.js:65`) |
| `POST /warehouses` | yes | true no-mock HTTP | `API_tests/warehouses.test.js`, `API_tests/inventory*.test.js` | create warehouse 201 (`API_tests/warehouses.test.js:50`) |
| `POST /warehouses/:id/locations` | yes | true no-mock HTTP | `API_tests/warehouses.test.js`, `API_tests/inventory*.test.js` | add location 201 (`API_tests/warehouses.test.js:90`) |
| `GET /workflows/approvals` | yes | true no-mock HTTP | `API_tests/workflows_approvals.test.js` | admin 200 (`API_tests/workflows_approvals.test.js:42`) |
| `GET /workflows/approvals/:id` | yes | true no-mock HTTP | `API_tests/workflows_approvals.test.js` | existing approval 200 (`API_tests/workflows_approvals.test.js:75`) |
| `POST /workflows/approvals` | yes | true no-mock HTTP | `API_tests/workflows_approvals.test.js` | submit 201 (`API_tests/workflows_approvals.test.js:60`) |
| `POST /workflows/approvals/:id/approve` | yes | true no-mock HTTP | `API_tests/workflows_approvals.test.js` | approve happy path (`API_tests/workflows_approvals.test.js:98`) |
| `POST /workflows/approvals/:id/reject` | yes | true no-mock HTTP | `API_tests/workflows_approvals.test.js` | reject happy path (`API_tests/workflows_approvals.test.js:118`) |
| `POST /workflows/approvals/:id/cancel` | yes | true no-mock HTTP | `API_tests/workflows_approvals.test.js` | cancel happy path (`API_tests/workflows_approvals.test.js:138`) |
| `GET /workflows/definitions` | yes | true no-mock HTTP | `API_tests/workflow_engine.test.js`, `API_tests/bootstrap_integrity.test.js` | definitions list (`API_tests/workflow_engine.test.js:33`) |
| `GET /workflows/definitions/:id` | yes | true no-mock HTTP | `API_tests/workflow_engine.test.js` | definition detail 200 (`API_tests/workflow_engine.test.js:74`) |
| `POST /workflows/definitions` | yes | true no-mock HTTP | `API_tests/workflow_engine.test.js` | create definition 201 (`API_tests/workflow_engine.test.js:51`) |
| `GET /workflows/instances` | yes | true no-mock HTTP | `API_tests/workflow_engine.test.js`, `API_tests/rbac_matrix.test.js`, `API_tests/scope.test.js` | instances list 200 (`API_tests/workflow_engine.test.js:99`) |
| `GET /workflows/instances/:id` | yes | true no-mock HTTP | `API_tests/workflow_engine.test.js`, `API_tests/rbac_matrix.test.js`, `API_tests/scope.test.js` | 404/403/200 object visibility matrix (`API_tests/scope.test.js:246`) |
| `POST /workflows/instances` | yes | true no-mock HTTP | `API_tests/workflow_engine.test.js`, `API_tests/scope.test.js` | initiate instance (`API_tests/workflow_engine.test.js:117`) |
| `POST /workflows/instances/:id/resubmit` | yes | true no-mock HTTP | `API_tests/workflow_engine.test.js` | authorized 404 (`API_tests/workflow_engine.test.js:149`) |
| `POST /workflows/instances/:id/cancel` | yes | true no-mock HTTP | `API_tests/workflow_engine.test.js` | authorized 404 (`API_tests/workflow_engine.test.js:141`) |
| `GET /workflows/tasks/mine` | yes | true no-mock HTTP | `API_tests/workflow_engine.test.js` | list tasks 200 (`API_tests/workflow_engine.test.js:165`) |
| `GET /workflows/tasks/:id` | yes | true no-mock HTTP | `API_tests/workflow_engine.test.js`, `API_tests/scope.test.js` | authorized 404 + visible 200/forbidden 403 (`API_tests/scope.test.js:210`) |
| `POST /workflows/tasks/:id/approve` | yes | true no-mock HTTP | `API_tests/workflow_engine.test.js` | authorized 404 (`API_tests/workflow_engine.test.js:177`) |
| `POST /workflows/tasks/:id/reject` | yes | true no-mock HTTP | `API_tests/workflow_engine.test.js` | authorized 404 (`API_tests/workflow_engine.test.js:185`) |
| `POST /workflows/tasks/:id/return` | yes | true no-mock HTTP | `API_tests/workflow_engine.test.js` | authorized 404 (`API_tests/workflow_engine.test.js:193`) |

## API Test Classification

1. **True No-Mock HTTP**
   - `API_tests/*.test.js` use real HTTP `fetch` against `http://localhost:4000` (`API_tests/_helpers.js:2`, `API_tests/_helpers.js:6`).
   - Test runner starts stack and executes API tests in backend container (`run_tests.sh:32`, `run_tests.sh:58`).
2. **HTTP with Mocking**
   - None found in `API_tests` (no `jest.mock`, `vi.mock`, `sinon.stub`, DI overrides).
3. **Non-HTTP**
   - `unit_tests/*.test.js` (direct route/service/module invocation, fake DB).
   - `frontend/src/**/*.test.js` (component/store unit tests).

## Mock Detection

- **Backend unit DB stubbing**: `unit_tests/_route_harness.js:35`, `unit_tests/_route_harness.js:41` mutate `pool.query` and `pool.connect`.
- **Backend fake clients**: `unit_tests/_fakes.js` provides scripted DB fakes (`unit_tests/_fakes.js:20`, `unit_tests/_fakes.js:45`).
- **Frontend API mocks**: `vi.mock('../api.js', ...)` in workspace component tests (`frontend/src/lib/inventory/InventoryDashboard.test.js:7`, `frontend/src/lib/orders/OrdersView.test.js:7`, `frontend/src/lib/workflows/TaskInbox.test.js:7`, etc.).
- **API tests**: no transport/controller/service mocking detected.

## Coverage Summary

- Total endpoints: **116**
- Endpoints with HTTP tests (method+path invoked): **116/116**
- Endpoints with strict true no-mock handler coverage: **116/116**

- HTTP coverage: **100.00%**
- True API coverage: **100.00%**

Strict uncovered endpoints:
- None.

## Unit Test Analysis

### Backend Unit Tests

- Test files: `unit_tests/*.test.js` (27 files).
- Modules covered:
  - controllers/routes: route suites (`routes_*.test.js`, `branches_*.test.js`).
  - services: `services_*.test.js` for orders/inventory/itinerary/payment_intake/workflow/ingestion/payments.
  - auth/guards/middleware: `infra.test.js`, `password.test.js`, `crypto.test.js`, plus workflow visibility tests.
- Important backend modules not clearly unit-tested directly:
  - `src/services/ingestion_parsers.js` (no direct test evidence found).
  - Runtime bootstrap/wiring modules (`src/server.js`, `src/db.js`, `src/config.js`) are not unit-targeted.

### Frontend Unit Tests (STRICT REQUIREMENT)

- Frontend test files detected:
  - `frontend/src/App.test.js`
  - `frontend/src/lib/api.test.js`
  - `frontend/src/lib/session.test.js`
  - `frontend/src/lib/permissions.test.js`
  - `frontend/src/lib/Guard.test.js`
  - `frontend/src/lib/DashboardWorkspace.test.js`
  - `frontend/src/lib/admin/AdminWorkspace.test.js`
  - `frontend/src/lib/audit/AuditWorkspace.test.js`
  - `frontend/src/lib/inventory/InventoryDashboard.test.js`
  - `frontend/src/lib/itinerary/Itineraries.test.js`
  - `frontend/src/lib/orders/OrdersView.test.js`
  - `frontend/src/lib/roadshow/RoadshowWorkspace.test.js`
  - `frontend/src/lib/workflows/TaskInbox.test.js`
- Framework/tools detected:
  - Vitest (`frontend/src/App.test.js:1`, `frontend/package.json:11`)
  - Testing Library Svelte (`frontend/src/App.test.js:2`)
  - jsdom (`frontend/package.json:21`)
- Components/modules covered:
  - App shell, auth/session/permission stores, Guard, dashboard, and all listed workspace Svelte components.
- Important frontend modules not tested:
  - `frontend/src/main.js` bootstrap path.
  - No real frontend-to-backend integration/e2e test layer.

**Frontend unit tests: PRESENT**

### Cross-Layer Observation

- Backend testing is significantly deeper (API + broad unit) than frontend.
- Frontend unit coverage exists, but many workspace tests mock `api` client, so cross-layer behavior is not validated.

## API Observability Check

- Strong in most API files: explicit method+path, request body/query setup, status assertions, and selective payload checks.
- Weak areas:
  - Some suites outside the newly fixed endpoints still accept broad status ranges (e.g., `API_tests/workflow_engine.test.js:128`, `API_tests/vendors.test.js:76`).

## Test Quality & Sufficiency

- Success paths: broadly present for core domains (auth, inventory, orders/payments, workflows, ingestion).
- Failure/validation/auth: extensively present.
- Edge cases: present (lockout lifecycle, scope matrix, workflow object visibility, drive-time scope, intake null-city handling).
- Integration boundaries: API tests hit real HTTP + DB-backed stack under Docker.
- Shallow spots: few endpoints lack true handler-path success/failure coverage (listed uncovered).
- `run_tests.sh` check:
  - Docker-based orchestration and execution confirmed (`run_tests.sh:32`, `run_tests.sh:53`, `run_tests.sh:58`, `run_tests.sh:66`).
  - No host package-manager dependency required beyond Docker.

## End-to-End Expectations (Fullstack)

- Real FE↔BE e2e tests are **missing**.
- Compensation exists via strong API suite + frontend unit tests, but this does not fully validate integrated user flows.

## Tests Check

- Static-only audit performed (no test execution).
- Evidence basis: route definitions, test source files, helper/bootstrap scripts, and test runner script.

## Test Coverage Score (0–100)

**96/100**

## Score Rationale

- Full endpoint handler coverage achieved with real HTTP tests.
- Deduction for missing fullstack e2e FE↔BE tests.
- Minor deduction for a few broad-acceptable assertions in non-critical suites.

## Key Gaps

1. Add at least one real FE↔BE flow test (login + one core workflow).
2. Tighten remaining broad status-range assertions in workflow/vendor suites.

## Confidence & Assumptions

- Confidence: **high** for endpoint/test mapping and mock classification.
- Assumptions:
  - Runtime route registration matches static imports in `src/server.js`.
  - API tests are executed in Docker as documented by `run_tests.sh`.

---

# README Audit

## README Location

- Found: `repo/README.md` (hard requirement satisfied).

## Hard Gate Evaluation

### Formatting
- PASS: clean markdown structure, sections, tables, command blocks.

### Startup Instructions (fullstack requirement)
- PASS: explicit `docker-compose up` provided (`repo/README.md:14`).

### Access Method
- PASS: frontend URL, API URL+port, DB port listed (`repo/README.md:46`).

### Verification Method
- PASS: concrete verification flow and API curl examples (`repo/README.md:76`).

### Environment Rules (Docker-contained)
- PASS (with caveat): no instruction to run `npm install`/`pip install`/manual DB setup on host.
- Caveat: one verification snippet uses host `node -pe` for token parsing (`repo/README.md:86`), which is not strictly Docker-contained tooling.

### Demo Credentials (auth conditional)
- PASS: admin credentials and role credential matrix provided (`repo/README.md:52`, `repo/README.md:59`).
- Note: non-admin roles are described as examples requiring creation post-bootstrap (`repo/README.md:61`).

## Engineering Quality

- Tech stack clarity: strong (`repo/README.md:3`).
- Architecture explanation: strong directory layout and invariants (`repo/README.md:224`, `repo/README.md:265`).
- Testing instructions: explicit dockerized one-command runner (`repo/README.md:116`).
- Security/roles/workflows: detailed and concrete.
- Presentation quality: high.

## High Priority Issues

- Verification snippet depends on host Node for token parsing (`repo/README.md:86`), weakening strict Docker-only posture.

## Medium Priority Issues

- README test inventory appears stale/incomplete vs current frontend test set (README lists 6 files but repository contains 13 frontend test files under `frontend/src/**/*.test.js`).
- Role credential table mixes seeded vs example accounts; onboarding could be clearer on which credentials are immediately valid.

## Low Priority Issues

- Minor verbosity overlap/redundancy across test inventory and security sections.

## Hard Gate Failures

- None.

## README Verdict

**PASS**
