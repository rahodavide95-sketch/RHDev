#!/usr/bin/env bash
# Avvia un Postgres usa-e-getta, carica l'imitazione di Supabase + schema.sql
# e lancia i test di sicurezza. Uso: bash test/rls/run.sh  (serve PostgreSQL 15+)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCHEMA="$HERE/../../supabase/schema.sql"
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d)"
RUNAS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$TMP"; RUNAS=(runuser -u postgres --); fi
cleanup() { "${RUNAS[@]}" "$BIN/pg_ctl" -D "$TMP/db" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
"${RUNAS[@]}" "$BIN/initdb" -D "$TMP/db" -U postgres -A trust >/dev/null
"${RUNAS[@]}" "$BIN/pg_ctl" -D "$TMP/db" -o "-k $TMP -c listen_addresses=''" -l "$TMP/log" start >/dev/null
for i in $(seq 1 30); do "${RUNAS[@]}" "$BIN/pg_isready" -h "$TMP" -U postgres >/dev/null 2>&1 && break; sleep 0.3; done
export PGOPTIONS="-c client_min_messages=warning"
PSQL=("${RUNAS[@]}" "$BIN/psql" -h "$TMP" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -t -A)
cp "$HERE/mock-supabase.sql" "$HERE/rls.test.sql" "$SCHEMA" "$TMP/" && chmod a+r "$TMP"/*.sql
"${PSQL[@]}" -f "$TMP/mock-supabase.sql"
"${PSQL[@]}" -f "$TMP/schema.sql"
"${PSQL[@]}" -f "$TMP/schema.sql"   # deve essere rieseguibile senza errori
PGOPTIONS="-c client_min_messages=notice" "${PSQL[@]}" -f "$TMP/rls.test.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  /  /p; /PASSATI/p; /ERROR/p; /FALLITO/p'
exit "${PIPESTATUS[0]}"
