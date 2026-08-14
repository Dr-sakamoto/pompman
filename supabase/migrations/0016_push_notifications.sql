-- ============================================================================
-- Web Push 通知（最小限）。
--
-- 仕様書 §作らないもの に「通知機能」は指示があるまで着手不要とあったが、
-- ここでその指示が入ったので実装する。狙いは2つだけに絞る:
--
--   * 新しいお題が出た   → 出題者以外の全員に
--   * 結果が発表された   → そのお題に回答した人に
--
-- どちらも「戻ってくる理由」が発生した瞬間だけ鳴らす。それ以外（誰かが回答した、
-- 採点した等）では鳴らさない。鬱陶しさは「頻度」で決まるので、種類を増やす前に
-- まずこの2つで様子を見る。
--
-- ポップアップとの関係: 通知を送る・受け取る仕組みはここ（DB・サーバー）の話で、
-- 「通知をタップして開いたら何かのポップアップに塞がれる」問題はクライアント側
-- （sw.js の notificationclick、購読UI）の作り方の話。ここでは後者を塞がない
-- ためのデータだけ用意する: 通知本文が指す odai の URL をそのまま持たせ、
-- タップしたら素通しでその画面に着地できるようにする。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 購読の保存先
--
-- ブラウザの PushSubscription をそのまま保存する。本人だけが読み書きでき、
-- 「他人に通知を送るために自分以外の購読を読む」は下の SECURITY DEFINER 関数
-- （必要な範囲だけを返す）越しにのみ許す。
-- ----------------------------------------------------------------------------

create table public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

comment on table public.push_subscriptions is
  'ブラウザの Push 購読。本人のみ読み書き可（RLS）。他人への通知送信は '
  'push_targets_for_new_odai() / push_targets_for_closed_odai() 経由でのみ読める。';

alter table public.push_subscriptions enable row level security;

revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 2. 送信先の引き当て（SECURITY DEFINER）
--
-- Server Action は「本人としてログインしたクライアント」なので、RLS のままだと
-- 自分の購読しか読めない。通知を送るには他人の購読が要るので、必要な範囲だけを
-- 返す関数越しに引き当てる。ここで漏れるのは push 用の endpoint/鍵で、
-- 送信には別途 VAPID 秘密鍵が要るため、これだけでは他人になりすませない。
-- ----------------------------------------------------------------------------

create or replace function public.push_targets_for_new_odai(p_author_id uuid)
returns table(user_id uuid, endpoint text, p256dh text, auth text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select s.user_id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  where s.user_id <> p_author_id;
$$;

comment on function public.push_targets_for_new_odai(uuid) is
  '新しいお題を通知する相手（出題者以外の購読）を返す。';

revoke all on function public.push_targets_for_new_odai(uuid) from public, anon;
grant execute on function public.push_targets_for_new_odai(uuid) to authenticated;

create or replace function public.push_targets_for_closed_odai(p_odai_id bigint)
returns table(user_id uuid, endpoint text, p256dh text, auth text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select s.user_id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  where s.user_id in (
    select distinct a.author_id from public.answers a where a.odai_id = p_odai_id
  );
$$;

comment on function public.push_targets_for_closed_odai(bigint) is
  '結果発表を通知する相手（そのお題に回答した人の購読）を返す。';

revoke all on function public.push_targets_for_closed_odai(bigint) from public, anon;
grant execute on function public.push_targets_for_closed_odai(bigint) to authenticated;

-- 送信に失敗した購読（410 Gone 等、ブラウザ側で失効済み）の後始末。
-- 失効した購読は元の持ち主のものとは限らない相手が知ることになるので
-- （通知を送った側が消す）、これも SECURITY DEFINER で持ち主を問わず消す。
create or replace function public.delete_stale_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

comment on function public.delete_stale_push_subscription(text) is
  '送信先が失効した(410/404)購読を消す。送信処理から呼ぶ後始末専用。';

revoke all on function public.delete_stale_push_subscription(text) from public, anon;
grant execute on function public.delete_stale_push_subscription(text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. 「結果発表」を一度だけ検知する
--
-- closed への遷移は sweep_odai_deadlines() / submit_picks() / unlock_answers() /
-- close_odai() のどれからでも起こりうる（0013 参照）。呼び出し側ごとに
-- 通知処理を書くと数え漏れ・二重送信の両方が起きやすいので、「まだ通知して
-- いない closed」を UPDATE ... RETURNING で1回だけ掴めるようにし、
-- どの呼び出し経路の直後でもこれを叩けば足りるようにする。
-- ----------------------------------------------------------------------------

alter table public.odai add column closed_notified_at timestamptz;

comment on column public.odai.closed_notified_at is
  '結果発表の通知を送信済みにした時刻。claim_newly_closed_odai() が一度だけ埋める。';

create or replace function public.claim_newly_closed_odai()
returns table(id bigint)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.odai
  set closed_notified_at = now()
  where phase = 'closed' and closed_notified_at is null
  returning odai.id;
$$;

comment on function public.claim_newly_closed_odai() is
  'まだ通知していない closed を通知済みにして返す。UPDATE 1文なので同時に '
  '複数箇所から呼んでも二重送信しない。';

revoke all on function public.claim_newly_closed_odai() from public, anon;
grant execute on function public.claim_newly_closed_odai() to authenticated;
