-- RoadshowOps - Itinerary, templates, versions, venues, drive-time cache
-- Run: psql -U postgres -d roadshowops -f database/migrations/002_itinerary.sql

\connect roadshowops

-- =========================================================================
-- Venues (coordinates optional -> falls back to manual drive time)
-- =========================================================================
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

-- =========================================================================
-- Drive-time cache (symmetric; stored once with lo/hi pair)
-- =========================================================================
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

-- =========================================================================
-- Itinerary (live state)
-- =========================================================================
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

-- =========================================================================
-- Versions: immutable snapshot per change, enables restore
-- =========================================================================
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

-- =========================================================================
-- Templates
-- =========================================================================
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
