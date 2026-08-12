import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import {
  PROXY_USER_ID_HEADER,
  describeAuthCookies,
  getUserResilient,
  hasAuthCookie,
  isSessionFresh,
} from "@/lib/supabase/auth";
import { AUTH_COOKIE_OPTIONS } from "@/lib/supabase/cookies";
import { SESSION_BACKUP_COOKIE, SESSION_BACKUP_OPTIONS } from "@/lib/supabase/session-backup";

const PUBLIC_PATHS = ["/login", "/signup"];

type CookieToSet = { name: string; value: string; options: CookieOptions };

export default async function proxy(request: NextRequest) {
  /*
   * Supabase が書き戻す Cookie は貯めておき、最後にレスポンスへまとめて載せる。
   * 以前は setAll のたびにレスポンスを作り直していたが、それだと
   * 「ユーザーが分かってからリクエストヘッダーを足す」ことができない。
   */
  const pendingCookies: CookieToSet[] = [];

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          pendingCookies.push({ name, value, options });
        }
      },
    },
  });

  // Cookie が無いなら問い合わせるまでもなく未ログイン。
  const signedIn = hasAuthCookie(request.cookies.getAll());
  let user: User | null = null;
  let networkFailure = false;
  let authError: string | undefined;

  if (signedIn) {
    /*
     * 【速い道】Cookie に入っているセッションをそのまま使う。
     *
     * getUser() は毎回 Supabase Auth への往復が発生する。ここは全ページ・
     * 全 Server Action・プリフェッチのすべてが通る場所なので、その往復が
     * そのまま「タップしてから画面が変わるまでの待ち時間」に化けていた。
     * getSession() は Cookie を読むだけで通信しない（期限切れのときだけ
     * トークン更新が飛ぶ）。
     *
     * 署名を検証していないセッションを信じてよいのは、ここでの判定の用途が
     * 「ログイン画面に飛ばすかどうか」だけだから。データの読み書きは例外なく
     * Supabase 越し（RLS 付き）で、トークンの署名はその都度あちら側で
     * 検証される。偽のトークンを持ち込んでもページの器が出るだけで、
     * requireMember() が users を引いた時点で弾かれ /login に戻る。
     */
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session && isSessionFresh(session)) {
      user = session.user;
    } else {
      // 【確実な道】セッションが無い・期限切れ・更新に失敗した。
      // 未ログインなのか通信できなかっただけなのかを、リトライしつつ見極める。
      ({ user, networkFailure, authError } = await getUserResilient(supabase));
    }
  }

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
      pendingCookies.push({
        name: SESSION_BACKUP_COOKIE,
        value: session.refresh_token,
        options: SESSION_BACKUP_OPTIONS,
      });
    }
  }

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Supabase に届かなかっただけの場合はログアウトさせない。
  // ここで飛ばすと、復帰直後の一瞬の通信失敗でログイン画面に戻されてしまう。
  if (networkFailure) {
    logSessionLoss(request, "networkFailure", authError);
    return buildResponse(request, null, pendingCookies);
  }

  // ログイン済みならログイン画面に留まらせない。控えから復旧できた場合に
  // ここを通る。POST を弾くと再ログインが壊れるので GET だけを対象にする。
  if (user && isPublic && request.method === "GET") {
    return redirectTo(request, "/", pendingCookies);
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

    return redirectTo(request, "/login", pendingCookies);
  }

  return buildResponse(request, user?.id ?? null, pendingCookies);
}

/**
 * 後段へ渡すレスポンスを組み立てる。
 *
 * 分かったユーザーの id をリクエストヘッダーに載せて、ページ側が
 * getUser() をやり直さずに済むようにする（PROXY_USER_ID_HEADER 参照）。
 * 外から来た同名のヘッダーは、値を入れる前に必ず捨てる。
 */
function buildResponse(request: NextRequest, userId: string | null, cookies: CookieToSet[]) {
  const headers = new Headers(request.headers);
  headers.delete(PROXY_USER_ID_HEADER);
  if (userId) headers.set(PROXY_USER_ID_HEADER, userId);

  const response = NextResponse.next({ request: { headers } });
  for (const { name, value, options } of cookies) {
    response.cookies.set(name, value, options);
  }
  return response;
}

/**
 * リダイレクトしつつ、それまでに書いた Cookie を引き継ぐ。
 *
 * NextResponse.redirect() は新しいレスポンスなので、Cookie を載せ直さないと
 * セッションの更新や控えの保存がすべて捨てられる。控えから復旧した直後に
 * これをやると、復旧 → 破棄 → 復旧 … と無限に繰り返すことになる。
 */
function redirectTo(request: NextRequest, pathname: string, cookies: CookieToSet[]) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";

  const redirected = NextResponse.redirect(url);
  for (const { name, value, options } of cookies) {
    redirected.cookies.set(name, value, options);
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
