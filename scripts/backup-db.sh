#!/usr/bin/env bash
#
# Weekly backup of the application data, taken from a Mac, for as long as
# the Supabase project is on a plan without automatic backups.
#
#   npm run backup          # writes ~/EMR-backups/emr-YYYY-MM-DD.dump
#
# Needs pg_dump: `brew install libpq` (it lands in $(brew --prefix libpq)/bin).
# Reads DATABASE_URL from .env.local, which should be the postgres role: the
# app role is not the owner and cannot dump everything. pg_dump needs a
# session, so a transaction-pooler URL (port 6543) is switched to the session
# pooler (5432) on the same host.
#
# Only the public schema is included — the application's own tables. Sign-in
# accounts live in Supabase's auth schema and are not in this file; they
# survive anything short of losing the whole project, and the public rows are
# what a bad import or deletion would take.
#
# Restore, into the same project, after checking the file with
# `pg_restore --list FILE | head`:
#
#   pg_restore --clean --if-exists --no-owner --no-privileges \
#     --dbname "$DATABASE_URL" ~/EMR-backups/emr-YYYY-MM-DD.dump
#
# then run scripts/sql/app-role.sql again, since grants are not in the dump.
set -euo pipefail
cd "$(dirname "$0")/.."

url=$(grep -E '^DATABASE_URL=' .env.local | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
[ -n "$url" ] || { echo "DATABASE_URL not found in .env.local" >&2; exit 1; }
url=${url/:6543\//:5432/}

pg_dump_bin=$(command -v pg_dump || true)
if [ -z "$pg_dump_bin" ] && command -v brew >/dev/null 2>&1; then
  pg_dump_bin="$(brew --prefix libpq 2>/dev/null)/bin/pg_dump"
fi
[ -n "$pg_dump_bin" ] && [ -x "$pg_dump_bin" ] || { echo "pg_dump not found — run: brew install libpq" >&2; exit 1; }

dir="${EMR_BACKUP_DIR:-$HOME/EMR-backups}"
mkdir -p "$dir"
out="$dir/emr-$(date +%F).dump"

"$pg_dump_bin" "$url" --format=custom --no-owner --no-privileges --schema=public --file "$out"
echo "Wrote $out ($(du -h "$out" | cut -f1))"

# Keep the eight newest; a weekly run keeps two months.
ls -1t "$dir"/emr-*.dump 2>/dev/null | tail -n +9 | while read -r old; do rm -f -- "$old"; done
