import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Supabase のセッション Cookie が入っているか。
 * @supabase/ssr は `sb-<project-ref>-auth-token` という名前で保存する
 * （長いと `.0` `.1` と分割される）。
 */
export function hasAuthCookie(cookies: { name: string }[]): boolean {
  return cookies.some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
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
): Promise<{ user: User | null; networkFailure: boolean }> {
  const delays = [150, 400];

  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.auth.getUser();

    if (data.user) return { user: data.user, networkFailure: false };
    if (!isNetworkFailure(error)) return { user: null, networkFailure: false };
    if (attempt >= delays.length) return { user: null, networkFailure: true };

    await sleep(delays[attempt]);
  }
}
