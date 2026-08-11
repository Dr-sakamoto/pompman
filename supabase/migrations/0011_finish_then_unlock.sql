-- ============================================================================
-- 「回答したら即解禁」から「出し切ってから解禁」に変更する。
--
-- 0010 は「1つ回答した瞬間に他人の回答が見える」だった。これだと2個目以降の
-- 回答は他人を見た後に書かれることになり、「他人に引きずられていない」という
-- 保証が最初の1個にしか掛からなかった。
--
-- 本マイグレーションでは、解禁を「回答する」という行為から切り離し、
-- 明示的な操作（unlock_answers）にする。書ける分をすべて書き終えてから
-- 自分の意思で解禁する。解禁は片道切符で、解禁した後はそのお題に
-- 回答を追加できない。
--
--   回答だけ書いた人（未解禁）… 他人の回答は読めない。回答数だけ分かる。採点もできない
--   解禁した人                … 全回答が読める。採点できる。以後そのお題には回答を追加できない
--
-- これで「そのお題に書いたすべての回答が、他人を見る前に書かれている」ことが
-- DB 層で保証される（0010 では最初の1個にしか掛からなかった保証が、全部に掛かる）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 解禁ログ
--
-- 「回答した」（public.answers に行がある）と「解禁した」（このテーブルに
-- 行がある）を別の事実として持つ。解禁は取り消せない・やり直せないので
-- UPDATE/DELETE のポリシーは置かない。
-- ----------------------------------------------------------------------------

create table public.answer_unlocks (
  odai_id     bigint not null references public.odai (id) on delete cascade,
  user_id     uuid not null references public.users (id),
  unlocked_at timestamptz not null default now(),
  primary key (odai_id, user_id)
);

comment on table public.answer_unlocks is
  '「出し切ったので他人の回答を見る」を宣言したログ。片道切符（UPDATE/DELETE 不可）。'
  '行が無い間、他人の answers はそのユーザーには見えず、そのユーザー自身も回答を追加できるが採点はできない。'
  '行ができた瞬間に他人の answers が見えて採点できるようになり、代わりにそのお題への回答追加ができなくなる。';

create index answer_unlocks_odai_id_idx on public.answer_unlocks (odai_id);

alter table public.answer_unlocks enable row level security;

create policy answer_unlocks_select on public.answer_unlocks
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.odai_phase(odai_id) = 'closed'
  );

-- 実際の作成は unlock_answers() 経由。RLS はそれと同じ条件を持たせておく
-- （0001 からの約束: RPC 側だけに条件を置くと、RLS 単体では守れなくなる）。
create policy answer_unlocks_insert on public.answer_unlocks
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.odai_phase(odai_id) = 'open'
    and private.has_answered(odai_id, (select auth.uid()))  -- 出し切る対象が無いと解禁できない
  );

revoke all on public.answer_unlocks from anon, authenticated;
grant select, insert on public.answer_unlocks to authenticated;

-- ----------------------------------------------------------------------------
-- 2. 解禁済みかどうかの判定
--
-- private.has_answered()（=回答したか）とは別に持つ。RLS ポリシー式の中から
-- 使うので private スキーマ + authenticated への execute が要る（0002 の理由）。
-- ----------------------------------------------------------------------------

create or replace function private.has_unlocked(p_odai_id bigint, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.answer_unlocks u
    where u.odai_id = p_odai_id
      and u.user_id = p_uid
  )
$$;

comment on function private.has_unlocked(bigint, uuid) is
  '指定ユーザーがそのお題を解禁済みか。他人の回答・採点の解禁条件。';

revoke all on function private.has_unlocked(bigint, uuid) from public, anon;
grant execute on function private.has_unlocked(bigint, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. RLS の張り替え: has_answered（回答したか）→ has_unlocked（解禁したか）
-- ----------------------------------------------------------------------------

-- 回答の閲覧は解禁が条件。
drop policy answers_select on public.answers;
create policy answers_select on public.answers
  for select to authenticated
  using (
    author_id = (select auth.uid())                              -- 自分の回答は常に
    or private.odai_phase(odai_id) = 'closed'                    -- 結果発表後は全部
    or private.has_unlocked(odai_id, (select auth.uid()))        -- 解禁した人には全部
  );

-- 回答の追加は「まだ解禁していない」ことが条件。解禁後に書けてしまうと
-- 「他人を見てから書いた回答」が混ざり、本マイグレーションの狙いが崩れる。
drop policy answers_insert on public.answers;
create policy answers_insert on public.answers
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and is_ai = false                                             -- MVP では AI 投稿を受け付けない
    and private.odai_phase(odai_id) = 'open'
    and not private.has_unlocked(odai_id, (select auth.uid()))    -- 解禁後は追加できない
  );

-- 採点は解禁が条件（中身を見ずに選べてしまうと picks が選好でなくなるため）。
drop policy picks_insert on public.picks;
create policy picks_insert on public.picks
  for insert to authenticated
  with check (
    voter_id = (select auth.uid())
    and private.odai_phase(odai_id) = 'open'
    and private.has_unlocked(odai_id, (select auth.uid()))
    and private.answer_odai_id(answer_id) = odai_id
    and private.answer_author_id(answer_id) <> (select auth.uid())  -- 自分の回答は選べない
  );

-- ----------------------------------------------------------------------------
-- 4. 閲覧ビューも同じ可視条件に揃える
--
-- answers_select ポリシーとこのビューは必ず一緒に直すこと（0001 からの約束）。
-- ----------------------------------------------------------------------------

drop view public.answers_view;

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
  or o.phase = 'closed'
  or private.has_unlocked(a.odai_id, (select auth.uid()));

comment on view public.answers_view is
  '回答の閲覧はすべてこのビュー経由。解禁する（unlock_answers）まで他人の回答は返らない。'
  '結果発表まで author_id は自分の回答以外 null。';

revoke all on public.answers_view from anon, authenticated;
grant select on public.answers_view to authenticated;

-- ----------------------------------------------------------------------------
-- 5. 解禁の RPC
--
-- 実際の遮断は answer_unlocks の RLS が行う（二重チェックは意図的、0001 の
-- submit_picks と同じ方針）。security invoker のまま。
-- ----------------------------------------------------------------------------

create or replace function public.unlock_answers(p_odai_id bigint)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;

  if private.odai_phase(p_odai_id) is distinct from 'open' then
    raise exception 'このお題はもう回答を受け付けていません' using errcode = 'P0001';
  end if;

  if not private.has_answered(p_odai_id, v_uid) then
    raise exception '先に回答を書いてください' using errcode = 'P0001';
  end if;

  if private.has_unlocked(p_odai_id, v_uid) then
    raise exception 'すでに解禁済みです' using errcode = 'P0001';
  end if;

  insert into public.answer_unlocks (odai_id, user_id) values (p_odai_id, v_uid);
end
$$;

comment on function public.unlock_answers(bigint) is
  '「出し切ったので他人の回答を見る」を宣言する。以後そのお題には回答を追加できなくなる（片道切符）。';

revoke all on function public.unlock_answers(bigint) from public, anon;
grant execute on function public.unlock_answers(bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. 採点 RPC の解禁チェックも張り替え
-- ----------------------------------------------------------------------------

create or replace function public.submit_picks(p_odai_id bigint, p_answer_ids bigint[])
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_given int  := coalesce(array_length(p_answer_ids, 1), 0);
  v_max   int;
begin
  if v_uid is null then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;

  if private.odai_phase(p_odai_id) is distinct from 'open' then
    raise exception 'このお題はもう採点を受け付けていません' using errcode = 'P0001';
  end if;

  if not private.has_unlocked(p_odai_id, v_uid) then
    raise exception '先に回答を出し切って解禁してください' using errcode = 'P0001';
  end if;

  if (select count(distinct x) from unnest(p_answer_ids) x) <> v_given then
    raise exception '同じ回答を複数の順位に選ぶことはできません' using errcode = 'P0001';
  end if;

  v_max := least(3, private.pickable_answer_count(p_odai_id, v_uid));
  if v_max = 0 then
    raise exception '選べる回答がありません' using errcode = 'P0001';
  end if;
  if v_given < 1 or v_given > v_max then
    raise exception '選べるのは1〜%件です', v_max using errcode = 'P0001';
  end if;

  delete from public.picks p
   where p.odai_id = p_odai_id and p.voter_id = v_uid;

  insert into public.picks (odai_id, voter_id, answer_id, rank)
  select p_odai_id, v_uid, t.answer_id, t.ord::smallint
  from unnest(p_answer_ids) with ordinality as t(answer_id, ord);
end
$$;

revoke all on function public.submit_picks(bigint, bigint[]) from public, anon;
grant execute on function public.submit_picks(bigint, bigint[]) to authenticated;
