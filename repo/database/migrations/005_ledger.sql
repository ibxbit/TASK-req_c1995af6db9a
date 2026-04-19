-- RoadshowOps - Immutable stock ledger + order↔reservation linkage + reservation expiry
-- Run: psql -U postgres -d roadshowops -f database/migrations/005_ledger.sql

\connect roadshowops

-- =========================================================================
-- Reservation lifecycle: 60-minute payment window
-- =========================================================================
ALTER TABLE core.stock_reservation
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_reservation_expiry
  ON core.stock_reservation(expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;

-- =========================================================================
-- Order line items (links order ↔ item ↔ location ↔ reservation)
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.event_order_line (
  id             BIGSERIAL PRIMARY KEY,
  order_id       BIGINT  NOT NULL REFERENCES core.event_order(id) ON DELETE CASCADE,
  item_id        BIGINT  NOT NULL REFERENCES core.item(id),
  location_id    INTEGER NOT NULL REFERENCES core.warehouse_location(id),
  quantity       BIGINT  NOT NULL CHECK (quantity > 0),
  reservation_id BIGINT REFERENCES core.stock_reservation(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_line_order ON core.event_order_line(order_id);

-- =========================================================================
-- Immutable stock ledger
--   who = actor_user_id (+ JOIN app_user for current display name)
--   when = occurred_at
--   why = reason (free text, e.g., 'reservation:expired_unpaid', 'cycle_count_adjust')
--   before/after = on_hand_{before,after} + reserved_{before,after}
-- =========================================================================
CREATE TABLE IF NOT EXISTS audit.stock_ledger (
  id              BIGSERIAL PRIMARY KEY,
  movement_id     BIGINT REFERENCES core.stock_movement(id),
  item_id         BIGINT  NOT NULL REFERENCES core.item(id),
  location_id     INTEGER NOT NULL REFERENCES core.warehouse_location(id),
  actor_user_id   BIGINT REFERENCES core.app_user(id),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason          TEXT    NOT NULL,
  on_hand_before  BIGINT  NOT NULL,
  on_hand_after   BIGINT  NOT NULL,
  reserved_before BIGINT  NOT NULL,
  reserved_after  BIGINT  NOT NULL,
  reference_type  TEXT,
  reference_id    TEXT
);

CREATE INDEX IF NOT EXISTS idx_ledger_item   ON audit.stock_ledger(item_id, location_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_actor  ON audit.stock_ledger(actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_time   ON audit.stock_ledger(occurred_at DESC);

-- =========================================================================
-- Immutability: reject UPDATE, DELETE, TRUNCATE at the DB level.
-- Combined with principle-of-least-privilege revokes, this makes the
-- ledger append-only regardless of application bugs.
-- =========================================================================
CREATE OR REPLACE FUNCTION audit.stock_ledger_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.stock_ledger is append-only (operation % is not allowed)', TG_OP
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_ledger_no_update   ON audit.stock_ledger;
DROP TRIGGER IF EXISTS trg_stock_ledger_no_delete   ON audit.stock_ledger;
DROP TRIGGER IF EXISTS trg_stock_ledger_no_truncate ON audit.stock_ledger;

CREATE TRIGGER trg_stock_ledger_no_update
  BEFORE UPDATE ON audit.stock_ledger
  FOR EACH ROW EXECUTE FUNCTION audit.stock_ledger_immutable();

CREATE TRIGGER trg_stock_ledger_no_delete
  BEFORE DELETE ON audit.stock_ledger
  FOR EACH ROW EXECUTE FUNCTION audit.stock_ledger_immutable();

CREATE TRIGGER trg_stock_ledger_no_truncate
  BEFORE TRUNCATE ON audit.stock_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION audit.stock_ledger_immutable();

-- Belt-and-braces: revoke UPDATE/DELETE/TRUNCATE from the application role.
-- (On an on-prem single-role deployment the triggers above are the primary defense.)
REVOKE UPDATE, DELETE, TRUNCATE ON audit.stock_ledger FROM PUBLIC;
