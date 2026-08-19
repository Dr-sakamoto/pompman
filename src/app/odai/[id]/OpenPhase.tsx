"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  closeOdai,
  deleteOdai,
  editOdai,
  submitAnswer,
  submitPicks,
  unlockAnswers,
  type ActionState,
  type EditOdaiState,
} from "@/app/actions";
import { ErrorText, Panel } from "@/components/ui";
import { seededOrder } from "@/lib/scoring";
import {
  AUTO_UNLOCK_IDLE_HOURS,
  MAX_ANSWERS_PER_ODAI,
  MAX_PICKS,
  MIN_SCORERS_TO_CLOSE,
  type AnswerView,
  type Odai,
  type Pick,
} from "@/lib/types";

const RANK_LABEL = ["1位", "2位", "3位"];

/**
 * 回答と採点が同居するフェーズ。
 *
 * 他人の回答は「自分が採点に進む」まで見えない（DB 側で担保）。採点に進むのは
 * 片道切符 —— 進んだ瞬間に全回答が見えて採点できるようになる代わりに、
 * そのお題への回答追加はできなくなる。回答を書いていなくても採点だけの
 * 参加として進める（採点が一番大事な機能なので、そこへのハードルは低くする）。
 *
 * 誰が書いたかは結果発表まで伏せたまま。採点（picks）も結果発表まで他人には見えない。
 */
export function OpenPhase({
  odai,
  answers,
  answerCount,
  unlocked,
  myPicks,
  mySkipped,
  voterId,
  isOwner,
}: {
  odai: Odai;
  answers: AnswerView[];
  answerCount: number;
  unlocked: boolean;
  myPicks: Pick[];
  mySkipped: boolean;
  voterId: string;
  isOwner: boolean;
}) {
  // 投稿順のままだと先に出した人が有利。並びは (お題, 採点者) で固定して散らす。
  const ordered = useMemo(
    () => seededOrder(answers, `${odai.id}:${voterId}`, (a) => a.id),
    [answers, odai.id, voterId],
  );

  const myAnswerCount = answers.filter((a) => a.is_mine).length;
  const pickable = unlocked ? answers.length - myAnswerCount : 0;
  const maxPicks = Math.min(MAX_PICKS, pickable);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-bold">回答 {answerCount}件</span>
        <span className="text-muted">
          {myAnswerCount > 0 ? `うちあなたの回答 ${myAnswerCount}件` : "あなたはまだ回答していません"}
        </span>
        <RefreshButton />
      </div>

      {!unlocked && <AnswerForm odaiId={odai.id} myAnswerCount={myAnswerCount} />}

      {!unlocked ? (
        <UnlockPanel odaiId={odai.id} myAnswerCount={myAnswerCount} answerCount={answerCount} />
      ) : (
        <PickForm
          odaiId={odai.id}
          answers={ordered}
          myPicks={myPicks}
          mySkipped={mySkipped}
          maxPicks={maxPicks}
          pickable={pickable}
        />
      )}

      {isOwner && answerCount === 0 && <EditDeleteOdaiPanel odai={odai} />}

      {isOwner && <CloseOdaiButton odaiId={odai.id} />}
    </div>
  );
}

/**
 * お題の編集・削除。出題者だけに見える。まだ誰も回答していない間だけ操作できる
 * （回答が付いた後にお題の本文が変わったり消えたりすると、その回答が何に対する
 * 回答か分からなくなるため。実際の許可判定は DB 側の RLS）。
 */
function EditDeleteOdaiPanel({ odai }: { odai: Odai }) {
  const [editing, setEditing] = useState(false);
  const [editState, editAction, editPending] = useActionState<EditOdaiState, FormData>(
    editOdai,
    {},
  );
  const [deleteState, deleteAction, deletePending] = useActionState<ActionState, FormData>(
    deleteOdai,
    {},
  );

  useEffect(() => {
    if (editState.done) setEditing(false);
  }, [editState]);

  if (!editing) {
    return (
      <div className="flex items-center gap-3 border-t border-line pt-4 text-sm">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-muted hover:text-white"
        >
          お題を編集する
        </button>
        <form
          action={deleteAction}
          onSubmit={(e) => {
            if (!window.confirm("このお題を削除します。よろしいですか？")) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="odai_id" value={odai.id} />
          <button
            type="submit"
            disabled={deletePending}
            className="text-red-300 hover:text-red-200 disabled:opacity-40"
          >
            {deletePending ? "削除中…" : "お題を削除する"}
          </button>
        </form>
        <ErrorText message={deleteState.error} />
      </div>
    );
  }

  return (
    <Panel className="space-y-3 border-t border-line">
      <form action={editAction} className="space-y-3">
        <input type="hidden" name="odai_id" value={odai.id} />
        <textarea
          name="text"
          required
          rows={3}
          maxLength={200}
          defaultValue={odai.text}
          className="w-full resize-none rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={editPending}
            className="flex-1 rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
          >
            {editPending ? "保存中…" : "保存する"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md border border-line px-4 py-2 text-sm hover:border-white/25"
          >
            キャンセル
          </button>
        </div>
        <ErrorText message={editState.error} />
      </form>
    </Panel>
  );
}

/** 回答数など、見えている範囲の最新値を取りに行く。選択中の状態は消えない。 */
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
          このお題への回答は上限（{MAX_ANSWERS_PER_ODAI}個）に達しました。下の
          「採点に進む」から他の人の回答を見て採点できます。
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
          何個でも書けます（このお題にあと{left}個）。あとから消したり直したりはできません。
        </p>
        <ErrorText message={state.error} />
      </form>
    </Panel>
  );
}

/** 採点に進む。片道切符 —— 押すとそのお題には回答を追加できなくなる。回答を書いていなくても押せる。 */
function UnlockPanel({
  odaiId,
  myAnswerCount,
  answerCount,
}: {
  odaiId: number;
  myAnswerCount: number;
  answerCount: number;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(unlockAnswers, {});

  return (
    <Panel className="space-y-3 border-dashed">
      <p className="text-sm font-bold">他の人の回答は伏せられています</p>
      <p className="text-sm text-muted">
        採点に進むとその場にある{answerCount > 0 ? `${answerCount}件` : "回答"}
        が見えるようになります。
        {myAnswerCount > 0 && (
          <>
            {" "}
            <strong className="text-white">進むと、このお題にはもう回答を追加できません</strong>
            （片道切符）。
          </>
        )}
      </p>
      {myAnswerCount > 0 && (
        <p className="text-sm text-muted">
          押し忘れても止まらないように、
          <strong className="text-white">
            最後に書いてから{AUTO_UNLOCK_IDLE_HOURS}時間経つと自動で解禁されます
          </strong>
          。まだ書き足すつもりなら、それまでに書いてください。
        </p>
      )}
      <form action={action} className="space-y-2">
        <input type="hidden" name="odai_id" value={odaiId} />
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
        >
          {pending ? "処理中…" : "採点に進む"}
        </button>
        <ErrorText message={state.error} />
      </form>
    </Panel>
  );
}

function PickForm({
  odaiId,
  answers,
  myPicks,
  mySkipped,
  maxPicks,
  pickable,
}: {
  odaiId: number;
  answers: AnswerView[];
  myPicks: Pick[];
  mySkipped: boolean;
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
  const [skipState, skipAction, skipPending] = useActionState<ActionState, FormData>(
    submitPicks,
    {},
  );

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

  const skipInitial = useRef(true);
  useEffect(() => {
    if (skipInitial.current) {
      skipInitial.current = false;
      return;
    }
    if (!skipPending && !skipState.error) setSelected([]);
  }, [skipState, skipPending]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {pickable === 0
          ? "まだ他の人の回答がありません。集まったら面白い順に選んでください。"
          : `面白かった順に最大${maxPicks}つ選んでください。途中まででも送れます。回答が増えたら何度でも選び直せます。`}
      </p>

      {mySkipped && selected.length === 0 && (
        <p className="text-sm text-muted">
          「何も選ばない」で採点を終えています。気が変わったら下から選んで送信し直せます。
        </p>
      )}

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

          <form action={skipAction} className="mt-3 space-y-2 border-t border-line pt-3">
            <input type="hidden" name="odai_id" value={odaiId} />
            <button
              type="submit"
              disabled={skipPending}
              className="w-full rounded-md border border-line px-4 py-2 text-sm hover:border-white/25 disabled:opacity-40"
            >
              {skipPending ? "送信中…" : "何も選ばない（採点を終える）"}
            </button>
            <p className="text-xs text-muted">
              面白い回答が無かったときはこちら。採点は0件のまま終えたことになります。
            </p>
            <ErrorText message={skipState.error} />
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
      {/* 自動発表の条件は画面上部の進捗バー2本が出しているので、ここでは繰り返さない。 */}
      <p className="text-xs text-muted">
        出題者だけが操作できます。発表すると回答も採点も締め切られ、誰が何を書いて
        誰を選んだかが全員に公開されます。押さなくても、上の2本のバーのどちらかが
        埋まれば自動で発表されます。採点した人が{MIN_SCORERS_TO_CLOSE}人に届くまでは、
        押しても待っても発表されません（採点0の順位表を出さないため）。
      </p>
      <ErrorText message={state.error} />
    </form>
  );
}
