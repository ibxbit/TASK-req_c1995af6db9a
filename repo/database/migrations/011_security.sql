-- RoadshowOps - Security hardening: lockout, encrypted fields, workstation tracking
-- Run: psql -U postgres -d roadshowops -f database/migrations/011_security.sql

\connect roadshowops

-- =========================================================================
-- Account-lockout state on users
-- =========================================================================
ALTER TABLE core.app_user
  ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0
    CHECK (failed_login_count >= 0),
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_user_locked_until
  ON core.app_user(locked_until)
  WHERE locked_until IS NOT NULL;

-- =========================================================================
-- Encrypted sensitive fields (AES-256-GCM ciphertext, base64-encoded
-- payload: 'v1:<iv>:<ct>:<tag>')
-- =========================================================================
ALTER TABLE core.vendor
  ADD COLUMN IF NOT EXISTS tax_id_encrypted       TEXT,
  ADD COLUMN IF NOT EXISTS bank_routing_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_last4     TEXT CHECK (bank_account_last4 IS NULL OR bank_account_last4 ~ '^\d{2,4}$');

-- =========================================================================
-- Workstation on audit log (append-only column add is schema change, not row mutation)
-- =========================================================================
ALTER TABLE audit.permission_event
  ADD COLUMN IF NOT EXISTS workstation TEXT;

CREATE INDEX IF NOT EXISTS idx_perm_event_workstation
  ON audit.permission_event(workstation);
