-- RoadshowOps Operations Suite - Database bootstrap
-- Run once against a local PostgreSQL instance:
--   psql -U postgres -f database/init.sql

CREATE DATABASE roadshowops;

\connect roadshowops

-- Core domain schema (multi-city roadshow operations)
CREATE SCHEMA IF NOT EXISTS core;

-- Audit schema (system-wide auditability requirement)
CREATE SCHEMA IF NOT EXISTS audit;
