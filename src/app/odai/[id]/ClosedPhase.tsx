import { tally } from "@/lib/scoring";
import type { AnswerView, Pick } from "@/lib/types";

export function ClosedPhase({
  answers,
  picks,
  handles,
}: {
  answers: AnswerView[];
  picks: Pick[];
  handles: Record<string, string>;
}) {
  const results = tally(answers, picks);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">1位=3点 / 2位=2点 / 3位=1点</p>

      <ul className="space-y-3">
        {results.map(({ answer, score, picks: got }, i) => (
          <li
            key={answer.id}
            className={`rounded-lg border p-4 ${
              score > 0 && i === 0 ? "border-accent bg-accent/5" : "border-line bg-panel"
            }`}
          >
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="text-sm font-bold">
                {handles[answer.author_id ?? ""] ?? "?"}
                {answer.is_ai && (
                  <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-xs font-normal text-muted">
                    AI{answer.model_ver ? ` / ${answer.model_ver}` : ""}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-sm text-muted">{score}点</span>
            </div>

            <p className="mb-3 whitespace-pre-wrap">{answer.text}</p>

            {got.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {got.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-full border border-line px-2 py-0.5 text-xs text-muted"
                  >
                    {handles[p.voter_id] ?? "?"} → {p.rank}位
                  </li>
                ))}
              </ul>
            ) : (
              // 誰にも選ばれなかった回答も必ず出す。消さない・隠さない。
              <p className="text-xs text-muted">誰にも選ばれませんでした</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
