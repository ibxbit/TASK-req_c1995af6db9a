# API Specification

## Authentication

- POST /api/auth/login
  - Body: { username, password }
  - Response: { token, user, roles, scopes }
  - Security: Lockout after 5 failed attempts, min 12-char password

## Itinerary

- GET /api/itineraries
  - Query: ?userId (scoped)
  - Response: [ { id, name, events, version, ... } ]

- POST /api/itineraries
  - Body: { name, events, templateId? }
  - Response: { id, ... }

- PUT /api/itineraries/:id
  - Body: { events, ... }
  - Response: { success }

- POST /api/itineraries/:id/restore
  - Body: { version }
  - Response: { success }

## Orders & Payments

- POST /api/orders
  - Body: { eventId, items, paymentStage, ... }
  - Response: { orderId, reserved, paymentDue }

- POST /api/orders/:id/pay
  - Body: { method, reference, amount }
  - Response: { receipt, status }

- POST /api/orders/:id/cancel
  - Body: { reason }
  - Response: { success }

- POST /api/orders/:id/refund
  - Body: { reason, amount }
  - Response: { refundId, status }

## Inventory

- GET /api/inventory
  - Query: ?warehouseId
  - Response: [ { itemId, name, onHand, reserved, threshold, ... } ]

- POST /api/inventory/move
  - Body: { from, to, itemId, qty, reason }
  - Response: { success }

- POST /api/inventory/count
  - Body: { itemId, locationId, qty }
  - Response: { success }

## Workflow & Approvals

- GET /api/workflows
  - Query: ?objectType&objectId
  - Response: [ { id, tasks, status, ... } ]

- POST /api/workflows/:id/approve
  - Body: { userId, comments }
  - Response: { success }

- POST /api/workflows/:id/return
  - Body: { reason }
  - Response: { success }

## Data Intake

- POST /api/intake/upload
  - Body: multipart/form-data (HTML/CSV)
  - Response: { jobId, status }

- GET /api/intake/status/:jobId
  - Response: { status, lastCheckpoint, errors }

## Audit & Security

- GET /api/audit/logs
  - Query: ?userId&actionType
  - Response: [ { id, userId, action, timestamp, workstation, ... } ]
