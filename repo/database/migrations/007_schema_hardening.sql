-- RoadshowOps - Audit append-only hardening + additional performance indexes
-- Run: psql -U postgres -d roadshowops -f database/migrations/007_schema_hardening.sql

\connect roadshowops

-- =========================================================================
-- Shared immutability function for audit tables
-- =========================================================================
CREATE OR REPLACE FUNCTION audit.reject_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is not allowed (audit tables are append-only)',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$;

-- =========================================================================
-- audit.permission_event: append-only
-- =========================================================================
DROP TRIGGER IF EXISTS trg_permission_event_no_update   ON audit.permission_event;
DROP TRIGGER IF EXISTS trg_permission_event_no_delete   ON audit.permission_event;
DROP TRIGGER IF EXISTS trg_permission_event_no_truncate ON audit.permission_event;

CREATE TRIGGER trg_permission_event_no_update
  BEFORE UPDATE ON audit.permission_event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER trg_permission_event_no_delete
  BEFORE DELETE ON audit.permission_event
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER trg_permission_event_no_truncate
  BEFORE TRUNCATE ON audit.permission_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON audit.permission_event FROM PUBLIC;

-- =========================================================================
-- audit.ingestion_run: append-only (ingestion service writes one row per run
-- at completion; no updates)
-- =========================================================================
DROP TRIGGER IF EXISTS trg_ingestion_run_no_update   ON audit.ingestion_run;
DROP TRIGGER IF EXISTS trg_ingestion_run_no_delete   ON audit.ingestion_run;
DROP TRIGGER IF EXISTS trg_ingestion_run_no_truncate ON audit.ingestion_run;

CREATE TRIGGER trg_ingestion_run_no_update
  BEFORE UPDATE ON audit.ingestion_run
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER trg_ingestion_run_no_delete
  BEFORE DELETE ON audit.ingestion_run
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER trg_ingestion_run_no_truncate
  BEFORE TRUNCATE ON audit.ingestion_run
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON audit.ingestion_run FROM PUBLIC;

-- Re-point audit.stock_ledger triggers to the shared function (keeps name compatibility)
DROP TRIGGER IF EXISTS trg_stock_ledger_no_update   ON audit.stock_ledger;
DROP TRIGGER IF EXISTS trg_stock_ledger_no_delete   ON audit.stock_ledger;
DROP TRIGGER IF EXISTS trg_stock_ledger_no_truncate ON audit.stock_ledger;

CREATE TRIGGER trg_stock_ledger_no_update
  BEFORE UPDATE ON audit.stock_ledger
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER trg_stock_ledger_no_delete
  BEFORE DELETE ON audit.stock_ledger
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER trg_stock_ledger_no_truncate
  BEFORE TRUNCATE ON audit.stock_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();

-- =========================================================================
-- Additional performance indexes for frequent queries
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_event_order_status_time
  ON core.event_order(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_stage_order
  ON core.payment_stage(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_stage_due
  ON core.payment_stage(status, due_at);
CREATE INDEX IF NOT EXISTS idx_refund_reason
  ON core.refund(reason);
CREATE INDEX IF NOT EXISTS idx_candidate_created_at
  ON core.candidate(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movement_ref
  ON core.stock_movement(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservation_ref
  ON core.stock_reservation(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_itinerary_date
  ON core.itinerary(itinerary_date DESC);
