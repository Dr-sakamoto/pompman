-- ============================================================================
-- 回答受付の進捗（データ量 / 経過日数）を見せるための集計 RPC
--
-- answers テーブルは「回答受付中は自分の回答しか読めない」という RLS が
-- あるため、素の SELECT では他人の回答が何件集まっているか分からない
-- （0007 のコメント参照: 引きずられた回答を防ぐため）。
--
-- ただし件数・人数だけの集計値は、内容や誰が書いたかを一切含まない。
-- 0007 で自動締め切りの判断基準にした「全員回答」「3日経過」を、
-- ユーザーにもバーで見せられるようにする。
-- ============================================================================

create or replace function public.answering_progress(p_odai_id bigint)
returns table(answer_count int, member_count int, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select count(*)::int from public.answers a where a.odai_id = p_odai_id),
    (select count(*)::int from public.users),
    o.created_at
  from public.odai o
  where o.id = p_odai_id
$$;

comment on function public.answering_progress(bigint) is
  '回答受付中の odai について、回答数・登録メンバー数・作成日時を返す。0007 の自動締め切り条件（全員回答 or 3日経過）を UI 側のバーで見せるための集計専用 RPC。回答の内容や著者は一切含まない。';

revoke all on function public.answering_progress(bigint) from public, anon;
grant execute on function public.answering_progress(bigint) to authenticated;
