-- ============================================================================
-- RLS ヘルパー関数を PostgREST の公開スキーマから隠す。
--
-- authenticated への GRANT EXECUTE は RLS ポリシー評価（ポリシー式は
-- authenticated ロールとして実行される）のために必須だが、public スキーマに
-- 置いたままだと同じ GRANT が /rest/v1/rpc/<関数名> を直接叩けてしまう。
--
-- 特に answer_author_id と pickable_answer_count は実害がある:
--   - answer_author_id を直接叩けば、投票中でも本当の author_id が取れて
--     しまい、「投票が終わるまで回答者名は伏せる」を回避できる。
--   - pickable_answer_count を直接叩けば、回答受付中でも他人の回答数が
--     わかってしまい、「回答者数も見せない」を回避できる。
--
-- PostgREST は Exposed schemas に設定したスキーマの関数しか RPC として
-- 公開しないため、private スキーマに逃がせば同じ GRANT のままで API 経由の
-- 直接呼び出しだけを塞げる。
--
-- Supabase の Database Linter（get_advisors）がこの2つを検出した:
--   - authenticated_security_definer_function_executable
--   - function_search_path_mutable（users_freeze_privileged_columns）
-- ============================================================================

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.odai_phase(bigint)                  set schema private;
alter function public.answer_odai_id(bigint)               set schema private;
alter function public.answer_author_id(bigint)             set schema private;
alter function public.pickable_answer_count(bigint, uuid)  set schema private;
alter function public.maybe_close_voting(bigint)           set schema private;

-- RLS ポリシー式は関数を OID で参照しているため、スキーマを移動しても
-- 自動的に追従する（pg_policies で確認済み）。
-- submit_picks の本文は "public.odai_phase" のようにスキーマを直書きして
-- いるため、スキーマ移動だけでは追従しない。呼び先を書き換えて再作成する。
create or replace function public.submit_picks(p_odai_id bigint, p_answer_ids bigint[])
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_given    int  := coalesce(array_length(p_answer_ids, 1), 0);
  v_required int;
begin
  if v_uid is null then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;

  -- 実際の遮断は picks の RLS が行うが、先に見て分かるエラーを返しておく
  if private.odai_phase(p_odai_id) is distinct from 'voting' then
    raise exception 'このお題は投票中ではありません' using errcode = 'P0001';
  end if;

  if (select count(distinct x) from unnest(p_answer_ids) x) <> v_given then
    raise exception '同じ回答を複数の順位に選ぶことはできません' using errcode = 'P0001';
  end if;

  v_required := least(3, private.pickable_answer_count(p_odai_id, v_uid));
  if v_required = 0 then
    raise exception '選べる回答がありません' using errcode = 'P0001';
  end if;
  if v_given <> v_required then
    raise exception '%位まで選んでください', v_required using errcode = 'P0001';
  end if;

  delete from public.picks p
   where p.odai_id = p_odai_id and p.voter_id = v_uid;

  insert into public.picks (odai_id, voter_id, answer_id, rank)
  select p_odai_id, v_uid, t.answer_id, t.ord::smallint
  from unnest(p_answer_ids) with ordinality as t(answer_id, ord);

  perform private.maybe_close_voting(p_odai_id);
end
$$;

grant execute on function public.submit_picks(bigint, bigint[]) to authenticated;

-- ついでに: search_path を固定していなかったトリガー関数を締める
create or replace function public.users_freeze_privileged_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null then
    if new.role is distinct from old.role then
      raise exception 'role は変更できません' using errcode = '42501';
    end if;
    new.id         := old.id;
    new.created_at := old.created_at;
  end if;
  return new;
end
$$;
