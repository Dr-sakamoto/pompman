"use client";

import { useActionState } from "react";
import { issueInviteCodes, type IssueCodesState } from "@/app/actions";
import { ErrorText, Panel } from "@/components/ui";

export function InviteCodeIssuer() {
  const [state, action, pending] = useActionState<IssueCodesState, FormData>(issueInviteCodes, {});

  return (
    <Panel className="space-y-3">
      <form action={action} className="flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="count" className="mb-1 block text-sm font-medium">
            発行数
          </label>
          <input
            id="count"
            name="count"
            type="number"
            min={1}
            max={20}
            defaultValue={1}
            required
            className="w-full rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
        >
          {pending ? "発行中…" : "発行する"}
        </button>
      </form>

      {state.codes && state.codes.length > 0 && (
        <div className="rounded-md border border-accent/40 bg-accent/5 p-3">
          <p className="mb-2 text-sm font-bold">発行しました。この番号を配ってください。</p>
          <ul className="flex flex-wrap gap-2">
            {state.codes.map((c) => (
              <li
                key={c}
                className="rounded-md bg-accent px-3 py-1 font-mono text-lg font-bold tracking-widest text-ink"
              >
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ErrorText message={state.error} />
    </Panel>
  );
}
