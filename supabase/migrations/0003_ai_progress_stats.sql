-- ============================================================================
-- AI導入までのデータ量カウントダウン表示用の集計関数。
--
-- odai-mvp-spec.md 曰く「AI（回答生成・報酬モデル）の着手は、picksが数百件
-- 貯まってから」。個々の picks 行は RLS で voter_id ごと・非公開お題は隠され
-- ているが、件数という集計値だけなら voter_id を一切露出しないため公開して
-- 問題ない。security definer で RLS をバイパスし、件数のみを返す。
-- ============================================================================

create or replace function public.ai_progress_stats()
returns table (picks_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*) from public.picks;
$$;

revoke all on function public.ai_progress_stats() from public, anon;
grant execute on function public.ai_progress_stats() to authenticated;
