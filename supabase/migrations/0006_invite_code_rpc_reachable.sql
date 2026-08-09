-- ============================================================================
-- 招待コードの確保/確定/返却を Edge Function から呼べるようにする。
--
-- 0005 ではこれらを private スキーマに置いたが、private は PostgREST に公開されて
-- いないため service_role であっても RPC 経由では到達できなかった。
--
-- public に移し、EXECUTE を service_role だけに絞ることで
-- 「PostgREST から呼べるが、anon / authenticated からは呼べない」状態にする。
-- （EXECUTE 権限は service_role でもバイパスされないので、これが関門になる）
-- ============================================================================

drop function if exists private.claim_invite_code(text);
drop function if exists private.finalize_invite_code(text, uuid);
drop function if exists private.release_invite_code(text);

-- 未使用の行だけを UPDATE して、当たったかどうかで判定する。
-- 同じコードを同時に送られても 1 リクエストしか true を受け取らない。
create or replace function public.claim_invite_code(p_code text)
returns boolean
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  with claimed as (
    update public.invite_codes
    set used_at = now()
    where code = p_code
      and used_at is null
    returning 1
  )
  select exists (select 1 from claimed);
$$;

create or replace function public.finalize_invite_code(p_code text, p_user uuid)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update public.invite_codes
  set used_by = p_user
  where code = p_code
    and used_by is null;
$$;

create or replace function public.release_invite_code(p_code text)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  -- ユーザー作成に失敗したときだけ戻す。すでに誰かに紐付いていたら触らない。
  update public.invite_codes
  set used_at = null
  where code = p_code
    and used_by is null;
$$;

comment on function public.claim_invite_code(text) is
  '未使用の招待コードを原子的に確保する。service_role のみ。';
comment on function public.finalize_invite_code(text, uuid) is
  '確保済みコードに、実際に作成されたユーザーを紐付ける。service_role のみ。';
comment on function public.release_invite_code(text) is
  'ユーザー作成に失敗したとき、確保した招待コードを未使用に戻す。service_role のみ。';

-- ここが関門。ログイン前の anon からも、一般メンバーからも呼ばせない。
revoke all on function public.claim_invite_code(text) from public, anon, authenticated;
revoke all on function public.finalize_invite_code(text, uuid) from public, anon, authenticated;
revoke all on function public.release_invite_code(text) from public, anon, authenticated;

grant execute on function public.claim_invite_code(text) to service_role;
grant execute on function public.finalize_invite_code(text, uuid) to service_role;
grant execute on function public.release_invite_code(text) to service_role;
