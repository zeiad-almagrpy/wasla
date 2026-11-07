#!/usr/bin/env bash
# FOR DEVELOPERS ONLY: never run this folder's .sql files in Supabase (they are for a local scratch Postgres).
# Runs schema.sql + migrations + the behavioural tests against a SCRATCH Postgres database (it WIPES public/auth/storage there).
# Never point this at your Supabase project. Needs a local Postgres 14+ and psql.
#   usage:  ./run.sh "postgresql://postgres:postgres@localhost:5432/scratch"
set -euo pipefail
URL="${1:?pass the connection string of a scratch database}"
HERE="$(cd "$(dirname "$0")" && pwd)"
psql "$URL" -q -v ON_ERROR_STOP=1 -c "drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists storage cascade; create schema public;"
psql "$URL" -q -v ON_ERROR_STOP=1 -f "$HERE/stub.sql" 2>&1 | grep -v -E "WARNING|HINT" || true
psql "$URL" -q -v ON_ERROR_STOP=1 -f "$HERE/../../supabase/schema.sql" 2>&1 | grep -v NOTICE || true
for m in "$HERE"/../../supabase/migrations/*.sql; do psql "$URL" -q -v ON_ERROR_STOP=1 -f "$m" 2>&1 | grep -v NOTICE || true; done
psql "$URL" -q -t -A -v ON_ERROR_STOP=1 -f "$HERE/db_test.sql" 2>&1 | grep -E "ERROR|FAIL|PASSED" || { echo "tests produced no PASSED line"; exit 1; }
