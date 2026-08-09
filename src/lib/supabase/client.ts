import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./env";

/**
 * PKCE だと、ログインをリクエストしたブラウザにしかない code verifier が
 * 必要になり、別ブラウザ・別アプリでリンクを開くと失敗する
 * （メールアプリ内ブラウザでよく起きる）。implicit にしておけば、
 * メールのリンクを開かず URL だけコピーして貼る運用でも
 * verifyOtp が素直な token を受け取れる。
 */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { flowType: "implicit" },
  });
}
