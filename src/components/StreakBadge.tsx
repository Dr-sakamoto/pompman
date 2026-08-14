import type { StreakStats } from "@/lib/types";

/**
 * 連続参加日数（回答 or 採点のどちらか）。習慣化を促すための表示専用バッジ。
 * 0日のときは「今日から」と出し、0を否定形で見せない（再開のハードルを上げないため）。
 */
export function StreakBadge({ streak }: { streak: StreakStats }) {
  const days = streak.streak_days;
  const active = days > 0;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${
        active
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-line bg-white/5 text-muted"
      }`}
      title={active ? `${days}日連続で参加中` : "今日、回答か採点をすると連続記録が始まります"}
    >
      <span aria-hidden>🔥</span>
      {active ? `${days}日連続` : "今日から"}
    </span>
  );
}
