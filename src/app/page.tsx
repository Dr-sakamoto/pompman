import Link from "next/link";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { OdaiPlay } from "./ai/OdaiPlay";

// 回答が足りないと、その場で AI が書いて審査役が採点する（Server Action はこのページの設定で動く）。
export const maxDuration = 300;

type WeeklyOdai = { id: number; week_start: string; text: string };

function weekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", timeZone: "Asia/Tokyo" });
  return `${fmt(start)}〜${fmt(end)}`;
}

export default async function HomePage() {
  const supabase = await createClient();
  const [{ user }, { data: weekRows, error: weekError }] = await Promise.all([
    requireMember(),
    supabase.rpc("ensure_weekly_odai"),
  ]);
  const week = ((weekRows ?? []) as WeeklyOdai[])[0];

  return (
    <div className="space-y-6">
      {week ? (
        <>
          <div className="space-y-1">
            <p className="text-xs text-muted">
              今週のお題（{weekLabel(week.week_start)}）・{user.handle} さん
            </p>
            <h1 className="text-xl font-bold leading-snug">{week.text}</h1>
          </div>
          <OdaiPlay odaiId={week.id} picksLabel="今週あなたが選んだもの" />
        </>
      ) : (
        <p className="text-sm text-muted">
          {weekError
            ? `今週のお題を用意できませんでした: ${weekError.message}`
            : "お題のストックがまだありません。"}
        </p>
      )}

      <Link
        href="/ask"
        className="block rounded-lg border border-line bg-panel p-4 transition hover:border-white/25"
      >
        <p className="font-bold">相談する →</p>
        <p className="mt-1 text-xs text-muted">
          ネタで欲しいボケを大喜利のお題の形にして投げると、審査役が選び抜いた10個が返ってきます。
        </p>
      </Link>

      <Link href="/stats" className="block text-sm text-muted hover:text-white">
        週ごとの当たり率と、終わった週の殿堂 →
      </Link>

      {user.role === "admin" && (
        <Link href="/invites" className="block text-sm text-muted hover:text-white">
          + 招待コードを発行してメンバーを増やす
        </Link>
      )}
    </div>
  );
}
