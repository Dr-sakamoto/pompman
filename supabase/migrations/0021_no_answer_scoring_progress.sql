-- ============================================================================
-- 無回答採点を進捗（odai_close_progress）にも反映する。
--
-- 0020 で「回答を書いていなくても解禁して採点できる」ようにしたが、
-- odai_close_progress() の集計は answers テーブルだけを起点にしていた
-- （per_participant を a.odai_id, a.author_id で group by していた）。
-- そのため、回答を書かずに解禁・採点（または「何も選ばない」）した人は
-- unlocked / scored / judged / finished のどれにも数えられない。
--
-- 実害は2つ:
--   * 進捗バーの「人数」が、実際に採点した人数より少なく出る。
--   * judged が private.scorer_count() より小さくなりうる（0019 のテストが
--     前提にしている「judged と scorer_count は一致する」が崩れる）。
--     時間バーが「採点待ち」のままなのに、裏では発表条件を満たしている、
--     という表示と実挙動のズレが起きる。
--
-- 「参加者」（回答した人＝多様性の指標。人数バーの分母 max(participants,2) に
-- 使う）は今まで通り answers 起点のまま変えない。変えるのは
-- unlocked/scored/judged/finished の集計対象で、これは「回答した人」∪
-- 「解禁した人」に広げる —— 採点者は必ずこちらに含まれる
-- （submit_picks は has_unlocked を要求するため）。
-- ============================================================================

drop function if exists public.odai_close_progress();

create function public.odai_close_progress()
returns table (
  odai_id          bigint,      -- 対象のお題
  created_at       timestamptz, -- お題の作成時刻（時間バーの左端）
  as_of            timestamptz, -- この行を数えた時刻（now()。バーの現在地）
  ready_at         timestamptz, -- (a) が効き始める時刻 = created_at + auto_unlock_idle()
  close_at         timestamptz, -- (b) で発表される時刻 = created_at + auto_close_age()
  answer_count     bigint,      -- 回答数（データ量）
  participants     int,         -- 参加者＝回答した人の数（多様性）
  unlocked         int,         -- そのうち解禁済みの人数
  scored           int,         -- そのうち1件以上採点した人数
  judged           int,         -- そのうち採点を終えた人数（scored ＋「選ぶ回答なし」）
  finished         int,         -- そのうち「もう次の操作が無い」人数（(a) の分子）
  preference_pairs bigint       -- いま発表した場合に取れる選好ペアの数
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- 回答した人（参加者。answers 起点、今まで通り）。
  with answerers as (
    select a.odai_id as odai_id, a.author_id as user_id, count(*) as answers
    from public.answers a
    join public.odai o on o.id = a.odai_id and o.phase = 'open'
    group by a.odai_id, a.author_id
  ),
  -- 採点に関わりうる人＝回答した人 ∪ 解禁した人。無回答で解禁しただけの人も、
  -- ここに入っていないと unlocked/scored/judged/finished から漏れる。
  people as (
    select odai_id, user_id from answerers
    union
    select k.odai_id as odai_id, k.user_id as user_id
    from public.answer_unlocks k
    join public.odai o on o.id = k.odai_id and o.phase = 'open'
  ),
  per_participant as (
    select
      p.odai_id                                             as odai_id,
      p.user_id                                              as author_id,
      coalesce(an.answers, 0)                                as answers,
      (an.user_id is not null)                               as is_answerer,
      private.has_unlocked(p.odai_id, p.user_id)             as unlocked,
      private.pickable_answer_count(p.odai_id, p.user_id)    as pickable,
      (
        select count(*)
        from public.picks k
        where k.odai_id = p.odai_id and k.voter_id = p.user_id
      )                                                       as picks,
      private.has_skipped(p.odai_id, p.user_id)              as skipped
    from people p
    left join answerers an on an.odai_id = p.odai_id and an.user_id = p.user_id
  ),
  stat as (
    select
      pp.odai_id                                    as odai_id,
      (count(*) filter (where pp.is_answerer))::int as participants,
      (count(*) filter (where pp.unlocked))::int    as unlocked,
      (count(*) filter (where pp.picks > 0))::int   as scored,
      -- private.scorer_count() と同じもの（選んだ人＋「選ぶ回答なし」を宣言した人）。
      -- 採点者は必ず people（回答した人 or 解禁した人）に含まれるので、この集計で数が一致する。
      (count(*) filter (where pp.picks > 0 or pp.skipped))::int as judged,
      -- maybe_close_odai() の v_pending（未解禁 or「採点できるのに未採点かつ未skip」）の裏返し。
      (count(*) filter (
        where pp.unlocked and (pp.pickable = 0 or pp.picks > 0 or pp.skipped)
      ))::int                                       as finished,
      (sum(pp.answers))::bigint                     as answer_count,
      -- 仕様書 §8 (A) が返す行数と同じ値。ある採点者の1つの pick は、
      -- 「自分以外が書いた回答」のうち自分が選ばなかったものすべてと対になる。
      -- 何も選ばなかった（skip）人の picks は0件なので、寄与も0のまま。
      --   pairs = Σ_採点者 picks × (自分以外の回答数 − picks)
      (coalesce(sum(pp.picks * (pp.pickable - pp.picks)), 0))::bigint as preference_pairs
    from per_participant pp
    group by pp.odai_id
  )
  select
    o.id,
    o.created_at,
    now(),
    o.created_at + private.auto_unlock_idle(),
    o.created_at + private.auto_close_age(),
    coalesce(st.answer_count, 0),
    coalesce(st.participants, 0),
    coalesce(st.unlocked, 0),
    coalesce(st.scored, 0),
    coalesce(st.judged, 0),
    coalesce(st.finished, 0),
    coalesce(st.preference_pairs, 0)
  from public.odai o
  left join stat st on st.odai_id = o.id
  where o.phase = 'open'   -- closed のお題は発表済み。待つものが無い
$$;

comment on function public.odai_close_progress() is
  'open のお題ごとに、自動締め切りの2条件（参加者がやり切ったか / 寿命）への進捗を返す。'
  '集計値だけなので解禁前・未回答のユーザーにも見せてよい。'
  '判定の本体は private.maybe_close_odai()。条件を変えるときは必ず両方直すこと。'
  'finished は picks を入れた場合と pick_skips（何も選ばない）の両方を「終えた」に数える。'
  'unlocked/scored/judged/finished は無回答で解禁・採点した人も含む（0021）。'
  'judged が min_scorers() 未満のお題は、時間バーが右端まで行っても発表されない。';

revoke all on function public.odai_close_progress() from public, anon;
grant execute on function public.odai_close_progress() to authenticated;
