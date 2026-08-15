-- ============================================================================
-- 貢献度ランキングと連続日数ストリーク（習慣化のための表示専用集計）。
--
-- odai-mvp-spec.md の「作らないもの」には元々「ランキング・戦績ページ」が
-- 挙がっていたが、習慣化を促す目的で追加する。集計元は closed（結果発表済み）
-- のお題のみとし、open（回答・採点中）のお題の中身には一切触れない。
-- open 中に author_id を見せると「他人の回答が見える」「誰が書いたかで態度を
-- 変える」を招き、既存の匿名性設計（0001 answers_view, README §4.3）と
-- 衝突するため。closed になった時点で author_id はどのみち公開されている
-- （odai_close_progress のコメント、および 0001 answers_view 参照）ので、
-- そこだけを数えるのはこのアプリの設計と矛盾しない。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 貢献度ランキング: 結果発表済みのお題における投稿数（回答数・お題数）。
--
-- ai_progress_stats() / odai_close_progress() と同じく security definer で
-- 集計するが、ここは集計値ではなく handle と紐づいた個人の実績を返す。
-- ハンドルネームは users_select_all により最初から全員に公開されているので、
-- これは新しい非公開情報の開示ではない（本名は member_real_names で別管理・
-- 引き続き非公開）。
-- ----------------------------------------------------------------------------
create or replace function public.contribution_ranking()
returns table (
  user_id       uuid,
  handle        text,
  answer_count  bigint, -- closed のお題に投稿した回答数（AI投稿は除く）
  odai_count    bigint  -- closed になったお題のうち自分が出題したもの
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
    coalesce(oc.cnt, 0) as odai_count
  from public.users u
  left join (
    select a.author_id, count(*) as cnt
    from public.answers a
    join public.odai o on o.id = a.odai_id
    where o.phase = 'closed' and a.is_ai = false
    group by a.author_id
  ) ac on ac.author_id = u.id
  left join (
    select o.author_id, count(*) as cnt
    from public.odai o
    where o.phase = 'closed'
    group by o.author_id
  ) oc on oc.author_id = u.id
  where coalesce(ac.cnt, 0) > 0 or coalesce(oc.cnt, 0) > 0
  order by (coalesce(ac.cnt, 0) + coalesce(oc.cnt, 0)) desc, u.handle asc
$$;

comment on function public.contribution_ranking() is
  '結果発表済み(closed)のお題だけを対象にした投稿数ランキング。openのお題の中身（誰が何を書いたか）には触れない。';

revoke all on function public.contribution_ranking() from public, anon;
grant execute on function public.contribution_ranking() to authenticated;

-- ----------------------------------------------------------------------------
-- 連続日数ストリーク: 呼び出し本人が「回答 or 採点のどちらか」を行った日が
-- 何日連続しているか。他人のデータには触れないので RLS の可視性ルールと
-- 衝突しない（自分の回答・自分のpicksは常に自分から見える）。
--
-- 「参加」の単位は JST の暦日。日をまたぐ判定がUTCのままだと深夜の利用者だけ
-- 日付がずれるため、表示に合わせて Asia/Tokyo に変換してから丸める。
--
-- streak_days は「今日 or 昨日」に最後の参加日が無ければ 0
-- （途切れたストリークは0日として見せる。昨日まで許すのは、今日まだ何も
-- していないだけの人のストリークを日中いきなり0にしないため）。
-- ----------------------------------------------------------------------------
create or replace function public.my_streak()
returns table (
  streak_days      int,
  last_active_date date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with days as (
    select distinct (a.created_at at time zone 'Asia/Tokyo')::date as d
    from public.answers a
    where a.author_id = (select auth.uid())
    union
    select distinct (p.created_at at time zone 'Asia/Tokyo')::date as d
    from public.picks p
    where p.voter_id = (select auth.uid())
  ),
  -- 連続日数の島分け（gaps-and-islands）。同じ島なら d - row_number() が一定になる。
  islands as (
    select d, d - (row_number() over (order by d))::int as grp
    from days
  ),
  latest_run as (
    select count(*)::int as len, max(d) as last_day
    from islands
    group by grp
    order by max(d) desc
    limit 1
  )
  select
    case
      when lr.last_day is null then 0
      when lr.last_day >= (now() at time zone 'Asia/Tokyo')::date - 1 then lr.len
      else 0
    end,
    lr.last_day
  from (select 1) as one
  left join latest_run lr on true
$$;

comment on function public.my_streak() is
  '呼び出し本人の連続参加日数（回答 or 採点のどちらかを行った日が対象、JST暦日）。今日か昨日に参加していなければ0。';

revoke all on function public.my_streak() from public, anon;
grant execute on function public.my_streak() to authenticated;
