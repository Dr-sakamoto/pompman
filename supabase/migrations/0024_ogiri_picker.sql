-- ============================================================================
-- 大喜利「選ぶだけ」アプリへの切り替え。
--
-- 人が回答を書いて人が採点する形は、書く人が集まらないと何も始まらない。
-- そこで書くのを AI に任せ、人は「面白いものを選ぶ」だけにする。
--
--   1. お題を1つ決める（自分で書くか、過去のお題からおまかせ）
--   2. AI が10個の回答を出す
--   3. 面白いと思ったものを選ぶ（いくつでも。0個でもいい）
--   4. 選んだ／選ばなかったを AI に返して、次の10個を出させる → 3 に戻る
--
-- 選んだものだけでなく「見せたのに選ばれなかった」も同じ重さで残す。
-- 10個のうちどれを選んだかは、そのまま選好ペア（選んだ > 選ばなかった）になる。
-- 0001 の方針（選ばれなかった回答も教師データ、保存時に捨てない）をそのまま継ぐ。
--
-- 旧来の odai / answers / picks には一切手を付けない。データはそのまま残し、
-- おまかせお題の出どころとして odai を読むだけにする。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. テーブル
-- ----------------------------------------------------------------------------

-- 1人が1つのお題に取り組む単位。同じお題を別の日にやり直せば別のセッション。
create table public.ogiri_sessions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.users (id) on delete cascade,
  odai_text  text not null check (char_length(btrim(odai_text)) between 1 and 200),
  created_at timestamptz not null default now()
);

create index ogiri_sessions_user_idx on public.ogiri_sessions (user_id, created_at desc);

comment on table public.ogiri_sessions is
  '1人が1つのお題で「AI が10個出す → 選ぶ」を繰り返す単位。';

-- AI が10個出した1回ぶん。
create table public.ogiri_rounds (
  id           bigint generated always as identity primary key,
  session_id   bigint not null references public.ogiri_sessions (id) on delete cascade,
  round_no     int not null check (round_no >= 1),
  model        text not null,
  -- AI がそれまでの選択から読み取った「この人が面白がるもの」。画面にも出す。
  taste_note   text,
  -- 選び終えた時刻。null のあいだはまだ選んでいる途中。
  submitted_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (session_id, round_no)
);

comment on column public.ogiri_rounds.submitted_at is
  '選び終えた時刻。null なら未提出。提出後は picked を変えられない（選び直しは選好の上書きになるため）。';

-- AI が出した回答1つ。
create table public.ogiri_candidates (
  id       bigint generated always as identity primary key,
  round_id bigint not null references public.ogiri_rounds (id) on delete cascade,
  position smallint not null check (position between 1 and 10),
  text     text not null check (char_length(btrim(text)) > 0),
  picked   boolean not null default false,
  unique (round_id, position)
);

create index ogiri_candidates_picked_idx on public.ogiri_candidates (round_id) where picked;

comment on table public.ogiri_candidates is
  'AI が出した回答。picked=false も消さない（見せたのに選ばれなかった、という選好の片側）。';

-- ----------------------------------------------------------------------------
-- 2. RLS — 読むのは本人の分だけ。書き込みは下の関数越しのみ。
-- ----------------------------------------------------------------------------

alter table public.ogiri_sessions   enable row level security;
alter table public.ogiri_rounds     enable row level security;
alter table public.ogiri_candidates enable row level security;

revoke all on public.ogiri_sessions, public.ogiri_rounds, public.ogiri_candidates
  from anon, authenticated;
grant select on public.ogiri_sessions, public.ogiri_rounds, public.ogiri_candidates
  to authenticated;
-- セッションを始めるのだけは直接 INSERT させる（お題を書くだけで、整合を崩す余地がない）。
grant insert (user_id, odai_text) on public.ogiri_sessions to authenticated;

create policy ogiri_sessions_select_own on public.ogiri_sessions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy ogiri_sessions_insert_own on public.ogiri_sessions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.users u where u.id = (select auth.uid()))
  );

create policy ogiri_rounds_select_own on public.ogiri_rounds
  for select to authenticated
  using (exists (
    select 1 from public.ogiri_sessions s
    where s.id = session_id and s.user_id = (select auth.uid())
  ));

create policy ogiri_candidates_select_own on public.ogiri_candidates
  for select to authenticated
  using (exists (
    select 1
    from public.ogiri_rounds r
    join public.ogiri_sessions s on s.id = r.session_id
    where r.id = round_id and s.user_id = (select auth.uid())
  ));

-- ----------------------------------------------------------------------------
-- 3. 書き込み（SECURITY DEFINER）
-- ----------------------------------------------------------------------------

-- AI が出した10個を1ラウンドとして保存する。
-- 前のラウンドを選び終えていないと次は出せない（未提出のまま次へ進むと、
-- 「見せたのに選ばれなかった」と「まだ見ていない」が区別できなくなる）。
create or replace function public.add_ogiri_round(
  p_session_id bigint,
  p_model      text,
  p_taste_note text,
  p_texts      text[]
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round_no int;
  v_round_id bigint;
  i int;
begin
  if not exists (
    select 1 from public.ogiri_sessions
    where id = p_session_id and user_id = (select auth.uid())
  ) then
    raise exception 'session not found';
  end if;

  if exists (
    select 1 from public.ogiri_rounds
    where session_id = p_session_id and submitted_at is null
  ) then
    raise exception 'previous round not submitted';
  end if;

  if coalesce(array_length(p_texts, 1), 0) not between 1 and 10 then
    raise exception 'need 1..10 answers';
  end if;

  select coalesce(max(round_no), 0) + 1 into v_round_no
  from public.ogiri_rounds where session_id = p_session_id;

  insert into public.ogiri_rounds (session_id, round_no, model, taste_note)
  values (p_session_id, v_round_no, p_model, nullif(btrim(p_taste_note), ''))
  returning id into v_round_id;

  for i in 1 .. array_length(p_texts, 1) loop
    insert into public.ogiri_candidates (round_id, position, text)
    values (v_round_id, i, p_texts[i]);
  end loop;

  return v_round_id;
end;
$$;

-- 選んだ回答を記録してラウンドを締める。片道切符（提出後は変えられない）。
create or replace function public.submit_ogiri_picks(
  p_round_id      bigint,
  p_candidate_ids bigint[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.ogiri_rounds r
    join public.ogiri_sessions s on s.id = r.session_id
    where r.id = p_round_id
      and s.user_id = (select auth.uid())
      and r.submitted_at is null
  ) then
    raise exception 'round not found or already submitted';
  end if;

  update public.ogiri_candidates
  set picked = true
  where round_id = p_round_id
    and id = any (coalesce(p_candidate_ids, '{}'));

  update public.ogiri_rounds set submitted_at = now() where id = p_round_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. 好みの手本（SECURITY DEFINER）
--
-- 次の10個を作るとき、このお題での選択に加えて「他のお題で選ばれたもの」も
-- 手本として AI に見せる。少人数の身内なので、本人の分を優先しつつ
-- メンバー全体で選ばれたものも混ぜる（誰が選んだかは返さない）。
-- ----------------------------------------------------------------------------

create or replace function public.ogiri_taste_examples(
  p_exclude_session_id bigint,
  p_limit int default 40
) returns table (odai_text text, answer text, is_mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.odai_text, c.text, s.user_id = (select auth.uid())
  from public.ogiri_candidates c
  join public.ogiri_rounds r on r.id = c.round_id
  join public.ogiri_sessions s on s.id = r.session_id
  where c.picked
    and s.id <> p_exclude_session_id
    and exists (select 1 from public.users u where u.id = (select auth.uid()))
  order by (s.user_id = (select auth.uid())) desc, r.submitted_at desc nulls last
  limit least(greatest(p_limit, 0), 80);
$$;

revoke all on function public.add_ogiri_round(bigint, text, text, text[]) from public, anon;
revoke all on function public.submit_ogiri_picks(bigint, bigint[]) from public, anon;
revoke all on function public.ogiri_taste_examples(bigint, int) from public, anon;
grant execute on function public.add_ogiri_round(bigint, text, text, text[]) to authenticated;
grant execute on function public.submit_ogiri_picks(bigint, bigint[]) to authenticated;
grant execute on function public.ogiri_taste_examples(bigint, int) to authenticated;
