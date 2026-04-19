-- RoadshowOps - Events, orders, payment stages, invoices, receipts, refunds
-- Run: psql -U postgres -d roadshowops -f database/migrations/003_orders.sql

\connect roadshowops

-- =========================================================================
-- Numbering sequences (offline-friendly; no external ID service)
-- =========================================================================
CREATE SEQUENCE IF NOT EXISTS core.seq_order_number;
CREATE SEQUENCE IF NOT EXISTS core.seq_invoice_number;
CREATE SEQUENCE IF NOT EXISTS core.seq_receipt_number;
CREATE SEQUENCE IF NOT EXISTS core.seq_refund_number;

-- =========================================================================
-- Events (per city, with configurable min-headcount + cutoff)
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.event (
  id                  BIGSERIAL PRIMARY KEY,
  city_id             INTEGER NOT NULL REFERENCES core.city(id),
  name                TEXT NOT NULL,
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ,
  min_headcount       INTEGER NOT NULL DEFAULT 0 CHECK (min_headcount >= 0),
  headcount_cutoff_at TIMESTAMPTZ NOT NULL,
  current_headcount   INTEGER NOT NULL DEFAULT 0 CHECK (current_headcount >= 0),
  status              TEXT NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned','active','canceled','completed')),
  canceled_at         TIMESTAMPTZ,
  canceled_reason     TEXT,
  created_by          BIGINT REFERENCES core.app_user(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at),
  CHECK (headcount_cutoff_at <= starts_at)
);

CREATE INDEX IF NOT EXISTS idx_event_city   ON core.event(city_id);
CREATE INDEX IF NOT EXISTS idx_event_starts ON core.event(starts_at);
CREATE INDEX IF NOT EXISTS idx_event_status ON core.event(status);

-- =========================================================================
-- Event orders
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.event_order (
  id                 BIGSERIAL PRIMARY KEY,
  order_number       TEXT NOT NULL UNIQUE,
  event_id           BIGINT NOT NULL REFERENCES core.event(id),
  city_id            INTEGER NOT NULL REFERENCES core.city(id),
  customer_name      TEXT NOT NULL,
  customer_email     TEXT,
  customer_phone     TEXT,
  total_amount_cents BIGINT NOT NULL CHECK (total_amount_cents >= 0),
  currency           TEXT NOT NULL DEFAULT 'USD',
  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','fulfilled','canceled','refunded','partially_refunded')),
  created_by         BIGINT REFERENCES core.app_user(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_event ON core.event_order(event_id);
CREATE INDEX IF NOT EXISTS idx_order_city  ON core.event_order(city_id);

-- =========================================================================
-- Payment stages (configurable per order)
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.payment_stage (
  id                  BIGSERIAL PRIMARY KEY,
  order_id            BIGINT NOT NULL REFERENCES core.event_order(id) ON DELETE CASCADE,
  sequence            INTEGER NOT NULL,
  label               TEXT NOT NULL,
  amount_cents        BIGINT NOT NULL CHECK (amount_cents >= 0),
  due_rule_type       TEXT NOT NULL
                        CHECK (due_rule_type IN ('absolute','relative_to_order','relative_to_event_start')),
  due_offset_minutes  INTEGER,                -- signed; required for relative types
  due_at              TIMESTAMPTZ NOT NULL,   -- materialised absolute due time
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','invoiced','paid','refunded','voided')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, sequence)
);

-- =========================================================================
-- Invoices (one per stage, issued on order creation)
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.invoice (
  id               BIGSERIAL PRIMARY KEY,
  invoice_number   TEXT NOT NULL UNIQUE,
  payment_stage_id BIGINT NOT NULL UNIQUE REFERENCES core.payment_stage(id) ON DELETE CASCADE,
  order_id         BIGINT NOT NULL REFERENCES core.event_order(id),
  amount_cents     BIGINT NOT NULL CHECK (amount_cents >= 0),
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at           TIMESTAMPTZ NOT NULL,
  notes            TEXT,
  created_by       BIGINT REFERENCES core.app_user(id)
);

-- =========================================================================
-- Receipts (one per paid stage)
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.receipt (
  id               BIGSERIAL PRIMARY KEY,
  receipt_number   TEXT NOT NULL UNIQUE,
  invoice_id       BIGINT NOT NULL UNIQUE REFERENCES core.invoice(id) ON DELETE CASCADE,
  payment_stage_id BIGINT NOT NULL UNIQUE REFERENCES core.payment_stage(id),
  order_id         BIGINT NOT NULL REFERENCES core.event_order(id),
  amount_cents     BIGINT NOT NULL CHECK (amount_cents >= 0),
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  payment_method   TEXT,
  reference        TEXT,
  created_by       BIGINT REFERENCES core.app_user(id)
);

-- =========================================================================
-- Refunds (one per refunded stage)
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.refund (
  id               BIGSERIAL PRIMARY KEY,
  refund_number    TEXT NOT NULL UNIQUE,
  payment_stage_id BIGINT NOT NULL UNIQUE REFERENCES core.payment_stage(id),
  order_id         BIGINT NOT NULL REFERENCES core.event_order(id),
  amount_cents     BIGINT NOT NULL CHECK (amount_cents > 0),
  reason           TEXT NOT NULL
                     CHECK (reason IN ('event_canceled','headcount_miss','manual')),
  triggered_by     TEXT NOT NULL CHECK (triggered_by IN ('system','user')),
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       BIGINT REFERENCES core.app_user(id)
);

CREATE INDEX IF NOT EXISTS idx_refund_order ON core.refund(order_id);
