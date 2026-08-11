-- ============================================================================
-- フェーズを「回答・採点中(open)」→「結果発表(closed)」の2つに畳み、
-- 1人1回答の制限を外す。
--
-- 変更の理由:
--   * 多様な回答から選ぶのが目的なのに、1人1回答だと母数が人数で頭打ちになる。
--   * 誰が書いたかは結果発表まで伏せたままなので、回答を即座に公開しても
--     「名前で選ばれる」ことは起きない。回答受付と採点を分ける必要がない。
--   * 分けないほうが、回答した直後に採点でき、回答数もその場で分かる。
--
-- 引き換えに手放したもの（意図的）:
--   0001_init.sql は「他人の回答を見てから書くと引きずられた回答が混ざり、
--   教師データとして劣化する」として回答受付中の閲覧を禁じていた。この保証は
--   なくなる。picks（相対比較のペア）は従来どおり結果発表まで非公開なので、
--   「他人の採点を見てから採点する」ほうの汚染は引き続き防いでいる。
--
-- 変わらないもの:
--   * picks.voter_id は落とさない
--   * answers は UPDATE も DELETE もできない（0票の回答も資産）
--   * ベスト3選出（絶対評価にはしない）
--   * 結果発表まで author_id は自分の回答以外 null
--
-- このマイグレーションは 0007_auto_close_answers.sql / 0008_answering_progress.sql
-- と並行で作られたブランチをマージしたもの。あちらは「回答受付フェーズを、
-- 全員回答 or 3日経過で自動的に投票フェーズへ進める」機能で、
--   * 回答者数と登録メンバー数を比べる（＝1人1回答が前提）
--   * answering → voting という遷移がある（＝この2つを1つの open に畳む前提）
-- の両方に依存している。どちらも本マイグレーションで崩すので、そのまま両立しない。
-- 0番でその機能一式を先に撤去してから、本題の畳み込みに入る。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. 0007_auto_close_answers.sql / 0008_answering_progress.sql の撤去
--
-- 「全員回答 or 3日経過で自動的に次のフェーズへ」という発想自体は次点で
-- 検討する価値があるが、1人1回答前提の実装をそのまま延命させると
-- 「回答者数 == 登録メンバー数」という誤った判定が残ってしまう。
-- 一旦撤去し、必要になったら open/closed の2フェーズに合わせて作り直す。
-- ----------------------------------------------------------------------------

drop trigger if exists answers_maybe_close_after_insert on public.answers;
drop function if exists private.answers_maybe_close_after_insert();
drop function if exists private.maybe_close_answers(bigint);
drop function if exists public.sweep_answer_deadlines();
drop function if exists public.answering_progress(bigint);

-- ----------------------------------------------------------------------------
-- 1. フェーズ: answering / voting / closed → open / closed
-- ----------------------------------------------------------------------------

alter table public.odai drop constraint odai_phase_check;

-- 進行中のお題（answering も voting も）は open に集約される。
-- voting だったお題はここで回答受付が再開されるが、新モデルではそれが正しい。
update public.odai set phase = 'open' where phase <> 'closed';

alter table public.odai alter column phase set default 'open';
alter table public.odai
  add constraint odai_phase_check check (phase in ('open', 'closed'));

comment on column public.odai.phase is
  'open(回答・採点中) | closed(結果発表)。遷移は close_odai() 経由のみ。';

-- 締め切りは1回だけになったので、時刻カラムも1本に畳む。
-- answers_closed_at は「回答受付が終わった時刻」＝もう存在しない概念なので落とす。
alter table public.odai rename column voting_closed_at to closed_at;
alter table public.odai drop column answers_closed_at;

comment on column public.odai.closed_at is '結果を発表した時刻。';

-- ----------------------------------------------------------------------------
-- 2. 1人1回答をやめる
-- ----------------------------------------------------------------------------

alter table public.answers drop constraint answers_one_per_author;

-- 一意制約が兼ねていた (odai_id, author_id) の引きが無くなるので張り直す。
-- 下の投稿上限トリガーが毎回この形で数える。
create index answers_odai_author_idx on public.answers (odai_id, author_id);

-- 無制限だと1人が大量投稿して採点対象を埋め尽くせてしまう。
-- 「多答できる」と「1人が場を占有する」は別なので、1お題あたりの上限を置く。
--
-- RLS の with check では防げない: ポリシー式の中から数えても、同じ INSERT 文で
-- 入った行はまだ見えないため、まとめて INSERT すれば擦り抜けられる。
-- AFTER ... FOR EACH ROW は文の終了後に走り、同じ文の行も数えられる。
create or replace function public.answers_enforce_per_author_limit()
returns trigger
language plpgsql
-- authenticated は answers を SELECT できない（閲覧は answers_view 経由）ので definer。
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.answers a
  where a.odai_id = new.odai_id
    and a.author_id = new.author_id;

  if v_count > 10 then
    raise exception '1つのお題に出せる回答は10個までです' using errcode = 'P0001';
  end if;

  return null;
end
$$;

comment on function public.answers_enforce_per_author_limit() is
  '1お題・1人あたりの回答数の上限。同じ INSERT 文で入った行も数えるため AFTER トリガー。';

drop trigger if exists answers_enforce_per_author_limit on public.answers;

create trigger answers_enforce_per_author_limit
  after insert on public.answers
  for each row execute function public.answers_enforce_per_author_limit();

-- ----------------------------------------------------------------------------
-- 3. RLS ポリシーの張り直し
-- ----------------------------------------------------------------------------

drop policy odai_insert_self on public.odai;
create policy odai_insert_self on public.odai
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and phase = 'open'
  );

-- 回答は投稿された時点で全員に見える。
-- 「誰が書いたか」は answers_view が列ごと伏せるので、行の可視性は絞らない。
drop policy answers_select on public.answers;
create policy answers_select on public.answers
  for select to authenticated
  using (true);

drop policy answers_insert on public.answers;
create policy answers_insert on public.answers
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and is_ai = false                          -- MVP では AI 投稿を受け付けない
    and private.odai_phase(odai_id) = 'open'
  );

-- UPDATE / DELETE ポリシーは引き続き置かない。回答は資産なので消させない。

drop policy picks_insert on public.picks;
create policy picks_insert on public.picks
  for insert to authenticated
  with check (
    voter_id = (select auth.uid())
    and private.odai_phase(odai_id) = 'open'
    and private.answer_odai_id(answer_id) = odai_id
    and private.answer_author_id(answer_id) <> (select auth.uid())  -- 自分の回答は選べない
  );

drop policy picks_delete on public.picks;
create policy picks_delete on public.picks
  for delete to authenticated
  using (
    voter_id = (select auth.uid())
    and private.odai_phase(odai_id) = 'open'
  );

-- picks_select は変更なし: 自分の picks か、結果発表後のみ。
-- 「他人の採点を見てから採点する」は引き続き塞がっている。

-- ----------------------------------------------------------------------------
-- 4. 閲覧ビューの張り直し
--
-- 行はもう絞らない（誰でも全回答を読める）。伏せるのは author_id / model_ver の
-- 2列だけ。answers_select ポリシーと同じ可視条件を保つ、という関係は変わらない。
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
    when o.phase = 'closed' then a.author_id
    when a.author_id = (select auth.uid()) then a.author_id
    else null
  end as author_id,
  case when o.phase = 'closed' then a.model_ver else null end as model_ver,
  (a.author_id = (select auth.uid())) as is_mine
from public.answers a
join public.odai o on o.id = a.odai_id;

comment on view public.answers_view is
  '回答の閲覧はすべてこのビュー経由。結果発表まで author_id は自分の回答以外 null。';

revoke all on public.answers_view from anon, authenticated;
grant select on public.answers_view to authenticated;

-- ----------------------------------------------------------------------------
-- 5. フェーズ遷移 / 採点の RPC
-- ----------------------------------------------------------------------------

-- 回答・採点中 → 結果発表（お題の作成者のみ）。
-- 締め切りが1回になったので close_answers / close_voting はこれ1つに畳む。
create or replace function public.close_odai(p_odai_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_author uuid;
  v_phase  text;
  v_count  int;
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

  update public.odai
     set phase = 'closed', closed_at = now()
   where id = p_odai_id;
end
$$;

-- ベスト3の提出。security invoker のまま＝ picks の RLS が本当に効いているか
-- ここでも検証されることになる。二重チェックは意図的。
--
-- 従来は「ちょうど min(3, 選べる数) 件」を強制していたが、回答が集まりきる前でも
-- 採点できるようになったので上限だけの制約にする。1件だけ選んだ状態も、
-- 後から回答が増えてから選び直すのも、どちらも有効な選好データ。
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

  -- 実際の遮断は picks の RLS が行うが、先に見て分かるエラーを返しておく
  if private.odai_phase(p_odai_id) is distinct from 'open' then
    raise exception 'このお題はもう採点を受け付けていません' using errcode = 'P0001';
  end if;

  if (select count(distinct x) from unnest(p_answer_ids) x) <> v_given then
    raise exception '同じ回答を複数の順位に選ぶことはできません' using errcode = 'P0001';
  end if;

  v_max := least(3, private.pickable_answer_count(p_odai_id, v_uid));
  if v_max = 0 then
    raise exception '選べる回答がありません' using errcode = 'P0001';
  end if;
  if v_given < 1 or v_given > v_max then
    raise exception '選べるのは1〜%件です', v_max using errcode = 'P0001';
  end if;

  delete from public.picks p
   where p.odai_id = p_odai_id and p.voter_id = v_uid;

  insert into public.picks (odai_id, voter_id, answer_id, rank)
  select p_odai_id, v_uid, t.answer_id, t.ord::smallint
  from unnest(p_answer_ids) with ordinality as t(answer_id, ord);
end
$$;

-- 回答受付と採点が同じフェーズになったので、
-- 「回答者全員が投票し終わったら自動で締める」は成立しない（回答はいつでも増える）。
-- 締め切りは出題者の close_odai() だけ。
drop function if exists public.close_answers(bigint);
drop function if exists public.close_voting(bigint);
drop function if exists private.maybe_close_voting(bigint);

revoke all on function public.close_odai(bigint)             from public, anon;
revoke all on function public.submit_picks(bigint, bigint[]) from public, anon;

grant execute on function public.close_odai(bigint)             to authenticated;
grant execute on function public.submit_picks(bigint, bigint[]) to authenticated;
