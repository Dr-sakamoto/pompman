-- ============================================================================
-- 解禁と締め切りを自動で進める。
--
-- 実測（本番 8人 / お題6件 / 回答18件）で分かったこと:
--
--   * 8人中7人が回答を書いている。書く手は止まっていない。
--   * にもかかわらず解禁（answer_unlocks）は2人、picks は1人 7件だけ。
--     6人は他人の回答を1件も見ないまま止まっている。
--   * お題6件はすべて open。結果発表が一度も起きていない。
--
-- 詰まっているのは回答ではなく、その先の2箇所だった。
--
--   1. 解禁が手動の片道切符なので、「後でもっといい回答を思いつくかも」と
--      思った人は押さない。押さない限り他人の回答も採点も見えないので、
--      全員が待った結果、誰も採点しない。
--   2. 締め切りが出題者の手動操作だけなので、結果発表が一度も起きない。
--      誰が書いたか分かる瞬間＝戻ってくる理由が発生しない。
--
-- どちらも「放っておくと進まない」という同じ形をしている。0007 は回答受付に
-- 対して同じ手当て（全員終わった or N日経過で自動遷移）を入れていたが、
-- 1人1回答・3フェーズ制に依存していたため 0009 で撤去された。ここで
-- open/closed の2フェーズ・多答可のモデルに合わせて作り直す。
--
-- 守るものは変えない。「そのお題に自分が書いたすべての回答が、他人を見る前に
-- 書かれている」は本サイトのデータ品質の核なので、自動解禁でも壊さない
-- （§1 参照。自動解禁は「最後の回答から一定時間経った人」だけを対象にするので、
--  解禁時刻は必ずその人の全回答より後になる。仕様書 §8 (D) の検証は 0件のまま）。
--
-- 変えるのは「決断の重さ」だけ。解禁は DB 上は今までどおり片道切符で、
-- 手動の unlock_answers() / close_odai() もそのまま残す（早く進めたい人の
-- 逃げ道として）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. しきい値
--
-- 関数に切り出しておく: 判定側とテスト側で同じ値を参照でき、後から変えるとき
-- 1箇所で済む。UI 側の表記（src/lib/types.ts の AUTO_UNLOCK_IDLE_HOURS /
-- AUTO_CLOSE_AGE_DAYS）と必ず揃えること。
-- ----------------------------------------------------------------------------

-- 「もう出し切った」とみなすまでの無音時間。この人がそのお題に最後の回答を
-- 書いてからこれだけ経ったら、書き終えたものとして解禁する。
--
-- 夜に書いた人が翌朝には採点できる長さにしてある。短すぎると考え中の人を
-- 締め出す（解禁＝以後そのお題に追加できない）が、長くすると「誰も採点しない」
-- 状態がそのぶん続く。まだ1周も完走していない今は、回り始めるほうを優先する。
create or replace function private.auto_unlock_idle()
returns interval language sql immutable as $$ select interval '12 hours' $$;

-- お題そのものの寿命。ここまで来たら誰が何をしていようと結果を発表する。
-- 「全員やり切った」（§2）のほうが先に効くのが普通で、これは最後の保険。
--
-- 結果発表＝誰が書いたか分かる瞬間＝戻ってくる理由なので、これが起きる頻度が
-- そのままお題の供給ペースに効く。週に何度か回る長さにしてある。
create or replace function private.auto_close_age()
returns interval language sql immutable as $$ select interval '3 days' $$;

comment on function private.auto_unlock_idle() is
  '自動解禁のしきい値。その人の最終回答からこれだけ経つと「出し切った」とみなす。';
comment on function private.auto_close_age() is
  '自動締め切りのしきい値。お題の作成からこれだけ経つと結果を発表する。';

revoke all on function private.auto_unlock_idle() from public, anon;
revoke all on function private.auto_close_age()  from public, anon;

-- ----------------------------------------------------------------------------
-- 1. 自動解禁
--
-- 対象は「そのお題に回答していて、まだ解禁しておらず、最後の回答から
-- auto_unlock_idle() 以上経っている人」。1人ずつ独立に判定する —— 解禁は
-- 元々「フェーズ（時間）ではなく1人ずつの状態」で持っている概念なので
-- （0011 参照）、自動化もその粒度に合わせる。他人が何をしていようと関係ない。
--
-- 「回答した人だけ」が重要: 未回答の人を解禁すると、その人はそのお題に
-- 二度と回答できなくなる（answers_insert が has_unlocked で塞がれる）。
-- 手動の unlock_answers() が has_answered を要求しているのと同じ理由。
--
-- 保証が壊れないこと: unlocked_at = now() に対し、対象者の全回答は
--   max(created_at) <= now() - auto_unlock_idle()
-- を満たしている。つまり全回答が解禁より前にある。仕様書 §8 (D) の
-- 「解禁後に書かれた回答」は引き続き0件。
-- ----------------------------------------------------------------------------

create or replace function private.maybe_unlock_odai(p_odai_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phase text;
begin
  select o.phase into v_phase from public.odai o where o.id = p_odai_id;
  if not found or v_phase <> 'open' then
    return;
  end if;

  insert into public.answer_unlocks (odai_id, user_id)
  select a.odai_id, a.author_id
  from public.answers a
  where a.odai_id = p_odai_id
  group by a.odai_id, a.author_id
  having max(a.created_at) <= now() - private.auto_unlock_idle()
  on conflict (odai_id, user_id) do nothing;  -- すでに手動で解禁済みの人は触らない
end
$$;

comment on function private.maybe_unlock_odai(bigint) is
  '最終回答から auto_unlock_idle() 以上経った回答者を自動で解禁する。'
  '未回答の人は対象外（解禁すると二度と回答できなくなるため）。';

revoke all on function private.maybe_unlock_odai(bigint) from public, anon;

-- ----------------------------------------------------------------------------
-- 2. 自動締め切り
--
-- どちらかを満たしたら結果発表へ進める。
--
--   (a) 参加者が全員やり切った —— 参加者（そのお題に回答した人）が2人以上いて、
--       全員が解禁済みで、採点できる人は全員採点済み。もう誰にも次の操作が
--       残っていないので、待つ理由がない。
--   (b) 作成から auto_close_age() 経過 —— 回答が1件でもあれば発表する。
--
-- 「参加者」を母数にするのは、登録メンバー全員を母数にすると一度も触って
-- いない人がいるだけで永久に成立しないため（実際 8人中1人は回答0件）。
-- 0007 は「回答者数 >= 登録メンバー数」で判定していたが、あれは1人1回答が
-- 前提だったから成立していた。多答可の今は人数の比較そのものが成り立たない。
--
-- (a) の「採点できる人は」の但し書き: 自分の回答は選べないので、参加者が
-- 実質1人だけのお題では pickable が0になり、採点しようがない。採点でき
-- ない人を待つと永久に閉じないので、母数から外す。
--
-- (a) には最低寿命を課す。そうしないと、早い2人が出してすぐ手動で解禁・採点
-- した時点で「参加者は全員やり切った」が成立し、まだ開いてもいない残りの
-- メンバーの目の前でお題が閉じてしまう。auto_unlock_idle()（＝自動解禁が
-- 効き始めるまでの時間）だけは必ず開けておけば、全員に最低1日の猶予が出る。
--
-- close_odai() と同じく、回答が0件のお題は閉じない（発表するものが無い）。
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
       -- 採点できる状態なのに、まだ1件も選んでいない
       private.pickable_answer_count(p_odai_id, p.author_id) > 0
       and not exists (
         select 1 from public.picks k
         where k.odai_id = p_odai_id and k.voter_id = p.author_id
       )
     );

  if v_pending > 0 then
    return;
  end if;

  update public.odai set phase = 'closed', closed_at = now() where id = p_odai_id;
end
$$;

comment on function private.maybe_close_odai(bigint) is
  '自動締め切りの条件（参加者が全員解禁・採点し終えた、または作成から auto_close_age() 経過。'
  'いずれも回答1件以上が前提）を満たしていれば closed へ進める。';

revoke all on function private.maybe_close_odai(bigint) from public, anon;

-- ----------------------------------------------------------------------------
-- 3. 採点が入った瞬間に締め切りを判定する
--
-- (a) の「全員やり切った」は最後の1人が採点した瞬間に成立する。そこで即座に
-- 発表まで進めたい —— 採点し終えてすぐ結果が出るのが、いちばん戻ってきたく
-- なる形なので。掃除（§4）を待つと最大1回の画面表示ぶん遅れる。
--
-- submit_picks() は delete → insert で採点をやり直すので、行ごとに呼ぶと
-- 同じ判定を最大3回することになる。文単位のトリガーに遷移テーブルを付けて
-- 1回で済ませる。
--
-- 解禁のほうにもトリガーを置く: 最後の1人が解禁したとき、その人が「採点で
-- きない」（pickable = 0）なら、その瞬間に (a) が成立しうる。
-- ----------------------------------------------------------------------------

create or replace function private.maybe_close_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in select distinct odai_id from inserted loop
    perform private.maybe_close_odai(r.odai_id);
  end loop;
  return null;
end
$$;

comment on function private.maybe_close_after_insert() is
  'picks / answer_unlocks の INSERT 後に、そのお題の自動締め切り条件を判定する。';

drop trigger if exists picks_maybe_close_after_insert on public.picks;
create trigger picks_maybe_close_after_insert
  after insert on public.picks
  referencing new table as inserted
  for each statement execute function private.maybe_close_after_insert();

drop trigger if exists answer_unlocks_maybe_close_after_insert on public.answer_unlocks;
create trigger answer_unlocks_maybe_close_after_insert
  after insert on public.answer_unlocks
  referencing new table as inserted
  for each statement execute function private.maybe_close_after_insert();

revoke all on function private.maybe_close_after_insert() from public, anon;

-- ----------------------------------------------------------------------------
-- 4. 時間経過ぶんの掃除
--
-- 自動解禁も寿命による締め切りも「時間が経った」ことが引き金なので、
-- DB 側にはそれを知らせるイベントが無い（誰かが何かを INSERT するとは限らない）。
-- 0007 と同じく、ページ表示のたびに呼ぶ公開 RPC を置く。
--
-- 解禁 → 締め切りの順に回す: 自動解禁で最後の1人が解禁され、その人が採点
-- できない立場（pickable = 0）なら、同じ掃除の中で締め切りまで成立しうる。
-- ----------------------------------------------------------------------------

create or replace function public.sweep_odai_deadlines()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in select id from public.odai where phase = 'open' loop
    perform private.maybe_unlock_odai(r.id);
    perform private.maybe_close_odai(r.id);
  end loop;
end
$$;

comment on function public.sweep_odai_deadlines() is
  'open のお題を全件見て、自動解禁と自動締め切りの条件を満たしたものを進める。ページ表示時に呼ぶ想定。';

revoke all on function public.sweep_odai_deadlines() from public, anon;
grant execute on function public.sweep_odai_deadlines() to authenticated;
