"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { setMemberRealName, type ActionState } from "@/app/actions";
import { ErrorText } from "@/components/ui";

/**
 * 管理者だけに見える、本名メモの表示・編集。
 * 他のメンバーがこの画面を見てもこのコンポーネント自体が描画されない
 * （members/page.tsx 側で管理者にしか渡さない）ので、存在自体もバレない。
 */
export function RealNameEditor({ userId, realName }: { userId: string; realName: string | null }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(setMemberRealName, {});
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) setEditing(false);
    wasPending.current = pending;
  }, [pending, state]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs text-muted hover:text-white"
        title="本名メモ（管理者にのみ表示）"
      >
        {realName ? `(${realName})` : "＋本名を記録"}
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="user_id" value={userId} />
      <input
        name="real_name"
        defaultValue={realName ?? ""}
        placeholder="本名"
        autoFocus
        className="w-28 rounded border border-line bg-ink px-2 py-0.5 text-xs outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-accent hover:underline disabled:opacity-40"
      >
        保存
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-xs text-muted hover:text-white"
      >
        取消
      </button>
      <ErrorText message={state.error} />
    </form>
  );
}
