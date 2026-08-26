-- ============================================================================
-- 他人の回答が1件も無くても「何も選ばない」で採点を終えられるようにする。
--
-- 0020/0021 で「回答を書かずに解禁・採点できる」ようにしたが、submit_picks()
-- は v_given（送った件数）を見る前に pickable_answer_count = 0 なら常に
-- 「選べる回答がありません」で弾いていた。これは実際に選ぼうとした場合には
-- 正しいが、v_given = 0（＝「何も選ばない」の明示的な宣言）まで一緒に
-- 弾いてしまっていた。
--
-- 結果、他人の回答がまだ1件も無い状態で解禁した人は、0021 の
-- odai_close_progress() 上は自動で finished 扱いになるだけで、pick_skips に
-- 行が残らない。そのため結果発表後の「採点した人 / 選ぶ回答なし」表示
-- （src/app/odai/[id]/ClosedPhase.tsx）にも貢献度ランキングの将来の集計にも
-- 一切現れず、「採点したのに何もしていないことにされる」状態だった
-- （「無回答で採点できない」と感じる直接の原因）。
--
-- 直すのは submit_picks() のチェック順序だけ: v_given = 0 の枝を
-- pickable_answer_count のチェックより前に出す。実際に1件以上選ぼうとした
-- ときは今まで通り「選べる回答がありません」で弾く。
-- ============================================================================

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

  if not private.has_unlocked(p_odai_id, v_uid) then
    raise exception '先に回答を出し切って解禁してください' using errcode = 'P0001';
  end if;

  -- 「何も選ばない」の明示的な宣言は、選べる回答が0件でも常に受け付ける
  -- （他人の回答がまだ無いお題を最初に解禁した人が典型例）。
  if v_given = 0 then
    delete from public.picks p
     where p.odai_id = p_odai_id and p.voter_id = v_uid;

    insert into public.pick_skips (odai_id, voter_id)
    values (p_odai_id, v_uid)
    on conflict (odai_id, voter_id) do nothing;

    return;
  end if;

  v_max := least(3, private.pickable_answer_count(p_odai_id, v_uid));
  if v_max = 0 then
    raise exception '選べる回答がありません' using errcode = 'P0001';
  end if;

  if (select count(distinct x) from unnest(p_answer_ids) x) <> v_given then
    raise exception '同じ回答を複数の順位に選ぶことはできません' using errcode = 'P0001';
  end if;

  if v_given > v_max then
    raise exception '選べるのは1〜%件です', v_max using errcode = 'P0001';
  end if;

  delete from public.pick_skips s
   where s.odai_id = p_odai_id and s.voter_id = v_uid;

  delete from public.picks p
   where p.odai_id = p_odai_id and p.voter_id = v_uid;

  insert into public.picks (odai_id, voter_id, answer_id, rank)
  select p_odai_id, v_uid, t.answer_id, t.ord::smallint
  from unnest(p_answer_ids) with ordinality as t(answer_id, ord);
end
$$;

comment on function public.submit_picks(bigint, bigint[]) is
  '採点を送る。空配列（0件）は「何も選ばない」の明示的な宣言として、'
  '選べる回答が0件のときも常に受け付ける（0022）。1件以上選ぼうとしたときだけ'
  '選べる回答が無ければ弾く。';

revoke all on function public.submit_picks(bigint, bigint[]) from public, anon;
grant execute on function public.submit_picks(bigint, bigint[]) to authenticated;
