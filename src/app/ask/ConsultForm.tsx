"use client";

import { useActionState } from "react";
import type { ActionState } from "@/app/actions";
import { startConsult } from "@/app/ai/actions";
import { ErrorText, Panel } from "@/components/ui";

export function ConsultForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(startConsult, {});

  return (
    <Panel>
      <form action={action} className="space-y-3">
        <textarea
          name="text"
          required
          rows={3}
          maxLength={200}
          placeholder="例: 合コンで一番やってはいけない自己紹介とは？"
          className="w-full resize-none rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-4 py-3 font-bold text-ink disabled:opacity-40"
        >
          {pending ? "AI が書いて審査役が絞り中…（1分ほど）" : "相談する"}
        </button>
        <ErrorText message={state.error} />
      </form>
    </Panel>
  );
}
