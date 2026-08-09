-- ============================================================================
-- admin ロールの仕組みを整備する。
--
-- Gemini 連携や API キー追加のような、誰でも実行できると危険な機能を
-- 今後追加する際に admin だけへ絞れるようにする土台。
-- ============================================================================

-- 指定ユーザー（省略時は呼び出し元）が admin かどうか。
-- RLS ポリシーやサーバー側の権限チェックから使う想定。
create or replace function private.is_admin(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.users u
    where u.id = p_uid and u.role = 'admin'
  )
$$;

comment on function private.is_admin(uuid) is
  '指定ユーザーが admin ロールか判定する。private スキーマ配下のため PostgREST 経由では呼べない。';

revoke all on function private.is_admin(uuid) from public, anon;
grant execute on function private.is_admin(uuid) to authenticated;

-- 運営アカウントを admin にする。
-- auth.uid() が無い経路（このマイグレーション自体）は
-- users_freeze_privileged_columns トリガーの role 変更禁止をすり抜けられる
-- （0001_init.sql のコメント参照）。
update public.users u
set role = 'admin'
from auth.users au
where u.id = au.id
  and au.email = 'r.naruo33@gmail.com';
