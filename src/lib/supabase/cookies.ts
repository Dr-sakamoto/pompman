import type { CookieOptions } from "@supabase/ssr";

/**
 * セッション Cookie の属性。
 *
 * @supabase/ssr の既定は httpOnly: false で、ブラウザ側の createBrowserClient が
 * Cookie を読み書きできるようにしてある。しかし本アプリはログインも含めて
 * すべて Server Action / middleware 側で完結しており、createBrowserClient は
 * 一切使っていない（src/lib/supabase/client.ts は未使用）。
 *
 * スクリプトから読める Cookie は Safari の ITP が「script-writable storage」として
 * 破棄対象に含めるため、ホーム画面から起動する PWA だとタスクキル後に
 * セッションごと消えることがある。実際、タスクキル直後のリクエストでは
 * 認証 Cookie が送られておらず（Supabase への問い合わせすら発生せず）
 * middleware が 307 で /login に飛ばしていた。
 *
 * 読む必要が無いのだから httpOnly にして、この対象から外す。
 * XSS でトークンを抜かれなくなる副次的な利点もある。
 *
 * maxAge はライブラリ側が常に既定値（400日）で上書きするため、ここでは指定しない。
 */
export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
};
