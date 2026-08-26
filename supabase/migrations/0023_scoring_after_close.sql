-- ============================================================================
-- 結果発表済みのお題を、まだ採点していない人が「名前を伏せたまま」後から採点する。
--
-- 発表（closed）は今まで全員に対して一斉に効いていた。誰が書いたか・誰が誰を
-- 選んだかが phase だけで決まるので、**その時点で採点していなかった人の採点は
-- 永久に取れなくなる**。実際に起きているのはこれで、自動締め切り（0013）と
-- 最低採点人数（0019）を入れた今でも、発表は「2人が採点した瞬間」や「寿命が
-- 来た瞬間」に起きるため、残りの人はたいてい未採点のまま締め出される。
--
-- 失っているものは大きい。このサイトの本体は picks（選好ペア）で、1人が採点を
-- 1回諦めるたびに「その人が自分以外の回答 n 件をどう並べたか」がまるごと消える。
-- お題そのものは発表後も残っていて、回答も凍結されているのだから、**採点だけが
-- できない理由は「名前が見えてしまっているから」しかない**。
--
-- そこで、発表を「お題の状態」から「1人ずつの状態」に分ける —— 0011 が
-- 「他人の回答が見えない」を時間ではなく状態（answer_unlocks）で守るように
-- したのと同じ形。
--
--   result_reveals に行が無い人 … closed でも author_id と他人の picks は伏せたまま。
--                                 代わりに後から採点できる（after_close = true）
--   result_reveals に行がある人 … 結果が全部見える。代わりに二度と採点できない
--
-- 採点を終えた人には、締め切りの瞬間にトリガーで行を入れる（＝今までどおり
-- すぐ結果が見える）。行が入るのは他に2つ、どちらも本人の操作:
--
--   * 後から採点した（submit_picks）… 採点し終えた対価として結果が出る
--   * 採点せずに結果を見た（reveal_results）… 見たいだけの人の逃げ道。片道切符
--
-- 「結果を見てからの採点」を許さないのが要。他人の picks と回答者名を見てから
-- 付けた順位は選好ではなく同調のログで、picks を発表まで伏せている理由
-- （0001 §3）がそのまま効き続ける。だから reveal は取り消せない片道切符にし、
-- 採点との排他を RLS 側に持たせる。
--
-- それでも「発表前の採点」と「発表後の採点」は同じ強さのデータではない。
-- このマイグレーション以前に closed になったお題では、その人がもう結果を
-- 見てしまっているかどうかを DB は知らない（見た事実を記録していなかった）。
-- 混ぜたまま学習させると区別できなくなるので、picks / pick_skips に
-- after_close を立てて、行そのものにどちらで付いた採点かを持たせる。
-- 落とすかどうかは学習時に決められる —— 保存時に決めない、は 0001 からの方針。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 「結果を見た」宣言（result_reveals）
--
-- answer_unlocks（0011）と同じ形の片道切符。UPDATE / DELETE のポリシーは
-- 置かない —— 見たものは見なかったことにできない。
-- ----------------------------------------------------------------------------

create table public.result_reveals (
  odai_id     bigint not null references public.odai (id) on delete cascade,
  user_id     uuid not null references public.users (id),
  revealed_at timestamptz not null default now(),
  primary key (odai_id, user_id)
);

comment on table public.result_reveals is
  '「このお題の結果（誰が書いたか・誰が誰を選んだか）を見た」という宣言。片道切符（UPDATE/DELETE 不可）。'
  '行が無いあいだ、closed のお題でも author_id と他人の picks は伏せられ、代わりに後から採点できる。'
  '行ができた瞬間に結果が見えるようになり、代わりにそのお題は二度と採点できなくなる。';

create index result_reveals_odai_id_idx on public.result_reveals (odai_id);

alter table public.result_reveals enable row level security;

-- 誰が結果を見たかは本人以外に見せない（見ていない人を急かす材料にしない）。
create policy result_reveals_select on public.result_reveals
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 実際の作成は reveal_results() / submit_picks() 経由。RLS はそれと同じ条件を
-- 持たせておく（0001 からの約束: RPC 側だけに条件を置くと RLS 単体では守れない）。
create policy result_reveals_insert on public.result_reveals
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.odai_phase(odai_id) = 'closed'
  );

revoke all on public.result_reveals from anon, authenticated;
grant select, insert on public.result_reveals to authenticated;

-- ----------------------------------------------------------------------------
-- 2. 結果を見たかどうかの判定（has_unlocked / has_skipped と同じ形）
--
-- RLS ポリシー式とビューの両方から使うので private スキーマ + authenticated への
-- execute が要る（0002 の理由）。
-- ----------------------------------------------------------------------------

create or replace function private.has_revealed(p_odai_id bigint, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.result_reveals r
    where r.odai_id = p_odai_id
      and r.user_id = p_uid
  )
$$;

comment on function private.has_revealed(bigint, uuid) is
  '指定ユーザーがそのお題の結果を見たか。回答者名・他人の picks の開示条件であり、'
  '同時に「もう後から採点できない」条件でもある（両立させない）。';

revoke all on function private.has_revealed(bigint, uuid) from public, anon;
grant execute on function private.has_revealed(bigint, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. 締め切りの瞬間に、採点を終えた人には結果を開ける
--
-- 採点を済ませた人にとっては今までと何も変わらない（発表＝すぐ結果が見える）。
-- 締め切りは複数の経路から起きる（出題者の close_odai・寿命・全員やり切り・
-- 採点トリガー、0013/0017）ので、経路ごとに書かず phase の遷移そのものに
-- トリガーを置く。
--
-- ここで行を入れておくことが、あとの「発表前の採点は消せない」も担保する:
-- 発表前に採点した人は必ず revealed になるため、下の picks_delete /
-- pick_skips_delete（未 reveal の間だけ消せる）を通れない。
-- ----------------------------------------------------------------------------

create or replace function private.reveal_results_for_scorers()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.result_reveals (odai_id, user_id)
  select new.id, t.voter_id
  from (
    select k.voter_id from public.picks k      where k.odai_id = new.id
    union
    select s.voter_id from public.pick_skips s where s.odai_id = new.id
  ) t
  on conflict (odai_id, user_id) do nothing;
  return null;
end
$$;

comment on function private.reveal_results_for_scorers() is
  'お題が closed になった瞬間に、採点を終えていた人（picks か pick_skips がある人）へ結果を開ける。';

revoke all on function private.reveal_results_for_scorers() from public, anon;

drop trigger if exists odai_reveal_results_on_close on public.odai;
create trigger odai_reveal_results_on_close
  after update on public.odai
  for each row
  when (old.phase is distinct from new.phase and new.phase = 'closed')
  execute function private.reveal_results_for_scorers();

-- すでに発表済みのお題ぶんを埋める。ここを入れないと、過去に採点した人まで
-- 「未採点」に見え、結果が伏せられてしまう。
insert into public.result_reveals (odai_id, user_id, revealed_at)
select o.id, t.voter_id, coalesce(o.closed_at, now())
from public.odai o
join lateral (
  select k.voter_id from public.picks k      where k.odai_id = o.id
  union
  select s.voter_id from public.pick_skips s where s.odai_id = o.id
) t on true
where o.phase = 'closed'
on conflict (odai_id, user_id) do nothing;

-- ----------------------------------------------------------------------------
-- 4. 「発表後に付いた採点」であることを行に持たせる
--
-- 発表前の採点と発表後の採点は、どちらも「他人の名前も他人の採点も見ずに
-- 付けた順位」だが、同じ強さのデータとは限らない:
--
--   * このマイグレーション以前に closed になったお題では、その人がすでに
--     結果を見てしまっている可能性がある（見た事実を記録していなかった）。
--   * 発表後は時間が経っている。その場の空気で選んだ順位とは条件が違う。
--
-- どちらも「後から捨てられるように残す」で足りる。混ぜたまま保存すると
-- 二度と分離できない（voter_id を落とさないのと同じ理由）。
-- ----------------------------------------------------------------------------

alter table public.picks      add column after_close boolean not null default false;
alter table public.pick_skips add column after_close boolean not null default false;

comment on column public.picks.after_close is
  '結果発表後に（名前を伏せたまま）付けられた採点か。既存行は false。'
  'RLS で phase と一致することを強制しているので、この値は必ず本当のこと。';
comment on column public.pick_skips.after_close is
  '結果発表後に宣言された「選ぶ回答なし」か。picks.after_close と同じ扱い。';

-- ----------------------------------------------------------------------------
-- 5. picks / pick_skips の RLS を「phase」から「その人が結果を見たか」に変える
--
-- 変更前は closed になった瞬間に全員が全員の picks を読めた。読めてしまうと
-- 「他人の採点を見てから採点する」が成立するので、後追い採点を許すなら
-- ここも1人ずつの状態に合わせる必要がある（picks を伏せている理由は
-- フェーズではなく「同調のログにしない」ことなので、条件のほうを直す）。
--
-- INSERT の with check には after_close = (phase = 'closed') を入れてある。
-- テーブルへの INSERT 権限は列単位ではないので、これが無いと発表前の採点に
-- 後追いの印を付けたり（逆も）できてしまい、フラグが信用できなくなる。
-- ----------------------------------------------------------------------------

drop policy picks_select on public.picks;
create policy picks_select on public.picks
  for select to authenticated
  using (
    voter_id = (select auth.uid())
    or (
      private.odai_phase(odai_id) = 'closed'
      and private.has_revealed(odai_id, (select auth.uid()))
    )
  );

drop policy picks_insert on public.picks;
create policy picks_insert on public.picks
  for insert to authenticated
  with check (
    voter_id = (select auth.uid())
    and private.answer_odai_id(answer_id) = odai_id
    and private.answer_author_id(answer_id) <> (select auth.uid())  -- 自分の回答は選べない
    and case private.odai_phase(odai_id)
          -- 発表前: 今までどおり、解禁した人だけが採点できる
          when 'open'   then private.has_unlocked(odai_id, (select auth.uid()))
                             and after_close = false
          -- 発表後: まだ結果を見ていない人だけが、伏せたまま採点できる
          when 'closed' then not private.has_revealed(odai_id, (select auth.uid()))
                             and after_close = true
          else false
        end
  );

-- 選び直しは「まだ結果を見ていないあいだ」だけ。発表前に採点した人は締め切りの
-- 瞬間に revealed になる（§3）ので、発表前の採点はここを通れない＝消せない。
drop policy picks_delete on public.picks;
create policy picks_delete on public.picks
  for delete to authenticated
  using (
    voter_id = (select auth.uid())
    and (
      private.odai_phase(odai_id) = 'open'
      or not private.has_revealed(odai_id, (select auth.uid()))
    )
  );

drop policy pick_skips_select on public.pick_skips;
create policy pick_skips_select on public.pick_skips
  for select to authenticated
  using (
    voter_id = (select auth.uid())
    or (
      private.odai_phase(odai_id) = 'closed'
      and private.has_revealed(odai_id, (select auth.uid()))
    )
  );

drop policy pick_skips_insert on public.pick_skips;
create policy pick_skips_insert on public.pick_skips
  for insert to authenticated
  with check (
    voter_id = (select auth.uid())
    and case private.odai_phase(odai_id)
          when 'open'   then private.has_unlocked(odai_id, (select auth.uid()))
                             and after_close = false
          when 'closed' then not private.has_revealed(odai_id, (select auth.uid()))
                             and after_close = true
          else false
        end
  );

drop policy pick_skips_delete on public.pick_skips;
create policy pick_skips_delete on public.pick_skips
  for delete to authenticated
  using (
    voter_id = (select auth.uid())
    and (
      private.odai_phase(odai_id) = 'open'
      or not private.has_revealed(odai_id, (select auth.uid()))
    )
  );

-- ----------------------------------------------------------------------------
-- 6. 回答者名も「その人が結果を見たか」で開ける
--
-- answers_select ポリシーとこのビューは必ず一緒に直すこと（0001 からの約束）だが、
-- 変えたのは列を伏せる条件だけで、行の可視条件（誰にどの行が見えるか）は
-- 0011 のまま。行はむしろ closed で全員に開いていないと後から採点できない。
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
    when a.author_id = (select auth.uid()) then a.author_id
    when o.phase = 'closed' and private.has_revealed(o.id, (select auth.uid())) then a.author_id
    else null
  end as author_id,
  case
    when o.phase = 'closed' and private.has_revealed(o.id, (select auth.uid())) then a.model_ver
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
  'author_id / model_ver は、結果発表後にその人が結果を見る（result_reveals）まで null。';

revoke all on public.answers_view from anon, authenticated;
grant select on public.answers_view to authenticated;

-- ----------------------------------------------------------------------------
-- 7. 採点せずに結果を見る
--
-- 「採点しないと結果が見られない」は関門になりすぎる（採点したくない日もある）。
-- 逃げ道は用意するが、片道切符にして採点との排他を守る。
-- 実際の遮断は result_reveals の RLS が行う（二重チェックは意図的、0011 と同じ）。
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
    raise exception 'このお題はまだ結果発表されていません' using errcode = 'P0001';
  end if;

  insert into public.result_reveals (odai_id, user_id)
  values (p_odai_id, v_uid)
  on conflict (odai_id, user_id) do nothing;
end
$$;

comment on function public.reveal_results(bigint) is
  '結果（回答者名・全員の picks）を開ける。以後そのお題は採点できなくなる（片道切符）。';

revoke all on function public.reveal_results(bigint) from public, anon;
grant execute on function public.reveal_results(bigint) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. submit_picks(): 発表後の採点を受け付ける
--
-- 0022 版との差は3つだけ。
--   * phase = 'closed' でも、まだ結果を見ていない人なら通す
--   * 入れる行に after_close を立てる（発表前は false のまま）
--   * 後追いで採点し終えたら、その場で結果を開ける（採点の対価がすぐ出る）
-- 選べる件数・重複・自分の回答といった採点そのもののルールは一切変えない。
-- ----------------------------------------------------------------------------

create or replace function public.submit_picks(p_odai_id bigint, p_answer_ids bigint[])
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid    := auth.uid();
  v_given int     := coalesce(array_length(p_answer_ids, 1), 0);
  v_phase text;
  v_retro boolean;
  v_max   int;
begin
  if v_uid is null then
    raise exception 'ログインが必要です' using errcode = '42501';
  end if;

  v_phase := private.odai_phase(p_odai_id);

  if v_phase = 'open' then
    if not private.has_unlocked(p_odai_id, v_uid) then
      raise exception '先に回答を出し切って解禁してください' using errcode = 'P0001';
    end if;
    v_retro := false;
  elsif v_phase = 'closed' then
    -- 結果を見たあとの順位は選好ではなく同調のログなので受け付けない。
    if private.has_revealed(p_odai_id, v_uid) then
      raise exception '結果を見たあとは採点できません' using errcode = 'P0001';
    end if;
    v_retro := true;
  else
    raise exception 'お題が見つかりません' using errcode = 'P0002';
  end if;

  -- 「何も選ばない」の明示的な宣言は、選べる回答が0件でも常に受け付ける（0022）。
  if v_given = 0 then
    delete from public.picks p
     where p.odai_id = p_odai_id and p.voter_id = v_uid;

    insert into public.pick_skips (odai_id, voter_id, after_close)
    values (p_odai_id, v_uid, v_retro)
    on conflict (odai_id, voter_id) do nothing;

    if v_retro then
      insert into public.result_reveals (odai_id, user_id)
      values (p_odai_id, v_uid)
      on conflict (odai_id, user_id) do nothing;
    end if;

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

  insert into public.picks (odai_id, voter_id, answer_id, rank, after_close)
  select p_odai_id, v_uid, t.answer_id, t.ord::smallint, v_retro
  from unnest(p_answer_ids) with ordinality as t(answer_id, ord);

  -- 後追いの採点はやり直せない（結果が開くため）。その代わり、送った瞬間に結果が出る。
  if v_retro then
    insert into public.result_reveals (odai_id, user_id)
    values (p_odai_id, v_uid)
    on conflict (odai_id, user_id) do nothing;
  end if;
end
$$;

comment on function public.submit_picks(bigint, bigint[]) is
  '採点を送る。空配列（0件）は「何も選ばない」の明示的な宣言として、'
  '選べる回答が0件のときも常に受け付ける（0022）。'
  '結果発表後でも、まだ結果を見ていない人は伏せたまま採点できる（0023）。'
  'その場合 after_close が立ち、送った時点で結果が開く（＝やり直せない）。';

revoke all on function public.submit_picks(bigint, bigint[]) from public, anon;
grant execute on function public.submit_picks(bigint, bigint[]) to authenticated;
