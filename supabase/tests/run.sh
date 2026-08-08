#!/usr/bin/env bash
# RLS 検証を使い捨ての PostgreSQL 上で回す。
#
#   ./supabase/tests/run.sh
#
# ローカルに PostgreSQL 16 が必要（Supabase CLI は不要）。
# Supabase 本番に一切触らずに、回答の見えかたとフェーズ制御を確認できる。
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "PostgreSQL は root では起動できません。一般ユーザーで実行してください。" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGPORT="${PGPORT:-5433}"
PGDATA="${PGDATA:-$(mktemp -d)/pgdata}"
export PGHOST=/tmp PGPORT PGUSER=postgres

cleanup() { "$PGBIN/pg_ctl" -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== PostgreSQL を $PGDATA に起動 =="
"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/../pg.log" \
  -o "-k /tmp -p $PGPORT -c listen_addresses=" start >/dev/null

PSQL="psql -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "create database odai"
$PSQL -d odai -f "$HERE/supabase_stub.sql"
$PSQL -d odai -f "$HERE/../migrations/0001_init.sql"
echo "== マイグレーション適用OK =="
echo

bash "$HERE/rls_test.sh"
