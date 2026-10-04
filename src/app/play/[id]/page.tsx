import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Panel } from "@/components/ui";
import { PickBoard, RetryButton } from "./PickBoard";

// 選び終えるたびに、その場で AI が次の10個を考える。
export const maxDuration = 120;

type Candidate = { id: number; position: number; text: string; picked: boolean };
type Round = {
  id: number;
  round_no: number;
  taste_note: string | null;
  submitted_at: string | null;
  ogiri_candidates: Candidate[];
};

export default async function PlayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) notFound();

  const supabase = await createClient();
  const [, { data: session }, { data: roundRows }] = await Promise.all([
    requireMember(),
    supabase.from("ogiri_sessions").select("id, odai_text").eq("id", sessionId).maybeSingle(),
    supabase
      .from("ogiri_rounds")
      .select("id, round_no, taste_note, submitted_at, ogiri_candidates(id, position, text, picked)")
      .eq("session_id", sessionId)
      .order("round_no"),
  ]);
  if (!session) notFound();

  const rounds = ((roundRows ?? []) as Round[]).map((r) => ({
    ...r,
    ogiri_candidates: [...r.ogiri_candidates].sort((a, b) => a.position - b.position),
  }));
  const current = rounds.find((r) => !r.submitted_at);
  const done = rounds.filter((r) => r.submitted_at);
  const best = done.flatMap((r) =>
    r.ogiri_candidates.filter((c) => c.picked).map((c) => ({ ...c, roundNo: r.round_no })),
  );

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-muted hover:text-white">
        ← お題一覧
      </Link>

      <div className="space-y-1">
        <p className="text-xs text-muted">お題</p>
        <h1 className="text-xl font-bold leading-snug">{session.odai_text}</h1>
      </div>

      {current ? (
        <PickBoard
          key={current.id}
          sessionId={sessionId}
          roundId={current.id}
          roundNo={current.round_no}
          tasteNote={current.taste_note}
          candidates={current.ogiri_candidates.map(({ id, text }) => ({ id, text }))}
        />
      ) : (
        <Panel className="space-y-3">
          <p className="text-sm text-muted">次の10個がまだありません。</p>
          <RetryButton sessionId={sessionId} />
        </Panel>
      )}

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-muted">回ごとの当たり数</h2>
          <ul className="space-y-1">
            {done.map((r) => {
              const hits = r.ogiri_candidates.filter((c) => c.picked).length;
              const total = r.ogiri_candidates.length || 1;
              return (
                <li key={r.id} className="flex items-center gap-3 text-xs">
                  <span className="w-10 shrink-0 text-muted">{r.round_no}回目</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${(hits / total) * 100}%` }}
                    />
                  </span>
                  <span className="w-12 shrink-0 text-right tabular-nums">
                    {hits}/{r.ogiri_candidates.length}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {best.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-muted">選んだ回答（{best.length}）</h2>
          <ul className="space-y-2">
            {best.map((c) => (
              <li key={c.id} className="rounded-lg border border-line bg-panel px-4 py-3">
                <p>{c.text}</p>
                <p className="mt-1 text-xs text-muted">{c.roundNo}回目</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
