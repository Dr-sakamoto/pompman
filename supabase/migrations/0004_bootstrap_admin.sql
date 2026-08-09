-- ============================================================================
-- ブートストラップ admin の自動付与。
--
-- 0003_admin_role.sql は「すでに public.users に行がある」前提で UPDATE して
-- いたが、運営アカウントが onboarding を済ませる前だったため 0 件更新に終わって
-- いた。結果、admin が 1 人も居ない＝メンバー追加が誰にもできない状態になる。
--
-- メンバー追加（＝他人のパスワード設定）は admin だけに許したいので、
-- 運営アカウントが handle を登録した時点で自動的に admin になるようにする。
-- INSERT 時に決めるので、users_freeze_privileged_columns（UPDATE 用トリガー）
-- とは競合しない。
-- ============================================================================

create or replace function public.users_grant_bootstrap_admin()
returns trigger
language plpgsql
-- auth.users を引くため security definer。search_path は固定して乗っ取りを防ぐ。
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from auth.users au
    where au.id = new.id
      and au.email = 'r.naruo33@gmail.com'
  ) then
    new.role := 'admin';
  end if;
  return new;
end
$$;

comment on function public.users_grant_bootstrap_admin() is
  '運営アカウントが users に登録された時点で admin ロールを付与する。';

drop trigger if exists users_grant_bootstrap_admin on public.users;

create trigger users_grant_bootstrap_admin
  before insert on public.users
  for each row execute function public.users_grant_bootstrap_admin();

-- すでに行がある場合にも効かせる（このマイグレーションは auth.uid() が無い経路で
-- 走るので、role 変更禁止トリガーをすり抜けられる）。
update public.users u
set role = 'admin'
from auth.users au
where u.id = au.id
  and au.email = 'r.naruo33@gmail.com'
  and u.role <> 'admin';
