import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { AnswerView, AppUser, Odai, Pick } from "@/lib/types";
import { PhaseBadge } from "@/components/ui";
import { AnsweringPhase } from "./AnsweringPhase";
import { VotingPhase } from "./VotingPhase";
import { ClosedPhase } from "./ClosedPhase";

export default async function OdaiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const odaiId = Number(id);
  if (!Number.isInteger(odaiId)) notFound();

  const { user } = await requireMember();
  const supabase = await createClient();

  // 経過日数による自動締め切りは呼び出しトリガーがないので、表示のたびに掃除する。
  await supabase.rpc("sweep_answer_deadlines");

  const { data: odaiRow } = await supabase
    .from("odai")
    .select("*")
    .eq("id", odaiId)
    .maybeSingle();
  if (!odaiRow) notFound();
  const odai = odaiRow as Odai;

  const [{ data: answerRows }, { data: pickRows }, { data: userRows }, { data: progressRows }] =
    await Promise.all([
      // 回答受付中は RLS により自分の回答しか返ってこない。
      supabase
        .from("answers_view")
        .select("*")
        .eq("odai_id", odaiId)
        .order("created_at", { ascending: true }),
      // 結果公開前は自分の picks しか返ってこない。
      supabase.from("picks").select("*").eq("odai_id", odaiId),
      supabase.from("users").select("*"),
      // 集計値だけの RPC。回答受付中でなければ使わないが、無条件に呼んでも害はない。
      odai.phase === "answering"
        ? supabase.rpc("answering_progress", { p_odai_id: odaiId })
        : Promise.resolve({ data: null }),
    ]);

  const answers = (answerRows ?? []) as AnswerView[];
  const picks = (pickRows ?? []) as Pick[];
  const handles = new Map(((userRows ?? []) as AppUser[]).map((u) => [u.id, u.handle]));
  const isOwner = odai.author_id === user.id;
  const progressRow = progressRows?.[0] as
    | { answer_count: number; member_count: number }
    | undefined;
  const progress = progressRow
    ? { answerCount: progressRow.answer_count, memberCount: progressRow.member_count }
    : null;

  return (
    <div className="space-y-6">
      <Link href="/" className="block text-sm text-muted hover:text-white">
        ← 一覧
      </Link>

      <div className="space-y-2">
        <PhaseBadge phase={odai.phase} />
        <h1 className="text-2xl font-bold leading-snug">{odai.text}</h1>
        <p className="text-sm text-muted">出題: {handles.get(odai.author_id) ?? "?"}</p>
      </div>

      {odai.phase === "answering" && (
        <AnsweringPhase
          odai={odai}
          myAnswer={answers.find((a) => a.is_mine) ?? null}
          isOwner={isOwner}
          progress={progress}
        />
      )}

      {odai.phase === "voting" && (
        <VotingPhase
          odai={odai}
          answers={answers}
          myPicks={picks.filter((p) => p.voter_id === user.id)}
          voterId={user.id}
          isOwner={isOwner}
        />
      )}

      {odai.phase === "closed" && (
        <ClosedPhase answers={answers} picks={picks} handles={Object.fromEntries(handles)} />
      )}
    </div>
  );
}
