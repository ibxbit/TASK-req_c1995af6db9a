-- RoadshowOps - Offline payment intake + retry queue + attempt audit
-- Run: psql -U postgres -d roadshowops -f database/migrations/008_payments.sql

\connect roadshowops

-- =========================================================================
-- Payment intake: the canonical entry point for every payment method.
-- UNIQUE (method, external_id) makes apply/import idempotent.
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.payment_intake (
  id                 BIGSERIAL PRIMARY KEY,
  method             TEXT NOT NULL CHECK (method IN ('cash','check','ach','wechat')),
  external_id        TEXT NOT NULL,
  order_id           BIGINT REFERENCES core.event_order(id),
  payment_stage_id   BIGINT REFERENCES core.payment_stage(id),
  amount_cents       BIGINT NOT NULL CHECK (amount_cents > 0),
  currency           TEXT NOT NULL DEFAULT 'USD',
  raw_payload        JSONB,
  signature          TEXT,
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  status             TEXT NOT NULL DEFAULT 'received'
                       CHECK (status IN ('received','processing','applied','failed','rejected','compensated')),
  receipt_id         BIGINT REFERENCES core.receipt(id),
  attempt_count      INTEGER NOT NULL DEFAULT 0,
  last_attempt_at    TIMESTAMPTZ,
  next_attempt_at    TIMESTAMPTZ,
  last_error         TEXT,
  notes              TEXT,
  created_by         BIGINT REFERENCES core.app_user(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (method, external_id)
);

CREATE INDEX IF NOT EXISTS idx_intake_status ON core.payment_intake(status);
CREATE INDEX IF NOT EXISTS idx_intake_order  ON core.payment_intake(order_id);
CREATE INDEX IF NOT EXISTS idx_intake_retry
  ON core.payment_intake(next_attempt_at)
  WHERE status = 'failed' AND next_attempt_at IS NOT NULL;

-- =========================================================================
-- Append-only attempt log (one row per try, incl. retries)
-- =========================================================================
CREATE TABLE IF NOT EXISTS audit.payment_attempt (
  id             BIGSERIAL PRIMARY KEY,
  intake_id      BIGINT NOT NULL REFERENCES core.payment_intake(id),
  attempt_number INTEGER NOT NULL,
  actor_user_id  BIGINT REFERENCES core.app_user(id),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  status         TEXT NOT NULL CHECK (status IN ('ok','failed','rejected')),
  error_message  TEXT,
  metadata       JSONB
);

CREATE INDEX IF NOT EXISTS idx_pay_attempt_intake
  ON audit.payment_attempt(intake_id, started_at DESC);

DROP TRIGGER IF EXISTS trg_payment_attempt_no_update   ON audit.payment_attempt;
DROP TRIGGER IF EXISTS trg_payment_attempt_no_delete   ON audit.payment_attempt;
DROP TRIGGER IF EXISTS trg_payment_attempt_no_truncate ON audit.payment_attempt;

CREATE TRIGGER trg_payment_attempt_no_update
  BEFORE UPDATE ON audit.payment_attempt
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER trg_payment_attempt_no_delete
  BEFORE DELETE ON audit.payment_attempt
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER trg_payment_attempt_no_truncate
  BEFORE TRUNCATE ON audit.payment_attempt
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON audit.payment_attempt FROM PUBLIC;
