-- ============================================================================
-- 貢献度ランキングの集計対象を拡張する。
--
-- これまでは「結果発表済み(closed)のお題」に限定していたが、投稿は
-- answering/voting（アプリ上の表示では open = 回答・採点中）の時点で
-- 既に行われている行為であり、closed になるまで表示に反映されないのは
-- 「頑張って投稿してもすぐランキングに乗らない」という体験上のギャップに
-- なっていた。集計するのはあくまで「件数」であって回答本文や誰の回答かでは
-- ないため、0016 が懸念していた匿名性（投票が終わるまで回答の中身・作者が
-- 分からない）とは衝突しない。よって全フェーズを対象にする。
--
-- あわせて、採点（picks への投票行為）も貢献度に加える。回答・お題の投稿と
-- 同じく「行為の件数」であり、my_streak() が既に「回答 or 採点」を参加の
-- 単位として扱っているのと揃える。
-- ============================================================================

-- 返り値の列（OUT パラメータ）が変わるので create or replace では置き換えられない
-- （0019_min_scoring_to_close.sql の odai_close_progress() と同じ理由）。
-- drop すると 0016 で付けた grant も落ちるので、末尾で付け直す。
drop function if exists public.contribution_ranking();

create function public.contribution_ranking()
returns table (
  user_id       uuid,
  handle        text,
  answer_count  bigint, -- 投稿した回答数（フェーズ問わず。AI投稿は除く）
  odai_count    bigint, -- 自分が出題したお題数（フェーズ問わず）
  pick_count    bigint  -- 採点（選出）した回数
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    u.id,
    u.handle,
    coalesce(ac.cnt, 0) as answer_count,
    coalesce(oc.cnt, 0) as odai_count,
    coalesce(pc.cnt, 0) as pick_count
  from public.users u
  left join (
    select a.author_id, count(*) as cnt
    from public.answers a
    where a.is_ai = false
    group by a.author_id
  ) ac on ac.author_id = u.id
  left join (
    select o.author_id, count(*) as cnt
    from public.odai o
    group by o.author_id
  ) oc on oc.author_id = u.id
  left join (
    select p.voter_id, count(*) as cnt
    from public.picks p
    group by p.voter_id
  ) pc on pc.voter_id = u.id
  where coalesce(ac.cnt, 0) > 0 or coalesce(oc.cnt, 0) > 0 or coalesce(pc.cnt, 0) > 0
  order by
    (coalesce(ac.cnt, 0) + coalesce(oc.cnt, 0) + coalesce(pc.cnt, 0)) desc,
    u.handle asc
$$;

comment on function public.contribution_ranking() is
  '投稿数（回答・お題・採点）ランキング。結果発表前のお題への投稿も含む。回答本文や作者の対応関係は含まない。';

revoke all on function public.contribution_ranking() from public, anon;
grant execute on function public.contribution_ranking() to authenticated;
