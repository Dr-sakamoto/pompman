import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

/*
 * 「10個全部が超面白い」を、一発で10個書かせて当てるのではなく
 * 「大量に書かせて、審査役がふるいにかけ、上から見せる」で作る。
 *
 *   書き手  … 角度を散らして40個書く。量と幅が仕事
 *   審査役  … 1つずつ「このメンバーに選ばれそうか」を厳しく採点する。目利きが仕事
 *
 * どちらにも、人間が実際に「選んだ／選ばなかった」ものを手本として見せる。
 * 鍛えたいのは審査役のほう（見せる10個の当たり率は、審査役が外れを捨てられるかで決まる）。
 */

export const GENERATOR_MODEL = "claude-opus-5-5";
export const JUDGE_MODEL = "claude-opus-5-5";
export const ANSWERS_PER_BATCH = 40;

/** 人間に見せた結果つきの回答（今週の分・過去の週の分のどちらにも使う）。 */
export type Labeled = { odaiText?: string; text: string; shown: number; picked: number };

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。Vercel の環境変数に追加してください。");
  }
  return new Anthropic();
}

function normalize(text: string): string {
  return text.replace(/\s+/g, "").replace(/[「」『』。、！!？?・…ー〜]/g, "");
}

/** 「見せた人のうち何人が選んだか」で勝ち・負けに分けて、手本の文章にする。 */
function formatExamples(heading: string, items: Labeled[]): string[] {
  const wins = items
    .filter((e) => e.picked > 0)
    .sort((a, b) => b.picked / b.shown - a.picked / a.shown || b.picked - a.picked);
  const losses = items.filter((e) => e.picked === 0 && e.shown > 0);
  if (wins.length === 0 && losses.length === 0) return [];

  const fmt = (e: Labeled) =>
    `- ${e.odaiText ? `お題「${e.odaiText}」→ ` : ""}${e.text}（${e.shown}人中${e.picked}人が選んだ）`;
  const lines = [`## ${heading}`];
  if (wins.length > 0) lines.push("選ばれたもの（選んだ人の割合が高い順）:", ...wins.slice(0, 40).map(fmt));
  if (losses.length > 0) lines.push("見せたのに誰も選ばなかったもの:", ...losses.slice(0, 30).map(fmt));
  lines.push("");
  return lines;
}

const WRITER_SYSTEM = `あなたは日本の大喜利の名手です。お題に対して、声に出して読んだ瞬間に笑いが起きる回答を書きます。

良い回答の条件:
- 短い。1行で言い切る。説明や前置きをしない
- 笑いの仕組み（前提のずらし・具体的すぎる情景・言葉の二重の意味・意外な視点・飛躍など）が一つはっきりある
- 誰でも最初に思いつく連想は避ける

あなたの回答は、別の審査役がふるいにかけてから仲間内に見せます。だから無難にまとめる必要はありません。
量と幅が仕事です。同じ仕組みや同じ着地の言い換えを並べず、角度を大きく散らしてください。
仲間内で実際に「選ばれた／選ばれなかった」回答を手本として渡すので、選ばれたものの笑いのツボを掴みつつ、
それをなぞるだけでなく、同じツボを別の角度から突く回答も試してください。`;

const JUDGE_SYSTEM = `あなたは大喜利の審査役です。ある仲間内のグループに見せたとき、その回答が「面白い」と選ばれるかを予測します。

採点の基準は、あなた自身の好みではなく、このグループが実際に選んだもの・選ばなかったものの傾向です。
手本をよく見て、このグループが何に笑い、何に笑わないかを掴んでから採点してください。

点は 0〜100。「このグループの人に見せたら、選ばれる確率（%）」のつもりで付けてください。
厳しく付けてください。ありがち・説明的・お題をなぞっただけ・意味が通らないものは低く。
本当に笑いが起きるものだけが高い点に値します。点が団子にならないよう、差をはっきり付けてください。`;

const WriterSchema = z.object({
  answers: z.array(z.string()).describe(`大喜利の回答。${ANSWERS_PER_BATCH}個。`),
});

const JudgeSchema = z.object({
  scores: z
    .array(z.object({ n: z.number().int().describe("回答の番号"), score: z.number().int() }))
    .describe("すべての回答の点。番号順。"),
});

async function write(odai: string, thisWeek: Labeled[], past: Labeled[]): Promise<string[]> {
  const parts = [
    ...formatExamples("過去のお題で、仲間内に見せた結果", past),
    ...formatExamples("このお題で、ここまでに仲間内に見せた結果", thisWeek),
    `## お題\n${odai}`,
    "",
    `回答を${ANSWERS_PER_BATCH}個書いてください。ここまでに出た回答と同じもの・ほぼ同じものは書かないでください。`,
  ];

  const response = await client().beta.messages.parse({
    model: GENERATOR_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(WriterSchema) },
    system: WRITER_SYSTEM,
    messages: [{ role: "user", content: parts.join("\n") }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error("このお題では回答を作れませんでした。");
  }
  if (!response.parsed_output) throw new Error("AI の応答を読み取れませんでした。");
  return response.parsed_output.answers;
}

async function judge(
  odai: string,
  candidates: string[],
  thisWeek: Labeled[],
  past: Labeled[],
): Promise<number[]> {
  const parts = [
    ...formatExamples("過去のお題で、このグループに見せた結果（採点の基準）", past),
    ...formatExamples("このお題で、このグループに見せた結果（採点の基準）", thisWeek),
    `## お題\n${odai}`,
    "",
    "## 採点する回答",
    ...candidates.map((c, i) => `${i + 1}. ${c}`),
    "",
    `${candidates.length}個すべてに点を付けてください。`,
  ];

  const response = await client().beta.messages.parse({
    model: JUDGE_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(JudgeSchema) },
    system: JUDGE_SYSTEM,
    messages: [{ role: "user", content: parts.join("\n") }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new Error("審査役が採点できませんでした。");
  }

  // 付け忘れた回答は最低点にする（見せる順位を上げないため）。
  const scores = candidates.map(() => 0);
  for (const { n, score } of response.parsed_output.scores) {
    if (n >= 1 && n <= candidates.length) scores[n - 1] = Math.max(0, Math.min(100, score));
  }
  return scores;
}

/**
 * 新しい回答を書かせて、審査役の点を付けて返す。
 * existing はこのお題でこれまでに作った全回答（重複を落とすため）。
 */
export async function makeBatch(
  odai: string,
  existing: string[],
  thisWeek: Labeled[],
  past: Labeled[],
): Promise<{ texts: string[]; scores: number[] }> {
  const raw = await write(odai, thisWeek, past);

  const seen = new Set(existing.map(normalize));
  const texts: string[] = [];
  for (const r of raw) {
    const text = r.trim().slice(0, 200);
    const key = normalize(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    texts.push(text);
  }
  if (texts.length === 0) throw new Error("新しい回答が出ませんでした。");

  const scores = await judge(odai, texts, thisWeek, past);
  return { texts, scores };
}

/** 見せる10個を選ぶための、回答ごとの材料（ai_answer_pool の1行）。 */
export type PoolItem = {
  answerId: number;
  text: string;
  judgeScore: number | null;
  shown: number;
  picked: number;
  seenByMe: boolean;
};

/** 審査役の点を事前の見込みとし、実際に見せた結果でならした「選ばれる見込み」。 */
export function expectedPickRate(item: PoolItem): number {
  // 審査役の点を、見せた人数 PRIOR_WEIGHT 人ぶんの重みとして扱う。
  // 見せた人が増えるほど、審査役の予想より実際の結果が効く。
  const PRIOR_WEIGHT = 3;
  const prior = (item.judgeScore ?? 30) / 100;
  return (PRIOR_WEIGHT * prior + item.picked) / (PRIOR_WEIGHT + item.shown);
}

export const SET_SIZE = 10;

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const EXPLORE_SLOTS = 2;

/**
 * まだ見ていない回答から10個を選ぶ。
 * 8個は見込みの高い順（上位枠）。2個は試し枠で、まだあまり見せていないものから
 * 無作為に選ぶ（審査役が低く付けたが実は面白い、を拾うため）。
 */
export function pickSet(
  pool: PoolItem[],
): { item: PoolItem; slot: "top" | "explore"; expected: number }[] {
  const unseen = pool
    .filter((p) => !p.seenByMe)
    .map((item) => ({ item, expected: expectedPickRate(item) }))
    .sort((a, b) => b.expected - a.expected);

  const topCount = Math.min(SET_SIZE - EXPLORE_SLOTS, unseen.length);
  const top = unseen.slice(0, topCount);
  const rest = unseen.slice(topCount);
  const lightlyTested = rest.filter((r) => r.item.shown < 2);
  const explorePool = lightlyTested.length >= EXPLORE_SLOTS ? lightlyTested : rest;
  const explore = shuffle(explorePool).slice(0, SET_SIZE - top.length);

  const chosen = [
    ...top.map((t) => ({ ...t, slot: "top" as const })),
    ...explore.map((e) => ({ ...e, slot: "explore" as const })),
  ];
  // 枠が見た目で分からないよう、並びは混ぜる
  return shuffle(chosen);
}
