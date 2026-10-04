"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import {
  GENERATOR_MODEL,
  JUDGE_MODEL,
  SET_SIZE,
  makeBatch,
  pickSet,
  type Labeled,
  type PoolItem,
} from "@/lib/ogiri";
import type { ActionState } from "@/app/actions";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** まだ見ていない回答がこれを下回ったら、裏で次のバッチを作っておく。 */
const REFILL_BELOW = 20;

async function loadPool(supabase: Supabase, weeklyId: number): Promise<PoolItem[]> {
  const { data, error } = await supabase.rpc("ai_answer_pool", { p_weekly_odai_id: weeklyId });
  if (error) throw new Error(error.message);
  return (
    (data ?? []) as {
      answer_id: number;
      text: string;
      judge_score: number | null;
      shown_count: number;
      picked_count: number;
      seen_by_me: boolean;
    }[]
  ).map((r) => ({
    answerId: r.answer_id,
    text: r.text,
    judgeScore: r.judge_score,
    shown: r.shown_count,
    picked: r.picked_count,
    seenByMe: r.seen_by_me,
  }));
}

/**
 * AI に新しい回答を書かせ、審査役の点を付けて保存する。
 * 他の人が生成中なら何もしない（"busy" を返す）。
 */
async function generateBatch(supabase: Supabase, weeklyId: number): Promise<"ok" | "busy" | string> {
  const { data: batchId, error: claimError } = await supabase.rpc("claim_ai_batch", {
    p_weekly_odai_id: weeklyId,
  });
  if (claimError) return claimError.message;
  if (batchId == null) return "busy";

  const finish = (texts: string[], scores: number[]) =>
    supabase.rpc("finish_ai_batch", {
      p_batch_id: batchId,
      p_generator_model: GENERATOR_MODEL,
      p_judge_model: JUDGE_MODEL,
      p_texts: texts,
      p_scores: scores,
    });

  try {
    const [{ data: week }, pool, { data: pastRows }] = await Promise.all([
      supabase.from("weekly_odai").select("text").eq("id", weeklyId).single(),
      loadPool(supabase, weeklyId),
      supabase.rpc("ai_past_examples", { p_exclude_weekly_odai_id: weeklyId }),
    ]);
    if (!week) throw new Error("今週のお題が見つかりません");

    const thisWeek: Labeled[] = pool
      .filter((p) => p.shown > 0)
      .map((p) => ({ text: p.text, shown: p.shown, picked: p.picked }));
    const past: Labeled[] = (
      (pastRows ?? []) as { odai_text: string; answer: string; shown_count: number; picked_count: number }[]
    ).map((r) => ({ odaiText: r.odai_text, text: r.answer, shown: r.shown_count, picked: r.picked_count }));

    const { texts, scores } = await makeBatch(
      week.text as string,
      pool.map((p) => p.text),
      thisWeek,
      past,
    );
    const { error } = await finish(texts, scores);
    if (error) return error.message;
    return "ok";
  } catch (e) {
    console.error("[ogiri] batch failed", e);
    await finish([], []);
    return e instanceof Error && /[ぁ-んァ-ン]/.test(e.message)
      ? e.message
      : "AI が回答を作れませんでした。少し待ってもう一度試してください。";
  }
}

/** まだ見ていない回答から10個を確保する。足りなければその場で作らせる。 */
async function createNextSet(supabase: Supabase, weeklyId: number): Promise<string | null> {
  let pool = await loadPool(supabase, weeklyId);

  if (pool.filter((p) => !p.seenByMe).length < SET_SIZE) {
    const result = await generateBatch(supabase, weeklyId);
    if (result === "ok") {
      pool = await loadPool(supabase, weeklyId);
    } else if (pool.every((p) => p.seenByMe)) {
      // 残りが少しでもあれば、作れなくてもその分だけは見せる
      return result === "busy"
        ? "AI がいま回答を作っています。1分ほどしてからもう一度押してください。"
        : result;
    }
  }

  const chosen = pickSet(pool);
  if (chosen.length === 0) return "見せられる回答がありません。もう一度押してください。";

  const { error } = await supabase.rpc("create_ai_set", {
    p_weekly_odai_id: weeklyId,
    p_answer_ids: chosen.map((c) => c.item.answerId),
    p_slots: chosen.map((c) => c.slot),
    p_expected: chosen.map((c) => c.expected),
  });
  if (error) return error.message;

  // 次の人（と自分の次の10個）を待たせないよう、残りが少なければ裏で作っておく。
  const remaining = pool.filter((p) => !p.seenByMe).length - chosen.length;
  if (remaining < REFILL_BELOW) {
    after(async () => {
      const result = await generateBatch(supabase, weeklyId);
      if (result !== "ok" && result !== "busy") console.error("[ogiri] refill failed", result);
    });
  }
  return null;
}

/**
 * 「10個見る」と「選んで次の10個へ」を1つの操作にまとめたもの。
 * set_id があれば、まずその10個の選択を記録する。続けて次の10個を確保する。
 *
 * 1つにしておくのは、提出は通ったが次の10個が作れなかったとき、その理由を
 * 同じ画面の同じ場所に出し続けるため（別々だと、画面が切り替わって消える）。
 */
export async function playNext(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireMember();
  const supabase = await createClient();
  const weeklyId = Number(formData.get("weekly_odai_id"));
  if (!Number.isInteger(weeklyId)) return { error: "不正な操作です" };

  if (formData.has("set_id")) {
    const setId = Number(formData.get("set_id"));
    const picked = formData.getAll("picked").map(Number).filter(Number.isInteger);
    const { error } = await supabase.rpc("submit_ai_set", {
      p_set_id: setId,
      p_answer_ids: picked,
    });
    if (error) return { error: error.message };
  }

  const error = await createNextSet(supabase, weeklyId);
  revalidatePath("/");
  return error ? { error } : {};
}
