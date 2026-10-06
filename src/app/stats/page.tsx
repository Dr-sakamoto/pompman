import Link from "next/link";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Panel } from "@/components/ui";

type WeekStats = {
  week_start: string;
  odai_text: string;
  pickers: number;
  sets: number;
  first_set_hits: number | null;
  top_shown: number;
  top_picked: number;
  explore_shown: number;
  explore_picked: number;
  judge_pair_acc: number | null;
  answers_made: number;
};

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

export default async function StatsPage() {
  const supabase = await createClient();
  const [, { data }] = await Promise.all([requireMember(), supabase.rpc("ai_weekly_stats")]);
  const weeks = (data ?? []) as WeekStats[];

  // 殿堂は終わった週の分しか返らない（今週の分は選んでいる人の判定に混ざるため）。
  // 新しい週から順に見て、最初に中身のあった週を出す。
  const { data: weeklyRows } = await supabase
    .from("ai_odai")
    .select("id, week_start")
    .eq("kind", "weekly")
    .order("week_start", { ascending: false })
    .limit(2);
  let lastWeek: { id: number; week_start: string } | undefined;
  let hall: { answer: string; shown_count: number; picked_count: number }[] = [];
  for (const w of (weeklyRows ?? []) as { id: number; week_start: string }[]) {
    const { data: hallRows } = await supabase.rpc("ai_hall_of_fame", { p_ai_odai_id: w.id });
    if (hallRows && hallRows.length > 0) {
      lastWeek = w;
      hall = hallRows as typeof hall;
      break;
    }
  }
  const lastWeekText = weeks.find((w) => w.week_start === lastWeek?.week_start)?.odai_text;

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-muted hover:text-white">
        ← 今週のお題
      </Link>
      <h1 className="text-xl font-bold">週ごとの当たり率</h1>

      <Panel className="space-y-1 text-xs text-muted">
        <p>
          <b className="text-white">はじめの10個</b>
          …その週に初めて見た10個のうち選んだ数（1人あたり平均）。いちばん素直な当たり率。目標は 10。
        </p>
        <p>
          <b className="text-white">上位枠 / 試し枠</b>
          …審査役が推した枠と、無作為に混ぜた枠の当たり率。差が大きいほど審査役が効いている。
        </p>
        <p>
          <b className="text-white">審査役の目利き</b>
          …同じ10個の中で「選ばれた方に高い点を付けていた」割合。50% は当てずっぽう。
        </p>
      </Panel>

      {weeks.length === 0 ? (
        <p className="text-sm text-muted">まだ記録がありません。</p>
      ) : (
        <ul className="space-y-3">
          {weeks.map((w) => (
            <li key={w.week_start} className="rounded-lg border border-line bg-panel p-4">
              <p className="text-xs text-muted">{w.week_start} の週</p>
              <p className="font-medium">{w.odai_text}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted">はじめの10個</dt>
                  <dd className="text-lg font-bold tabular-nums">
                    {w.first_set_hits == null ? "—" : `${w.first_set_hits.toFixed(1)} / 10`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">審査役の目利き</dt>
                  <dd className="text-lg font-bold tabular-nums">
                    {w.judge_pair_acc == null ? "—" : `${Math.round(w.judge_pair_acc * 100)}%`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">上位枠の当たり</dt>
                  <dd className="tabular-nums">
                    {pct(w.top_picked, w.top_shown)}（{w.top_picked}/{w.top_shown}）
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">試し枠の当たり</dt>
                  <dd className="tabular-nums">
                    {pct(w.explore_picked, w.explore_shown)}（{w.explore_picked}/{w.explore_shown}）
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-muted">
                {w.pickers}人 ・ {w.sets}回 ・ AI が作った回答 {w.answers_made}個
              </p>
            </li>
          ))}
        </ul>
      )}

      {lastWeek && hall.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-muted">前の週の殿堂{lastWeekText ? `「${lastWeekText}」` : ""}</h2>
          <ul className="space-y-2">
            {hall.map((h, i) => (
              <li key={i} className="rounded-lg border border-line bg-panel px-4 py-3">
                <p>{h.answer}</p>
                <p className="mt-1 text-xs text-muted">
                  {h.shown_count}人中 {h.picked_count}人が選んだ
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
