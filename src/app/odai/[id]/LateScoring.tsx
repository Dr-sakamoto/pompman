"use client";

import { useActionState, useMemo } from "react";
import { revealResults, type ActionState } from "@/app/actions";
import { ErrorText, Panel } from "@/components/ui";
import { seededOrder } from "@/lib/scoring";
import { PickForm } from "./OpenPhase";
import type { AnswerView, Odai } from "@/lib/types";

/**
 * 結果発表後だが、まだ採点していない人に出す画面（0022）。
 *
 * 実測では解禁106件のうち51件（48%）が採点されないまま終わっていた。その多くは
 * 自動解禁 —— 本人が見ていない間に採点できる状態になり、気づいたら発表済み。
 * ここを開けるだけで、失われていた選好がそのまま教師データになる。
 *
 * ただし発表画面に採点ボタンを足すのでは駄目で、それをやると README §4.3 が
 * 禁じている2つ（誰が書いたかで選ぶ／他人の採点に同調する）がそのまま起きる。
 * 汚染するのは「いつ採点したか」ではなく「**採点する時点で何が見えていたか**」
 * なので、採点を先に置いて、結果はそのあとに回す。
 *
 * この画面で見えているものは open のときとまったく同じ —— 回答は匿名、
 * 他人の picks は伏せたまま（アプリ側の出し分けではなく DB 側の RLS で担保）。
 */
export function LateScoring({
  odai,
  answers,
  voterId,
}: {
  odai: Odai;
  answers: AnswerView[];
  voterId: string;
}) {
  // 並びは open のときと同じ (お題, 採点者) のハッシュ順。投稿順だと先着が有利。
  const ordered = useMemo(
    () => seededOrder(answers, `${odai.id}:${voterId}`, (a) => a.id),
    [answers, odai.id, voterId],
  );

  const pickable = answers.filter((a) => !a.is_mine).length;
  const maxPicks = Math.min(3, pickable);

  return (
    <div className="space-y-6">
      <Panel className="space-y-3 border-dashed">
        <p className="text-sm font-bold">このお題は結果が出ています</p>
        <p className="text-sm text-muted">
          ただし、あなたはまだ採点していません。
          <strong className="text-white">先に採点すると、そのあと結果が見られます</strong>
          。誰が書いたかも、誰が誰を選んだかも、まだ伏せてあります。
        </p>
        <p className="text-sm text-muted">
          あとから採点しても、あなたの選んだ結果はちゃんと集計に入ります。
        </p>
      </Panel>

      <PickForm
        odaiId={odai.id}
        answers={ordered}
        myPicks={[]}
        mySkipped={false}
        maxPicks={maxPicks}
        pickable={pickable}
        late
      />

      <RevealButton odaiId={odai.id} />
    </div>
  );
}

/**
 * 採点せずに結果だけ見る逃げ道。
 *
 * 「採点しないと結果が見られない」形にはしない。見たいだけの人に無理やり
 * 選ばせると、中身を読まずに適当に付けた picks が入る —— それは採点0より悪い
 * （README §4.3「中身を見ずに採点できると、picks が読んだ上での選好でなくなる」）。
 */
function RevealButton({ odaiId }: { odaiId: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(revealResults, {});

  return (
    <form action={action} className="space-y-2 border-t border-line pt-4">
      <input type="hidden" name="odai_id" value={odaiId} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md border border-line px-4 py-2 text-sm hover:border-white/25 disabled:opacity-40"
      >
        {pending ? "処理中…" : "採点せずに結果を見る"}
      </button>
      <p className="text-xs text-muted">
        こちらを選ぶと<strong className="text-white">このお題にはもう採点できません</strong>
        （片道切符）。結果を見てからの採点は、書いた人や他の人の採点を知った上での
        選択になってしまうため。
      </p>
      <ErrorText message={state.error} />
    </form>
  );
}
