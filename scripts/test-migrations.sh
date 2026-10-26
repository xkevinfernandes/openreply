#!/usr/bin/env bash
# npm run test:migrations — the only suite with a real Postgres.
#   1. applies every migration to a fresh, empty throwaway database;
#   2. checks with `prisma migrate diff` that the result matches every schema
#      file in prisma/ (no drift);
#   3. runs the database-backed suites (__tests__/**/*.migrations.test.ts)
#      against it (each builds its own Postgres schema inside);
#   4. drops the database, whatever happened.
# Local Postgres only. Override the database with MIGRATIONS_DB_URL (it is
# created if missing and dropped afterwards, so never point it at real data).
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${MIGRATIONS_PG_BASE:-postgresql://$(whoami)@localhost:5432}"
URL="${MIGRATIONS_DB_URL:-$BASE/openreply_migtest_$$}"
NAME="${URL##*/}"; NAME="${NAME%%\?*}"
ADMIN="${URL%/*}/postgres"

case "$URL" in
  *localhost*|*127.0.0.1*) ;;
  *) echo "test:migrations only runs against a local Postgres ($URL)"; exit 1 ;;
esac

psql "$ADMIN" -qc "DROP DATABASE IF EXISTS \"$NAME\"" >/dev/null
psql "$ADMIN" -qc "CREATE DATABASE \"$NAME\"" >/dev/null
trap 'psql "$ADMIN" -qc "DROP DATABASE IF EXISTS \"$NAME\" WITH (FORCE)" >/dev/null 2>&1 || true' EXIT

echo "▸ applying every migration to $NAME"
DATABASE_URL="$URL" npx prisma migrate deploy 2>&1 | grep -E "applied|Error|error" || true

echo "▸ checking for drift against prisma/*.prisma"
set +e
DATABASE_URL="$URL" npx prisma migrate diff --from-config-datasource --to-schema prisma --exit-code > /tmp/os-migrate-diff.$$ 2>&1
code=$?
set -e
if [ "$code" -ne 0 ]; then
  echo "✗ the migrations don't match the schema files (exit $code):"
  grep -v '^Loaded Prisma config' /tmp/os-migrate-diff.$$ || true
  rm -f /tmp/os-migrate-diff.$$
  exit 1
fi
rm -f /tmp/os-migrate-diff.$$
echo "✓ no drift"

echo "▸ database-backed suites"
TEST_MIGRATIONS_DB_URL="$URL" npx vitest run 'migrations.test'
