import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Supabase のセッション Cookie が入っているか。
 * @supabase/ssr は `sb-<project-ref>-auth-token` という名前で保存する
 * （長いと `.0` `.1` と分割される）。
 */
export function hasAuthCookie(cookies: { name: string }[]): boolean {
  return cookies.some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
}

/**
 * proxy が確かめたログインユーザーの id を、ページ側へ渡すためのヘッダー。
 *
 * proxy と各ページはどちらも「今このリクエストは誰なのか」を必要とするが、
 * それぞれが getUser() を呼ぶと Supabase Auth への往復が1回の画面遷移で
 * 2回発生する。proxy が出した答えをそのまま渡せば、後段は往復を省ける。
 *
 * このヘッダーは proxy が必ず上書きする（外から同名のヘッダーが来ていても
 * 捨てる）ので、ページ側から見れば偽装できない。proxy を通らずにページが
 * 描画されることは無い（matcher は静的ファイルしか除外していない）が、
 * 万一無ければ後段は自前で getUser() する作りにしてある。
 */
export const PROXY_USER_ID_HEADER = "x-pompman-user-id";

/** 期限切れ間際のセッションは「まだ有効」とみなさない余裕（秒）。 */
const SESSION_EXPIRY_MARGIN_SEC = 60;

/**
 * アクセストークンの期限がまだ十分に残っているか。
 *
 * getSession() は期限切れなら勝手に更新しに行くが、その判断は
 * ライブラリ側の閾値に委ねられている。こちらでも余裕を持って確かめて、
 * 「残り数秒のトークンを有効と信じて先へ進む」ことが無いようにする。
 */
export function isSessionFresh(session: Session): boolean {
  if (!session.expires_at) return false;
  return session.expires_at - SESSION_EXPIRY_MARGIN_SEC > Math.floor(Date.now() / 1000);
}

/**
 * status を見て「本当にセッションが無効」なのか「Supabase に届かなかった」のかを分ける。
 * 400/401/403 はセッションの問題。それ以外（fetch 自体の失敗・5xx）は通信の問題。
 */
function isNetworkFailure(error: unknown): boolean {
  if (!error) return false;

  const e = error as { name?: string; status?: number };
  if (e.name === "AuthRetryableFetchError") return true;
  if (typeof e.status === "number") return e.status >= 500;

  // status が付かないのは fetch レベルで落ちている（DNS・タイムアウト等）。
  return true;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * getUser() は「未ログイン」でも「Supabase に届かなかった」でも user: null を返す。
 * この2つを区別せず /login にリダイレクトしていたため、通信が一瞬失敗しただけで
 * ログアウト扱いになっていた（タスクキル直後の再起動で特に起きやすい）。
 *
 * 通信起因の失敗は数回リトライし、それでも駄目なら networkFailure として返す。
 * 呼び出し側はこれを見て「ログアウトさせる」か「そのまま通す」かを決める。
 */
export async function getUserResilient(
  supabase: SupabaseClient,
): Promise<{ user: User | null; networkFailure: boolean; authError?: string }> {
  const delays = [150, 400];

  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.auth.getUser();

    if (data.user) return { user: data.user, networkFailure: false };
    if (!isNetworkFailure(error)) {
      return { user: null, networkFailure: false, authError: describeAuthError(error) };
    }
    if (attempt >= delays.length) {
      return { user: null, networkFailure: true, authError: describeAuthError(error) };
    }

    await sleep(delays[attempt]);
  }
}

/** ログ用。トークンは絶対に含めない。 */
function describeAuthError(error: unknown): string {
  if (!error) return "none";
  const e = error as { name?: string; status?: number; message?: string };
  return `${e.name ?? "?"}/${e.status ?? "?"}/${e.message ?? "?"}`;
}

/**
 * セッションが復元できなかったときに、原因を切り分けるための情報を作る。
 *
 * 「Cookie が端末から消えている」のか「Cookie はあるが壊れている（分割された
 * チャンクの片方だけ失われた等）」のかは、どちらも同じ症状（Supabase に
 * 問い合わせが飛ばないまま未ログイン扱い）になるため、外形からは区別できない。
 *
 * 値はセッショントークンそのものなので絶対に出さない。名前と長さだけ記録する。
 */
export function describeAuthCookies(cookies: { name: string; value: string }[]): string {
  const auth = cookies.filter((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
  if (auth.length === 0) {
    const others = cookies.map((c) => c.name).join(",") || "(none)";
    return `authCookies=0 otherCookies=[${others}]`;
  }
  const parts = auth.map((c) => `${c.name}:${c.value.length}B`).join(" ");
  return `authCookies=${auth.length} ${parts}`;
}
