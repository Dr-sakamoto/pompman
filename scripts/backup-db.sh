#!/usr/bin/env bash
# Supabase 無料プランにはダウンロード可能な自動バックアップも PITR も無いため、
# データを自前で外部に退避するためのスクリプト。
#
# 使い方:
#   SUPABASE_DB_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \
#     npm run backup
#
# 接続文字列は Supabase Dashboard > Project Settings > Database > Connection string (URI)
# からコピーする。パスワードを含むので、シェル履歴やリポジトリには残さないこと。
#
# 出力は backups/（.gitignore 済み）に溜まるだけなので、定期的に手元や
# クラウドストレージなど、Supabase 以外の場所へコピーしておくこと。
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL を設定してください（Supabase Dashboard > Project Settings > Database > Connection string）}"

cd "$(dirname "$0")/.."
mkdir -p backups

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="backups/pompman-${stamp}.sql.gz"

pg_dump "$SUPABASE_DB_URL" \
  --schema=public \
  --no-owner \
  --no-privileges \
  | gzip > "$out"

echo "wrote $out"
