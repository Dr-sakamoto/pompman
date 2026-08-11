"use client";

import { useActionState } from "react";
import { closeAnswers, submitAnswer, type ActionState } from "@/app/actions";
import { ErrorText, Panel } from "@/components/ui";
import type { AnswerView, Odai } from "@/lib/types";

export function AnsweringPhase({
  odai,
  myAnswer,
  isOwner,
}: {
  odai: Odai;
  myAnswer: AnswerView | null;
  isOwner: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(submitAnswer, {});

  return (
    <div className="space-y-4">
      {myAnswer ? (
        <Panel>
          <p className="mb-1 text-xs font-bold text-muted">あなたの回答</p>
          <p className="whitespace-pre-wrap">{myAnswer.text}</p>
        </Panel>
      ) : (
        <Panel>
          <form action={action} className="space-y-3">
            <input type="hidden" name="odai_id" value={odai.id} />
            <textarea
              name="text"
              required
              rows={3}
              maxLength={500}
              placeholder="回答を書く"
              className="w-full resize-none rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
            >
              {pending ? "送信中…" : "回答する"}
            </button>
            <ErrorText message={state.error} />
          </form>
        </Panel>
      )}

      <p className="text-sm text-muted">
        回答受付中は、他の人の回答も回答者の数も見えません。
        {myAnswer && " 回答は1人1つで、あとから変更できません。"}
      </p>

      {isOwner && <CloseAnswersButton odaiId={odai.id} />}
    </div>
  );
}

function CloseAnswersButton({ odaiId }: { odaiId: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(closeAnswers, {});

  return (
    <form action={action} className="space-y-2 border-t border-line pt-4">
      <input type="hidden" name="odai_id" value={odaiId} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md border border-line px-4 py-2 text-sm font-medium hover:border-white/25 disabled:opacity-40"
      >
        {pending ? "処理中…" : "回答を締め切って投票へ"}
      </button>
      <p className="text-xs text-muted">
        出題者だけが操作できます。回答が2件以上必要です。何もしなくても、全員が回答するか3日経つと自動で締め切られます。
      </p>
      <ErrorText message={state.error} />
    </form>
  );
}
