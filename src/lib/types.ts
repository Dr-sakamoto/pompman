export type Phase = "open" | "closed";

/** 1お題・1人あたりの回答数の上限（DB 側のトリガーと必ず揃えること）。 */
export const MAX_ANSWERS_PER_ODAI = 10;

/** 1人が選べる回答の数（ベスト3）。 */
export const MAX_PICKS = 3;

/**
 * 自動解禁までの無音時間（DB 側の private.auto_unlock_idle() と必ず揃えること）。
 * 最後の回答からこれだけ経つと「出し切った」とみなして自動で解禁される。
 */
export const AUTO_UNLOCK_IDLE_HOURS = 12;

/**
 * 自動締め切りまでのお題の寿命（DB 側の private.auto_close_age() と必ず揃えること）。
 */
export const AUTO_CLOSE_AGE_DAYS = 3;

/**
 * 「参加者が全員やり切った」で締め切るのに要る最低参加者数
 * （DB 側の private.maybe_close_odai() と必ず揃えること）。
 *
 * 1人しか書いていないお題をこれで閉じると、他の人が回答する前に発表されてしまう。
 * 選好ペアも作れない（自分の回答は選べないので、参加者1人では採点が成立しない）。
 */
export const AUTO_CLOSE_MIN_PARTICIPANTS = 2;

export type AppUser = {
  id: string;
  handle: string;
  role: "admin" | "educator" | "member";
  terms_accepted_at: string | null;
  created_at: string;
  handle_changed_at: string;
};

/** 表示名の変更クールダウン（DB 側の 0018 マイグレーションと必ず揃えること）。 */
export const HANDLE_CHANGE_COOLDOWN_DAYS = 30;

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

/** pick_skips の行。「面白い回答が無かった」という明示的な採点終了の宣言。 */
export type PickSkip = {
  odai_id: number;
  voter_id: string;
  created_at: string;
};

/**
 * odai_close_progress() の行。open のお題1件ぶんの「結果発表までの進捗」。
 *
 * 中身は全部集計値で、誰が何を書いたか・誰が誰を選んだかは含まない
 * （0014 の header 参照）。時刻は DB 側の now() を基準に揃えてあるので、
 * 比率はこの行の中だけで計算できる。
 */
export type CloseProgressRow = {
  odai_id: number;
  created_at: string;
  as_of: string;
  ready_at: string;
  close_at: string;
  answer_count: number;
  participants: number;
  unlocked: number;
  scored: number;
  finished: number;
  preference_pairs: number;
};

export const PHASE_LABEL: Record<Phase, string> = {
  open: "回答・採点中",
  closed: "結果発表",
};

/**
 * contribution_ranking() の行。投稿数（回答数・お題数・採点数）。
 * 結果発表前(open)のお題への投稿・採点も含む。お題の中身（誰が何を書いたか）は含まない。
 */
export type ContributionRankingRow = {
  user_id: string;
  handle: string;
  answer_count: number;
  odai_count: number;
  pick_count: number;
};

/**
 * my_streak() の行。呼び出し本人の連続参加日数
 * （回答 or 採点のどちらかを行った日が対象、JST暦日）。
 */
export type StreakStats = {
  streak_days: number;
  last_active_date: string | null;
};
