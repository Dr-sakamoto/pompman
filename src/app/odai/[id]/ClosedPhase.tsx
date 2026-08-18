import { tally } from "@/lib/scoring";
import type { AnswerView, Pick } from "@/lib/types";

export function ClosedPhase({
  answers,
  picks,
  skips,
  handles,
  currentUserId,
}: {
  answers: AnswerView[];
  picks: Pick[];
  skips: number;
  handles: Record<string, string>;
  currentUserId: string;
}) {
  const results = tally(answers, picks);
  const voters = new Set(picks.map((p) => p.voter_id)).size;

  // 全体順位は誰にも見せない。自分の回答の順位・得点だけ、本人にだけ見せる。
  const myResults = results
    .map((r, i) => ({ ...r, rank: i + 1 }))
    .filter((r) => r.answer.author_id === currentUserId);

  return (
    <div className="space-y-4">
      {/*
        「選ぶ回答なし」で終えた人も採点を終えた人（0016）。0票が並ぶ結果のとき、
        それが「誰も見ていない」のか「見た上で誰も選ばなかった」のかで意味が
        まるで違うので、人数を分けて出す。
      */}
      <p className="text-sm text-muted">
        回答 {answers.length}件 / 採点した人 {voters}人
        {skips > 0 && `（ほかに「選ぶ回答なし」${skips}人）`} ・ 1位=3点 / 2位=2点 / 3位=1点
      </p>

      {myResults.length > 0 && (
        <div className="rounded-lg border border-accent bg-accent/5 p-4">
          <p className="mb-2 text-sm font-bold">あなたの結果</p>
          <ul className="space-y-1 text-sm">
            {myResults.map((r) => (
              <li key={r.answer.id} className="text-muted">
                {r.answer.text}: {r.rank}位 / {r.score}点
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-3">
        {answers.map((answer) => (
          <li key={answer.id} className="rounded-lg border border-line bg-panel p-4">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="text-sm font-bold">
                {handles[answer.author_id ?? ""] ?? "?"}
                {answer.is_ai && (
                  <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-xs font-normal text-muted">
                    AI{answer.model_ver ? ` / ${answer.model_ver}` : ""}
                  </span>
                )}
              </span>
            </div>

            <p className="whitespace-pre-wrap">{answer.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
