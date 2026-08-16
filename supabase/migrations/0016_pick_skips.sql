-- ============================================================================
-- 「何も選ばない」で採点を終える。
--
-- 今までは submit_picks() が v_given >= 1 を要求していたので、面白い回答が
-- 1件も無いと感じた採点者は「何も送らない」ことしかできず、それは DB 上
-- 「まだ採点していない」と見分けが付かなかった。maybe_close_odai() の
-- v_pending は「採点できる状態なのに picks が無い人」を待ち続けるので、
-- そのお題はこの人のぶんだけ寿命（auto_close_age）まで発表されずに残る。
--
-- 「1件も選ばなかった」を明示的な事実として持たせるため、picks とは別に
-- pick_skips を置く。picks を入れる（選び直す）と skip は消え、skip を
-- 宣言する（何も選ばない）と picks は消える —— 常にどちらか一方だけが
-- そのお題・その人の最新状態を表す。
-- ============================================================================

create table public.pick_skips (
  odai_id    bigint not null references public.odai (id) on delete cascade,
  voter_id   uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  primary key (odai_id, voter_id)
);

comment on table public.pick_skips is
  '「面白い回答が無かった」という明示的な採点終了の宣言。picks が0件なのが'
  '「未採点」なのか「選んだ結果ゼロ」なのかを区別するために置く。'
  'picks を入れると消え、picks を全部消して skip すると picks 側が消える（排他）。';

create index pick_skips_odai_id_idx on public.pick_skips (odai_id);

alter table public.pick_skips enable row level security;

create policy pick_skips_select on public.pick_skips
  for select to authenticated
  using (
    voter_id = (select auth.uid())
    or private.odai_phase(odai_id) = 'closed'
  );

-- 実際の作成・削除は submit_picks() 経由。RLS はそれと同じ条件を持たせておく
-- （0001 からの約束: RPC 側だけに条件を置くと、RLS 単体では守れなくなる）。
create policy pick_skips_insert on public.pick_skips
  for insert to authenticated
  with check (
    voter_id = (select auth.uid())
    and private.odai_phase(odai_id) = 'open'
    and private.has_unlocked(odai_id, (select auth.uid()))
  );

create policy pick_skips_delete on public.pick_skips
  for delete to authenticated
  using (
    voter_id = (select auth.uid())
    and private.odai_phase(odai_id) = 'open'
  );

revoke all on public.pick_skips from anon, authenticated;
grant select, insert, delete on public.pick_skips to authenticated;

-- ----------------------------------------------------------------------------
-- 1. skip 済みかどうかの判定（has_unlocked と同じ形）
-- ----------------------------------------------------------------------------

create or replace function private.has_skipped(p_odai_id bigint, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.pick_skips s
    where s.odai_id = p_odai_id
      and s.voter_id = p_uid
  )
$$;

comment on function private.has_skipped(bigint, uuid) is
  '指定ユーザーがそのお題を「何も選ばない」で終えたか。';

revoke all on function private.has_skipped(bigint, uuid) from public, anon;
grant execute on function private.has_skipped(bigint, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. submit_picks(): 0件の送信を「何も選ばない」として受け付ける
-- ----------------------------------------------------------------------------

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

  v_max := least(3, private.pickable_answer_count(p_odai_id, v_uid));
  if v_max = 0 then
    raise exception '選べる回答がありません' using errcode = 'P0001';
  end if;

  if v_given = 0 then
    delete from public.picks p
     where p.odai_id = p_odai_id and p.voter_id = v_uid;

    insert into public.pick_skips (odai_id, voter_id)
    values (p_odai_id, v_uid)
    on conflict (odai_id, voter_id) do nothing;

    return;
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

revoke all on function public.submit_picks(bigint, bigint[]) from public, anon;
grant execute on function public.submit_picks(bigint, bigint[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. 自動締め切りの「待ち」判定に skip を合流させる
--
-- maybe_close_odai() と odai_close_progress() は同じ条件を2箇所に持つ約束
-- （0015 の header 参照）。picks が無くても skip 済みなら「もう次の操作が
-- 無い」人として扱う。
-- ----------------------------------------------------------------------------

create or replace function private.maybe_close_odai(p_odai_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phase        text;
  v_created_at   timestamptz;
  v_answers      int;
  v_participants int;
  v_pending      int;
begin
  select o.phase, o.created_at into v_phase, v_created_at
  from public.odai o
  where o.id = p_odai_id
  for update;

  if not found or v_phase <> 'open' then
    return;
  end if;

  -- close_odai() と同じ最低条件。発表するものが無いお題は閉じない。
  select count(*) into v_answers from public.answers a where a.odai_id = p_odai_id;
  if v_answers = 0 then
    return;
  end if;

  -- (b) 寿命切れ
  if now() >= v_created_at + private.auto_close_age() then
    update public.odai set phase = 'closed', closed_at = now() where id = p_odai_id;
    return;
  end if;

  -- (a) 参加者が全員やり切った。
  -- まだ全員に回答の機会が回っていないうちは、やり切ったように見えても閉じない。
  if now() < v_created_at + private.auto_unlock_idle() then
    return;
  end if;

  select count(distinct a.author_id) into v_participants
  from public.answers a where a.odai_id = p_odai_id;

  -- 1人しか書いていないお題を「全員やり切った」で閉じると、他の人が
  -- 回答する前に発表されてしまう。寿命（b）まで待つ。
  if v_participants < 2 then
    return;
  end if;

  select count(*) into v_pending
  from (select distinct a.author_id from public.answers a where a.odai_id = p_odai_id) p
  where not private.has_unlocked(p_odai_id, p.author_id)
     or (
       -- 採点できる状態なのに、まだ1件も選ばず・skip もしていない
       private.pickable_answer_count(p_odai_id, p.author_id) > 0
       and not exists (
         select 1 from public.picks k
         where k.odai_id = p_odai_id and k.voter_id = p.author_id
       )
       and not private.has_skipped(p_odai_id, p.author_id)
     );

  if v_pending > 0 then
    return;
  end if;

  update public.odai set phase = 'closed', closed_at = now() where id = p_odai_id;
end
$$;

comment on function private.maybe_close_odai(bigint) is
  '自動締め切りの条件（参加者が全員解禁・採点し終えた、または作成から auto_close_age() 経過。'
  'いずれも回答1件以上が前提）を満たしていれば closed へ進める。'
  '「採点し終えた」には picks を入れた場合と pick_skips で明示的に0件を宣言した場合の両方を含む。';

revoke all on function private.maybe_close_odai(bigint) from public, anon;

-- picks / pick_skips どちらの INSERT でも即座に締め切り判定させる（0013 §3 と同じ理由）。
drop trigger if exists pick_skips_maybe_close_after_insert on public.pick_skips;
create trigger pick_skips_maybe_close_after_insert
  after insert on public.pick_skips
  referencing new table as inserted
  for each statement execute function private.maybe_close_after_insert();

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
      )                                                     as picks,
      private.has_skipped(a.odai_id, a.author_id)           as skipped
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
      -- maybe_close_odai() の v_pending（未解禁 or「採点できるのに未採点かつ未skip」）の裏返し。
      (count(*) filter (
        where pp.unlocked and (pp.pickable = 0 or pp.picks > 0 or pp.skipped)
      ))::int                                       as finished,
      (sum(pp.answers))::bigint                     as answer_count,
      -- 仕様書 §8 (A) が返す行数と同じ値。ある採点者の1つの pick は、
      -- 「自分以外が書いた回答」のうち自分が選ばなかったものすべてと対になる。
      -- 何も選ばなかった（skip）人の picks は0件なので、寄与も0のまま。
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
  '判定の本体は private.maybe_close_odai()。条件を変えるときは必ず両方直すこと。'
  'finished は picks を入れた場合と pick_skips（何も選ばない）の両方を「終えた」に数える。';

revoke all on function public.odai_close_progress() from public, anon;
grant execute on function public.odai_close_progress() to authenticated;
