import Link from "next/link";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { WeekBoard } from "./week/WeekBoard";

// 回答が足りないと、その場で AI が書いて審査役が採点する（Server Action はこのページの設定で動く）。
export const maxDuration = 300;

type WeeklyOdai = { id: number; week_start: string; text: string };
type SetRow = {
  id: number;
  submitted_at: string | null;
  ai_set_items: { answer_id: number; position: number; picked: boolean; ai_answers: { text: string } }[];
};

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

  if (!week) {
    return (
      <p className="text-sm text-muted">
        {weekError ? `今週のお題を用意できませんでした: ${weekError.message}` : "お題のストックがまだありません。"}
      </p>
    );
  }

  const { data: setRows } = await supabase
    .from("ai_sets")
    .select("id, submitted_at, ai_set_items(answer_id, position, picked, ai_answers(text))")
    .eq("weekly_odai_id", week.id)
    .order("created_at");
  const sets = (setRows ?? []) as unknown as SetRow[];
  const open = sets.find((s) => !s.submitted_at);
  const done = sets.filter((s) => s.submitted_at);
  const myPicks = done.flatMap((s) => s.ai_set_items.filter((i) => i.picked));
  const seenCount = done.reduce((n, s) => n + s.ai_set_items.length, 0);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs text-muted">
          今週のお題（{weekLabel(week.week_start)}）・{user.handle} さん
        </p>
        <h1 className="text-xl font-bold leading-snug">{week.text}</h1>
      </div>

      <WeekBoard
        weeklyId={week.id}
        setId={open?.id ?? null}
        items={
          open
            ? [...open.ai_set_items]
                .sort((a, b) => a.position - b.position)
                .map((i) => ({ answerId: i.answer_id, text: i.ai_answers.text }))
            : []
        }
      />

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-muted">
            今週あなたが選んだもの（{seenCount}個中 {myPicks.length}個）
          </h2>
          {myPicks.length > 0 && (
            <ul className="space-y-2">
              {myPicks.map((i) => (
                <li key={i.answer_id} className="rounded-lg border border-line bg-panel px-4 py-3">
                  {i.ai_answers.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Link href="/stats" className="block text-sm text-muted hover:text-white">
        週ごとの当たり率と、先週までの殿堂 →
      </Link>

      {user.role === "admin" && (
        <Link href="/invites" className="block text-sm text-muted hover:text-white">
          + 招待コードを発行してメンバーを増やす
        </Link>
      )}
    </div>
  );
}
