-- RoadshowOps - Inventory (warehouses, locations, items, stock, movements, reservations)
-- Run: psql -U postgres -d roadshowops -f database/migrations/004_inventory.sql

\connect roadshowops

-- =========================================================================
-- Warehouses + sub-locations
-- =========================================================================
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

-- =========================================================================
-- Item master (editable safety threshold, default 10)
-- =========================================================================
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

-- =========================================================================
-- Stock: on_hand, reserved per (item, location). available = on_hand - reserved.
-- DB-level invariants prevent overselling.
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.stock (
  item_id     BIGINT  NOT NULL REFERENCES core.item(id),
  location_id INTEGER NOT NULL REFERENCES core.warehouse_location(id),
  on_hand     BIGINT  NOT NULL DEFAULT 0 CHECK (on_hand  >= 0),
  reserved    BIGINT  NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, location_id),
  CHECK (reserved <= on_hand)
);

-- =========================================================================
-- Movement log (full audit)
-- =========================================================================
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

CREATE INDEX IF NOT EXISTS idx_movement_item  ON core.stock_movement(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movement_type  ON core.stock_movement(movement_type);

-- =========================================================================
-- Reservations (holds against available stock)
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.stock_reservation (
  id             BIGSERIAL PRIMARY KEY,
  item_id        BIGINT  NOT NULL REFERENCES core.item(id),
  location_id    INTEGER NOT NULL REFERENCES core.warehouse_location(id),
  quantity       BIGINT  NOT NULL CHECK (quantity > 0),
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','fulfilled','released')),
  reference_type TEXT,
  reference_id   TEXT,
  created_by     BIGINT REFERENCES core.app_user(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_item   ON core.stock_reservation(item_id, location_id);
CREATE INDEX IF NOT EXISTS idx_reservation_status ON core.stock_reservation(status);

-- =========================================================================
-- Cycle counts
-- =========================================================================
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

-- =========================================================================
-- Views
-- =========================================================================

-- Per-item totals across all locations
CREATE OR REPLACE VIEW core.v_item_stock_summary AS
SELECT
  i.id                           AS item_id,
  i.sku,
  i.name,
  i.unit,
  i.safety_threshold,
  COALESCE(SUM(s.on_hand),  0)  AS on_hand_total,
  COALESCE(SUM(s.reserved), 0)  AS reserved_total,
  COALESCE(SUM(s.on_hand - s.reserved), 0) AS available_total
FROM core.item i
LEFT JOIN core.stock s ON s.item_id = i.id
WHERE i.is_active = TRUE
GROUP BY i.id;

-- Per (item, location) availability
CREATE OR REPLACE VIEW core.v_stock_position AS
SELECT
  s.item_id, i.sku, i.name, i.safety_threshold,
  s.location_id, wl.code AS location_code,
  w.id  AS warehouse_id, w.code AS warehouse_code, w.city_id,
  s.on_hand, s.reserved, (s.on_hand - s.reserved) AS available,
  s.updated_at
FROM core.stock s
JOIN core.item               i  ON i.id  = s.item_id
JOIN core.warehouse_location wl ON wl.id = s.location_id
JOIN core.warehouse          w  ON w.id  = wl.warehouse_id;

-- Low stock at item-total level (editable threshold)
CREATE OR REPLACE VIEW core.v_low_stock_item AS
SELECT *
FROM core.v_item_stock_summary
WHERE available_total < safety_threshold;
