import Link from "next/link";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ContributionRanking } from "@/components/ContributionRanking";
import { StreakBadge } from "@/components/StreakBadge";
import type { ContributionRankingRow, StreakStats } from "@/lib/types";

export default async function RankingPage() {
  const [{ user }, supabase] = await Promise.all([requireMember(), createClient()]);

  const [{ data: rankingRows }, { data: streakRows }] = await Promise.all([
    supabase.rpc("contribution_ranking"),
    supabase.rpc("my_streak"),
  ]);

  const ranking = (rankingRows ?? []) as ContributionRankingRow[];
  const streak = (streakRows?.[0] ?? { streak_days: 0, last_active_date: null }) as StreakStats;

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted hover:text-white">
        ← 一覧
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">貢献度ランキング</h1>
          <p className="mt-1 text-sm text-muted">
            結果発表済みのお題での投稿数（回答・お題）を集計しています。
          </p>
        </div>
        <StreakBadge streak={streak} />
      </div>

      <ContributionRanking rows={ranking} myUserId={user.id} />
    </div>
  );
}
