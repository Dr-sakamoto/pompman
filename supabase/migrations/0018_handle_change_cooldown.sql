-- ============================================================================
-- 表示名（handle）の自由な変更を許可しつつ、月1回程度に制限する。
--
-- これまで handle は onboarding で1回入れたら変更する手段が無かった。
-- 変更自体はここで解禁するが、頻繁な変更は「誰が誰だか分からなくなる」
-- （既存の member_real_names 対策の趣旨と同じ）ので、DB 側でクールダウンを
-- 強制する。UI 側のバリデーションだけに頼らない（signed-in ユーザーが
-- 直接 PostgREST を叩いても素通りしないように）。
-- ============================================================================

alter table public.users
  add column handle_changed_at timestamptz not null default now();

update public.users set handle_changed_at = created_at;

comment on column public.users.handle_changed_at is
  '最後に handle を変更した日時。クールダウン判定に使う（30日に1回まで）。';

-- role の自己昇格防止と同じトリガーに、handle のクールダウンを追加する。
create or replace function public.users_freeze_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    if new.role is distinct from old.role then
      raise exception 'role は変更できません' using errcode = '42501';
    end if;
    new.id         := old.id;
    new.created_at := old.created_at;

    if new.handle is distinct from old.handle then
      if now() - old.handle_changed_at < interval '30 days' then
        raise exception '表示名の変更は前回の変更から30日経つまでできません' using errcode = 'P0001';
      end if;
      new.handle_changed_at := now();
    else
      -- クライアントが直接送ってきても無視し、常にサーバー側の値を保つ。
      new.handle_changed_at := old.handle_changed_at;
    end if;
  end if;
  return new;
end
$$;
