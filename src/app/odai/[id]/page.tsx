import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { AnswerView, AppUser, CloseProgressRow, Odai, Pick } from "@/lib/types";
import { PhaseBadge } from "@/components/ui";
import { CloseProgress } from "@/components/CloseProgress";
import { OpenPhase } from "./OpenPhase";
import { ClosedPhase } from "./ClosedPhase";

export default async function OdaiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const odaiId = Number(id);
  if (!Number.isInteger(odaiId)) notFound();

  const supabase = await createClient();

  /*
   * 時間経過による自動解禁・自動締め切りを先に反映させる（一覧と同じ理由。
   * 同時に投げると、解禁されたのに伏せられたままの画面を1回見せてしまう）。
   * この画面は共有リンクから直接開かれることもあるので、一覧を経由しなくても
   * ここで追いつくようにしておく。
   */
  await supabase.rpc("sweep_odai_deadlines");

  /*
   * requireMember() と odai・回答・picks・users・回答数・解禁状態のクエリは
   * 互いの結果に依存していないので、直列に待たず同時に投げる。
   *
   * answer_unlocks は odai_id だけで絞り、user_id では絞らない: この配列を
   * 組み立てている時点では requireMember() の結果（user）がまだ解決して
   * いないので、同じ配列内から user.id を参照できない。RLS がそもそも
   * 「自分の行 or 結果発表後」しか返さないので、受け取ってから絞ればよい。
   */
  const [
    { user },
    { data: odaiRow },
    { data: answerRows },
    { data: pickRows },
    { data: userRows },
    { data: countRows },
    { data: unlockRows },
    { data: progressRows },
  ] = await Promise.all([
    requireMember(),
    supabase.from("odai").select("*").eq("id", odaiId).maybeSingle(),
    // 解禁する（unlock_answers）まで、他人の回答は1行も返ってこない（answers_view）。
    // 結果発表前は author_id も伏せられている。
    supabase
      .from("answers_view")
      .select("*")
      .eq("odai_id", odaiId)
      .order("created_at", { ascending: true }),
    // 結果発表前は自分の picks しか返ってこない。
    supabase.from("picks").select("*").eq("odai_id", odaiId),
    supabase.from("users").select("*"),
    // 件数は中身を含まないので、解禁前でも見せる。
    supabase.rpc("odai_answer_counts"),
    // 自分がこのお題を解禁済みかどうか（未解禁だと answers_view が自分の分しか返らないので、
    // 「まだ誰も他に回答していない」のか「単に未解禁」なのかを区別するのに要る）。
    supabase.from("answer_unlocks").select("odai_id, user_id").eq("odai_id", odaiId),
    // 結果発表までの進捗（人数・時間）。集計値だけなので未回答・未解禁でも見える。
    // 返るのは open のお題だけ。
    supabase.rpc("odai_close_progress"),
  ]);

  if (!odaiRow) notFound();
  const odai = odaiRow as Odai;
  const answers = (answerRows ?? []) as AnswerView[];
  const picks = (pickRows ?? []) as Pick[];
  const handles = new Map(((userRows ?? []) as AppUser[]).map((u) => [u.id, u.handle]));
  const answerCount =
    ((countRows ?? []) as { odai_id: number; answer_count: number }[]).find(
      (r) => r.odai_id === odaiId,
    )?.answer_count ?? 0;
  const unlocked = (unlockRows ?? []).some((r) => r.user_id === user.id);
  const isOwner = odai.author_id === user.id;
  const progress =
    ((progressRows ?? []) as CloseProgressRow[]).find((r) => Number(r.odai_id) === odaiId) ?? null;

  return (
    <div className="space-y-6">
      <Link href="/" className="block text-sm text-muted hover:text-white">
        ← 一覧
      </Link>

      <div className="space-y-2">
        <PhaseBadge phase={odai.phase} />
        <h1 className="text-2xl font-bold leading-snug">{odai.text}</h1>
        <p className="text-sm text-muted">
          出題: {odai.phase === "closed" ? handles.get(odai.author_id) ?? "?" : "匿名"}
        </p>
      </div>

      {odai.phase === "open" && progress && <CloseProgress progress={progress} />}

      {odai.phase === "open" && (
        <OpenPhase
          odai={odai}
          answers={answers}
          answerCount={answerCount}
          unlocked={unlocked}
          myPicks={picks.filter((p) => p.voter_id === user.id)}
          voterId={user.id}
          isOwner={isOwner}
        />
      )}

      {odai.phase === "closed" && (
        <ClosedPhase
          answers={answers}
          picks={picks}
          handles={Object.fromEntries(handles)}
          currentUserId={user.id}
        />
      )}
    </div>
  );
}
