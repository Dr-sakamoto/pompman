"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";
import { startSession } from "./actions";
import { ErrorText, Panel } from "@/components/ui";

function Buttons() {
  const { pending, data } = useFormStatus();
  const random = pending && data?.get("random");
  return (
    <div className="flex gap-2">
      <button
        type="submit"
        disabled={pending}
        className="flex-1 rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
      >
        {pending && !random ? "AIが10個考え中…" : "このお題で10個出す"}
      </button>
      <button
        type="submit"
        name="random"
        value="1"
        formNoValidate
        disabled={pending}
        className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-40"
      >
        {random ? "考え中…" : "おまかせ"}
      </button>
    </div>
  );
}

export function StartForm() {
  const [state, action] = useActionState<ActionState, FormData>(startSession, {});

  return (
    <Panel>
      <form action={action} className="space-y-3">
        <textarea
          name="text"
          rows={2}
          maxLength={200}
          placeholder="例: こんな校長先生は嫌だ"
          className="w-full resize-none rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
        />
        <Buttons />
        <p className="text-xs text-muted">「おまかせ」は過去に出たお題から1つ選びます。</p>
        <ErrorText message={state.error} />
      </form>
    </Panel>
  );
}
