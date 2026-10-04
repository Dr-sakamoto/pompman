import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const OGIRI_MODEL = "claude-opus-5-5";
export const ANSWERS_PER_ROUND = 10;

/** これまでに見せたラウンド1回ぶん（古い順に渡す）。 */
export type PastRound = {
  roundNo: number;
  candidates: { text: string; picked: boolean }[];
};

/** 他のお題で選ばれた回答（好みの手本）。 */
export type TasteExample = { odaiText: string; answer: string; isMine: boolean };

const OutputSchema = z.object({
  taste: z
    .string()
    .describe("ここまでの選択から読み取った、この人が面白がるものの傾向。日本語で1〜2文。初回なら狙いを1文で。"),
  answers: z.array(z.string()).describe(`大喜利の回答。ちょうど${ANSWERS_PER_ROUND}個。`),
});

const SYSTEM_PROMPT = `あなたは日本の大喜利の名手です。お題に対して、声に出して読んだ瞬間に笑いが起きる回答を出します。

良い回答の条件:
- 短い。1行で言い切る。説明や前置きをしない
- お題の前提をずらす・具体的すぎる固有の情景を描く・言葉の二重の意味を突く・意外な視点に立つ、など「笑いの仕組み」が一つはっきりある
- ありがちな連想（誰でも最初に思いつくもの）を避ける
- 10個は互いに角度を変える。同じ仕組みや同じ着地の言い換えを並べない

ユーザーは毎回あなたの10個から「面白い」と思ったものだけを選びます。選ばれたものと選ばれなかったものの差が、この人の笑いのツボです。
その差を読み取り、次の10個はツボに寄せて精度を上げてください。ただし寄せすぎて似たものばかりにならないよう、新しい角度にも少し挑戦してください。
過去に出した回答と同じもの・ほぼ同じものは二度と出さないでください。`;

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。Vercel の環境変数に追加してください。");
  }
  return new Anthropic();
}

function buildUserMessage(odai: string, rounds: PastRound[], examples: TasteExample[]): string {
  const parts: string[] = [];

  if (examples.length > 0) {
    const mine = examples.filter((e) => e.isMine);
    const others = examples.filter((e) => !e.isMine);
    const fmt = (e: TasteExample) => `- お題「${e.odaiText}」→ ${e.answer}`;
    parts.push("## 別のお題で選ばれた回答（好みの手本）");
    if (mine.length > 0) parts.push("この人自身が選んだもの:", ...mine.map(fmt));
    if (others.length > 0) parts.push("仲間内で選ばれたもの:", ...others.map(fmt));
    parts.push("");
  }

  if (rounds.length > 0) {
    parts.push("## このお題でのこれまでの結果（◎=選ばれた、×=選ばれなかった）");
    for (const r of rounds) {
      parts.push(`### ${r.roundNo}回目`);
      for (const c of r.candidates) parts.push(`${c.picked ? "◎" : "×"} ${c.text}`);
    }
    const total = rounds.reduce((n, r) => n + r.candidates.length, 0);
    const picked = rounds.reduce((n, r) => n + r.candidates.filter((c) => c.picked).length, 0);
    parts.push("");
    parts.push(
      picked === 0
        ? `ここまで${total}個出して1つも選ばれていません。これまでの方向性はすべて外れています。思い切って違う角度から攻めてください。`
        : `ここまで${total}個中${picked}個が選ばれました。◎ に共通する笑いの仕組みを見極め、7個ほどはそれをさらに研ぎ澄ませ、残りは新しい角度で試してください。`,
    );
    parts.push("");
  }

  parts.push(`## お題\n${odai}`);
  parts.push("");
  parts.push(`回答を${ANSWERS_PER_ROUND}個出してください。`);
  return parts.join("\n");
}

function normalize(text: string): string {
  return text.replace(/\s+/g, "").replace(/[「」『』。、！!？?・…]/g, "");
}

/** 次の10個を AI に出させる。 */
export async function generateAnswers(
  odai: string,
  rounds: PastRound[],
  examples: TasteExample[],
): Promise<{ taste: string; answers: string[] }> {
  const response = await client().beta.messages.parse({
    model: OGIRI_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: betaZodOutputFormat(OutputSchema),
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(odai, rounds, examples) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("このお題では回答を作れませんでした。別のお題を試してください。");
  }
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("AI の応答を読み取れませんでした。もう一度試してください。");

  // 過去に出したものと重複するもの・空のものは落とす。
  const seen = new Set(rounds.flatMap((r) => r.candidates.map((c) => normalize(c.text))));
  const answers: string[] = [];
  for (const raw of parsed.answers) {
    const text = raw.trim().slice(0, 200);
    const key = normalize(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    answers.push(text);
    if (answers.length === ANSWERS_PER_ROUND) break;
  }
  if (answers.length === 0) throw new Error("新しい回答が出ませんでした。もう一度試してください。");

  return { taste: parsed.taste.trim(), answers };
}
