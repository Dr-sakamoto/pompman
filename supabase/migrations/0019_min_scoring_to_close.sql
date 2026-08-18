-- ============================================================================
-- 採点が足りないお題は結果発表しない。
--
-- 0013 で自動締め切りを入れて「放っておいても発表される」ようにしたが、
-- そのとき置いた条件は2本とも**採点の量を見ていない**。
--
--   (a) 参加者が全員やり切った ... 全員が採点を終えているので量は自動的に足りる
--   (b) 作成から auto_close_age() 経過 ... 回答が1件でもあれば閉じる
--
-- 問題は (b)。回答は集まったが誰も採点しなかったお題も、3日経てばそのまま
-- 結果発表になる。そこで起きることは:
--
--   * 全員0点の順位表が出る。「みんなが選んだ結果」ではなく、ただの空欄。
--   * 選好ペアが1組も取れない（このサイトの本体は教師データなので、これは
--     そのお題から得られるものが0だったということ）。
--   * それでいて**匿名は解除される**。誰が書いたかは一度出したら戻せない。
--     結果発表は1回しか切れない札で、採点0のお題はその札を空振りで使う。
--
-- 極端な形は「参加者1人・回答3件」のお題。書いた本人は自分の回答を選べない
-- ので採点が原理的に成立しないのに、寿命が来ると発表されていた。
--
-- そこで**採点の量に下限を置き、満たすまでは閉じない**。待つ相手が
-- 「時間」から「採点」に変わるだけで、フェーズも操作も増えない。
--
-- 副作用として、寿命を過ぎたお題は「最低人数目の採点が入った瞬間」に発表
-- される（picks / pick_skips の INSERT トリガーがその場で判定するため。0013 §3）。
-- 採点しに行くことが、そのまま結果を出すスイッチになる。
--
-- 発表されないまま残り続けるお題はありうる（誰も採点しに来ない場合）。それは
-- 「発表するに値するものがまだ無い」という状態そのもので、出題者は
-- 0012 の削除でいつでも片付けられる。空振りの発表より、待たせるほうを採る。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. しきい値
--
-- 0013 と同じく関数に切り出す（判定・表示・テストで同じ値を参照するため）。
-- UI 側の表記（src/lib/types.ts の MIN_SCORERS_TO_CLOSE）と必ず揃えること。
--
-- 2人にしてある理由: 1人の採点だけで決まる順位は「みんなが選んだ」ではなく
-- その1人の好みで、結果発表としても教師データとしても意味が変わる。2人あれば
-- 少なくとも複数の目を通った比較になる。3人以上を求めると、参加者が少ない日の
-- お題が発表されないまま溜まるので、下限は下限らしく最小の2にしておく。
-- ----------------------------------------------------------------------------

create or replace function private.min_scorers()
returns int language sql immutable as $$ select 2 $$;

comment on function private.min_scorers() is
  '結果発表に要る最低採点人数。これを下回るお題は自動・手動どちらでも閉じない。';

revoke all on function private.min_scorers() from public, anon;

-- ----------------------------------------------------------------------------
-- 1. 採点を終えた人数
--
-- 「採点を終えた」は picks を1件以上入れた人と、pick_skips で「選ぶ回答なし」を
-- 宣言した人の両方（0016 と同じ線引き）。
--
-- skip を数に入れるのは、あれが**未採点ではなく採点結果**だから —— 全員が
-- 何も選ばなかったお題は「全員一致でスベっている」という事実の記録で、
-- 0票の回答を結果から消さないのと同じ理由（src/lib/scoring.ts の tally）で
-- 価値がある。数えないのは「まだ見てもいない人」だけ。
--
-- 採点者は必ず参加者（解禁には回答が要る）なので、participants と突き合わせる
-- 必要はない。picks と pick_skips は同じ人について排他なので union で足りる。
-- ----------------------------------------------------------------------------

create or replace function private.scorer_count(p_odai_id bigint)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from (
    select k.voter_id from public.picks k where k.odai_id = p_odai_id
    union
    select s.voter_id from public.pick_skips s where s.odai_id = p_odai_id
  ) t
$$;

comment on function private.scorer_count(bigint) is
  'そのお題で採点を終えた人数。1件以上選んだ人と「選ぶ回答なし」を宣言した人の合計。';

revoke all on function private.scorer_count(bigint) from public, anon;

-- ----------------------------------------------------------------------------
-- 2. 自動締め切りに下限を足す
--
-- 0016 版との差は、回答0件のチェックのすぐ後ろに置いた最低採点量の門だけ。
-- (a) と (b) の手前に1つ置く形にしてある —— (a) は「参加者2人以上が全員
-- 採点済み」なので構造上この門を必ず通る（通らないなら (a) の条件のほうが
-- 壊れている）。門を経路ごとに書き分けないほうが、条件が1箇所で読める。
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

  -- 採点が足りないお題は、寿命が来ていても閉じない（0019）。
  if private.scorer_count(p_odai_id) < private.min_scorers() then
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
  'いずれも回答1件以上かつ採点を終えた人が min_scorers() 人以上が前提）を満たしていれば closed へ進める。'
  '「採点し終えた」には picks を入れた場合と pick_skips で明示的に0件を宣言した場合の両方を含む。';

revoke all on function private.maybe_close_odai(bigint) from public, anon;

-- ----------------------------------------------------------------------------
-- 3. 手動の締め切りにも同じ下限をかける
--
-- 「早く進めたい人の逃げ道」として出題者の close_odai() は残してあるが（0013）、
-- 逃げ道から出ると採点0の発表ができてしまうなら下限は下限として機能しない。
-- 自動と同じ門を通す。エラー文にいまの人数を入れて、あと何人待てばいいかを
-- その場で分かるようにする。
--
-- 「採点が集まらないお題を片付けたい」は削除（0012）で足りる。発表は
-- 匿名を解除する片道の操作なので、片付けの手段としては使わせない。
-- ----------------------------------------------------------------------------

create or replace function public.close_odai(p_odai_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_author  uuid;
  v_phase   text;
  v_count   int;
  v_scorers int;
  v_min     int := private.min_scorers();
begin
  if v_uid is null then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;

  select o.author_id, o.phase into v_author, v_phase
  from public.odai o where o.id = p_odai_id for update;

  if not found then
    raise exception 'お題が見つかりません' using errcode = 'P0002';
  end if;
  if v_author <> v_uid then
    raise exception '結果を発表できるのは出題者だけです' using errcode = '42501';
  end if;
  if v_phase <> 'open' then
    raise exception 'このお題はすでに結果発表済みです' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.answers a where a.odai_id = p_odai_id;
  if v_count = 0 then
    raise exception '回答が1件も無いお題は結果発表できません' using errcode = 'P0001';
  end if;

  v_scorers := private.scorer_count(p_odai_id);
  if v_scorers < v_min then
    raise exception '採点した人が%人になるまで結果発表できません（いま%人）', v_min, v_scorers
      using errcode = 'P0001';
  end if;

  update public.odai
     set phase = 'closed', closed_at = now()
   where id = p_odai_id;
end
$$;

revoke all on function public.close_odai(bigint) from public, anon;
grant execute on function public.close_odai(bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. 進捗にも「採点を終えた人数」を出す
--
-- 0015 の約束（判定と表示は同じ数え方をする / 条件を変えるときは両方直す）に
-- 従って、判定に足した下限を表示側にも足す。judged が min_scorers() に届いて
-- いないお題は、時間バーが右端まで行っても発表されない —— 画面がそれを
-- 「あと0分」と言い続けると、いちばん見せたくない嘘になる。
--
-- scored（1件以上選んだ人）はそのまま残す。judged との差がそのまま
-- 「選ぶ回答が無かった人」の数になる。どちらも人数だけで中身は含まない。
-- ----------------------------------------------------------------------------

drop function if exists public.odai_close_progress();

create function public.odai_close_progress()
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
  judged           int,         -- そのうち採点を終えた人数（scored ＋「選ぶ回答なし」）
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
      -- private.scorer_count() と同じもの（選んだ人＋「選ぶ回答なし」を宣言した人）。
      -- 採点者は必ず参加者なので、参加者を回すこの集計で数が一致する。
      (count(*) filter (where pp.picks > 0 or pp.skipped))::int as judged,
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
    coalesce(st.judged, 0),
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
  'finished は picks を入れた場合と pick_skips（何も選ばない）の両方を「終えた」に数える。'
  'judged が min_scorers() 未満のお題は、時間バーが右端まで行っても発表されない。';

revoke all on function public.odai_close_progress() from public, anon;
grant execute on function public.odai_close_progress() to authenticated;
