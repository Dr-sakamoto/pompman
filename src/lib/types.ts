export type Phase = "open" | "closed";

/** 1お題・1人あたりの回答数の上限（DB 側のトリガーと必ず揃えること）。 */
export const MAX_ANSWERS_PER_ODAI = 10;

/** 1人が選べる回答の数（ベスト3）。 */
export const MAX_PICKS = 3;

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
  closed_at: string | null;
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

export const PHASE_LABEL: Record<Phase, string> = {
  open: "回答・採点中",
  closed: "結果発表",
};
