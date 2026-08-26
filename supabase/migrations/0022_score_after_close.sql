-- ============================================================================
-- 結果発表後でも、まだ採点していない人は採点できるようにする。
--
-- 実測（2026-08-26 / 本番）で、解禁106件のうち51件（48%）が一度も採点されない
-- まま終わっていた。しかも解禁の63%は自動解禁で、本人が見ていない間に起きる。
-- 気づいたときにはお題が発表済みで、そこから先は `phase = 'open'` を要求する
-- RLS に阻まれて何もできない —— その人の選好は永久に失われる。
--
-- ただし「発表画面に採点ボタンを足す」だけでは駄目で、それをやると
-- README §4.3 が禁じている2つがそのまま起きる:
--
--   * 発表後は author_id が見えている → 中身ではなく**書いた人で選ぶ**
--     （picks が人気投票に化ける）
--   * 発表後は他人の picks も見えている → **同調したログ**になる
--
-- 汚染の原因は「いつ採点したか」ではなく「**採点する時点で何が見えていたか**」。
-- なので時刻ではなく状態で分ける —— 0010/0011 が回答と解禁でやったのと同じ形。
--
--   採点していない人がお題を開く → 回答は匿名のまま・他人の picks は伏せたまま
--   → 採点する（または「結果を見る」を選ぶ）→ そこで初めて結果が見える
--
-- 「結果を見た」を明示的な事実として持たせるため result_reveals を置く。
-- これは answer_unlocks と同じ**片道切符**で、一度見たらそのお題はもう採点
-- できない（見た後の採点は、上の2つの汚染そのものだから）。
--
-- 対象は「**発表前にそのお題を解禁していて、まだ採点していない人**」だけに絞る。
--   * 解禁していない人（新規メンバー含む）は今まで通り、開けばすぐ結果が見える。
--     参加していないお題の結果まで採点で塞ぐと、新しい人が「読んで面白がる」
--     入口を失う。
--   * すでに採点を終えた人も今まで通り。もう結果を見ているので選び直させない。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 「結果を見た」の記録（片道切符）
-- ----------------------------------------------------------------------------

create table public.result_reveals (
  odai_id     bigint not null references public.odai (id) on delete cascade,
  user_id     uuid not null references public.users (id),
  revealed_at timestamptz not null default now(),
  primary key (odai_id, user_id)
);

comment on table public.result_reveals is
  '「このお題の結果を見た」の宣言。answer_unlocks と同じ片道切符で、'
  '入った時点からそのお題には採点できなくなる（見てからの採点は '
  '「誰が書いたか」「他人が何を選んだか」を知った上の選択になり、'
  'README §4.3 が禁じている人気投票化・同調ログ化そのものになるため）。';

create index result_reveals_odai_id_idx on public.result_reveals (odai_id);

alter table public.result_reveals enable row level security;

-- 自分の行だけ。誰が結果を見たかは他人に見せない（見せる必要が無く、
-- 「まだ見ていない人」が誰かは採点の圧力になりうる）。
create policy result_reveals_select on public.result_reveals
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy result_reveals_insert on public.result_reveals
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.odai_phase(odai_id) = 'closed'
  );

-- UPDATE / DELETE のポリシーは置かない（片道切符。answer_unlocks と同じ）。
revoke all on public.result_reveals from anon, authenticated;
grant select, insert on public.result_reveals to authenticated;

create or replace function private.has_revealed(p_odai_id bigint, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.result_reveals r
    where r.odai_id = p_odai_id and r.user_id = p_uid
  )
$$;

comment on function private.has_revealed(bigint, uuid) is
  '指定ユーザーがそのお題の結果を見たか。';

revoke all on function private.has_revealed(bigint, uuid) from public, anon;
grant execute on function private.has_revealed(bigint, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. 「その人に結果を見せてよいか」——この1つの述語で全部を決める
--
-- answers_view の author_id、picks_select、pick_skips_select が同じ条件を
-- 見るようにしておく。3箇所に別々の式を書くと、どれか1つがズレた瞬間に
-- 「名前は伏せているのに picks から誰の回答か分かる」が起きる。
-- ----------------------------------------------------------------------------

create or replace function private.results_visible(p_odai_id bigint, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    private.odai_phase(p_odai_id) = 'closed'
    and (
      -- そのお題に参加していない人（解禁していない）は、今まで通りすぐ見える。
      not private.has_unlocked(p_odai_id, p_uid)
      -- 自分で「結果を見る」を選んだ
      or private.has_revealed(p_odai_id, p_uid)
      -- もう採点を終えている（選んだ or「選ぶ回答なし」）
      or exists (
        select 1 from public.picks k
        where k.odai_id = p_odai_id and k.voter_id = p_uid
      )
      or private.has_skipped(p_odai_id, p_uid)
    )
$$;

comment on function private.results_visible(bigint, uuid) is
  'そのユーザーにそのお題の結果（誰が書いたか・誰が誰を選んだか）を見せてよいか。'
  'closed であることに加えて「参加していない or 結果を見ると宣言した or 採点を終えた」'
  'のいずれかが要る。answers_view / picks_select / pick_skips_select はこれ1つを見る。';

revoke all on function private.results_visible(bigint, uuid) from public, anon;
grant execute on function private.results_visible(bigint, uuid) to authenticated;

-- 発表後に採点できるか。「解禁済みなのに、まだ結果を見ていない」が条件。
-- results_visible が偽であることが、そのまま「まだ何も知らない状態」の証明になる。
create or replace function private.can_score_late(p_odai_id bigint, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    private.odai_phase(p_odai_id) = 'closed'
    and private.has_unlocked(p_odai_id, p_uid)
    and not private.results_visible(p_odai_id, p_uid)
$$;

comment on function private.can_score_late(bigint, uuid) is
  '結果発表後だが、そのユーザーはまだ採点できるか（発表前に解禁していて、'
  'かつまだ結果を見ていない）。picks / pick_skips の INSERT はこれを見る。';

revoke all on function private.can_score_late(bigint, uuid) from public, anon;
grant execute on function private.can_score_late(bigint, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. 既存の closed なお題は、全員「もう見た」として埋める
--
-- このマイグレーション以前に発表されたお題については、誰が結果を見たかの記録が
-- 無い。見ていない人もいるはずだが、**見たかどうかを知る手段が無い**。
-- 分からないまま採点を開けると「実は既に結果を見ていた人の採点」が教師データに
-- 混ざりうるので、安全側に倒して全員に reveal を入れておく。
-- この機能が実際に効くのは、次に発表されるお題から。
-- ----------------------------------------------------------------------------

insert into public.result_reveals (odai_id, user_id, revealed_at)
select k.odai_id, k.user_id, now()
from public.answer_unlocks k
join public.odai o on o.id = k.odai_id and o.phase = 'closed'
on conflict (odai_id, user_id) do nothing;

-- ----------------------------------------------------------------------------
-- 4. 閲覧ビュー: 結果を見ていない人には author_id を伏せたままにする
--
-- 0011 の版との違いは author_id / model_ver の条件だけ。行の絞り込み
-- （answers_select ポリシーと揃えるべき部分）は変えていない —— 回答の本文は
-- closed なら誰でも読める、のまま。伏せるのは「誰が書いたか」だけ。
-- ----------------------------------------------------------------------------

drop view public.answers_view;

create view public.answers_view
with (security_barrier = true) as
select
  a.id,
  a.odai_id,
  a.text,
  a.is_ai,
  a.created_at,
  case
    when private.results_visible(a.odai_id, (select auth.uid())) then a.author_id
    when a.author_id = (select auth.uid()) then a.author_id
    else null
  end as author_id,
  case
    when private.results_visible(a.odai_id, (select auth.uid())) then a.model_ver
    else null
  end as model_ver,
  (a.author_id = (select auth.uid())) as is_mine
from public.answers a
join public.odai o on o.id = a.odai_id
where
  a.author_id = (select auth.uid())
  or o.phase = 'closed'
  or private.has_unlocked(a.odai_id, (select auth.uid()));

comment on view public.answers_view is
  '回答の閲覧はすべてこのビュー経由。解禁する（unlock_answers）まで他人の回答は返らない。'
  'author_id は private.results_visible() が真になるまで自分の回答以外 null —— '
  '結果発表後でも、まだ採点していない人には伏せたまま（0022）。';

revoke all on public.answers_view from anon, authenticated;
grant select on public.answers_view to authenticated;

-- ----------------------------------------------------------------------------
-- 5. picks / pick_skips: 読むほうを絞り、書くほうを開ける
-- ----------------------------------------------------------------------------

-- 読む: 発表済みでも、まだ採点していない人には他人の picks を見せない。
-- 見せてしまうと、そのあとの採点が「他人に同調しただけのログ」になる。
drop policy picks_select on public.picks;
create policy picks_select on public.picks
  for select to authenticated
  using (
    voter_id = (select auth.uid())
    or private.results_visible(odai_id, (select auth.uid()))
  );

drop policy pick_skips_select on public.pick_skips;
create policy pick_skips_select on public.pick_skips
  for select to authenticated
  using (
    voter_id = (select auth.uid())
    or private.results_visible(odai_id, (select auth.uid()))
  );

-- 書く: open のあいだ（今まで通り）に加えて、発表後の「まだ採点していない人」。
drop policy picks_insert on public.picks;
create policy picks_insert on public.picks
  for insert to authenticated
  with check (
    voter_id = (select auth.uid())
    and private.answer_odai_id(answer_id) = odai_id
    and private.answer_author_id(answer_id) <> (select auth.uid())  -- 自分の回答は選べない
    and (
      (
        private.odai_phase(odai_id) = 'open'
        and private.has_unlocked(odai_id, (select auth.uid()))
      )
      or private.can_score_late(odai_id, (select auth.uid()))
    )
  );

-- 選び直し（submit_picks は delete → insert で差し替える）。
drop policy picks_delete on public.picks;
create policy picks_delete on public.picks
  for delete to authenticated
  using (
    voter_id = (select auth.uid())
    and (
      private.odai_phase(odai_id) = 'open'
      or private.can_score_late(odai_id, (select auth.uid()))
    )
  );

drop policy pick_skips_insert on public.pick_skips;
create policy pick_skips_insert on public.pick_skips
  for insert to authenticated
  with check (
    voter_id = (select auth.uid())
    and (
      (
        private.odai_phase(odai_id) = 'open'
        and private.has_unlocked(odai_id, (select auth.uid()))
      )
      or private.can_score_late(odai_id, (select auth.uid()))
    )
  );

drop policy pick_skips_delete on public.pick_skips;
create policy pick_skips_delete on public.pick_skips
  for delete to authenticated
  using (
    voter_id = (select auth.uid())
    and (
      private.odai_phase(odai_id) = 'open'
      or private.can_score_late(odai_id, (select auth.uid()))
    )
  );

-- ----------------------------------------------------------------------------
-- 6. submit_picks(): 発表後の採点を通す
--
-- 変えたのはフェーズの判定だけ。「解禁していること」「自分の回答は選べない」
-- 「1〜3件」「同じ回答を二重に選べない」はそのまま。
-- ----------------------------------------------------------------------------

create or replace function public.submit_picks(p_odai_id bigint, p_answer_ids bigint[])
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_given int  := coalesce(array_length(p_answer_ids, 1), 0);
  v_late  boolean;
  v_max   int;
begin
  if v_uid is null then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;

  v_late := private.can_score_late(p_odai_id, v_uid);

  if private.odai_phase(p_odai_id) is distinct from 'open' and not v_late then
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

comment on function public.submit_picks(bigint, bigint[]) is
  '採点を送る（0件なら「選ぶ回答なし」の宣言）。open のあいだと、'
  '発表後でもまだ結果を見ていない解禁済みの人（private.can_score_late）が呼べる。';

revoke all on function public.submit_picks(bigint, bigint[]) from public, anon;
grant execute on function public.submit_picks(bigint, bigint[]) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. 結果を見る（片道切符）
--
-- 採点せずに結果だけ見たい人の逃げ道。押すと以後そのお題には採点できない。
-- 採点を「済ませないと結果が見られない」形にはしない —— 見たいだけの人に
-- 無理やり選ばせると、中身を読まずに適当に選んだ picks が入る。
-- それは採点0より悪い（README §4.3「中身を見ずに採点できると、picks が
-- 読んだ上での選好でなくなる」）。
-- ----------------------------------------------------------------------------

create or replace function public.reveal_results(p_odai_id bigint)
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

  if private.odai_phase(p_odai_id) is distinct from 'closed' then
    raise exception 'このお題はまだ発表されていません' using errcode = 'P0001';
  end if;

  insert into public.result_reveals (odai_id, user_id)
  values (p_odai_id, v_uid)
  on conflict (odai_id, user_id) do nothing;
end
$$;

comment on function public.reveal_results(bigint) is
  '結果を見る。片道切符で、以後そのお題には採点できなくなる。'
  'すでに採点を終えた人・そのお題を解禁していない人は呼ぶ必要が無い'
  '（private.results_visible が最初から真）。';

revoke all on function public.reveal_results(bigint) from public, anon;
grant execute on function public.reveal_results(bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. 「発表後だがまだ採点できるお題」の一覧
--
-- 一覧（/）で「採点できます」を出すために要る。集計値ではなく自分の状態なので
-- security definer で自分の分だけを返す。
-- ----------------------------------------------------------------------------

create or replace function public.my_scoreable_closed_odai()
returns table (odai_id bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id
  from public.odai o
  where o.phase = 'closed'
    and private.can_score_late(o.id, auth.uid())
$$;

comment on function public.my_scoreable_closed_odai() is
  '発表済みだが、呼んだ本人はまだ採点できるお題の id。'
  '一覧で「採点できます」を出すために使う。';

revoke all on function public.my_scoreable_closed_odai() from public, anon;
grant execute on function public.my_scoreable_closed_odai() to authenticated;
