import type { AnswerView, Pick } from "./types";

/** 1位=3点, 2位=2点, 3位=1点 */
export const RANK_POINTS: Record<number, number> = { 1: 3, 2: 2, 3: 1 };

export function pointsForRank(rank: number): number {
  return RANK_POINTS[rank] ?? 0;
}

export type AnswerResult = {
  answer: AnswerView;
  score: number;
  picks: Pick[];
};

/**
 * 集計。0票の回答も必ず結果に含める。
 * 誰からも選ばれなかった回答＝全員一致でスベっている回答であり、
 * 減点法の教師データとして同じだけ価値がある。消さない・隠さない。
 */
export function tally(answers: AnswerView[], picks: Pick[]): AnswerResult[] {
  const byAnswer = new Map<number, Pick[]>();
  for (const p of picks) {
    const list = byAnswer.get(p.answer_id);
    if (list) list.push(p);
    else byAnswer.set(p.answer_id, [p]);
  }

  return answers
    .map((answer) => {
      const own = (byAnswer.get(answer.id) ?? []).slice().sort((a, b) => a.rank - b.rank);
      return {
        answer,
        picks: own,
        score: own.reduce((sum, p) => sum + pointsForRank(p.rank), 0),
      };
    })
    .sort((a, b) => b.score - a.score || a.answer.id - b.answer.id);
}

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 採点画面の並び順。投稿順のままだと先に出した人が有利になるので散らす。
 *
 * 並びは「行ごとのハッシュ」で決める。配列をシャッフルする方式だと、回答が
 * 1件増えただけで既存の回答の並びまで全部変わってしまう。回答受付と採点が
 * 同じフェーズになった今、それは選びかけの画面が目の前で組み替わることを
 * 意味する。行ごとに順番が決まっていれば、増えた回答が間に挿さるだけで済む。
 *
 * seed に採点者を含めるので、並びは人によって違う。
 */
export function seededOrder<T>(items: T[], seed: string, keyOf: (item: T) => number): T[] {
  return items
    .map((item) => ({ item, key: keyOf(item) }))
    .map((x) => ({ ...x, h: hash32(`${seed}:${x.key}`) }))
    .sort((a, b) => a.h - b.h || a.key - b.key)
    .map((x) => x.item);
}
