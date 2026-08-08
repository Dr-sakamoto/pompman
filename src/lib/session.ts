import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import type { AppUser } from "./types";

/**
 * ログイン済みかつ handle 登録済みであることを保証する。
 * どちらか欠けていたら適切な画面に飛ばす。
 */
export async function requireMember(): Promise<{ user: AppUser; authId: string }> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .maybeSingle();

  if (!profile) redirect("/onboarding");

  return { user: profile as AppUser, authId: authUser.id };
}
