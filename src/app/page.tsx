import Link from "next/link";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { StartForm } from "./play/StartForm";

// お題を出すと、その場で AI が最初の10個を考える（Server Action はこのページの設定で動く）。
export const maxDuration = 120;

type SessionRow = {
  id: number;
  odai_text: string;
  created_at: string;
  ogiri_rounds: { ogiri_candidates: { picked: boolean }[] }[];
};

export default async function HomePage() {
  const supabase = await createClient();
  const [{ user }, { data }] = await Promise.all([
    requireMember(),
    supabase
      .from("ogiri_sessions")
      .select("id, odai_text, created_at, ogiri_rounds(ogiri_candidates(picked))")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const sessions = (data ?? []) as SessionRow[];

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-sm text-muted">{user.handle} さん</p>
        <h1 className="text-2xl font-bold">AIが10個出す。あなたは選ぶだけ。</h1>
        <p className="text-sm text-muted">
          面白いと思った回答を選ぶほど、次の10個があなたのツボに寄っていきます。
        </p>
      </div>

      <StartForm />

      {user.role === "admin" && (
        <Link href="/invites" className="block text-sm text-muted hover:text-white">
          + 招待コードを発行してメンバーを増やす
        </Link>
      )}

      {sessions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-muted">これまでのお題</h2>
          <ul className="space-y-2">
            {sessions.map((s) => {
              const candidates = s.ogiri_rounds.flatMap((r) => r.ogiri_candidates);
              const picked = candidates.filter((c) => c.picked).length;
              return (
                <li key={s.id}>
                  <Link
                    href={`/play/${s.id}`}
                    className="block rounded-lg border border-line bg-panel p-4 transition hover:border-white/25"
                  >
                    <p className="font-medium">{s.odai_text}</p>
                    <p className="mt-1 text-xs text-muted">
                      {s.ogiri_rounds.length}回 ・ {candidates.length}個中 {picked}個 選んだ
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
