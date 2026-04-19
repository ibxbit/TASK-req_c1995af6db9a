-- RoadshowOps - Unified audit log query surface + query indexes
-- Run: psql -U postgres -d roadshowops -f database/migrations/012_audit.sql

\connect roadshowops

-- =========================================================================
-- Entity fields for consistent filtering across audit events
-- =========================================================================
ALTER TABLE audit.permission_event
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id   TEXT;

-- =========================================================================
-- Query indexes (user, workstation, action are the required filter axes)
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_perm_event_action
  ON audit.permission_event(action);
CREATE INDEX IF NOT EXISTS idx_perm_event_entity
  ON audit.permission_event(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_perm_event_user_time
  ON audit.permission_event(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_perm_event_workstation_time
  ON audit.permission_event(workstation, occurred_at DESC)
  WHERE workstation IS NOT NULL;

-- =========================================================================
-- Unified audit view: UNION across every append-only audit table.
-- Callers query a single surface; storage remains domain-specific.
-- =========================================================================
CREATE OR REPLACE VIEW audit.v_audit_log AS
SELECT
  'permission_event'::text               AS source,
  pe.id                                  AS event_id,
  pe.user_id, pe.username,
  COALESCE(pe.action, pe.permission_code) AS action,
  pe.entity_type, pe.entity_id,
  pe.resource                            AS entity,
  pe.workstation, pe.ip_address,
  pe.http_method, pe.http_path,
  pe.granted, pe.reason,
  pe.metadata,
  pe.occurred_at
FROM audit.permission_event pe
UNION ALL
SELECT 'stock_ledger', sl.id, sl.actor_user_id, NULL,
       'inventory.' || sl.reason,
       'stock',
       sl.item_id::text || ':' || sl.location_id::text,
       'stock:' || sl.item_id || '@' || sl.location_id,
       NULL, NULL, NULL, NULL,
       TRUE, NULL,
       jsonb_build_object(
         'movement_id',      sl.movement_id,
         'on_hand_before',   sl.on_hand_before,
         'on_hand_after',    sl.on_hand_after,
         'reserved_before',  sl.reserved_before,
         'reserved_after',   sl.reserved_after,
         'reference_type',   sl.reference_type,
         'reference_id',     sl.reference_id
       ),
       sl.occurred_at
FROM audit.stock_ledger sl
UNION ALL
SELECT 'payment_attempt', pa.id, pa.actor_user_id, NULL,
       'payment.attempt.' || pa.status,
       'payment_intake', pa.intake_id::text,
       'intake:' || pa.intake_id,
       NULL, NULL, NULL, NULL,
       pa.status = 'ok',
       pa.error_message,
       pa.metadata,
       pa.started_at
FROM audit.payment_attempt pa
UNION ALL
SELECT 'ingestion_run', ir.id, ir.actor_user_id, NULL,
       'ingestion.run',
       'ingestion_run', ir.id::text,
       COALESCE('source:' || ir.source_id::text, 'resource:' || ir.resource),
       NULL, NULL, NULL, NULL,
       TRUE, NULL,
       jsonb_build_object(
         'resource',     ir.resource,
         'source_id',    ir.source_id,
         'record_count', ir.record_count,
         'inserted',     ir.inserted,
         'updated',      ir.updated,
         'skipped',      ir.skipped,
         'errors',       ir.errors
       ),
       ir.started_at
FROM audit.ingestion_run ir;

-- =========================================================================
-- Retention: 7 years. Implemented by policy, not DELETE (tables are
-- immutable at the trigger level). Export + drop partitions out-of-band
-- after 7 years.
-- =========================================================================
COMMENT ON SCHEMA audit IS
  'Append-only audit. Retention: 7 years. Never UPDATE/DELETE rows in-place — triggers will reject.';
