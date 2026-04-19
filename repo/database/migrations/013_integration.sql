-- RoadshowOps - Integration: append-only financial ledger + unified audit view refresh
-- Run: psql -U postgres -d roadshowops -f database/migrations/013_integration.sql

\connect roadshowops

-- =========================================================================
-- Financial ledger: one row per realised money movement (receipt / refund).
-- Signed amount_cents: positive = money in, negative = money out.
-- Every receipt and refund MUST write a row here.
-- =========================================================================
CREATE TABLE IF NOT EXISTS audit.financial_ledger (
  id               BIGSERIAL PRIMARY KEY,
  entry_type       TEXT NOT NULL CHECK (entry_type IN ('receipt','refund')),
  order_id         BIGINT NOT NULL REFERENCES core.event_order(id),
  payment_stage_id BIGINT NOT NULL REFERENCES core.payment_stage(id),
  receipt_id       BIGINT REFERENCES core.receipt(id),
  refund_id        BIGINT REFERENCES core.refund(id),
  amount_cents     BIGINT NOT NULL,
  currency         TEXT   NOT NULL DEFAULT 'USD',
  reason           TEXT,
  actor_user_id    BIGINT REFERENCES core.app_user(id),
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata         JSONB,
  CHECK (
    (entry_type = 'receipt' AND amount_cents > 0 AND receipt_id IS NOT NULL AND refund_id IS NULL) OR
    (entry_type = 'refund'  AND amount_cents < 0 AND refund_id  IS NOT NULL AND receipt_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_fin_ledger_order ON audit.financial_ledger(order_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_fin_ledger_type  ON audit.financial_ledger(entry_type);
CREATE INDEX IF NOT EXISTS idx_fin_ledger_time  ON audit.financial_ledger(occurred_at DESC);

-- Append-only enforcement (reuse shared reject function)
DROP TRIGGER IF EXISTS trg_fin_ledger_no_update   ON audit.financial_ledger;
DROP TRIGGER IF EXISTS trg_fin_ledger_no_delete   ON audit.financial_ledger;
DROP TRIGGER IF EXISTS trg_fin_ledger_no_truncate ON audit.financial_ledger;

CREATE TRIGGER trg_fin_ledger_no_update
  BEFORE UPDATE ON audit.financial_ledger
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER trg_fin_ledger_no_delete
  BEFORE DELETE ON audit.financial_ledger
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER trg_fin_ledger_no_truncate
  BEFORE TRUNCATE ON audit.financial_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON audit.financial_ledger FROM PUBLIC;

-- =========================================================================
-- Extend the unified audit view with financial ledger rows
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
       NULL, NULL, NULL, NULL, TRUE, NULL,
       jsonb_build_object(
         'movement_id',     sl.movement_id,
         'on_hand_before',  sl.on_hand_before,
         'on_hand_after',   sl.on_hand_after,
         'reserved_before', sl.reserved_before,
         'reserved_after',  sl.reserved_after,
         'reference_type',  sl.reference_type,
         'reference_id',    sl.reference_id
       ), sl.occurred_at
FROM audit.stock_ledger sl
UNION ALL
SELECT 'payment_attempt', pa.id, pa.actor_user_id, NULL,
       'payment.attempt.' || pa.status,
       'payment_intake', pa.intake_id::text,
       'intake:' || pa.intake_id,
       NULL, NULL, NULL, NULL, pa.status = 'ok', pa.error_message,
       pa.metadata, pa.started_at
FROM audit.payment_attempt pa
UNION ALL
SELECT 'ingestion_run', ir.id, ir.actor_user_id, NULL,
       'ingestion.run',
       'ingestion_run', ir.id::text,
       COALESCE('source:' || ir.source_id::text, 'resource:' || ir.resource),
       NULL, NULL, NULL, NULL, TRUE, NULL,
       jsonb_build_object(
         'resource',     ir.resource,
         'source_id',    ir.source_id,
         'record_count', ir.record_count,
         'inserted',     ir.inserted,
         'updated',      ir.updated,
         'skipped',      ir.skipped,
         'errors',       ir.errors
       ), ir.started_at
FROM audit.ingestion_run ir
UNION ALL
SELECT 'financial_ledger', fl.id, fl.actor_user_id, NULL,
       'financial.' || fl.entry_type,
       'order', fl.order_id::text,
       'order:' || fl.order_id || ':stage:' || fl.payment_stage_id,
       NULL, NULL, NULL, NULL, TRUE, fl.reason,
       jsonb_build_object(
         'amount_cents', fl.amount_cents,
         'currency',     fl.currency,
         'receipt_id',   fl.receipt_id,
         'refund_id',    fl.refund_id
       ), fl.occurred_at
FROM audit.financial_ledger fl;
