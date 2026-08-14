import type { ContributionRankingRow } from "@/lib/types";
import { Panel } from "@/components/ui";

const MEDAL = ["🥇", "🥈", "🥉"];

export function ContributionRanking({
  rows,
  myUserId,
}: {
  rows: ContributionRankingRow[];
  myUserId: string;
}) {
  if (rows.length === 0) {
    return (
      <Panel>
        <p className="text-sm text-muted">
          まだ結果発表済みのお題がありません。お題が締め切られるとここに載ります。
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="divide-y divide-line p-0">
      {rows.map((row, i) => {
        const total = row.answer_count + row.odai_count;
        const mine = row.user_id === myUserId;

        return (
          <div
            key={row.user_id}
            className={`flex items-center gap-3 px-4 py-3 ${mine ? "bg-accent/5" : ""}`}
          >
            <span className="w-6 shrink-0 text-center text-sm text-muted">
              {MEDAL[i] ?? i + 1}
            </span>
            <span className={`flex-1 truncate font-medium ${mine ? "text-accent" : ""}`}>
              {row.handle}
              {mine && <span className="ml-1 text-xs text-muted">(あなた)</span>}
            </span>
            <span className="shrink-0 text-right text-xs text-muted">
              <span className="font-bold text-white">{total}</span> 投稿
              <span className="ml-1.5">
                （回答{row.answer_count} / お題{row.odai_count}）
              </span>
            </span>
          </div>
        );
      })}
    </Panel>
  );
}
