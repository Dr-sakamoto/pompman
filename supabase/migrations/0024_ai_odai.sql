-- ============================================================================
-- 大喜利「選ぶだけ」アプリへの切り替え（週1お題 × AI 大量生成 × 審査役のふるい）。
--
-- 目標は「10個見せたら10個とも超面白い」状態を、人間のひらめきや偶然を待たずに
-- 作ること。一発で10個書かせて全部当てるのは無理なので、こう分ける:
--
--   1. お題は週1回、これまで貯めた odai から自動で1つ選ぶ（全員共通）
--   2. AI がそのお題に回答を大量に作る（ai_answers。40個ずつのバッチ）
--   3. 審査役の AI が1つずつ「選ばれそうか」を採点する（judge_score）
--   4. 見せる10個は、審査役の点と「他の人に見せて選ばれたか」を合わせて上から選ぶ。
--      うち2枠は試し枠（まだあまり見せていないもの）にして、審査役の見落としを拾う
--   5. 人は面白いものを選ぶだけ。何人に見せて何人が選んだかが、そのまま
--      「超面白い」の判定（1人の気分ではなく、複数人の合意）になる
--
-- 鍛える相手は書き手ではなく審査役。審査役が外れを捨てられるほど、見せる10個の
-- 当たり率が上がる。その当たり率と審査役の目利きを週ごとに測る（ai_weekly_stats）。
--
-- 選ばれなかった回答も消さない。同じ10個の中の「選んだ > 選ばなかった」が
-- 選好ペアになり、審査役を鍛える教材になる（0001 からの方針）。
--
-- お題には2種類ある（ai_odai.kind）:
--
--   weekly  … 週1回の全員共通のお題。全員で選んで、目利きのデータを貯める側
--   consult … 1人が好きなときに出す「相談」。ネタで欲しいボケを大喜利のお題の形にして投げ、
--             貯まった目利き（審査役）で絞った10個を受け取る側。本人にしか見えない
--
-- どちらも「大量に書く → 審査役が採点 → 上から10個 → 選ぶ」の同じ流れに乗る。
-- 相談で本人が選んだ／選ばなかったも、審査役の手本として同じように貯まる。
--
-- 旧来の odai / answers / picks には一切手を付けない。odai はお題ストックとして読むだけ。
--
-- ※ このファイルは、マージ前の下書き（ogiri_sessions 等。1人が好きなお題で遊ぶ形）を
--   置き換えたもの。下書きを適用済みの DB でもそのまま流せるよう、先に片付ける。
-- ============================================================================

drop function if exists public.add_ogiri_round(bigint, text, text, text[]);
drop function if exists public.submit_ogiri_picks(bigint, bigint[]);
drop function if exists public.ogiri_taste_examples(bigint, int);
drop table if exists public.ogiri_candidates, public.ogiri_rounds, public.ogiri_sessions;

-- ----------------------------------------------------------------------------
-- 0. 補助
-- ----------------------------------------------------------------------------

create or replace function private.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.users where id = (select auth.uid()));
$$;

-- 週の区切り。日本時間の月曜 0 時から始まる週の、月曜の日付。
create or replace function private.current_week_start()
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('week', now() at time zone 'Asia/Tokyo')::date;
$$;

-- ----------------------------------------------------------------------------
-- 1. テーブル
-- ----------------------------------------------------------------------------

-- AI に回答を作らせるお題。週1（全員共通）と相談（本人だけ）の2種類。
create table public.ai_odai (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('weekly', 'consult')),
  -- weekly のみ。日本時間の月曜の日付
  week_start date,
  -- weekly のみ。お題ストック（odai）のどれから選んだか
  odai_id    bigint references public.odai (id) on delete set null,
  -- consult のみ。相談した人
  owner_id   uuid references public.users (id) on delete cascade,
  text       text not null check (char_length(btrim(text)) between 1 and 200),
  created_at timestamptz not null default now(),
  constraint ai_odai_weekly_has_week check ((kind = 'weekly') = (week_start is not null)),
  constraint ai_odai_consult_has_owner check ((kind = 'consult') = (owner_id is not null))
);

create unique index ai_odai_one_per_week on public.ai_odai (week_start) where kind = 'weekly';
create index ai_odai_owner_idx on public.ai_odai (owner_id, created_at desc) where kind = 'consult';

comment on table public.ai_odai is
  'AI に回答を作らせるお題。weekly = 週1回の全員共通（odai から自動で選ぶ）、'
  'consult = 1人が好きなときに出す相談（本人だけが見られる）。';

-- このお題を見てよいか。weekly はメンバー全員、consult は本人だけ。
create or replace function private.can_access_odai(p_ai_odai_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ai_odai o
    where o.id = p_ai_odai_id
      and (
        (o.kind = 'weekly' and exists (select 1 from public.users u where u.id = (select auth.uid())))
        or o.owner_id = (select auth.uid())
      )
  );
$$;

-- AI に回答を作らせた1回ぶん。同時に2人が作らせないための札も兼ねる。
create table public.ai_batches (
  id              bigint generated always as identity primary key,
  ai_odai_id  bigint not null references public.ai_odai (id) on delete cascade,
  status          text not null default 'generating'
                    check (status in ('generating', 'done', 'failed')),
  generator_model text,
  judge_model     text,
  started_by      uuid references public.users (id) on delete set null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index ai_batches_week_idx on public.ai_batches (ai_odai_id, status);

-- AI が作った回答。審査役の点つき。
create table public.ai_answers (
  id             bigint generated always as identity primary key,
  ai_odai_id bigint not null references public.ai_odai (id) on delete cascade,
  batch_id       bigint not null references public.ai_batches (id) on delete cascade,
  text           text not null check (char_length(btrim(text)) > 0),
  judge_score    smallint check (judge_score between 0 and 100),
  created_at     timestamptz not null default now()
);

create index ai_answers_week_idx on public.ai_answers (ai_odai_id);

comment on column public.ai_answers.judge_score is
  '審査役の AI が付けた「メンバーに選ばれそうか」の点（0〜100）。見せる順を決める材料の一つ。';

-- 1人に見せた10個。
create table public.ai_sets (
  id             bigint generated always as identity primary key,
  ai_odai_id bigint not null references public.ai_odai (id) on delete cascade,
  user_id        uuid not null references public.users (id) on delete cascade,
  -- 選び終えた時刻。null のあいだは選んでいる途中。
  submitted_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index ai_sets_user_idx on public.ai_sets (user_id, ai_odai_id);
-- 選んでいる途中の10個は1人1つまで。
create unique index ai_sets_one_open on public.ai_sets (user_id, ai_odai_id)
  where submitted_at is null;

-- 10個の中身。
create table public.ai_set_items (
  set_id      bigint not null references public.ai_sets (id) on delete cascade,
  answer_id   bigint not null references public.ai_answers (id) on delete cascade,
  position    smallint not null check (position between 1 and 10),
  -- top = 審査役と合意で上位だったもの / explore = 試し枠
  slot        text not null check (slot in ('top', 'explore')),
  -- 見せた時点での見込み（0〜1）。審査役の目利きを後から測るのに使う。
  expected    real,
  picked      boolean not null default false,
  primary key (set_id, answer_id),
  unique (set_id, position)
);

create index ai_set_items_answer_idx on public.ai_set_items (answer_id);

comment on table public.ai_set_items is
  '見せた10個と、選んだかどうか。picked=false も消さない（見せたのに選ばれなかった、という選好の片側）。';

-- ----------------------------------------------------------------------------
-- 2. RLS — 直接読めるのはお題・回答・自分の10個だけ。書き込みは関数越しのみ。
--
-- 他人が何を選んだかは週が終わるまで伏せる。見えてしまうと「みんなが選んだから
-- 選ぶ」が混ざり、合意が独立した判定でなくなる。集計値だけは関数越しに使う。
-- ----------------------------------------------------------------------------

alter table public.ai_odai  enable row level security;
alter table public.ai_batches   enable row level security;
alter table public.ai_answers   enable row level security;
alter table public.ai_sets      enable row level security;
alter table public.ai_set_items enable row level security;

revoke all on public.ai_odai, public.ai_batches, public.ai_answers,
              public.ai_sets, public.ai_set_items
  from anon, authenticated;
grant select on public.ai_odai, public.ai_answers, public.ai_sets, public.ai_set_items
  to authenticated;

create policy ai_odai_select on public.ai_odai
  for select to authenticated
  using (
    (kind = 'weekly' and (select private.is_member()))
    or owner_id = (select auth.uid())
  );

create policy ai_answers_select on public.ai_answers
  for select to authenticated using (private.can_access_odai(ai_odai_id));

create policy ai_sets_select_own on public.ai_sets
  for select to authenticated using (user_id = (select auth.uid()));

create policy ai_set_items_select_own on public.ai_set_items
  for select to authenticated
  using (exists (
    select 1 from public.ai_sets s
    where s.id = set_id and s.user_id = (select auth.uid())
  ));

-- ----------------------------------------------------------------------------
-- 3. 今週のお題
--
-- 最初に開いた人が今週のお題を決める（cron を持たないので、表示のついでに決める）。
-- まだ週のお題になっていないものから無作為に選び、使い切ったら全体から選ぶ。
-- ----------------------------------------------------------------------------

create or replace function public.ensure_weekly_odai()
returns setof public.ai_odai
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week date := private.current_week_start();
  v_odai_id bigint;
  v_text text;
begin
  if not private.is_member() then
    raise exception 'members only';
  end if;

  if not exists (select 1 from public.ai_odai where kind = 'weekly' and week_start = v_week) then
    select o.id, o.text into v_odai_id, v_text
    from public.odai o
    where not exists (select 1 from public.ai_odai w where w.odai_id = o.id)
    order by random()
    limit 1;

    if v_odai_id is null then
      select o.id, o.text into v_odai_id, v_text
      from public.odai o order by random() limit 1;
    end if;

    if v_odai_id is not null then
      insert into public.ai_odai (kind, week_start, odai_id, text)
      values ('weekly', v_week, v_odai_id, left(v_text, 200))
      on conflict (week_start) where kind = 'weekly' do nothing;
    end if;
  end if;

  return query select * from public.ai_odai where kind = 'weekly' and week_start = v_week;
end;
$$;

-- 相談を始める。お題は本人だけが見られる。
-- AI の呼び出しにはお金がかかるので、1人1日30件まで（アプリ側の CONSULT_DAILY_LIMIT と揃えること）。
create or replace function public.create_consult(p_text text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not private.is_member() then
    raise exception 'members only';
  end if;
  if (select count(*) from public.ai_odai
      where owner_id = (select auth.uid()) and created_at > now() - interval '1 day') >= 30 then
    raise exception 'daily consult limit reached';
  end if;

  insert into public.ai_odai (kind, owner_id, text)
  values ('consult', (select auth.uid()), btrim(p_text))
  returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. AI の回答づくり
--
-- 作らせる前に札（ai_batches）を取る。他の人が数分以内に取った札が生きていれば
-- 取れない（null を返す）。同じお題に何人もが同時に API を叩かないため。
-- ----------------------------------------------------------------------------

create or replace function public.claim_ai_batch(p_ai_odai_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not private.can_access_odai(p_ai_odai_id) then
    raise exception 'odai not found';
  end if;

  -- 同じお題の札の取り合いを1列に並べる
  perform 1 from public.ai_odai where id = p_ai_odai_id for update;
  if not found then
    raise exception 'odai not found';
  end if;

  -- 途中で落ちた札は5分で失効させる
  update public.ai_batches
  set status = 'failed', finished_at = now()
  where ai_odai_id = p_ai_odai_id
    and status = 'generating'
    and started_at < now() - interval '5 minutes';

  if exists (
    select 1 from public.ai_batches
    where ai_odai_id = p_ai_odai_id and status = 'generating'
  ) then
    return null;
  end if;

  insert into public.ai_batches (ai_odai_id, started_by)
  values (p_ai_odai_id, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- 作った回答と審査役の点を保存して札を返す。p_texts が空なら失敗として返す。
create or replace function public.finish_ai_batch(
  p_batch_id        bigint,
  p_generator_model text,
  p_judge_model     text,
  p_texts           text[],
  p_scores          int[]
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_id bigint;
  v_n int := coalesce(array_length(p_texts, 1), 0);
begin
  select ai_odai_id into v_week_id
  from public.ai_batches
  where id = p_batch_id and started_by = (select auth.uid()) and status = 'generating'
  for update;
  if v_week_id is null then
    raise exception 'batch not found';
  end if;

  if v_n > 100 then
    raise exception 'too many answers';
  end if;
  if coalesce(array_length(p_scores, 1), 0) <> v_n then
    raise exception 'scores must match texts';
  end if;

  insert into public.ai_answers (ai_odai_id, batch_id, text, judge_score)
  select v_week_id, p_batch_id, btrim(t.text), greatest(0, least(100, t.score))
  from unnest(p_texts, p_scores) as t(text, score)
  where btrim(t.text) <> '';

  update public.ai_batches
  set status = case when v_n > 0 then 'done' else 'failed' end,
      generator_model = p_generator_model,
      judge_model = p_judge_model,
      finished_at = now()
  where id = p_batch_id;

  return v_n;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. 見せる10個を選ぶための材料
--
-- 回答ごとに、審査役の点・今まで何人に見せて何人が選んだか・自分がもう見たか。
-- 誰が選んだかは返さない。
-- ----------------------------------------------------------------------------

create or replace function public.ai_answer_pool(p_ai_odai_id bigint)
returns table (
  answer_id    bigint,
  text         text,
  judge_score  smallint,
  shown_count  int,
  picked_count int,
  seen_by_me   boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    a.text,
    a.judge_score,
    count(i.set_id) filter (where s.submitted_at is not null)::int,
    count(i.set_id) filter (where s.submitted_at is not null and i.picked)::int,
    coalesce(bool_or(s.user_id = (select auth.uid())), false)
  from public.ai_answers a
  left join public.ai_set_items i on i.answer_id = a.id
  left join public.ai_sets s on s.id = i.set_id
  where a.ai_odai_id = p_ai_odai_id
    and private.can_access_odai(p_ai_odai_id)
  group by a.id;
$$;

-- 10個を自分用に確保する。選んでいる途中の10個があれば作れない。
create or replace function public.create_ai_set(
  p_ai_odai_id bigint,
  p_answer_ids     bigint[],
  p_slots          text[],
  p_expected       real[]
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set_id bigint;
  v_n int := coalesce(array_length(p_answer_ids, 1), 0);
begin
  if not private.can_access_odai(p_ai_odai_id) then
    raise exception 'odai not found';
  end if;
  if v_n not between 1 and 10
     or coalesce(array_length(p_slots, 1), 0) <> v_n
     or coalesce(array_length(p_expected, 1), 0) <> v_n then
    raise exception 'need 1..10 answers with slots';
  end if;
  if (select count(*) from public.ai_answers
      where id = any (p_answer_ids) and ai_odai_id = p_ai_odai_id) <> v_n then
    raise exception 'answers do not belong to this odai';
  end if;
  -- 一度見た回答は二度見せない（2回目の判定は1回目と独立でない）
  if exists (
    select 1 from public.ai_set_items i
    join public.ai_sets s on s.id = i.set_id
    where s.user_id = (select auth.uid()) and i.answer_id = any (p_answer_ids)
  ) then
    raise exception 'already shown';
  end if;

  insert into public.ai_sets (ai_odai_id, user_id)
  values (p_ai_odai_id, (select auth.uid()))
  returning id into v_set_id;

  insert into public.ai_set_items (set_id, answer_id, position, slot, expected)
  select v_set_id, t.answer_id, t.ord, t.slot, t.expected
  from unnest(p_answer_ids, p_slots, p_expected) with ordinality
    as t(answer_id, slot, expected, ord);

  return v_set_id;
end;
$$;

-- 選んだものを記録して10個を締める。片道切符（提出後は変えられない）。
create or replace function public.submit_ai_set(
  p_set_id     bigint,
  p_answer_ids bigint[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.ai_sets
    where id = p_set_id and user_id = (select auth.uid()) and submitted_at is null
  ) then
    raise exception 'set not found or already submitted';
  end if;

  update public.ai_set_items
  set picked = true
  where set_id = p_set_id and answer_id = any (coalesce(p_answer_ids, '{}'));

  update public.ai_sets set submitted_at = now() where id = p_set_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. 手本（書き手と審査役に見せる、過去の「選ばれた／選ばれなかった」）
--
-- 他のお題（週1・相談の両方）で、見せた人のうち選んだ割合が高いもの（勝ち）と、
-- 見せたのに誰にも選ばれなかったもの（負け）。今のお題の分は ai_answer_pool から取る。
-- 相談で本人が選んだものも手本に入る（審査役に渡すだけで、他の人の画面には出ない）。
-- ----------------------------------------------------------------------------

create or replace function public.ai_past_examples(p_exclude_ai_odai_id bigint)
returns table (odai_text text, answer text, shown_count int, picked_count int)
language sql
stable
security definer
set search_path = ''
as $$
  with stats as (
    select w.text as odai_text, a.text as answer,
           count(*)::int as shown_count,
           count(*) filter (where i.picked)::int as picked_count
    from public.ai_set_items i
    join public.ai_sets s on s.id = i.set_id and s.submitted_at is not null
    join public.ai_answers a on a.id = i.answer_id
    join public.ai_odai w on w.id = a.ai_odai_id
    where a.ai_odai_id <> p_exclude_ai_odai_id
      and private.is_member()
    group by w.text, a.id, a.text
  )
  (select * from stats where picked_count > 0
   order by picked_count::real / shown_count desc, picked_count desc limit 40)
  union all
  (select * from stats where picked_count = 0
   order by shown_count desc limit 30);
$$;

-- ----------------------------------------------------------------------------
-- 7. 週ごとの成績
--
--   first_set_hits  … 各人が「その週はじめて見た10個」のうち選んだ数の平均。
--                     見慣れ・疲れの影響が無いので、いちばん素直な当たり率。目標は 10。
--   top_*           … 上位枠（審査役＋合意）の当たり率
--   explore_*       … 試し枠の当たり率。上位枠より低いほど審査役が効いている
--   judge_pair_acc  … 同じ10個の中で「選んだ／選ばなかった」の組のうち、
--                     審査役の点が選んだほうに高く付いていた割合（0.5 で当てずっぽう）
-- ----------------------------------------------------------------------------

create or replace function public.ai_weekly_stats()
returns table (
  week_start       date,
  odai_text        text,
  pickers          int,
  sets             int,
  first_set_hits   real,
  top_shown        int,
  top_picked       int,
  explore_shown    int,
  explore_picked   int,
  judge_pair_acc   real,
  answers_made     int
)
language sql
stable
security definer
set search_path = ''
as $$
  with items as (
    select s.ai_odai_id, s.user_id, s.id as set_id, i.slot, i.picked, a.judge_score
    from public.ai_sets s
    join public.ai_set_items i on i.set_id = s.id
    join public.ai_answers a on a.id = i.answer_id
    where s.submitted_at is not null
  ),
  firsts as (
    select ai_odai_id, user_id, count(*) filter (where picked) as hits
    from (
      select s.ai_odai_id, s.user_id, i.picked,
             dense_rank() over (partition by s.ai_odai_id, s.user_id order by s.created_at) as r
      from public.ai_sets s
      join public.ai_set_items i on i.set_id = s.id
      where s.submitted_at is not null
    ) x
    where r = 1
    group by ai_odai_id, user_id
  ),
  pairs as (
    select p.ai_odai_id,
           avg(case when p.judge_score > n.judge_score then 1.0
                    when p.judge_score = n.judge_score then 0.5
                    else 0.0 end) as acc
    from items p
    join items n on n.set_id = p.set_id and not n.picked
    where p.picked and p.judge_score is not null and n.judge_score is not null
    group by p.ai_odai_id
  )
  select
    w.week_start,
    w.text,
    (select count(distinct user_id) from items where ai_odai_id = w.id)::int,
    (select count(distinct set_id) from items where ai_odai_id = w.id)::int,
    (select avg(hits) from firsts where ai_odai_id = w.id)::real,
    (select count(*) from items where ai_odai_id = w.id and slot = 'top')::int,
    (select count(*) from items where ai_odai_id = w.id and slot = 'top' and picked)::int,
    (select count(*) from items where ai_odai_id = w.id and slot = 'explore')::int,
    (select count(*) from items where ai_odai_id = w.id and slot = 'explore' and picked)::int,
    (select acc from pairs where ai_odai_id = w.id)::real,
    (select count(*) from public.ai_answers where ai_odai_id = w.id)::int
  from public.ai_odai w
  where w.kind = 'weekly'
    and private.is_member()
  order by w.week_start desc;
$$;

-- 終わった週の「殿堂」: 見せた人のうち選んだ人が多かった回答。
-- 今週の分は返さない（見えると、まだ選んでいる人の判定に混ざる）。
create or replace function public.ai_hall_of_fame(p_ai_odai_id bigint)
returns table (answer text, shown_count int, picked_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select a.text,
         count(*)::int,
         count(*) filter (where i.picked)::int
  from public.ai_answers a
  join public.ai_odai w on w.id = a.ai_odai_id
  join public.ai_set_items i on i.answer_id = a.id
  join public.ai_sets s on s.id = i.set_id and s.submitted_at is not null
  where a.ai_odai_id = p_ai_odai_id
    and w.kind = 'weekly'
    and w.week_start < private.current_week_start()
    and private.is_member()
  group by a.id, a.text
  having count(*) filter (where i.picked) > 0
  order by count(*) filter (where i.picked) desc,
           count(*) filter (where i.picked)::real / count(*) desc
  limit 20;
$$;

-- ----------------------------------------------------------------------------
-- 8. 権限
-- ----------------------------------------------------------------------------

revoke all on function private.is_member() from public, anon;
revoke all on function private.current_week_start() from public, anon;
revoke all on function private.can_access_odai(bigint) from public, anon;
grant execute on function private.can_access_odai(bigint) to authenticated;
revoke all on function public.create_consult(text) from public, anon;
grant execute on function public.create_consult(text) to authenticated;
grant execute on function private.is_member() to authenticated;
grant execute on function private.current_week_start() to authenticated;

revoke all on function public.ensure_weekly_odai() from public, anon;
revoke all on function public.claim_ai_batch(bigint) from public, anon;
revoke all on function public.finish_ai_batch(bigint, text, text, text[], int[]) from public, anon;
revoke all on function public.ai_answer_pool(bigint) from public, anon;
revoke all on function public.create_ai_set(bigint, bigint[], text[], real[]) from public, anon;
revoke all on function public.submit_ai_set(bigint, bigint[]) from public, anon;
revoke all on function public.ai_past_examples(bigint) from public, anon;
revoke all on function public.ai_weekly_stats() from public, anon;
revoke all on function public.ai_hall_of_fame(bigint) from public, anon;

grant execute on function public.ensure_weekly_odai() to authenticated;
grant execute on function public.claim_ai_batch(bigint) to authenticated;
grant execute on function public.finish_ai_batch(bigint, text, text, text[], int[]) to authenticated;
grant execute on function public.ai_answer_pool(bigint) to authenticated;
grant execute on function public.create_ai_set(bigint, bigint[], text[], real[]) to authenticated;
grant execute on function public.submit_ai_set(bigint, bigint[]) to authenticated;
grant execute on function public.ai_past_examples(bigint) to authenticated;
grant execute on function public.ai_weekly_stats() to authenticated;
grant execute on function public.ai_hall_of_fame(bigint) to authenticated;
