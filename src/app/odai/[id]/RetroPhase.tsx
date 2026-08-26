"use client";

import { useActionState, useMemo } from "react";
import { revealResults, type ActionState } from "@/app/actions";
import { ErrorText, Panel } from "@/components/ui";
import { seededOrder } from "@/lib/scoring";
import { MAX_PICKS, type AnswerView, type Odai, type Pick } from "@/lib/types";
import { PickForm } from "./PickForm";

/**
 * 結果発表済みのお題を、まだ採点していない人が後から採点する画面。
 *
 * 発表されていても、この人にとっては**まだ何も開いていない** —— 回答者名も
 * 他人の採点も伏せたまま（DB 側で担保。0023）。だから採点条件は発表前と同じで、
 * ここで付く順位は「他人を見る前に付けた順位」のまま残る。
 *
 * 違うのは一度きりだということ。採点を送るか「結果を見る」を押すかのどちらかで
 * 結果が開き、開いた後はもう採点できない（結果を見てから付けた順位は、
 * 他の人に合わせただけの記録に化けるため）。
 */
export function RetroPhase({
  odai,
  answers,
  myPicks,
  mySkipped,
  voterId,
}: {
  odai: Odai;
  answers: AnswerView[];
  myPicks: Pick[];
  mySkipped: boolean;
  voterId: string;
}) {
  // 並びは発表前と同じ規則（投稿順のままだと先に出した人が有利）。
  const ordered = useMemo(
    () => seededOrder(answers, `${odai.id}:${voterId}`, (a) => a.id),
    [answers, odai.id, voterId],
  );

  const myAnswerCount = answers.filter((a) => a.is_mine).length;
  const pickable = answers.length - myAnswerCount;
  const maxPicks = Math.min(MAX_PICKS, pickable);

  return (
    <div className="space-y-6">
      <Panel className="space-y-3 border-dashed">
        <p className="text-sm font-bold">このお題はもう結果発表されていますが、まだ採点できます</p>
        <p className="text-sm text-muted">
          あなたはこのお題をまだ採点していません。
          <strong className="text-white">誰が書いたか・誰が誰を選んだかは伏せたまま</strong>
          なので、いま採点しても発表前と同じ条件で選べます。採点を送ると、そのあとに結果が出ます。
        </p>
        <p className="text-sm text-muted">
          回答 {answers.length}件
          {myAnswerCount > 0 && `（うちあなたの回答 ${myAnswerCount}件）`}
        </p>
      </Panel>

      <PickForm
        odaiId={odai.id}
        answers={ordered}
        myPicks={myPicks}
        mySkipped={mySkipped}
        maxPicks={maxPicks}
        pickable={pickable}
        retro
      />

      <RevealButton odaiId={odai.id} />
    </div>
  );
}

/** 採点せずに結果だけ見る。片道切符 —— 押したらそのお題は二度と採点できない。 */
function RevealButton({ odaiId }: { odaiId: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(revealResults, {});

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("結果を見ると、このお題はもう採点できなくなります。よろしいですか？")) {
          e.preventDefault();
        }
      }}
      className="space-y-2 border-t border-line pt-4"
    >
      <input type="hidden" name="odai_id" value={odaiId} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md border border-line px-4 py-2 text-sm text-muted hover:border-white/25 hover:text-white disabled:opacity-40"
      >
        {pending ? "処理中…" : "採点せずに結果を見る"}
      </button>
      <p className="text-xs text-muted">
        一度見ると、このお題はもう採点できません（片道切符）。
      </p>
      <ErrorText message={state.error} />
    </form>
  );
}
