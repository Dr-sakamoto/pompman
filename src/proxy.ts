import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { getUserResilient, hasAuthCookie } from "@/lib/supabase/auth";

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

  // getUser() を呼ぶことでセッションが更新され、Cookie が書き戻される。
  // Cookie が無いなら問い合わせるまでもなく未ログイン。
  const signedIn = hasAuthCookie(request.cookies.getAll());
  const { user, networkFailure } = signedIn
    ? await getUserResilient(supabase)
    : { user: null, networkFailure: false };

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Supabase に届かなかっただけの場合はログアウトさせない。
  // ここで飛ばすと、復帰直後の一瞬の通信失敗でログイン画面に戻されてしまう。
  if (networkFailure) return response;

  if (!user && !isPublic) {
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
