-- ============================================================================
-- 本名メモ（管理者専用）。
--
-- ハンドルネームがふざけていて誰が誰だか分からない問題への対処。
-- 管理者だけが各メンバーに本名をメモでき、それを見られるのも管理者だけ。
-- 本人以外にバレると恥ずかしい情報なので、public.users には持たせず、
-- 別テーブル + RLS（select/insert/update とも private.is_admin() のみ）で
-- 一般メンバーからは（テーブルの存在ごと）完全に見えないようにする。
-- ============================================================================

create table public.member_real_names (
  user_id    uuid primary key references public.users (id) on delete cascade,
  real_name  text not null check (char_length(btrim(real_name)) between 1 and 40),
  updated_at timestamptz not null default now()
);

comment on table public.member_real_names is
  'メンバーの本名メモ。管理者のみ閲覧・編集できる（RLS で強制）。';

alter table public.member_real_names enable row level security;

revoke all on public.member_real_names from anon, authenticated;
grant select, insert, update, delete on public.member_real_names to authenticated;

create policy member_real_names_select_admin on public.member_real_names
  for select to authenticated
  using (private.is_admin());

create policy member_real_names_insert_admin on public.member_real_names
  for insert to authenticated
  with check (private.is_admin());

create policy member_real_names_update_admin on public.member_real_names
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy member_real_names_delete_admin on public.member_real_names
  for delete to authenticated
  using (private.is_admin());
