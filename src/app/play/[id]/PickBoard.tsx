"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/app/actions";
import { retryGenerate, submitPicksAndNext } from "../actions";
import { ErrorText } from "@/components/ui";

export function PickBoard({
  sessionId,
  roundId,
  roundNo,
  tasteNote,
  candidates,
}: {
  sessionId: number;
  roundId: number;
  roundNo: number;
  tasteNote: string | null;
  candidates: { id: number; text: string }[];
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [state, action, pending] = useActionState<ActionState, FormData>(submitPicksAndNext, {});

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="round_id" value={roundId} />
      {[...picked].map((id) => (
        <input key={id} type="hidden" name="picked" value={id} />
      ))}

      <div className="space-y-1">
        <p className="text-sm font-bold">{roundNo}回目 — 面白いと思ったものを全部タップ</p>
        {tasteNote && roundNo > 1 && (
          <p className="text-xs text-muted">AIの読み: {tasteNote}</p>
        )}
      </div>

      <ul className="space-y-2">
        {candidates.map((c) => {
          const on = picked.has(c.id);
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => toggle(c.id)}
                disabled={pending}
                aria-pressed={on}
                className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition ${
                  on
                    ? "border-accent bg-accent/15"
                    : "border-line bg-panel hover:border-white/25"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                    on ? "border-accent bg-accent text-ink" : "border-line text-transparent"
                  }`}
                  aria-hidden
                >
                  ✓
                </span>
                <span>{c.text}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div
        className="sticky bottom-0 -mx-4 border-t border-line bg-ink/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-4 py-3 font-bold text-ink disabled:opacity-40"
        >
          {pending
            ? "選択を反映して次の10個を考え中…"
            : picked.size === 0
              ? "どれも面白くない → 次の10個"
              : `${picked.size}個選んで次の10個へ`}
        </button>
        <ErrorText message={state.error} />
      </div>
    </form>
  );
}

export function RetryButton({ sessionId }: { sessionId: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(retryGenerate, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="session_id" value={sessionId} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
      >
        {pending ? "AIが10個考え中…" : "10個出す"}
      </button>
      <ErrorText message={state.error} />
    </form>
  );
}
