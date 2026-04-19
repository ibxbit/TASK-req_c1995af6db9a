# Design Outline

## System Architecture

- **Frontend:** Svelte, role-based UI, offline-first, field masking, drag-and-drop, conflict detection, version restore.
- **Backend:** Fastify REST API, PostgreSQL, background jobs for cleanup, ingestion, and workflow.
- **Security:** Local auth, AES-256 at rest, lockout, audit logs, field masking.
- **Inventory:** Multi-warehouse, real-time reservation, auto-release, auditable ledger.
- **Order Settlement:** Offline-first, local payment files, idempotent callbacks, compensating entries.
- **Workflow Engine:** Task generation, timing/visibility, validation, multi-node approval, auto-archive.

## Key Flows

- **Itinerary Planning:**
  - Drag-and-drop events, template use, conflict/buffer checks, versioning.

- **Order & Payment:**
  - Multi-stage payments, auto-cancel/refund, offline payment support, minimum headcount enforcement.

- **Inventory Management:**
  - Real-time stock, reservation/release, low-stock alerts, movement logging.

- **Data Intake:**
  - Scheduled parsing, checkpoint resume, policy hooks for anti-bot.

- **Security & Audit:**
  - Strong password, lockout, encryption, append-only logs, 7-year retention.
