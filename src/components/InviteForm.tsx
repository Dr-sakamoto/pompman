"use client";

import { useActionState, useState } from "react";
import { inviteMember, type ActionState } from "@/app/actions";
import { ErrorText, Panel } from "@/components/ui";

export function InviteForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(inviteMember, {});
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-muted hover:text-white"
      >
        + メンバーを招待
      </button>
    );
  }

  return (
    <Panel>
      <form
        action={(formData) => {
          setSentTo(String(formData.get("email") ?? ""));
          action(formData);
        }}
        className="space-y-3"
      >
        <div>
          <label htmlFor="invite-email" className="mb-1 block text-sm font-medium">
            招待するメールアドレス
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            className="w-full rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
            placeholder="friend@example.com"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
        >
          {pending ? "送信中…" : "招待メールを送る"}
        </button>
        {!pending && !state.error && sentTo && (
          <p className="text-sm text-emerald-300">{sentTo} に招待メールを送りました</p>
        )}
        <ErrorText message={state.error} />
      </form>
    </Panel>
  );
}
