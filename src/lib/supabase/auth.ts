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

/**
 * Cookie に入っているセッションをそのまま読む。
 *
 * getUser() と違って Auth サーバーへ問い合わせないので、通常は通信ゼロで返る
 * （期限が近いときだけ auth-js が裏でトークンを更新し、そのぶんだけ往復する）。
 *
 * **署名は検証していないので、これで「本人である」と判断してはいけない。**
 * 用途は proxy.ts の「/login に飛ばすかどうか」の交通整理だけ。その先の
 * ページと Server Action は必ず requireMember() を通り、そこで getUser() が
 * Auth サーバーに問い合わせる。DB 側も RLS が本物の JWT で判定する。
 * 偽の Cookie を持ち込んでも、リダイレクトを1回すり抜けられるだけで
 * データには一切触れない。
 */
export async function getSessionResilient(
  supabase: SupabaseClient,
): Promise<{ session: Session | null; networkFailure: boolean }> {
  const delays = [150, 400];

  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.auth.getSession();

    if (data.session) return { session: data.session, networkFailure: false };
    if (!isNetworkFailure(error)) return { session: null, networkFailure: false };
    if (attempt >= delays.length) return { session: null, networkFailure: true };

    await sleep(delays[attempt]);
  }
}
