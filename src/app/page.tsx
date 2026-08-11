import Link from "next/link";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Odai, Phase } from "@/lib/types";
import { PHASE_LABEL } from "@/lib/types";
import { PhaseBadge, TodoBadge } from "@/components/ui";
import { AiProgress } from "@/components/AiProgress";

const SECTIONS: Phase[] = ["open", "closed"];

export default async function HomePage() {
  const { user } = await requireMember();
  const supabase = await createClient();

  const [
    { data: odaiRows },
    { data: myAnswers },
    { data: countRows },
    { data: myPicks },
    { data: progressRows },
  ] = await Promise.all([
    supabase.from("odai").select("*").order("created_at", { ascending: false }),
    // 自分の回答はいつでも読める（他人の回答は自分が回答するまで読めない）。
    supabase.from("answers_view").select("odai_id").eq("is_mine", true),
    // 回答数は件数だけなので、まだ回答していないお題の分も出る。
    supabase.rpc("odai_answer_counts"),
    supabase.from("picks").select("odai_id").eq("voter_id", user.id),
    supabase.rpc("ai_progress_stats"),
  ]);

  const odai = (odaiRows ?? []) as Odai[];
  const myAnswerCount = new Map<number, number>();
  for (const a of (myAnswers ?? []) as { odai_id: number }[]) {
    myAnswerCount.set(a.odai_id, (myAnswerCount.get(a.odai_id) ?? 0) + 1);
  }
  const answerCount = new Map(
    ((countRows ?? []) as { odai_id: number; answer_count: number }[]).map((r) => [
      r.odai_id,
      Number(r.answer_count),
    ]),
  );
  const scored = new Set((myPicks ?? []).map((p) => p.odai_id as number));
  const picksCount = progressRows?.[0]?.picks_count ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{user.handle} さん</p>
        <Link
          href="/odai/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-ink"
        >
          お題を出す
        </Link>
      </div>

      <AiProgress picksCount={picksCount} />

      {user.role === "admin" && (
        <Link href="/invites" className="block text-sm text-muted hover:text-white">
          + 招待コードを発行してメンバーを増やす
        </Link>
      )}

      {odai.length === 0 && (
        <p className="text-sm text-muted">
          まだお題がありません。最初の1つを出してください。
        </p>
      )}

      {SECTIONS.map((phase) => {
        const rows = odai.filter((o) => o.phase === phase);
        if (rows.length === 0) return null;

        return (
          <section key={phase} className="space-y-2">
            <h2 className="text-sm font-bold text-muted">{PHASE_LABEL[phase]}</h2>
            <ul className="space-y-2">
              {rows.map((o) => {
                const count = answerCount.get(o.id) ?? 0;
                const mine = myAnswerCount.get(o.id) ?? 0;
                const todo =
                  o.phase !== "open"
                    ? null
                    : mine === 0
                      ? "未回答"
                      : // 他人の回答が1つも無いうちは採点できないので急かさない
                        count > mine && !scored.has(o.id)
                        ? "未採点"
                        : null;

                return (
                  <li key={o.id}>
                    <Link
                      href={`/odai/${o.id}`}
                      className={`block rounded-lg border bg-panel p-4 transition hover:border-white/25 ${
                        todo ? "border-accent/60" : "border-line"
                      }`}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <PhaseBadge phase={o.phase} />
                        {todo && <TodoBadge>{todo}</TodoBadge>}
                        <span className="ml-auto text-xs text-muted">回答 {count}件</span>
                      </div>
                      <p className="font-medium">{o.text}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
