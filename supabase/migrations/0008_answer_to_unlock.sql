-- ============================================================================
-- 「自分が回答するまで他人の回答は見えない」を戻す。
--
-- 0007 で回答受付と採点を1フェーズに畳んだとき、回答を投稿された瞬間に全員へ
-- 公開した。その引き換えに、初期版が持っていた
--   「他人の回答を見てから書くと引きずられた回答が混ざり、教師データとして劣化する」
-- という保証を手放していた。ここで形を変えて取り戻す。
--
-- 時間（フェーズ）で分けるのではなく、1人ずつの状態で分ける:
--
--   回答していない人  … 他人の回答は読めない。回答数だけ分かる。採点もできない
--   回答した人        … その瞬間から全回答が読めて、採点できる
--
-- こうすると、
--   * 「回答したらすぐ採点できる」（0007 の狙い）はそのまま
--   * 各人の**最初の1つは必ず他人を見る前に書かれる**ことが DB 層で保証される
--   * 多答・1フェーズ・回答数の可視化も維持される
--
-- 2つ目以降の回答は解禁後に書かれるので、この保証の外側にある。教師データ側では
-- 「そのお題・その人の何個目の回答か」で区別できる（仕様書 §8 (D)）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 解禁の判定
-- ----------------------------------------------------------------------------

create or replace function private.has_answered(p_odai_id bigint, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.answers a
    where a.odai_id = p_odai_id
      and a.author_id = p_uid
  )
$$;

comment on function private.has_answered(bigint, uuid) is
  '指定ユーザーがそのお題に回答済みか。他人の回答の解禁条件。';

revoke all on function private.has_answered(bigint, uuid) from public, anon;
-- RLS ポリシー式は authenticated として評価されるので execute が要る。
grant execute on function private.has_answered(bigint, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. 回答数だけは誰にでも見せる
--
-- 「回答数が分かる」と「回答の中身が見える」は別。件数は集計値で、誰が何を
-- 書いたかを一切含まないので、解禁前でも出してよい。
-- （初期版は回答者数も伏せていたが、それは3フェーズ制で「まだ誰も回答して
--   いないお題」を隠す意味があったから。1フェーズになった今は、回答数が
--   見えないと参加すべきお題が分からない。）
-- ----------------------------------------------------------------------------

create or replace function public.odai_answer_counts()
returns table (odai_id bigint, answer_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.odai_id, count(*) from public.answers a group by a.odai_id
$$;

comment on function public.odai_answer_counts() is
  'お題ごとの回答数。件数だけを返すので、解禁前のユーザーにも見せてよい。';

revoke all on function public.odai_answer_counts() from public, anon;
grant execute on function public.odai_answer_counts() to authenticated;

-- ----------------------------------------------------------------------------
-- 3. RLS: 回答の可視性を解禁制にする
-- ----------------------------------------------------------------------------

drop policy answers_select on public.answers;
create policy answers_select on public.answers
  for select to authenticated
  using (
    author_id = (select auth.uid())                              -- 自分の回答は常に
    or private.odai_phase(odai_id) = 'closed'                    -- 結果発表後は全部
    or private.has_answered(odai_id, (select auth.uid()))        -- 回答した人には全部
  );

-- 他人の回答が見えない人は採点もできない。見ずに選べてしまうと、
-- picks が「中身を読んだ上での選好」でなくなる。
drop policy picks_insert on public.picks;
create policy picks_insert on public.picks
  for insert to authenticated
  with check (
    voter_id = (select auth.uid())
    and private.odai_phase(odai_id) = 'open'
    and private.has_answered(odai_id, (select auth.uid()))
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
  or private.has_answered(a.odai_id, (select auth.uid()));

comment on view public.answers_view is
  '回答の閲覧はすべてこのビュー経由。自分が回答するまで他人の回答は返らない。'
  '結果発表まで author_id は自分の回答以外 null。';

revoke all on public.answers_view from anon, authenticated;
grant select on public.answers_view to authenticated;

-- ----------------------------------------------------------------------------
-- 5. 採点 RPC 側にも先回りのエラーを足す
--
-- 実際の遮断は picks の RLS が行う（二重チェックは意図的）。
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

  if not private.has_answered(p_odai_id, v_uid) then
    raise exception '先に自分の回答を出してください' using errcode = 'P0001';
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
