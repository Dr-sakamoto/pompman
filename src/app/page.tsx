import Link from "next/link";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Odai, Phase } from "@/lib/types";
import { isPastAnswerDeadline, PHASE_LABEL } from "@/lib/types";
import { PhaseBadge, TodoBadge } from "@/components/ui";
import { AiProgress } from "@/components/AiProgress";

const SECTIONS: Phase[] = ["answering", "voting", "closed"];

export default async function HomePage() {
  const supabase = await createClient();
  const listOdai = () => supabase.from("odai").select("*").order("created_at", { ascending: false });

  /*
   * 以前は requireMember() → sweep RPC → 一覧のクエリ、と3段階に分けて
   * 直列に待っていた。どれも互いの結果に依存していないので、まとめて
   * 同時に投げる（sweep は下で必要なときだけ）。
   */
  const [{ user }, { data: odaiRows }, { data: myAnswers }, { data: pickRows }, { data: progressRows }] =
    await Promise.all([
      requireMember(),
      listOdai(),
      // 自分の回答は phase を問わず読める（他人の回答は回答受付中は読めない）
      supabase.from("answers_view").select("odai_id").eq("is_mine", true),
      // RLS により、結果公開前は自分の picks しか返らない。voter_id で絞るのは
      // 受け取ってから（user.id を待たずにこのクエリを投げるため）。
      supabase.from("picks").select("odai_id, voter_id"),
      supabase.rpc("ai_progress_stats"),
    ]);

  let odai = (odaiRows ?? []) as Odai[];

  // 経過日数による自動締め切りは呼び出しトリガーがないので、表示のたびに掃除する。
  // ただし期限を過ぎたお題が実際に見えているときだけでいい（isPastAnswerDeadline 参照）。
  if (odai.some((o) => o.phase === "answering" && isPastAnswerDeadline(o.created_at))) {
    await supabase.rpc("sweep_answer_deadlines");
    const { data } = await listOdai();
    odai = (data ?? odaiRows ?? []) as Odai[];
  }

  const answered = new Set((myAnswers ?? []).map((a) => a.odai_id as number));
  const voted = new Set(
    (pickRows ?? []).filter((p) => p.voter_id === user.id).map((p) => p.odai_id as number),
  );
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
                const todo =
                  (o.phase === "answering" && !answered.has(o.id) && "未回答") ||
                  (o.phase === "voting" && !voted.has(o.id) && "未投票") ||
                  null;

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
