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

/**
 * 投票画面の並び順。投稿順のままだと先に出した人が有利になるのでシャッフルする。
 * ただしリロードのたびに並びが変わると選びかけの投票が破綻するので、
 * (お題, 投票者) で決まる固定の並びにしてある。
 */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const next = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };

  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
