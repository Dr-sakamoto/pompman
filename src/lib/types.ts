export type Phase = "answering" | "voting" | "closed";

export type AppUser = {
  id: string;
  handle: string;
  role: "admin" | "educator" | "member";
  terms_accepted_at: string | null;
  created_at: string;
};

export type Odai = {
  id: number;
  author_id: string;
  text: string;
  phase: Phase;
  created_at: string;
  answers_closed_at: string | null;
  voting_closed_at: string | null;
};

/**
 * answers_view の行。
 * author_id は phase='closed' になるまで自分の回答以外 null（DB 側で伏せている）。
 */
export type AnswerView = {
  id: number;
  odai_id: number;
  text: string;
  is_ai: boolean;
  created_at: string;
  author_id: string | null;
  model_ver: string | null;
  is_mine: boolean;
};

export type Pick = {
  id: number;
  odai_id: number;
  voter_id: string;
  answer_id: number;
  rank: number;
  created_at: string;
};

// supabase/migrations/0007_auto_close_answers.sql の interval '3 days' と一致させること。
export const ANSWER_DEADLINE_DAYS = 3;

/**
 * 経過日数による自動締め切りの条件を満たしているか。
 *
 * sweep_answer_deadlines() を呼ぶ必要があるかの事前判定に使う。掃除が要るのは
 * 「作成から3日経った回答受付中のお題」がある場合だけで、それは手元の
 * created_at を見れば分かる。ほとんどの表示では該当ゼロなので、RPC の往復を
 * まるごと省ける（もう一つの条件「全員回答した」は answers の INSERT
 * トリガーが即座に処理するので、ここで気にしなくてよい）。
 */
export function isPastAnswerDeadline(createdAt: string): boolean {
  const deadlineMs = ANSWER_DEADLINE_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() >= new Date(createdAt).getTime() + deadlineMs;
}

export const PHASE_LABEL: Record<Phase, string> = {
  answering: "回答受付中",
  voting: "投票中",
  closed: "結果公開",
};
