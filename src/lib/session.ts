import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";
import { PROXY_USER_ID_HEADER, getUserResilient } from "./supabase/auth";
import type { AppUser } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * proxy が確かめたログインユーザーの id。無ければ null。
 *
 * proxy は外から来た同名ヘッダーを必ず捨ててから自分の値を入れるので、
 * ここに届く値は偽装されていない。念のため形だけは確かめておく。
 */
async function userIdFromProxy(): Promise<string | null> {
  const id = (await headers()).get(PROXY_USER_ID_HEADER);
  return id && UUID.test(id) ? id : null;
}

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

  /*
   * 【速い道】proxy が既に誰なのかを確かめているので、users を直接引く。
   *
   * ここで getUser() を呼ぶと、同じ画面遷移の中で Supabase Auth への往復が
   * proxy と合わせて2回になる。往復1回ぶんがまるごと待ち時間として乗るので、
   * 分かっている答えを二度確かめない。
   *
   * この users への問い合わせ自体が、トークンが本物かどうかの検査も兼ねる。
   * 署名が通らないトークンなら PostgREST が 401 で弾き、error が返る。
   * その場合は下の確実な道に落として、ログイン画面に送るか通信エラーに
   * するかを見極める。
   */
  const proxyUserId = await userIdFromProxy();
  if (proxyUserId) {
    const { data: profile, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", proxyUserId)
      .maybeSingle();

    if (profile) return { user: profile as AppUser, authId: proxyUserId };
    if (!error) redirect("/onboarding");
  }

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
