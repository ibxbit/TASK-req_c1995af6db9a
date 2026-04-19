-- RoadshowOps - Multi-source data ingestion (sources, checkpoints, staged records)
-- Run: psql -U postgres -d roadshowops -f database/migrations/010_ingestion_sources.sql

\connect roadshowops

-- =========================================================================
-- Sources: configurable definitions for each feed we ingest from.
--   type:   job_board | university | company
--   format: html | csv
--   inbox_dir: relative path under INGESTION_ROOT_DIR (sandboxed)
--   parser_key: selects a parser from the registry in ingestion_parsers.js
--   Extensibility hooks (user_agent / ip_hint / captcha_strategy) are recorded
--   per source and read by the extension layer — unused in pure offline mode.
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.ingestion_source (
  id                 BIGSERIAL PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,
  type               TEXT NOT NULL CHECK (type IN ('job_board','university','company')),
  format             TEXT NOT NULL CHECK (format IN ('html','csv')),
  inbox_dir          TEXT NOT NULL,
  parser_key         TEXT NOT NULL,
  min_interval_hours INTEGER NOT NULL DEFAULT 6 CHECK (min_interval_hours >= 6),
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  user_agent         TEXT,
  ip_hint            TEXT,
  captcha_strategy   TEXT CHECK (captcha_strategy IN ('none','skip','prompt','manual')),
  config             JSONB,
  created_by         BIGINT REFERENCES core.app_user(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_source_active
  ON core.ingestion_source(is_active, type);

-- =========================================================================
-- Per-source checkpoint (resume state)
--   last_file + last_record_offset let the scheduler resume a partially-
--   processed file on the next tick.
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.ingestion_checkpoint (
  source_id            BIGINT PRIMARY KEY REFERENCES core.ingestion_source(id) ON DELETE CASCADE,
  last_run_started_at  TIMESTAMPTZ,
  last_run_finished_at TIMESTAMPTZ,
  last_file            TEXT,
  last_record_offset   BIGINT NOT NULL DEFAULT 0,
  last_file_hash       TEXT,
  cursor               JSONB,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================================
-- Staged records: dedupe by (source_id, external_key); fingerprint detects
-- content changes if the same key is re-ingested later.
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.ingestion_record (
  id           BIGSERIAL PRIMARY KEY,
  source_id    BIGINT NOT NULL REFERENCES core.ingestion_source(id),
  run_id       BIGINT REFERENCES audit.ingestion_run(id),
  external_key TEXT   NOT NULL,
  fingerprint  TEXT   NOT NULL,
  data         JSONB  NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_key)
);

CREATE INDEX IF NOT EXISTS idx_ingest_record_run ON core.ingestion_record(run_id);
CREATE INDEX IF NOT EXISTS idx_ingest_record_fp  ON core.ingestion_record(fingerprint);

-- =========================================================================
-- Link audit.ingestion_run back to a source (additive; append-only semantics unchanged)
-- =========================================================================
ALTER TABLE audit.ingestion_run
  ADD COLUMN IF NOT EXISTS source_id BIGINT REFERENCES core.ingestion_source(id);
