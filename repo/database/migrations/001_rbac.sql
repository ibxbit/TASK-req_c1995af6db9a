-- RoadshowOps - RBAC schema
-- Run: psql -U postgres -d roadshowops -f database/migrations/001_rbac.sql

\connect roadshowops

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS audit;

-- =========================================================================
-- Users
-- =========================================================================
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

-- =========================================================================
-- Roles (fixed catalogue)
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.role (
  id          SMALLSERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT
);

-- =========================================================================
-- Permissions (3 layers: menu / action / data)
-- =========================================================================
DO $$ BEGIN
  CREATE TYPE core.permission_layer AS ENUM ('menu', 'action', 'data');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS core.permission (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  layer       core.permission_layer NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS core.role_permission (
  role_id       SMALLINT NOT NULL REFERENCES core.role(id) ON DELETE CASCADE,
  permission_id INTEGER  NOT NULL REFERENCES core.permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS core.user_role (
  user_id BIGINT   NOT NULL REFERENCES core.app_user(id) ON DELETE CASCADE,
  role_id SMALLINT NOT NULL REFERENCES core.role(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- =========================================================================
-- Cities + data-level scoping (multi-city roadshow)
-- =========================================================================
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

-- =========================================================================
-- Example domain tables (demonstrate row-level filtering)
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.candidate (
  id         BIGSERIAL PRIMARY KEY,
  city_id    INTEGER NOT NULL REFERENCES core.city(id),
  full_name  TEXT NOT NULL,
  email      TEXT,
  status     TEXT NOT NULL DEFAULT 'new',
  created_by BIGINT REFERENCES core.app_user(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_city ON core.candidate(city_id);

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

-- =========================================================================
-- Audit log (permission-sensitive events)
-- =========================================================================
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

-- =========================================================================
-- View: effective permissions per active user
-- =========================================================================
CREATE OR REPLACE VIEW core.v_user_permission AS
SELECT DISTINCT u.id AS user_id, p.code, p.layer
FROM core.app_user u
JOIN core.user_role      ur ON ur.user_id = u.id
JOIN core.role_permission rp ON rp.role_id = ur.role_id
JOIN core.permission      p  ON p.id       = rp.permission_id
WHERE u.is_active = TRUE;
