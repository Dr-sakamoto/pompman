import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { supabaseAnonKey, supabaseUrl } from "./env";
import { AUTH_COOKIE_OPTIONS } from "./cookies";

/**
 * 1リクエストにつき1個だけ作って使い回す（React の cache）。
 *
 * createClient() は1回のリクエストで何度も呼ばれる。たとえば回答を送ると
 * 「Server Action → requireMember() → revalidatePath による再レンダリング
 * → そこでも requireMember()」と連なる。呼ぶたびに新しいクライアントを
 * 作っていると、そのたびにセッション Cookie をパースし直し、期限が近ければ
 * インスタンスごとに別々でトークンを更新しに行っていた。
 * 使い回せば、その重複した往復がまるごと消える。
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component からは Cookie を書けない。
          // セッションの更新は middleware 側でやっているので無視してよい。
        }
      },
    },
  });
});
