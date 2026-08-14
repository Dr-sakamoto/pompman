-- ============================================================================
-- 結果発表までの進捗を数えて返す（表示用）。
--
-- 0013 で自動締め切りを入れたが、条件が画面から見えない。今の UI は
-- 「押さなくても、全員採点し終えるか3日経てば自動で発表されます」という
-- 文章が1行あるだけで、そのお題が**どちらの条件にどれだけ近いのか**が分からない。
-- 分からないものは待つしかなく、待っているあいだは何もしないのがいちばん楽なので、
-- 0013 が直そうとした「放っておくと進まない」がそのまま残る。
--
-- 自動締め切りの条件は2本ある（0013 §2）。片方は人、もう片方は時間で進む。
--
--   (a) 参加者（そのお題に回答した人）が2人以上いて、全員が解禁済み、
--       採点できる人は全員採点済み ＋ 作成から auto_unlock_idle()
--   (b) 作成から auto_close_age() 経過（回答1件以上が前提）
--
-- 進み方の違う2本なので、進捗バーもお題ごとに2本要る。(a) は「あと誰が
-- 何をすれば発表されるか」＝自分で動かせる棒、(b) は「あと何時間で
-- 勝手に発表されるか」＝放っておいても動く棒。
--
-- ここは**表示専用**で、判定の本体は private.maybe_close_odai()。同じ条件を
-- 2箇所に書くことになるので、**片方だけ直すと画面と実挙動がズレる。必ず
-- 一緒に直すこと**（finished の式は maybe_close_odai() の v_pending を
-- 裏返したもの）。
--
-- ----------------------------------------------------------------------------
-- 何を出してよいか（伏せているものとの線引き）
-- ----------------------------------------------------------------------------
--
-- 返すのは全部**集計値**で、誰が何を書いたか・誰が誰を選んだかは1つも含まない。
-- 0010 が odai_answer_counts() で引いた線（「回答数が分かる」と「回答の中身が
-- 見える」は別）と同じ理由で、解禁前・未回答のユーザーにも見せてよい。
--
--   * participants / unlocked / scored ... 人数だけ。誰かは分からない
--   * preference_pairs ................... 件数だけ。誰が何を選んだかは分からない
--
-- picks を結果発表まで伏せているのは「他人の採点を見てから採点すると、選好
-- データが同調のログに化ける」から（README）。**何人が採点したか**を知っても
-- 中身は1件も分からないので、この危険は生まない。むしろ「あと1人で発表」が
-- 見えるほうが戻ってくる理由になる。
--
-- ただし2人しかいないお題では「回答数 − 自分の回答数」で相手の回答数が割れる。
-- これは 0010 の時点ですでにそうで（回答数は公開）、participants が増えても
-- 誰が書いたかは出ない。身内数人の規模では許容する。
-- ============================================================================

create or replace function public.odai_close_progress()
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
  finished         int,         -- そのうち「もう次の操作が無い」人数（(a) の分子）
  preference_pairs bigint       -- いま発表した場合に取れる選好ペアの数
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- 参加者1人ぶんの状態。has_unlocked / pickable_answer_count は
  -- maybe_close_odai() が使っているものと同じ（判定と表示で数え方を変えない）。
  with per_participant as (
    select
      a.odai_id                                             as odai_id,
      a.author_id                                           as author_id,
      count(*)                                              as answers,
      private.has_unlocked(a.odai_id, a.author_id)          as unlocked,
      private.pickable_answer_count(a.odai_id, a.author_id) as pickable,
      (
        select count(*)
        from public.picks k
        where k.odai_id = a.odai_id and k.voter_id = a.author_id
      )                                                     as picks
    from public.answers a
    join public.odai o on o.id = a.odai_id and o.phase = 'open'
    group by a.odai_id, a.author_id
  ),
  stat as (
    select
      pp.odai_id                                    as odai_id,
      (count(*))::int                               as participants,
      (count(*) filter (where pp.unlocked))::int    as unlocked,
      (count(*) filter (where pp.picks > 0))::int   as scored,
      -- maybe_close_odai() の v_pending（未解禁 or「採点できるのに未採点」）の裏返し。
      (count(*) filter (
        where pp.unlocked and (pp.pickable = 0 or pp.picks > 0)
      ))::int                                       as finished,
      (sum(pp.answers))::bigint                     as answer_count,
      -- 仕様書 §8 (A) が返す行数と同じ値。ある採点者の1つの pick は、
      -- 「自分以外が書いた回答」のうち自分が選ばなかったものすべてと対になる。
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
    coalesce(st.finished, 0),
    coalesce(st.preference_pairs, 0)
  from public.odai o
  left join stat st on st.odai_id = o.id
  where o.phase = 'open'   -- closed のお題は発表済み。待つものが無い
$$;

comment on function public.odai_close_progress() is
  'open のお題ごとに、自動締め切りの2条件（参加者がやり切ったか / 寿命）への進捗を返す。'
  '集計値だけなので解禁前・未回答のユーザーにも見せてよい。'
  '判定の本体は private.maybe_close_odai()。条件を変えるときは必ず両方直すこと。';

revoke all on function public.odai_close_progress() from public, anon;
grant execute on function public.odai_close_progress() to authenticated;
