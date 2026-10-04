"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { OGIRI_MODEL, generateAnswers, type PastRound, type TasteExample } from "@/lib/ogiri";
import type { ActionState } from "@/app/actions";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** 過去の選択をすべて踏まえて次の10個を出し、ラウンドとして保存する。 */
async function generateNextRound(supabase: Supabase, sessionId: number): Promise<string | null> {
  const [{ data: session }, { data: rounds }, { data: examples }] = await Promise.all([
    supabase.from("ogiri_sessions").select("odai_text").eq("id", sessionId).maybeSingle(),
    supabase
      .from("ogiri_rounds")
      .select("round_no, ogiri_candidates(text, picked, position)")
      .eq("session_id", sessionId)
      .not("submitted_at", "is", null)
      .order("round_no"),
    supabase.rpc("ogiri_taste_examples", { p_exclude_session_id: sessionId, p_limit: 40 }),
  ]);
  if (!session) return "お題が見つかりません";

  const pastRounds: PastRound[] = (rounds ?? []).map((r) => ({
    roundNo: r.round_no as number,
    candidates: ((r.ogiri_candidates ?? []) as { text: string; picked: boolean; position: number }[])
      .sort((a, b) => a.position - b.position)
      .map(({ text, picked }) => ({ text, picked })),
  }));
  const tasteExamples: TasteExample[] = (
    (examples ?? []) as { odai_text: string; answer: string; is_mine: boolean }[]
  ).map((e) => ({ odaiText: e.odai_text, answer: e.answer, isMine: e.is_mine }));

  let result: { taste: string; answers: string[] };
  try {
    result = await generateAnswers(session.odai_text as string, pastRounds, tasteExamples);
  } catch (e) {
    console.error("[ogiri] generate failed", e);
    return e instanceof Error && /[ぁ-んァ-ン]/.test(e.message)
      ? e.message
      : "AI が回答を出せませんでした。少し待ってもう一度試してください。";
  }

  const { error } = await supabase.rpc("add_ogiri_round", {
    p_session_id: sessionId,
    p_model: OGIRI_MODEL,
    p_taste_note: result.taste,
    p_texts: result.answers,
  });
  if (error) return error.message;
  return null;
}

/** お題を決めて最初の10個を出す。お題が空なら過去のお題からおまかせで選ぶ。 */
export async function startSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { user } = await requireMember();
  const supabase = await createClient();

  let text = String(formData.get("text") ?? "").trim();
  if (formData.get("random")) {
    const { data } = await supabase.from("odai").select("text").limit(500);
    const pool = (data ?? []).map((r) => r.text as string).filter(Boolean);
    if (pool.length === 0) return { error: "おまかせできるお題がまだありません。自分で書いてください" };
    text = pool[Math.floor(Math.random() * pool.length)];
  }
  if (!text) return { error: "お題を入力してください" };
  if (text.length > 200) return { error: "お題は200文字以内にしてください" };

  const { data: session, error } = await supabase
    .from("ogiri_sessions")
    .insert({ user_id: user.id, odai_text: text })
    .select("id")
    .single();
  if (error || !session) return { error: error?.message ?? "お題を保存できませんでした" };

  // 生成に失敗してもセッションは残す。画面側から「もう一度出す」でやり直せる。
  await generateNextRound(supabase, session.id as number);
  revalidatePath("/");
  redirect(`/play/${session.id}`);
}

/** 選んだものを記録して、それを反映した次の10個を出す。 */
export async function submitPicksAndNext(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireMember();
  const supabase = await createClient();

  const sessionId = Number(formData.get("session_id"));
  const roundId = Number(formData.get("round_id"));
  const picked = formData.getAll("picked").map(Number).filter(Number.isInteger);
  if (!Number.isInteger(sessionId) || !Number.isInteger(roundId)) return { error: "不正な操作です" };

  const { error } = await supabase.rpc("submit_ogiri_picks", {
    p_round_id: roundId,
    p_candidate_ids: picked,
  });
  if (error) return { error: error.message };

  const genError = await generateNextRound(supabase, sessionId);
  revalidatePath(`/play/${sessionId}`);
  revalidatePath("/");
  return genError ? { error: genError } : {};
}

/** 生成に失敗したあとのやり直し（選び終えたラウンドしか無いときに使う）。 */
export async function retryGenerate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMember();
  const supabase = await createClient();
  const sessionId = Number(formData.get("session_id"));
  if (!Number.isInteger(sessionId)) return { error: "不正な操作です" };

  const genError = await generateNextRound(supabase, sessionId);
  revalidatePath(`/play/${sessionId}`);
  return genError ? { error: genError } : {};
}
