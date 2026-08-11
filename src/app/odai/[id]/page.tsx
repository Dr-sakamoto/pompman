import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { AnswerView, AppUser, Odai, Pick } from "@/lib/types";
import { PhaseBadge } from "@/components/ui";
import { OpenPhase } from "./OpenPhase";
import { ClosedPhase } from "./ClosedPhase";

export default async function OdaiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const odaiId = Number(id);
  if (!Number.isInteger(odaiId)) notFound();

  const { user } = await requireMember();
  const supabase = await createClient();

  const { data: odaiRow } = await supabase
    .from("odai")
    .select("*")
    .eq("id", odaiId)
    .maybeSingle();
  if (!odaiRow) notFound();
  const odai = odaiRow as Odai;

  const [{ data: answerRows }, { data: pickRows }, { data: userRows }] = await Promise.all([
    // 結果発表前は author_id が伏せられた状態で返ってくる（answers_view）。
    supabase
      .from("answers_view")
      .select("*")
      .eq("odai_id", odaiId)
      .order("created_at", { ascending: true }),
    // 結果発表前は自分の picks しか返ってこない。
    supabase.from("picks").select("*").eq("odai_id", odaiId),
    supabase.from("users").select("*"),
  ]);

  const answers = (answerRows ?? []) as AnswerView[];
  const picks = (pickRows ?? []) as Pick[];
  const handles = new Map(((userRows ?? []) as AppUser[]).map((u) => [u.id, u.handle]));
  const isOwner = odai.author_id === user.id;

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

      {odai.phase === "open" && (
        <OpenPhase
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
