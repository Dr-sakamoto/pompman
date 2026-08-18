-- ============================================================================
-- 採点フローの簡略化: 「回答を書かないと解禁できない」制約を外す。
--
-- 採点だけしたい人（回答は書かない）も他人の回答を見て採点に進めるようにする。
-- 0011 では「出し切ってから解禁」を保証するために has_answered を必須にしていたが、
-- 採点への参加ハードルを下げるため、この保証は任意（書いた人だけに適用）に緩める。
-- 片道切符（解禁後は回答を追加できない）自体は維持する。
-- ============================================================================

drop policy if exists answer_unlocks_insert on public.answer_unlocks;

create policy answer_unlocks_insert on public.answer_unlocks
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.odai_phase(odai_id) = 'open'
  );

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

  if private.has_unlocked(p_odai_id, v_uid) then
    raise exception 'すでに解禁済みです' using errcode = 'P0001';
  end if;

  insert into public.answer_unlocks (odai_id, user_id) values (p_odai_id, v_uid);
end
$$;

comment on function public.unlock_answers(bigint) is
  '他人の回答を見て採点できるようにする。以後そのお題には回答を追加できなくなる（片道切符）。回答を書いていなくても呼べる。';
