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

export const PHASE_LABEL: Record<Phase, string> = {
  answering: "回答受付中",
  voting: "投票中",
  closed: "結果公開",
};
