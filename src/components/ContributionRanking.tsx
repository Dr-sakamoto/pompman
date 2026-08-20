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
          まだ投稿・採点がありません。回答したりお題を出したり採点したりするとここに載ります。
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="divide-y divide-line p-0">
      {rows.map((row, i) => {
        const total = row.answer_count + row.odai_count + row.pick_count;
        const mine = row.user_id === myUserId;

        return (
          <div
            key={row.user_id}
            className={`flex items-start gap-3 px-4 py-3 ${mine ? "bg-accent/5" : ""}`}
          >
            <span className="w-6 shrink-0 text-center text-sm text-muted">
              {MEDAL[i] ?? i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`truncate font-medium ${mine ? "text-accent" : ""}`}>
                {row.handle}
                {mine && <span className="ml-1 text-xs text-muted">(あなた)</span>}
              </div>
              <div className="text-xs text-muted">
                <span className="font-bold text-white">{total}</span> 貢献
                <span className="ml-1.5">
                  （回答{row.answer_count} / お題{row.odai_count} / 採点{row.pick_count}）
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </Panel>
  );
}
