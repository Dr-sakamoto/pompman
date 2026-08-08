"use client";

import { useActionState } from "react";
import { registerHandle, type ActionState } from "@/app/actions";
import { ErrorText, Panel } from "@/components/ui";

export function HandleForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(registerHandle, {});

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">表示名を決める</h1>
        <p className="mt-1 text-sm text-muted">
          結果画面で回答者として表示される名前です。あとから変更できます。
        </p>
      </div>

      <Panel>
        <form action={action} className="space-y-4">
          <input
            name="handle"
            required
            maxLength={20}
            autoComplete="off"
            placeholder="ポンプマン"
            className="w-full rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
          >
            {pending ? "登録中…" : "はじめる"}
          </button>
          <ErrorText message={state.error} />
        </form>
      </Panel>
    </div>
  );
}
