"use client";

import { useActionState, useState } from "react";
import { upsertMember, type MemberActionState } from "@/app/actions";
import { ErrorText, Panel } from "@/components/ui";

/**
 * 管理者がメンバーのアカウントを作る／パスワードを変更する。
 * 決めたパスワードは LINE などで本人に直接渡す前提（メールは送らない）。
 */
export function MemberForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<MemberActionState, FormData>(upsertMember, {});

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-muted hover:text-white"
      >
        + メンバーを追加 / パスワードを変更
      </button>
    );
  }

  return (
    <Panel>
      <form action={action} className="space-y-3">
        <div>
          <label htmlFor="member-email" className="mb-1 block text-sm font-medium">
            メールアドレス
          </label>
          <input
            id="member-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            className="w-full rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
            placeholder="friend@example.com"
          />
        </div>

        <div>
          <label htmlFor="member-password" className="mb-1 block text-sm font-medium">
            パスワード
          </label>
          <input
            id="member-password"
            name="password"
            type="text"
            required
            minLength={8}
            autoComplete="off"
            className="w-full rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
            placeholder="8文字以上"
          />
          <p className="mt-1 text-xs text-muted">
            あなたが決めたこのパスワードを、本人にLINEなどで伝えてください。
          </p>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
        >
          {pending ? "登録中…" : "この内容で登録する"}
        </button>

        {state.done && (
          <p className="text-sm text-emerald-300">
            {state.email} を{state.created ? "登録しました" : "更新しました（パスワード変更）"}
          </p>
        )}
        <ErrorText message={state.error} />
      </form>
    </Panel>
  );
}
