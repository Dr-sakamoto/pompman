"use client";

import { useActionState, useMemo, useState } from "react";
import { closeVoting, submitPicks, type ActionState } from "@/app/actions";
import { ErrorText, Panel } from "@/components/ui";
import { seededShuffle } from "@/lib/scoring";
import type { AnswerView, Odai, Pick } from "@/lib/types";

const RANK_LABEL = ["1位", "2位", "3位"];

export function VotingPhase({
  odai,
  answers,
  myPicks,
  voterId,
  isOwner,
}: {
  odai: Odai;
  answers: AnswerView[];
  myPicks: Pick[];
  voterId: string;
  isOwner: boolean;
}) {
  // 投稿順のままだと先に出した人が有利。並びは (お題, 投票者) で固定してシャッフルする。
  const shuffled = useMemo(
    () => seededShuffle(answers, `${odai.id}:${voterId}`),
    [answers, odai.id, voterId],
  );

  const pickable = answers.filter((a) => !a.is_mine).length;
  const required = Math.min(3, pickable);

  const [selected, setSelected] = useState<number[]>(() =>
    myPicks.slice().sort((a, b) => a.rank - b.rank).map((p) => p.answer_id),
  );
  const [state, action, pending] = useActionState<ActionState, FormData>(submitPicks, {});

  function toggle(answerId: number) {
    setSelected((prev) => {
      const at = prev.indexOf(answerId);
      if (at !== -1) return prev.filter((id) => id !== answerId);
      if (prev.length >= required) return prev;
      return [...prev, answerId];
    });
  }

  const remaining = required - selected.length;
  const alreadyVoted = myPicks.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-muted">
          面白かった順に{required}つ選んでください。誰が書いたかは結果公開まで分かりません。
        </p>
      </div>

      <ul className="space-y-2">
        {shuffled.map((a) => {
          const at = selected.indexOf(a.id);
          const rank = at === -1 ? null : at + 1;
          const disabled = a.is_mine;

          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => toggle(a.id)}
                disabled={disabled}
                className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition ${
                  disabled
                    ? "cursor-not-allowed border-line bg-panel/40 opacity-45"
                    : rank
                      ? "border-accent bg-accent/10"
                      : "border-line bg-panel hover:border-white/25"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-6 w-10 shrink-0 items-center justify-center rounded text-xs font-bold ${
                    rank ? "bg-accent text-ink" : "border border-line text-muted"
                  }`}
                >
                  {rank ? RANK_LABEL[rank - 1] : "―"}
                </span>
                <span className="whitespace-pre-wrap">{a.text}</span>
              </button>
              {disabled && <p className="mt-1 pl-1 text-xs text-muted">あなたの回答（選べません）</p>}
            </li>
          );
        })}
      </ul>

      <Panel>
        <form action={action} className="space-y-3">
          <input type="hidden" name="odai_id" value={odai.id} />
          {selected.map((id, i) => (
            <input key={id} type="hidden" name={`rank_${i + 1}`} value={id} />
          ))}
          <button
            type="submit"
            disabled={pending || remaining > 0}
            className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
          >
            {pending
              ? "送信中…"
              : remaining > 0
                ? `あと${remaining}つ選んでください`
                : alreadyVoted
                  ? "選び直して送信"
                  : "この順位で投票する"}
          </button>
          {alreadyVoted && (
            <p className="text-xs text-muted">
              投票済みです。結果公開までは何度でも選び直せます。
            </p>
          )}
          <ErrorText message={state.error} />
        </form>
      </Panel>

      {isOwner && <CloseVotingButton odaiId={odai.id} />}
    </div>
  );
}

function CloseVotingButton({ odaiId }: { odaiId: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(closeVoting, {});

  return (
    <form action={action} className="space-y-2 border-t border-line pt-4">
      <input type="hidden" name="odai_id" value={odaiId} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md border border-line px-4 py-2 text-sm font-medium hover:border-white/25 disabled:opacity-40"
      >
        {pending ? "処理中…" : "投票を締め切って結果を公開"}
      </button>
      <p className="text-xs text-muted">
        出題者だけが操作できます。回答した人全員が投票を終えると自動で公開されます。
      </p>
      <ErrorText message={state.error} />
    </form>
  );
}
