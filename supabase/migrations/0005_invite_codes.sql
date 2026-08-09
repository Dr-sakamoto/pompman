-- ============================================================================
-- 招待コード。
--
-- 管理者が 4 桁のコードを人数分発行して配り、受け取った本人が
-- 自分でメールアドレスとパスワードを決めて登録する。
-- 管理者が他人のパスワードを握らずに済む。
--
-- コードは使い捨て。used_at を立てた時点で二度と使えない。
-- 監査のために使用済みの行も残す（誰がいつ入ったかを追える）。
-- ============================================================================

create table public.invite_codes (
  code       text primary key check (code ~ '^[0-9]{4}$'),
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  -- 確保した時点で立つ。ここが null でなければもう使えない。
  used_at    timestamptz,
  -- 実際にユーザーを作れてから埋まる。確保と作成の間は null。
  used_by    uuid references auth.users (id),

  constraint invite_codes_used_by_requires_used_at
    check (used_by is null or used_at is not null)
);

comment on table public.invite_codes is
  '招待コード。管理者が発行し、受け取った本人が自分でアカウントを作る。使い捨て。';
comment on column public.invite_codes.used_at is
  '確保した時刻。null でなければ再利用できない。';
comment on column public.invite_codes.used_by is
  '実際に作成されたユーザー。確保からユーザー作成までの間だけ null になる。';

create index invite_codes_unused on public.invite_codes (created_at desc)
  where used_at is null;

alter table public.invite_codes enable row level security;

-- 一覧を見られるのは管理者だけ。未使用コードは実質パスワードなので漏らさない。
-- 引き換え処理は service_role（Edge Function）が RLS を迂回して行う。
create policy invite_codes_select_admin on public.invite_codes
  for select to authenticated
  using (private.is_admin());

-- ----------------------------------------------------------------------------
-- コード発行
--
-- 4 桁なので衝突する。PK の一意制約に任せて、入るまで引き直す。
-- security definer だが冒頭で admin を確認しているので昇格経路にはならない。
-- ----------------------------------------------------------------------------
create or replace function public.create_invite_codes(p_count int)
returns setof text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin uuid := auth.uid();
  v_code  text;
  v_i     int;
  v_try   int;
begin
  if not private.is_admin() then
    raise exception '管理者のみ実行できます' using errcode = '42501';
  end if;

  if p_count is null or p_count < 1 or p_count > 20 then
    raise exception '発行数は1〜20で指定してください' using errcode = '22023';
  end if;

  for v_i in 1 .. p_count loop
    v_try := 0;
    loop
      v_try := v_try + 1;
      -- 10000 通りしかないので、埋まってくると引き直しが増える。
      -- 現実的な運用（数人〜数十人）では十分だが、上限は設けておく。
      if v_try > 200 then
        raise exception '空きコードを確保できませんでした。使用済みコードを整理してください。';
      end if;

      v_code := lpad((floor(random() * 10000))::int::text, 4, '0');

      begin
        insert into public.invite_codes (code, created_by)
        values (v_code, v_admin);
        return next v_code;
        exit;
      exception when unique_violation then
        -- 引き直す
      end;
    end loop;
  end loop;
end
$$;

comment on function public.create_invite_codes(int) is
  '招待コードを指定数だけ発行して返す。管理者のみ。';

revoke all on function public.create_invite_codes(int) from public, anon;
grant execute on function public.create_invite_codes(int) to authenticated;

-- ----------------------------------------------------------------------------
-- コードの引き換え
--
-- 同じコードを同時に送られても 1 回しか通らないよう、used_at is null の行だけを
-- UPDATE して、当たったかどうかで判定する（確保）。
-- ユーザー作成に成功したら finalize、失敗したら release で戻す。
-- 呼ぶのは service_role（Edge Function）だけ。
-- ----------------------------------------------------------------------------
create or replace function private.claim_invite_code(p_code text)
returns boolean
language sql
volatile
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

comment on function private.claim_invite_code(text) is
  '未使用の招待コードを原子的に確保する。確保できたら true。';

create or replace function private.finalize_invite_code(p_code text, p_user uuid)
returns void
language sql
volatile
as $$
  update public.invite_codes
  set used_by = p_user
  where code = p_code
    and used_by is null;
$$;

comment on function private.finalize_invite_code(text, uuid) is
  '確保済みコードに、実際に作成されたユーザーを紐付ける。';

create or replace function private.release_invite_code(p_code text)
returns void
language sql
volatile
as $$
  -- ユーザー作成に失敗したときだけ戻す。すでに誰かに紐付いていたら触らない。
  update public.invite_codes
  set used_at = null
  where code = p_code
    and used_by is null;
$$;

comment on function private.release_invite_code(text) is
  'ユーザー作成に失敗したとき、確保した招待コードを未使用に戻す。';

revoke all on function private.claim_invite_code(text) from public, anon, authenticated;
revoke all on function private.finalize_invite_code(text, uuid) from public, anon, authenticated;
revoke all on function private.release_invite_code(text) from public, anon, authenticated;
