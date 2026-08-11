-- ============================================================================
-- 回答受付の自動締め切り
--
-- これまでは出題者が close_answers() を手動で叩くまで回答受付が終わらな
-- かった。投票フェーズには「全員投票し終えたら自動で結果公開」
-- (maybe_close_voting) がすでにあるので、回答フェーズにも同じ発想で
-- 自動遷移を足す。判断基準は二つ、どちらか満たせば締め切る:
--
--   * データ量: 登録メンバー全員が回答し終えた
--   * 経過日数: お題の作成から ANSWER_DEADLINE_DAYS 日経った
--
-- 手動の close_answers() は温存する（早めに締めたい場合の逃げ道として）。
-- ============================================================================

-- 単一の odai について自動締め切り条件を判定し、満たしていれば voting へ
-- 進める。出題者チェックは行わない（システムが自動で行う遷移のため）。
create or replace function private.maybe_close_answers(p_odai_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phase      text;
  v_created_at timestamptz;
  v_answers    int;
  v_members    int;
begin
  select o.phase, o.created_at into v_phase, v_created_at
  from public.odai o
  where o.id = p_odai_id
  for update;

  if not found or v_phase <> 'answering' then
    return;
  end if;

  select count(*) into v_answers from public.answers a where a.odai_id = p_odai_id;

  -- close_answers() と同じ最低条件。1件しかないのに自動で投票へは進めない。
  if v_answers < 2 then
    return;
  end if;

  select count(*) into v_members from public.users;

  if v_answers >= v_members or now() >= v_created_at + interval '3 days' then
    update public.odai
       set phase = 'voting', answers_closed_at = now()
     where id = p_odai_id;
  end if;
end
$$;

comment on function private.maybe_close_answers(bigint) is
  '回答受付の自動締め切り条件（全員回答 or 作成から3日経過、かつ回答2件以上）を満たしていれば voting へ進める。';

-- 回答が投稿されるたびに即座に判定する（「全員回答した」を待たずに次の
-- 回答者を待たせない）。
create or replace function private.answers_maybe_close_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.maybe_close_answers(new.odai_id);
  return new;
end
$$;

create trigger answers_maybe_close_after_insert
  after insert on public.answers
  for each row execute function private.answers_maybe_close_after_insert();

-- 経過日数のほうは「回答が投稿される」イベントが起きないと上のトリガーが
-- 発火しないため、ページ表示のたびに掃除できるよう公開 RPC も用意する。
create or replace function public.sweep_answer_deadlines()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in select id from public.odai where phase = 'answering' loop
    perform private.maybe_close_answers(r.id);
  end loop;
end
$$;

comment on function public.sweep_answer_deadlines() is
  '回答受付中の odai を全件チェックし、自動締め切り条件を満たしたものを voting へ進める。ページ表示時に呼ぶ想定。';

revoke all on function private.maybe_close_answers(bigint)             from public, anon;
revoke all on function private.answers_maybe_close_after_insert()      from public, anon;
revoke all on function public.sweep_answer_deadlines()                 from public, anon;

grant execute on function public.sweep_answer_deadlines() to authenticated;
