-- RoadshowOps - Approval workflows + ingestion audit
-- Run: psql -U postgres -d roadshowops -f database/migrations/006_workflows.sql

\connect roadshowops

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
