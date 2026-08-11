import { createBrowserClient } from "@supabase/ssr";
import { supabaseAnonKey, supabaseUrl } from "./env";

/*
 * 現在この関数は使われていない。認証はすべて Server Action / middleware 側で
 * 行っており、セッション Cookie は httpOnly で発行している（cookies.ts 参照）。
 * つまりブラウザ側からはセッションを読めないので、これを使ってもログイン状態は
 * 取れない。使うなら httpOnly を外す必要があるが、それは Safari の ITP に
 * セッションを消される原因そのものなので、避けること。
 */

export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
