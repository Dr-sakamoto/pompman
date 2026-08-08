"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createOdai, type ActionState } from "@/app/actions";
import { ErrorText, Panel } from "@/components/ui";

export function NewOdaiForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createOdai, {});

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted hover:text-white">
        ← 一覧
      </Link>
      <h1 className="text-2xl font-bold">お題を出す</h1>

      <Panel>
        <form action={action} className="space-y-4">
          <textarea
            name="text"
            required
            rows={3}
            maxLength={200}
            placeholder="例: 冷蔵庫を開けたら○○だった"
            className="w-full resize-none rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
          />
          <p className="text-xs text-muted">
            出したあとは、あなた自身が締め切り操作をして投票・結果公開に進めます。
          </p>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
          >
            {pending ? "作成中…" : "このお題で出す"}
          </button>
          <ErrorText message={state.error} />
        </form>
      </Panel>
    </div>
  );
}
