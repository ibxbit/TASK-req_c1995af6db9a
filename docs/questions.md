# Business Questions and Solutions

## Q1: How to handle expired matches?
- Hypothesis: Auto-cancel after 3 mins per prompt.
- Solution: Implemented background cleanup logic.

## Q2: How to ensure offline-first order settlement and payment reconciliation?
- Hypothesis: Use local transaction files and idempotent callbacks.
- Solution: Store payment files locally, verify with shared secret, retry failed callbacks, and use compensating ledger entries.

## Q3: How to enforce role-based data and action permissions in the UI?
- Hypothesis: Gate all screens, actions, and data by role and scope.
- Solution: Implement menu/button/data-scope checks per user role and assignment.

## Q4: How to handle inventory reservation and release?
- Hypothesis: Reserve on order, release on cancel/unpaid, log all movements.
- Solution: Server-side reservation, auto-release after 60 mins unpaid, auditable ledger for all changes.

## Q5: How to manage multi-source data ingestion with checkpoint resume?
- Hypothesis: Use incremental parsing and checkpoint tracking.
- Solution: Scheduled jobs parse local exports, track last checkpoint, enforce 6-hour min interval.
