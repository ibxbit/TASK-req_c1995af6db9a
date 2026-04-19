#!/bin/sh
# RoadshowOps backend bootstrap.
#
# Canonical startup path:
#   1) wait for postgres
#   2) apply database/migrations/*.sql in lexical order (idempotent)
#   3) apply database/seeds/*.sql in lexical order (idempotent)
#   4) bootstrap admin user
#   5) start Fastify
#
# Any SQL failure in step 2 or 3 aborts startup with a non-zero exit.
# There are no silent skips; ON_ERROR_STOP=1 is set for every psql invocation.
set -eu

: "${PGHOST:=db}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
: "${PGDATABASE:=roadshowops}"

export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

echo "[entrypoint] waiting for postgres at ${PGHOST}:${PGPORT}..."
until psql -c 'select 1' >/dev/null 2>&1; do
  sleep 1
done
echo "[entrypoint] postgres ready"

run_sql() {
  file="$1"
  echo "[entrypoint] applying $(basename "$file")"
  if ! psql -v ON_ERROR_STOP=1 -X -q -f "$file"; then
    echo "[entrypoint] FATAL: failed to apply $(basename "$file") — aborting startup" >&2
    exit 1
  fi
}

if [ -d /app/database/migrations ]; then
  echo "[entrypoint] applying migrations in order..."
  # Lexical order matches 001_, 002_, ... 013_ numbering.
  for migration in $(ls /app/database/migrations/*.sql 2>/dev/null | sort); do
    [ -f "$migration" ] || continue
    run_sql "$migration"
  done
else
  echo "[entrypoint] FATAL: /app/database/migrations not found" >&2
  exit 1
fi

if [ -d /app/database/seeds ]; then
  echo "[entrypoint] applying seeds in order..."
  for seed in $(ls /app/database/seeds/*.sql 2>/dev/null | sort); do
    [ -f "$seed" ] || continue
    run_sql "$seed"
  done
fi

echo "[entrypoint] verifying required database objects..."
if ! node src/scripts/verify-schema.js; then
  echo "[entrypoint] FATAL: required DB objects missing after bootstrap" >&2
  exit 1
fi

echo "[entrypoint] bootstrapping administrator (idempotent)..."
if ! node src/scripts/create-admin.js; then
  echo "[entrypoint] FATAL: admin bootstrap failed" >&2
  exit 1
fi

echo "[entrypoint] starting Fastify server..."
exec node src/server.js
