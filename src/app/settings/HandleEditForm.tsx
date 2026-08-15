"use client";

import { useActionState } from "react";
import { updateHandle, type ActionState } from "@/app/actions";
import { ErrorText } from "@/components/ui";
import { HANDLE_CHANGE_COOLDOWN_DAYS } from "@/lib/types";

export function HandleEditForm({
  handle,
  handleChangedAt,
}: {
  handle: string;
  handleChangedAt: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateHandle, {});

  const nextEligible = new Date(
    new Date(handleChangedAt).getTime() + HANDLE_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
  );
  const canChange = nextEligible.getTime() <= Date.now();

  return (
    <form action={action} className="space-y-3">
      <input
        name="handle"
        required
        maxLength={20}
        autoComplete="off"
        defaultValue={handle}
        disabled={!canChange}
        className="w-full rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent disabled:opacity-40"
      />
      {!canChange && (
        <p className="text-sm text-muted">
          次に変更できるのは {nextEligible.toLocaleDateString("ja-JP")} 以降です。
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !canChange}
        className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
      >
        {pending ? "変更中…" : "変更する"}
      </button>
      <ErrorText message={state.error} />
    </form>
  );
}
