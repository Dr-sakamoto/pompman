"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/app/actions";
import { playNext } from "./actions";
import { ErrorText, Panel } from "@/components/ui";

type Item = { answerId: number; text: string };

export function PickBoard({
  odaiId,
  setId,
  items,
}: {
  odaiId: number;
  setId: number | null;
  items: Item[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(playNext, {});

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="ai_odai_id" value={odaiId} />
      {setId != null ? (
        <PickList key={setId} setId={setId} items={items} pending={pending} />
      ) : (
        <Panel className="space-y-3">
          <p className="text-sm text-muted">
            AI が大量に書いた回答から、審査役が選び抜いた10個を見せます。
          </p>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-accent px-4 py-3 font-bold text-ink disabled:opacity-40"
          >
            {pending ? "回答を準備中…（初回は1分ほど）" : "10個見る"}
          </button>
        </Panel>
      )}
      <ErrorText message={state.error} />
    </form>
  );
}

function PickList({ setId, items, pending }: { setId: number; items: Item[]; pending: boolean }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <input type="hidden" name="set_id" value={setId} />
      {[...picked].map((id) => (
        <input key={id} type="hidden" name="picked" value={id} />
      ))}

      <p className="text-sm font-bold">面白いと思ったものを全部タップ</p>

      <ul className="space-y-2">
        {items.map((c) => {
          const on = picked.has(c.answerId);
          return (
            <li key={c.answerId}>
              <button
                type="button"
                onClick={() => toggle(c.answerId)}
                disabled={pending}
                aria-pressed={on}
                className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition ${
                  on ? "border-accent bg-accent/15" : "border-line bg-panel hover:border-white/25"
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
            ? "記録して次の10個を準備中…"
            : picked.size === 0
              ? "どれも面白くない → 次の10個"
              : `${picked.size}個選んで次の10個へ`}
        </button>
      </div>
    </div>
  );
}
