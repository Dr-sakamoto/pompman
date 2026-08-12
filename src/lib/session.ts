import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";
import { getUserResilient } from "./supabase/auth";
import type { AppUser } from "./types";

/**
 * ログイン済みかつ handle 登録済みであることを保証する。
 * どちらか欠けていたら適切な画面に飛ばす。
 *
 * cache() で1リクエストにつき1回だけ実行する。回答を送ると Server Action と
 * その後の再レンダリングの両方から呼ばれるが、同じリクエストの中で認証状態が
 * 変わることはないので、Auth サーバーと users テーブルへの往復を2回する意味がない。
 */
export const requireMember = cache(async function requireMember(): Promise<{
  user: AppUser;
  authId: string;
}> {
  const supabase = await createClient();
  const { user: authUser, networkFailure } = await getUserResilient(supabase);

  // 通信できなかっただけならログイン画面には飛ばさない。
  // セッション自体は生きているので、エラーにして再読み込みさせる。
  if (networkFailure) {
    throw new Error("認証サーバーに接続できませんでした。通信環境を確認して再読み込みしてください。");
  }

  if (!authUser) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .maybeSingle();

  if (!profile) redirect("/onboarding");

  return { user: profile as AppUser, authId: authUser.id };
});

/**
 * admin ロールであることを保証する。
 * ログイン・登録済みでも role が admin でなければ弾く。
 * Gemini 連携や API キー追加など、誰でも実行できると危険な処理はこれで守る。
 */
export async function requireAdmin(): Promise<{ user: AppUser; authId: string }> {
  const { user, authId } = await requireMember();

  if (user.role !== "admin") redirect("/");

  return { user, authId };
}
