-- ============================================================================
-- お題の出題者だけが編集・削除できるようにする。
--
-- 0001 は「フェーズ遷移は close_odai() だけが行う」という理由で odai に
-- UPDATE / DELETE ポリシーを意図的に置いていなかった。今回追加する編集・削除は
-- フェーズ遷移とは別物（本文だけを直す／出す前の投稿を取り消す）なので、
-- 素直に RLS の UPDATE / DELETE ポリシーとして持たせる。
--
-- 許可する範囲は絞る:
--   * 出題者本人のみ
--   * phase = 'open'（結果発表後は資産として固定する）
--   * まだ誰も回答していない（回答は消せない資産なので、回答が付いた後に
--     お題の本文が変わったり消えたりすると、その回答が何に対する回答か
--     わからなくなる）
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 「そのお題に回答が1件でもあるか」の判定
--
-- authenticated には answers への直接 SELECT 権限が無い（閲覧は answers_view
-- 経由に一本化されている、0009 参照）ので、RLS ポリシー式から素の EXISTS は
-- 書けない。private スキーマの security definer 関数を挟んで切り離す
-- （0001/0002 と同じ理由）。
-- ----------------------------------------------------------------------------

create or replace function private.odai_has_answers(p_odai_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.answers a where a.odai_id = p_odai_id
  )
$$;

comment on function private.odai_has_answers(bigint) is
  '指定お題に回答が1件でもあるか。出題者による編集・削除を許すかの判定に使う。';

revoke all on function private.odai_has_answers(bigint) from public, anon;
grant execute on function private.odai_has_answers(bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. odai の UPDATE / DELETE ポリシー
-- ----------------------------------------------------------------------------

create policy odai_update_self on public.odai
  for update to authenticated
  using (
    author_id = (select auth.uid())
    and phase = 'open'
    and not private.odai_has_answers(id)
  )
  with check (
    author_id = (select auth.uid())
    and phase = 'open'
  );

create policy odai_delete_self on public.odai
  for delete to authenticated
  using (
    author_id = (select auth.uid())
    and phase = 'open'
    and not private.odai_has_answers(id)
  );

grant update (text), delete on public.odai to authenticated;
