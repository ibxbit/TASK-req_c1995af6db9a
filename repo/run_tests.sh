#!/usr/bin/env bash
# Idempotent test runner — brings up the compose stack if needed, waits for the
# backend to be healthy, then executes all test suites (backend unit, backend API,
# and frontend unit tests) inside their respective containers.
# No host-side npm install or Node.js installation is required beyond Docker.

set -euo pipefail

# Disable MSYS/Git-Bash automatic path conversion so container paths
# like /app/unit_tests are passed through verbatim on Windows hosts.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required" >&2
  exit 1
fi

# Pick the compose invocation style available on this host.
if docker compose version >/dev/null 2>&1; then
  DC() { docker compose "$@"; }
elif command -v docker-compose >/dev/null 2>&1; then
  DC() { docker-compose "$@"; }
else
  echo "error: neither 'docker compose' nor 'docker-compose' is installed" >&2
  exit 1
fi

echo "[1/5] Bringing up the stack (idempotent)..."
DC up -d

echo "[2/5] Waiting for backend /health..."
HEALTH_PROBE='fetch("http://localhost:4000/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
for i in $(seq 1 90); do
  if DC exec -T backend node -e "$HEALTH_PROBE" >/dev/null 2>&1; then
    echo "    backend healthy"
    break
  fi
  sleep 2
  if [ "$i" -eq 90 ]; then
    echo "error: backend failed to become healthy within 180s" >&2
    DC logs backend | tail -n 80 >&2
    exit 1
  fi
done

FAIL=0

echo "[3/5] Running backend unit tests (unit_tests/)..."
if ! DC exec -T backend node --test /app/unit_tests; then
  FAIL=1
fi

echo "[4/5] Running backend API tests (API_tests/)..."
if ! DC exec -T backend node --test /app/API_tests; then
  FAIL=1
fi

echo "[5/5] Running frontend unit tests (frontend/src/**/*.test.js)..."
# Build a dedicated test image from ./frontend (avoids relying on the dev-server
# container, which may be an unrelated cached image on shared Docker hosts).
docker build -q -t roadshowops-frontend-test -f ./frontend/Dockerfile ./frontend >/dev/null
if ! docker run --rm roadshowops-frontend-test npm test; then
  FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
  echo "FAIL: one or more test suites failed."
  exit 1
fi

echo "OK: all tests passed."
