import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { AnswerView, AppUser, Odai, Pick } from "@/lib/types";
import { isPastAnswerDeadline } from "@/lib/types";
import { PhaseBadge } from "@/components/ui";
import { AnsweringPhase } from "./AnsweringPhase";
import { VotingPhase } from "./VotingPhase";
import { ClosedPhase } from "./ClosedPhase";

export default async function OdaiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const odaiId = Number(id);
  if (!Number.isInteger(odaiId)) notFound();

  const supabase = await createClient();
  const getOdai = () => supabase.from("odai").select("*").eq("id", odaiId).maybeSingle();
  // 回答受付中は RLS により自分の回答しか返ってこない。
  const listAnswers = () =>
    supabase
      .from("answers_view")
      .select("*")
      .eq("odai_id", odaiId)
      .order("created_at", { ascending: true });

  /*
   * 以前は requireMember() → sweep RPC → odai 取得 → 残りのクエリ、と
   * 4段階に分けて直列に待っていた。互いの結果に依存していないので同時に投げる。
   * answering_progress だけは phase を見てから呼んでいたが、件数と人数を返す
   * だけの RPC なので回答受付中以外に呼んでも害はない（migrations/0008 参照）。
   */
  const [{ user }, odaiRes, answersRes, { data: pickRows }, { data: userRows }, { data: progressRows }] =
    await Promise.all([
      requireMember(),
      getOdai(),
      listAnswers(),
      // 結果公開前は自分の picks しか返ってこない。
      supabase.from("picks").select("*").eq("odai_id", odaiId),
      supabase.from("users").select("*"),
      supabase.rpc("answering_progress", { p_odai_id: odaiId }),
    ]);

  if (!odaiRes.data) notFound();
  let odai = odaiRes.data as Odai;
  let answers = (answersRes.data ?? []) as AnswerView[];

  /*
   * 経過日数による自動締め切り。期限切れのお題を開いたときだけ掃除する
   * （isPastAnswerDeadline 参照）。voting に進むと他人の回答も読めるように
   * なるので、掃除したら回答も取り直す。
   */
  if (odai.phase === "answering" && isPastAnswerDeadline(odai.created_at)) {
    await supabase.rpc("sweep_answer_deadlines");
    const [sweptOdai, sweptAnswers] = await Promise.all([getOdai(), listAnswers()]);
    if (sweptOdai.data) {
      odai = sweptOdai.data as Odai;
      answers = (sweptAnswers.data ?? []) as AnswerView[];
    }
  }

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
        <p className="text-sm text-muted">
          出題: {odai.phase === "closed" ? handles.get(odai.author_id) ?? "?" : "匿名"}
        </p>
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
