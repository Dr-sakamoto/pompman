"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeOdai, submitAnswer, submitPicks, type ActionState } from "@/app/actions";
import { ErrorText, Panel } from "@/components/ui";
import { seededOrder } from "@/lib/scoring";
import { MAX_ANSWERS_PER_ODAI, MAX_PICKS, type AnswerView, type Odai, type Pick } from "@/lib/types";

const RANK_LABEL = ["1位", "2位", "3位"];

/**
 * 回答と採点が同居するフェーズ。
 *
 * 回答は投稿した瞬間から全員に見える。誰が書いたかは結果発表まで伏せたままなので、
 * 「名前で選ばれる」ことは起きない。採点（picks）も結果発表まで他人には見えない。
 */
export function OpenPhase({
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
  // 投稿順のままだと先に出した人が有利。並びは (お題, 採点者) で固定して散らす。
  const ordered = useMemo(
    () => seededOrder(answers, `${odai.id}:${voterId}`, (a) => a.id),
    [answers, odai.id, voterId],
  );

  const myAnswerCount = answers.filter((a) => a.is_mine).length;
  const pickable = answers.length - myAnswerCount;
  const maxPicks = Math.min(MAX_PICKS, pickable);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-bold">回答 {answers.length}件</span>
        <span className="text-muted">
          {myAnswerCount > 0 ? `うちあなたの回答 ${myAnswerCount}件` : "あなたはまだ回答していません"}
        </span>
        <RefreshButton />
      </div>

      <AnswerForm odaiId={odai.id} myAnswerCount={myAnswerCount} />

      {answers.length === 0 ? (
        <p className="text-sm text-muted">
          まだ回答がありません。最初の1つを書いてください。
        </p>
      ) : (
        <PickForm
          odaiId={odai.id}
          answers={ordered}
          myPicks={myPicks}
          maxPicks={maxPicks}
          pickable={pickable}
        />
      )}

      {isOwner && <CloseOdaiButton odaiId={odai.id} />}
    </div>
  );
}

/** 他の人が出した新しい回答を取りに行く。採点の選択状態は消えない。 */
function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      className="ml-auto rounded-md border border-line px-3 py-1 text-xs text-muted hover:border-white/25 disabled:opacity-40"
    >
      {pending ? "更新中…" : "最新にする"}
    </button>
  );
}

function AnswerForm({ odaiId, myAnswerCount }: { odaiId: number; myAnswerCount: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(submitAnswer, {});
  const left = MAX_ANSWERS_PER_ODAI - myAnswerCount;

  if (left <= 0) {
    return (
      <Panel>
        <p className="text-sm text-muted">
          このお題への回答は上限（{MAX_ANSWERS_PER_ODAI}個）に達しました。採点は続けられます。
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <form action={action} className="space-y-3">
        <input type="hidden" name="odai_id" value={odaiId} />
        <textarea
          name="text"
          required
          rows={3}
          maxLength={500}
          placeholder={myAnswerCount === 0 ? "回答を書く" : "もう1つ書く"}
          className="w-full resize-none rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
        >
          {pending ? "送信中…" : "回答する"}
        </button>
        <p className="text-xs text-muted">
          何個でも出せます（このお題にあと{left}個）。回答はすぐ全員に出ますが、
          誰が書いたかは結果発表まで伏せられます。あとから消したり直したりはできません。
        </p>
        <ErrorText message={state.error} />
      </form>
    </Panel>
  );
}

function PickForm({
  odaiId,
  answers,
  myPicks,
  maxPicks,
  pickable,
}: {
  odaiId: number;
  answers: AnswerView[];
  myPicks: Pick[];
  maxPicks: number;
  pickable: number;
}) {
  const [selected, setSelected] = useState<number[]>(() =>
    myPicks
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map((p) => p.answer_id),
  );
  const [state, action, pending] = useActionState<ActionState, FormData>(submitPicks, {});

  function toggle(answerId: number) {
    setSelected((prev) => {
      const at = prev.indexOf(answerId);
      if (at !== -1) return prev.filter((id) => id !== answerId);
      if (prev.length >= maxPicks) return prev;
      return [...prev, answerId];
    });
  }

  // 選び直しの途中で対象の回答が消えることはない（回答は削除できない）ので、
  // 送信対象は選択順そのままでよい。
  const alreadyPicked = myPicks.length > 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {pickable === 0
          ? "まだ他の人の回答がありません。集まったら面白い順に選んでください。"
          : `面白かった順に最大${maxPicks}つ選んでください。途中まででも送れます。回答が増えたら何度でも選び直せます。`}
      </p>

      <ul className="space-y-2">
        {answers.map((a) => {
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

      {pickable > 0 && (
        <Panel>
          <form action={action} className="space-y-3">
            <input type="hidden" name="odai_id" value={odaiId} />
            {selected.map((id, i) => (
              <input key={id} type="hidden" name={`rank_${i + 1}`} value={id} />
            ))}
            <button
              type="submit"
              disabled={pending || selected.length === 0}
              className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
            >
              {pending
                ? "送信中…"
                : selected.length === 0
                  ? "採点する回答を選んでください"
                  : alreadyPicked
                    ? `選び直して送信（${selected.length}件）`
                    : `この順位で採点する（${selected.length}件）`}
            </button>
            {alreadyPicked && (
              <p className="text-xs text-muted">
                採点済みです。結果発表までは何度でも選び直せます。誰が誰を選んだかは
                結果発表まで他の人には見えません。
              </p>
            )}
            <ErrorText message={state.error} />
          </form>
        </Panel>
      )}
    </div>
  );
}

function CloseOdaiButton({ odaiId }: { odaiId: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(closeOdai, {});

  return (
    <form action={action} className="space-y-2 border-t border-line pt-4">
      <input type="hidden" name="odai_id" value={odaiId} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md border border-line px-4 py-2 text-sm font-medium hover:border-white/25 disabled:opacity-40"
      >
        {pending ? "処理中…" : "締め切って結果を発表する"}
      </button>
      <p className="text-xs text-muted">
        出題者だけが操作できます。発表すると回答も採点も締め切られ、誰が何を書いて
        誰を選んだかが全員に公開されます。
      </p>
      <ErrorText message={state.error} />
    </form>
  );
}
