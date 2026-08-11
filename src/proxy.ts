import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { describeAuthCookies, getUserResilient, hasAuthCookie } from "@/lib/supabase/auth";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookies";
import { SESSION_BACKUP_COOKIE, SESSION_BACKUP_OPTIONS } from "@/lib/supabase/session-backup";

const PUBLIC_PATHS = ["/login", "/signup"];

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() を呼ぶことでセッションが更新され、Cookie が書き戻される。
  // Cookie が無いなら問い合わせるまでもなく未ログイン。
  const signedIn = hasAuthCookie(request.cookies.getAll());
  let { user, networkFailure, authError } = signedIn
    ? await getUserResilient(supabase)
    : { user: null, networkFailure: false, authError: undefined as string | undefined };

  /*
   * 本体のセッション Cookie から復元できなかったが、控えの refresh token が
   * 残っているなら、そこからセッションを作り直す。
   *
   * 本体は 4KB 級で `.0` `.1` に分割保存されるため、片方だけ失われると
   * 復元できない。控えは数十文字の単独 Cookie なので分割されず、生き残りやすい。
   * これで「Cookie が消えた／壊れた」のどちらであってもログインを維持できる。
   */
  const backupToken = request.cookies.get(SESSION_BACKUP_COOKIE)?.value;
  if (!user && !networkFailure && backupToken) {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: backupToken });
    if (data.user) {
      user = data.user;
      console.log(`[session-recovered] path=${request.nextUrl.pathname} was=${authError ?? "-"}`);
    } else {
      authError = `backupFailed:${error?.message ?? "?"}`;
    }
  }

  // 控えを最新の refresh token に保つ。リフレッシュのたびに回るため、
  // 古いものを残すと次回の復旧に失敗する。getSession() は Cookie を読むだけで
  // 通信は発生しない。
  if (user) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.refresh_token && session.refresh_token !== backupToken) {
      response.cookies.set(SESSION_BACKUP_COOKIE, session.refresh_token, SESSION_BACKUP_OPTIONS);
    }
  }

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Supabase に届かなかっただけの場合はログアウトさせない。
  // ここで飛ばすと、復帰直後の一瞬の通信失敗でログイン画面に戻されてしまう。
  if (networkFailure) {
    logSessionLoss(request, "networkFailure", authError);
    return response;
  }

  // ログイン済みならログイン画面に留まらせない。控えから復旧できた場合に
  // ここを通る。POST を弾くと再ログインが壊れるので GET だけを対象にする。
  if (user && isPublic && request.method === "GET") {
    return redirectTo(request, "/", response);
  }

  if (!user && !isPublic) {
    /*
     * 【調査用ログ・原因が特定でき次第外す】
     *
     * ここに来る理由は2通りあり、外形からは区別できない:
     *   (a) 端末から Cookie が消えている
     *   (b) Cookie はあるが復元できない（分割チャンクの片方だけ失われた等）
     * どちらも「Supabase への問い合わせが飛ばないまま未ログイン扱い」になる。
     * Cookie の名前と長さだけ記録して切り分ける。値は絶対に出さない。
     */
    logSessionLoss(request, "redirectToLogin", authError);

    return redirectTo(request, "/login", response);
  }

  return response;
}

/**
 * リダイレクトしつつ、それまでに書いた Cookie を引き継ぐ。
 *
 * NextResponse.redirect() は新しいレスポンスなので、そのまま返すと
 * セッションの更新や控えの保存がすべて捨てられる。控えから復旧した直後に
 * これをやると、復旧 → 破棄 → 復旧 … と無限に繰り返すことになる。
 */
function redirectTo(request: NextRequest, pathname: string, current: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";

  const redirected = NextResponse.redirect(url);
  for (const cookie of current.cookies.getAll()) {
    redirected.cookies.set(cookie);
  }
  return redirected;
}

/** 調査用。セッションを失った瞬間の状況を残す。値は含めない。 */
function logSessionLoss(request: NextRequest, reason: string, authError?: string) {
  const ua = request.headers.get("user-agent") ?? "?";
  console.log(
    `[session-loss] reason=${reason} path=${request.nextUrl.pathname}` +
      ` ${describeAuthCookies(request.cookies.getAll())}` +
      ` authError=${authError ?? "-"}` +
      ` secFetchSite=${request.headers.get("sec-fetch-site") ?? "-"}` +
      ` secFetchMode=${request.headers.get("sec-fetch-mode") ?? "-"}` +
      ` ua=${ua.slice(0, 120)}`,
  );
}

export const config = {
  /*
   * 認証チェックが要るのはページと Server Action だけ。静的ファイルまで通すと、
   * 未ログイン時に /login の HTML が返ってしまう。
   *
   * 特に /sw.js がこれに当たっていた。Content-Type が text/html になるため
   * navigator.serviceWorker.register() が MIME type エラーで失敗し、
   * 「ログイン画面に戻される状態」に陥ると Service Worker の更新チェックまで
   * 失敗して、壊れた古い Service Worker が更新されないまま残り続けていた。
   */
  matcher: [
    "/((?!_next/|sw\\.js|manifest\\.webmanifest|favicon\\.ico|.*\\.(?:svg|png|jpe?g|gif|webp|ico|js|css|json|txt|woff2?)$).*)",
  ],
};
