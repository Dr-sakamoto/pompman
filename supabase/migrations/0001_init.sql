-- ============================================================================
-- 会員制大喜利サイト MVP — 初期スキーマ
--
-- このプロジェクトの資産は UI ではなく picks に残るログ。
-- したがって以下は絶対に崩さないこと:
--   * picks.voter_id を落とさない（落とすと二度と分離できない）
--   * answers を削除しない（誰にも選ばれなかった回答も教師データ）
--   * 回答受付中に他人の回答が読めないことを DB 層で担保する
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. テーブル
-- ----------------------------------------------------------------------------

-- 参加者
create table public.users (
  id                uuid primary key references auth.users (id),
  handle            text not null unique
                      check (char_length(btrim(handle)) between 1 and 20),
  role              text not null default 'member'
                      check (role in ('admin', 'educator', 'member')),
  -- 仕様書 §7: 学習利用への同意。後から足すと必ず揉めるので最初から持たせる。
  terms_accepted_at timestamptz,
  created_at        timestamptz not null default now()
);

comment on table public.users is '参加者。auth.users と 1:1。';
comment on column public.users.terms_accepted_at is
  '投稿データを本プロジェクトの AI 学習に利用することへの同意日時。';

-- お題
create table public.odai (
  id                bigserial primary key,
  author_id         uuid not null references public.users (id),
  text              text not null check (char_length(btrim(text)) > 0),
  phase             text not null default 'answering'
                      check (phase in ('answering', 'voting', 'closed')),
  created_at        timestamptz not null default now(),
  answers_closed_at timestamptz,
  voting_closed_at  timestamptz
);

comment on column public.odai.phase is
  'answering(回答受付中) | voting(投票中) | closed(結果公開)。遷移は close_answers() / close_voting() 経由のみ。';

-- 回答
create table public.answers (
  id         bigserial primary key,
  odai_id    bigint not null references public.odai (id) on delete cascade,
  author_id  uuid not null references public.users (id),
  text       text not null check (char_length(btrim(text)) > 0),
  is_ai      boolean not null default false,
  model_ver  text,
  created_at timestamptz not null default now(),

  -- MVP は 1人1回答（データを単純に保つ）。将来 AI 参加者も 1体1回答。
  constraint answers_one_per_author unique (odai_id, author_id),
  -- model_ver は is_ai=true のときのみ
  constraint answers_model_ver_requires_ai check (is_ai or model_ver is null)
);

comment on column public.answers.is_ai is
  'MVP では常に false。AI 参加者を入れる段階で true が入る（スキーマ移行を避けるため先に置いてある）。';

-- 選出（このプロジェクトの全資産）
create table public.picks (
  id         bigserial primary key,
  odai_id    bigint not null references public.odai (id) on delete cascade,
  voter_id   uuid not null references public.users (id),
  answer_id  bigint not null references public.answers (id) on delete cascade,
  rank       smallint not null check (rank between 1 and 3),
  created_at timestamptz not null default now(),

  unique (odai_id, voter_id, rank),      -- 同じ順位を二重に付けられない
  unique (odai_id, voter_id, answer_id)  -- 同じ回答を二重に選べない
);

comment on table public.picks is
  '選出ログ。voter_id は絶対に落とさないこと。混ぜるのは学習時であって保存時ではない。';

create index answers_odai_id_idx on public.answers (odai_id);
create index picks_odai_id_idx   on public.picks (odai_id);
create index picks_voter_id_idx  on public.picks (voter_id);
create index picks_answer_id_idx on public.picks (answer_id);
create index odai_phase_idx      on public.odai (phase);

-- ----------------------------------------------------------------------------
-- 2. ヘルパー関数
--
-- RLS ポリシーの中から他テーブルを参照すると、そのテーブルの RLS / 権限が
-- 再帰的に効いてしまう。security definer 関数を挟んで切り離す。
-- ----------------------------------------------------------------------------

create or replace function public.odai_phase(p_odai_id bigint)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.phase from public.odai o where o.id = p_odai_id
$$;

create or replace function public.answer_odai_id(p_answer_id bigint)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.odai_id from public.answers a where a.id = p_answer_id
$$;

create or replace function public.answer_author_id(p_answer_id bigint)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.author_id from public.answers a where a.id = p_answer_id
$$;

-- 指定ユーザーが選べる回答の数（＝自分以外が書いた回答の数）
create or replace function public.pickable_answer_count(p_odai_id bigint, p_voter_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.answers a
  where a.odai_id = p_odai_id
    and a.author_id <> p_voter_id
$$;

-- ----------------------------------------------------------------------------
-- 3. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.users   enable row level security;
alter table public.odai    enable row level security;
alter table public.answers enable row level security;
alter table public.picks   enable row level security;

-- users --------------------------------------------------------------------
create policy users_select_all on public.users
  for select to authenticated
  using (true);

create policy users_insert_self on public.users
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy users_update_self on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- role の自己昇格を防ぐ。auth.uid() が無い経路（service_role / SQL エディタ）は
-- 運営の操作なので通す。
create or replace function public.users_freeze_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    if new.role is distinct from old.role then
      raise exception 'role は変更できません' using errcode = '42501';
    end if;
    new.id         := old.id;
    new.created_at := old.created_at;
  end if;
  return new;
end
$$;

create trigger users_freeze_privileged_columns
  before update on public.users
  for each row execute function public.users_freeze_privileged_columns();

-- odai ---------------------------------------------------------------------
create policy odai_select_all on public.odai
  for select to authenticated
  using (true);

create policy odai_insert_self on public.odai
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and phase = 'answering'
  );

-- UPDATE / DELETE ポリシーは意図的に無い。
-- フェーズ遷移は close_answers() / close_voting() だけが行う。

-- answers ------------------------------------------------------------------
-- 回答受付中は「自分が書いた回答しか読めない」。
-- 他人の回答を見てから書くと引きずられた回答が混ざり、教師データとして劣化する。
create policy answers_select on public.answers
  for select to authenticated
  using (
    author_id = (select auth.uid())
    or public.odai_phase(odai_id) in ('voting', 'closed')
  );

create policy answers_insert on public.answers
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and is_ai = false                                -- MVP では AI 投稿を受け付けない
    and public.odai_phase(odai_id) = 'answering'
  );

-- UPDATE / DELETE ポリシーは意図的に無い。回答は資産なので消させない。

-- picks --------------------------------------------------------------------
create policy picks_select on public.picks
  for select to authenticated
  using (
    voter_id = (select auth.uid())
    or public.odai_phase(odai_id) = 'closed'
  );

create policy picks_insert on public.picks
  for insert to authenticated
  with check (
    voter_id = (select auth.uid())
    and public.odai_phase(odai_id) = 'voting'
    and public.answer_odai_id(answer_id) = odai_id
    and public.answer_author_id(answer_id) <> (select auth.uid())  -- 自分の回答は選べない
  );

-- 投票中の選び直しのみ許可（差し替えは delete → insert）
create policy picks_delete on public.picks
  for delete to authenticated
  using (
    voter_id = (select auth.uid())
    and public.odai_phase(odai_id) = 'voting'
  );

-- ----------------------------------------------------------------------------
-- 4. 回答の閲覧ビュー（列レベルの目隠し）
--
-- RLS は行単位なので、投票中に answers を SELECT できる時点で author_id まで
-- 返ってしまう。「投票が終わるまで誰が書いたか分からない」を API レベルで
-- 守るため、基底テーブルへの SELECT 権限を落としてビュー経由に一本化する。
--
-- このビューは security definer（＝基底テーブルの RLS を迂回する）ため、
-- answers_select と同じ可視条件を WHERE に持たせてある。両方を必ず一緒に直すこと。
-- ----------------------------------------------------------------------------

create view public.answers_view
with (security_barrier = true) as
select
  a.id,
  a.odai_id,
  a.text,
  a.is_ai,
  a.created_at,
  case
    when o.phase = 'closed' then a.author_id
    when a.author_id = (select auth.uid()) then a.author_id
    else null
  end as author_id,
  case when o.phase = 'closed' then a.model_ver else null end as model_ver,
  (a.author_id = (select auth.uid())) as is_mine
from public.answers a
join public.odai o on o.id = a.odai_id
where
  a.author_id = (select auth.uid())
  or o.phase in ('voting', 'closed');

comment on view public.answers_view is
  '回答の閲覧はすべてこのビュー経由。closed になるまで author_id は自分の回答以外 null。';

-- ----------------------------------------------------------------------------
-- 5. 権限
-- ----------------------------------------------------------------------------

revoke all on public.users   from anon, authenticated;
revoke all on public.odai    from anon, authenticated;
revoke all on public.answers from anon, authenticated;
revoke all on public.picks   from anon, authenticated;
revoke all on public.answers_view from anon, authenticated;

grant select, insert, update on public.users to authenticated;
grant select, insert                on public.odai    to authenticated;
grant insert (odai_id, author_id, text) on public.answers to authenticated;
grant select, insert, delete        on public.picks   to authenticated;
grant select                        on public.answers_view to authenticated;

grant usage, select on sequence public.odai_id_seq    to authenticated;
grant usage, select on sequence public.answers_id_seq to authenticated;
grant usage, select on sequence public.picks_id_seq   to authenticated;

-- ----------------------------------------------------------------------------
-- 6. フェーズ遷移 / 投票の RPC
-- ----------------------------------------------------------------------------

-- 回答受付 → 投票（お題の作成者のみ）
create or replace function public.close_answers(p_odai_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_author uuid;
  v_phase  text;
  v_count  int;
begin
  if v_uid is null then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;

  select o.author_id, o.phase into v_author, v_phase
  from public.odai o where o.id = p_odai_id for update;

  if not found then
    raise exception 'お題が見つかりません' using errcode = 'P0002';
  end if;
  if v_author <> v_uid then
    raise exception 'お題を締め切れるのは作成者だけです' using errcode = '42501';
  end if;
  if v_phase <> 'answering' then
    raise exception 'このお題はすでに回答を締め切っています' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.answers a where a.odai_id = p_odai_id;
  if v_count < 2 then
    raise exception '回答が2件以上集まらないと投票に進めません' using errcode = 'P0001';
  end if;

  update public.odai
     set phase = 'voting', answers_closed_at = now()
   where id = p_odai_id;
end
$$;

-- 投票 → 結果公開（お題の作成者のみ）
create or replace function public.close_voting(p_odai_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_author uuid;
  v_phase  text;
begin
  if v_uid is null then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;

  select o.author_id, o.phase into v_author, v_phase
  from public.odai o where o.id = p_odai_id for update;

  if not found then
    raise exception 'お題が見つかりません' using errcode = 'P0002';
  end if;
  if v_author <> v_uid then
    raise exception '投票を締め切れるのは作成者だけです' using errcode = '42501';
  end if;
  if v_phase <> 'voting' then
    raise exception 'このお題は投票中ではありません' using errcode = 'P0001';
  end if;

  update public.odai
     set phase = 'closed', voting_closed_at = now()
   where id = p_odai_id;
end
$$;

-- 回答者全員が投票し終わっていたら自動で結果公開へ
create or replace function public.maybe_close_voting(p_odai_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pending int;
begin
  if (select o.phase from public.odai o where o.id = p_odai_id) <> 'voting' then
    return;
  end if;

  select count(*) into v_pending
  from (select distinct a.author_id from public.answers a where a.odai_id = p_odai_id) participants
  where not exists (
    select 1 from public.picks p
    where p.odai_id = p_odai_id and p.voter_id = participants.author_id
  );

  if v_pending = 0 then
    update public.odai
       set phase = 'closed', voting_closed_at = now()
     where id = p_odai_id;
  end if;
end
$$;

-- ベスト3の提出。security invoker のまま＝ picks の RLS が本当に効いているか
-- ここでも検証されることになる。二重チェックは意図的。
create or replace function public.submit_picks(p_odai_id bigint, p_answer_ids bigint[])
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_given    int  := coalesce(array_length(p_answer_ids, 1), 0);
  v_required int;
begin
  if v_uid is null then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;

  -- 実際の遮断は picks の RLS が行うが、先に見て分かるエラーを返しておく
  if public.odai_phase(p_odai_id) is distinct from 'voting' then
    raise exception 'このお題は投票中ではありません' using errcode = 'P0001';
  end if;

  if (select count(distinct x) from unnest(p_answer_ids) x) <> v_given then
    raise exception '同じ回答を複数の順位に選ぶことはできません' using errcode = 'P0001';
  end if;

  v_required := least(3, public.pickable_answer_count(p_odai_id, v_uid));
  if v_required = 0 then
    raise exception '選べる回答がありません' using errcode = 'P0001';
  end if;
  if v_given <> v_required then
    raise exception '%位まで選んでください', v_required using errcode = 'P0001';
  end if;

  delete from public.picks p
   where p.odai_id = p_odai_id and p.voter_id = v_uid;

  insert into public.picks (odai_id, voter_id, answer_id, rank)
  select p_odai_id, v_uid, t.answer_id, t.ord::smallint
  from unnest(p_answer_ids) with ordinality as t(answer_id, ord);

  perform public.maybe_close_voting(p_odai_id);
end
$$;

revoke all on function public.odai_phase(bigint)                     from public, anon;
revoke all on function public.answer_odai_id(bigint)                 from public, anon;
revoke all on function public.answer_author_id(bigint)               from public, anon;
revoke all on function public.pickable_answer_count(bigint, uuid)    from public, anon;
revoke all on function public.close_answers(bigint)                  from public, anon;
revoke all on function public.close_voting(bigint)                   from public, anon;
revoke all on function public.maybe_close_voting(bigint)             from public, anon;
revoke all on function public.submit_picks(bigint, bigint[])         from public, anon;

grant execute on function public.close_answers(bigint)              to authenticated;
grant execute on function public.close_voting(bigint)               to authenticated;
grant execute on function public.submit_picks(bigint, bigint[])     to authenticated;
-- ヘルパーは RLS ポリシー内から呼ばれる。ポリシー評価は definer 権限で走るため
-- authenticated への execute 付与が必要。
grant execute on function public.odai_phase(bigint)                 to authenticated;
grant execute on function public.answer_odai_id(bigint)             to authenticated;
grant execute on function public.answer_author_id(bigint)           to authenticated;
grant execute on function public.pickable_answer_count(bigint, uuid) to authenticated;
grant execute on function public.maybe_close_voting(bigint)         to authenticated;
