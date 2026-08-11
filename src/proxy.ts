import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { getSessionResilient, hasAuthCookie } from "@/lib/supabase/auth";

const PUBLIC_PATHS = ["/login", "/signup"];

export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
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

  /*
   * ここは全リクエスト（ページ表示も Server Action の POST も）が通る。
   * 以前は getUser() を呼んでいたが、これは毎回 Auth サーバーへの往復に
   * なるため、回答送信・ログイン・お題送信のすべてに固定で1往復ぶんの
   * 待ち時間を足していた。
   *
   * middleware に要るのは (1) 期限が近いセッションを更新して Cookie に
   * 書き戻すこと、(2) 未ログインなら /login に流すこと、の2つだけ。
   * getSession() は Cookie から読むだけなので通常は通信せず、(1) が必要な
   * ときだけ内部でリフレッシュして setAll() が走る。
   *
   * 「本人か」の検証をここでしなくてよい理由は getSessionResilient() の
   * コメントを参照（ページ側の requireMember() と DB の RLS が本番の関所）。
   */
  const signedIn = hasAuthCookie(request.cookies.getAll());
  const { session, networkFailure } = signedIn
    ? await getSessionResilient(supabase)
    : { session: null, networkFailure: false };

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Supabase に届かなかっただけの場合はログアウトさせない。
  // ここで飛ばすと、復帰直後の一瞬の通信失敗でログイン画面に戻されてしまう。
  if (networkFailure) return response;

  if (!session && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
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
