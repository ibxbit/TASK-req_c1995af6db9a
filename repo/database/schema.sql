-- =============================================================================
-- RoadshowOps Operations Suite — schema snapshot (DDL, 001..007)
-- =============================================================================
-- NOTE: This file is a PARTIAL snapshot of the baseline (migrations 001..007).
-- It does NOT include objects from migrations 008..013 and therefore CANNOT
-- be used on its own to bootstrap a runnable instance. The canonical
-- bootstrap path is applying every file in database/migrations/*.sql in
-- lexical order (see backend/docker-entrypoint.sh).
--
-- This file is retained for reference / baseline diffing only.
-- =============================================================================

\connect roadshowops

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS audit;

-- =============================================================================
-- ENUMs
-- =============================================================================
DO $$ BEGIN
  CREATE TYPE core.permission_layer AS ENUM ('menu','action','data');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =============================================================================
-- RBAC: users, roles, permissions
-- =============================================================================
CREATE TABLE IF NOT EXISTS core.app_user (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.role (
  id          SMALLSERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS core.permission (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  layer       core.permission_layer NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS core.role_permission (
  role_id       SMALLINT NOT NULL REFERENCES core.role(id)       ON DELETE CASCADE,
  permission_id INTEGER  NOT NULL REFERENCES core.permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS core.user_role (
  user_id BIGINT   NOT NULL REFERENCES core.app_user(id) ON DELETE CASCADE,
  role_id SMALLINT NOT NULL REFERENCES core.role(id)     ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- =============================================================================
-- Cities + per-user data-level scoping
-- =============================================================================
CREATE TABLE IF NOT EXISTS core.city (
  id        SERIAL PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS core.user_city (
  user_id BIGINT  NOT NULL REFERENCES core.app_user(id) ON DELETE CASCADE,
  city_id INTEGER NOT NULL REFERENCES core.city(id)     ON DELETE CASCADE,
  PRIMARY KEY (user_id, city_id)
);

-- =============================================================================
-- Candidates (recruiting)
-- =============================================================================
CREATE TABLE IF NOT EXISTS core.candidate (
  id         BIGSERIAL PRIMARY KEY,
  city_id    INTEGER NOT NULL REFERENCES core.city(id),
  full_name  TEXT NOT NULL,
  email      TEXT,
  status     TEXT NOT NULL DEFAULT 'new',
  created_by BIGINT REFERENCES core.app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_city       ON core.candidate(city_id);
CREATE INDEX IF NOT EXISTS idx_candidate_created_at ON core.candidate(created_at DESC);

-- =============================================================================
-- Finance transactions (legacy placeholder from RBAC demo)
-- =============================================================================
CREATE TABLE IF NOT EXISTS core.finance_transaction (
  id           BIGSERIAL PRIMARY KEY,
  city_id      INTEGER NOT NULL REFERENCES core.city(id),
  kind         TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  description  TEXT,
  created_by   BIGINT REFERENCES core.app_user(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_tx_city ON core.finance_transaction(city_id);

-- =============================================================================
-- Venues + drive-time cache
-- =============================================================================
CREATE TABLE IF NOT EXISTS core.venue (
  id         SERIAL PRIMARY KEY,
  city_id    INTEGER NOT NULL REFERENCES core.city(id),
  name       TEXT NOT NULL,
  address    TEXT,
  latitude   NUMERIC(9,6),
  longitude  NUMERIC(9,6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city_id, name)
);

CREATE INDEX IF NOT EXISTS idx_venue_city ON core.venue(city_id);

CREATE TABLE IF NOT EXISTS core.drive_time (
  origin_venue_id      INTEGER NOT NULL REFERENCES core.venue(id) ON DELETE CASCADE,
  destination_venue_id INTEGER NOT NULL REFERENCES core.venue(id) ON DELETE CASCADE,
  minutes              INTEGER NOT NULL CHECK (minutes >= 0),
  source               TEXT    NOT NULL CHECK (source IN ('manual','computed')),
  created_by           BIGINT REFERENCES core.app_user(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (origin_venue_id, destination_venue_id),
  CHECK (origin_venue_id < destination_venue_id)
);

-- =============================================================================
-- Itineraries + events + versions + templates
-- =============================================================================
CREATE TABLE IF NOT EXISTS core.itinerary (
  id              BIGSERIAL PRIMARY KEY,
  city_id         INTEGER NOT NULL REFERENCES core.city(id),
  owner_user_id   BIGINT  NOT NULL REFERENCES core.app_user(id),
  name            TEXT NOT NULL,
  itinerary_date  DATE NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_itinerary_city  ON core.itinerary(city_id);
CREATE INDEX IF NOT EXISTS idx_itinerary_owner ON core.itinerary(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_itinerary_date  ON core.itinerary(itinerary_date DESC);

CREATE TABLE IF NOT EXISTS core.itinerary_event (
  id           BIGSERIAL PRIMARY KEY,
  itinerary_id BIGINT  NOT NULL REFERENCES core.itinerary(id) ON DELETE CASCADE,
  sequence     INTEGER NOT NULL,
  title        TEXT    NOT NULL,
  venue_id     INTEGER REFERENCES core.venue(id),
  start_at     TIMESTAMPTZ NOT NULL,
  end_at       TIMESTAMPTZ NOT NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS idx_event_itinerary ON core.itinerary_event(itinerary_id, sequence);

CREATE TABLE IF NOT EXISTS core.itinerary_version (
  id             BIGSERIAL PRIMARY KEY,
  itinerary_id   BIGINT  NOT NULL REFERENCES core.itinerary(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  changed_by     BIGINT  NOT NULL REFERENCES core.app_user(id),
  change_summary TEXT,
  snapshot       JSONB   NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (itinerary_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_itinerary_version_it
  ON core.itinerary_version(itinerary_id, version_number DESC);

CREATE TABLE IF NOT EXISTS core.itinerary_template (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_by  BIGINT REFERENCES core.app_user(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.itinerary_template_event (
  id                        BIGSERIAL PRIMARY KEY,
  template_id               BIGINT NOT NULL REFERENCES core.itinerary_template(id) ON DELETE CASCADE,
  sequence                  INTEGER NOT NULL,
  title                     TEXT    NOT NULL,
  default_duration_minutes  INTEGER NOT NULL CHECK (default_duration_minutes > 0),
  offset_from_start_minutes INTEGER NOT NULL DEFAULT 0 CHECK (offset_from_start_minutes >= 0),
  default_notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_template_event_tpl
  ON core.itinerary_template_event(template_id, sequence);

-- =============================================================================
-- Events + orders + payment stages + invoices + receipts + refunds
-- =============================================================================
CREATE SEQUENCE IF NOT EXISTS core.seq_order_number;
CREATE SEQUENCE IF NOT EXISTS core.seq_invoice_number;
CREATE SEQUENCE IF NOT EXISTS core.seq_receipt_number;
CREATE SEQUENCE IF NOT EXISTS core.seq_refund_number;

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

CREATE INDEX IF NOT EXISTS idx_order_event        ON core.event_order(event_id);
CREATE INDEX IF NOT EXISTS idx_order_city         ON core.event_order(city_id);
CREATE INDEX IF NOT EXISTS idx_event_order_status_time
  ON core.event_order(status, created_at DESC);

CREATE TABLE IF NOT EXISTS core.payment_stage (
  id                  BIGSERIAL PRIMARY KEY,
  order_id            BIGINT NOT NULL REFERENCES core.event_order(id) ON DELETE CASCADE,
  sequence            INTEGER NOT NULL,
  label               TEXT NOT NULL,
  amount_cents        BIGINT NOT NULL CHECK (amount_cents >= 0),
  due_rule_type       TEXT NOT NULL
                        CHECK (due_rule_type IN ('absolute','relative_to_order','relative_to_event_start')),
  due_offset_minutes  INTEGER,
  due_at              TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','invoiced','paid','refunded','voided')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_payment_stage_order ON core.payment_stage(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_stage_due   ON core.payment_stage(status, due_at);

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

CREATE INDEX IF NOT EXISTS idx_refund_order  ON core.refund(order_id);
CREATE INDEX IF NOT EXISTS idx_refund_reason ON core.refund(reason);

-- =============================================================================
-- Warehouses + locations + item master + stock + movements + reservations + counts
-- =============================================================================
CREATE TABLE IF NOT EXISTS core.warehouse (
  id         SERIAL PRIMARY KEY,
  city_id    INTEGER NOT NULL REFERENCES core.city(id),
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  address    TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_city ON core.warehouse(city_id);

CREATE TABLE IF NOT EXISTS core.warehouse_location (
  id           SERIAL PRIMARY KEY,
  warehouse_id INTEGER NOT NULL REFERENCES core.warehouse(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  name         TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (warehouse_id, code)
);

CREATE TABLE IF NOT EXISTS core.item (
  id               BIGSERIAL PRIMARY KEY,
  sku              TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  unit             TEXT NOT NULL DEFAULT 'each',
  safety_threshold INTEGER NOT NULL DEFAULT 10 CHECK (safety_threshold >= 0),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.stock (
  item_id     BIGINT  NOT NULL REFERENCES core.item(id),
  location_id INTEGER NOT NULL REFERENCES core.warehouse_location(id),
  on_hand     BIGINT  NOT NULL DEFAULT 0 CHECK (on_hand  >= 0),
  reserved    BIGINT  NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, location_id),
  CHECK (reserved <= on_hand)
);

CREATE TABLE IF NOT EXISTS core.stock_movement (
  id               BIGSERIAL PRIMARY KEY,
  movement_type    TEXT NOT NULL
                     CHECK (movement_type IN (
                       'inbound','outbound','transfer','adjust',
                       'reservation','release','fulfill'
                     )),
  item_id          BIGINT  NOT NULL REFERENCES core.item(id),
  from_location_id INTEGER REFERENCES core.warehouse_location(id),
  to_location_id   INTEGER REFERENCES core.warehouse_location(id),
  quantity         BIGINT  NOT NULL,
  reference_type   TEXT,
  reference_id     TEXT,
  notes            TEXT,
  created_by       BIGINT REFERENCES core.app_user(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_movement_item ON core.stock_movement(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movement_type ON core.stock_movement(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_movement_ref
  ON core.stock_movement(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS core.stock_reservation (
  id             BIGSERIAL PRIMARY KEY,
  item_id        BIGINT  NOT NULL REFERENCES core.item(id),
  location_id    INTEGER NOT NULL REFERENCES core.warehouse_location(id),
  quantity       BIGINT  NOT NULL CHECK (quantity > 0),
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','fulfilled','released')),
  reference_type TEXT,
  reference_id   TEXT,
  expires_at     TIMESTAMPTZ,
  created_by     BIGINT REFERENCES core.app_user(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_item   ON core.stock_reservation(item_id, location_id);
CREATE INDEX IF NOT EXISTS idx_reservation_status ON core.stock_reservation(status);
CREATE INDEX IF NOT EXISTS idx_stock_reservation_ref
  ON core.stock_reservation(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_reservation_expiry
  ON core.stock_reservation(expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS core.cycle_count (
  id           BIGSERIAL PRIMARY KEY,
  item_id      BIGINT  NOT NULL REFERENCES core.item(id),
  location_id  INTEGER NOT NULL REFERENCES core.warehouse_location(id),
  expected_qty BIGINT  NOT NULL,
  counted_qty  BIGINT  NOT NULL CHECK (counted_qty >= 0),
  variance     BIGINT  NOT NULL,
  notes        TEXT,
  counted_by   BIGINT  NOT NULL REFERENCES core.app_user(id),
  counted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cycle_count_item ON core.cycle_count(item_id, counted_at DESC);

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

-- =============================================================================
-- Workflows (approval requests)
-- =============================================================================
CREATE TABLE IF NOT EXISTS core.approval_request (
  id              BIGSERIAL PRIMARY KEY,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  summary         TEXT NOT NULL,
  payload         JSONB,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','canceled')),
  requested_by    BIGINT NOT NULL REFERENCES core.app_user(id),
  decided_by      BIGINT REFERENCES core.app_user(id),
  decided_at      TIMESTAMPTZ,
  decision_notes  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_status ON core.approval_request(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_entity ON core.approval_request(entity_type, entity_id);

-- =============================================================================
-- Audit schema (APPEND-ONLY)
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit.permission_event (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT,
  username        TEXT,
  permission_code TEXT,
  resource        TEXT,
  action          TEXT,
  granted         BOOLEAN NOT NULL,
  reason          TEXT,
  http_method     TEXT,
  http_path       TEXT,
  ip_address      INET,
  metadata        JSONB,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perm_event_user ON audit.permission_event(user_id);
CREATE INDEX IF NOT EXISTS idx_perm_event_time ON audit.permission_event(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_perm_event_perm ON audit.permission_event(permission_code);

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

CREATE INDEX IF NOT EXISTS idx_ledger_item  ON audit.stock_ledger(item_id, location_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_actor ON audit.stock_ledger(actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_time  ON audit.stock_ledger(occurred_at DESC);

CREATE TABLE IF NOT EXISTS audit.ingestion_run (
  id             BIGSERIAL PRIMARY KEY,
  resource       TEXT NOT NULL,
  actor_user_id  BIGINT REFERENCES core.app_user(id),
  record_count   INTEGER NOT NULL,
  inserted       INTEGER NOT NULL DEFAULT 0,
  updated        INTEGER NOT NULL DEFAULT 0,
  skipped        INTEGER NOT NULL DEFAULT 0,
  errors         JSONB,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingestion_time ON audit.ingestion_run(started_at DESC);

-- =============================================================================
-- Append-only enforcement for all audit.* tables
-- =============================================================================
CREATE OR REPLACE FUNCTION audit.reject_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is not allowed (audit tables are append-only)',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['stock_ledger','permission_event','ingestion_run']) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_no_update   ON audit.%I', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_no_delete   ON audit.%I', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_no_truncate ON audit.%I', t, t);

    EXECUTE format(
      'CREATE TRIGGER trg_%s_no_update   BEFORE UPDATE   ON audit.%I FOR EACH ROW       EXECUTE FUNCTION audit.reject_mutation()', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_no_delete   BEFORE DELETE   ON audit.%I FOR EACH ROW       EXECUTE FUNCTION audit.reject_mutation()', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_no_truncate BEFORE TRUNCATE ON audit.%I FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation()', t, t);
  END LOOP;
END $$;

REVOKE UPDATE, DELETE, TRUNCATE ON audit.stock_ledger,
                                   audit.permission_event,
                                   audit.ingestion_run FROM PUBLIC;

-- =============================================================================
-- Views
-- =============================================================================
CREATE OR REPLACE VIEW core.v_user_permission AS
SELECT DISTINCT u.id AS user_id, p.code, p.layer
FROM core.app_user u
JOIN core.user_role       ur ON ur.user_id = u.id
JOIN core.role_permission rp ON rp.role_id = ur.role_id
JOIN core.permission      p  ON p.id       = rp.permission_id
WHERE u.is_active = TRUE;

CREATE OR REPLACE VIEW core.v_item_stock_summary AS
SELECT
  i.id                                       AS item_id,
  i.sku, i.name, i.unit, i.safety_threshold,
  COALESCE(SUM(s.on_hand),  0)               AS on_hand_total,
  COALESCE(SUM(s.reserved), 0)               AS reserved_total,
  COALESCE(SUM(s.on_hand - s.reserved), 0)   AS available_total
FROM core.item i
LEFT JOIN core.stock s ON s.item_id = i.id
WHERE i.is_active = TRUE
GROUP BY i.id;

CREATE OR REPLACE VIEW core.v_stock_position AS
SELECT
  s.item_id, i.sku, i.name, i.safety_threshold,
  s.location_id, wl.code AS location_code,
  w.id AS warehouse_id, w.code AS warehouse_code, w.city_id,
  s.on_hand, s.reserved, (s.on_hand - s.reserved) AS available,
  s.updated_at
FROM core.stock s
JOIN core.item               i  ON i.id  = s.item_id
JOIN core.warehouse_location wl ON wl.id = s.location_id
JOIN core.warehouse          w  ON w.id  = wl.warehouse_id;

CREATE OR REPLACE VIEW core.v_low_stock_item AS
SELECT * FROM core.v_item_stock_summary
WHERE available_total < safety_threshold;
