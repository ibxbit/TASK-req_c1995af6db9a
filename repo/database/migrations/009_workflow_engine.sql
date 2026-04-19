-- RoadshowOps - Workflow engine (definitions, steps, instances, tasks) + vendors
-- Run: psql -U postgres -d roadshowops -f database/migrations/009_workflow_engine.sql

\connect roadshowops

-- =========================================================================
-- Minimal vendor table — one of the engine's target entity_types
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.vendor (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  legal_name    TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','suspended')),
  created_by    BIGINT REFERENCES core.app_user(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================================
-- Workflow definitions: versioned templates per entity_type
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.workflow_definition (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT    NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  entity_type TEXT    NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  BIGINT REFERENCES core.app_user(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

CREATE INDEX IF NOT EXISTS idx_wf_def_entity ON core.workflow_definition(entity_type, is_active);

-- =========================================================================
-- Steps: ordered per definition, each with an assignee permission and SLA.
-- validation_rules is a JSONB array applied on the "approve" decision.
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.workflow_step (
  id                   BIGSERIAL PRIMARY KEY,
  definition_id        BIGINT NOT NULL REFERENCES core.workflow_definition(id) ON DELETE CASCADE,
  sequence             INTEGER NOT NULL,
  name                 TEXT    NOT NULL,
  assignee_permission  TEXT    NOT NULL,
  sla_hours            INTEGER NOT NULL DEFAULT 72 CHECK (sla_hours > 0),
  validation_rules     JSONB,
  UNIQUE (definition_id, sequence)
);

-- =========================================================================
-- Instances: live workflows bound to (entity_type, entity_id)
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.workflow_instance (
  id              BIGSERIAL PRIMARY KEY,
  definition_id   BIGINT NOT NULL REFERENCES core.workflow_definition(id),
  entity_type     TEXT   NOT NULL,
  entity_id       TEXT   NOT NULL,
  summary         TEXT,
  payload         JSONB,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','approved','rejected','returned','canceled','archived')),
  current_step_id BIGINT REFERENCES core.workflow_step(id),
  initiated_by    BIGINT NOT NULL REFERENCES core.app_user(id),
  initiated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ,
  archived_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wf_inst_entity ON core.workflow_instance(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_wf_inst_status ON core.workflow_instance(status, decided_at);

-- =========================================================================
-- Tasks: one per step execution. Visibility = step's assignee_permission.
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.workflow_task (
  id                BIGSERIAL PRIMARY KEY,
  instance_id       BIGINT NOT NULL REFERENCES core.workflow_instance(id) ON DELETE CASCADE,
  step_id           BIGINT NOT NULL REFERENCES core.workflow_step(id),
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','completed','skipped','canceled')),
  decision          TEXT CHECK (decision IN ('approved','rejected','returned_for_changes')),
  decided_by        BIGINT REFERENCES core.app_user(id),
  decided_at        TIMESTAMPTZ,
  decision_notes    TEXT,
  validation_errors JSONB,
  due_at            TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wf_task_instance ON core.workflow_task(instance_id);
CREATE INDEX IF NOT EXISTS idx_wf_task_open
  ON core.workflow_task(status, due_at)
  WHERE status = 'open';
