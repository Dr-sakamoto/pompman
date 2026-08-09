"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseUrl } from "@/lib/supabase/env";
import { requireMember } from "@/lib/session";

export type ActionState = { error?: string };

/** サインアップ直後の handle 登録。ここで学習利用への同意も記録する。 */
export async function registerHandle(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const handle = String(formData.get("handle") ?? "").trim();
  if (handle.length < 1 || handle.length > 20) {
    return { error: "表示名は1〜20文字で入力してください" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("users")
    .insert({ id: user.id, handle, terms_accepted_at: new Date().toISOString() });

  if (error) {
    if (error.code === "23505") return { error: "その表示名はすでに使われています" };
    return { error: error.message };
  }

  redirect("/");
}

export async function createOdai(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return { error: "お題を入力してください" };
  if (text.length > 200) return { error: "お題は200文字以内にしてください" };

  const { user } = await requireMember();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("odai")
    .insert({ author_id: user.id, text })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/");
  redirect(`/odai/${data.id}`);
}

export async function submitAnswer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const odaiId = Number(formData.get("odai_id"));
  const text = String(formData.get("text") ?? "").trim();
  if (!Number.isInteger(odaiId)) return { error: "お題が不正です" };
  if (!text) return { error: "回答を入力してください" };
  if (text.length > 500) return { error: "回答は500文字以内にしてください" };

  const { user } = await requireMember();
  const supabase = await createClient();

  const { error } = await supabase
    .from("answers")
    .insert({ odai_id: odaiId, author_id: user.id, text });

  if (error) {
    if (error.code === "23505") return { error: "このお題にはすでに回答済みです" };
    if (error.code === "42501") return { error: "このお題はもう回答を受け付けていません" };
    return { error: error.message };
  }

  revalidatePath(`/odai/${odaiId}`);
  revalidatePath("/");
  return {};
}

export async function submitPicks(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const odaiId = Number(formData.get("odai_id"));
  if (!Number.isInteger(odaiId)) return { error: "お題が不正です" };

  // rank_1, rank_2, rank_3 の順に詰める。空欄は後ろにしか来ない前提。
  const ids: number[] = [];
  for (const rank of [1, 2, 3]) {
    const raw = formData.get(`rank_${rank}`);
    if (raw === null || raw === "") continue;
    const id = Number(raw);
    if (!Number.isInteger(id)) return { error: "選んだ回答が不正です" };
    ids.push(id);
  }
  if (ids.length === 0) return { error: "1位を選んでください" };
  if (new Set(ids).size !== ids.length) {
    return { error: "同じ回答を複数の順位に選ぶことはできません" };
  }

  await requireMember();
  const supabase = await createClient();

  const { error } = await supabase.rpc("submit_picks", {
    p_odai_id: odaiId,
    p_answer_ids: ids,
  });

  if (error) return { error: error.message };

  revalidatePath(`/odai/${odaiId}`);
  revalidatePath("/");
  return {};
}

export async function closeAnswers(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const odaiId = Number(formData.get("odai_id"));
  if (!Number.isInteger(odaiId)) return { error: "お題が不正です" };

  await requireMember();
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_answers", { p_odai_id: odaiId });
  if (error) return { error: error.message };

  revalidatePath(`/odai/${odaiId}`);
  revalidatePath("/");
  return {};
}

export async function closeVoting(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const odaiId = Number(formData.get("odai_id"));
  if (!Number.isInteger(odaiId)) return { error: "お題が不正です" };

  await requireMember();
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_voting", { p_odai_id: odaiId });
  if (error) return { error: error.message };

  revalidatePath(`/odai/${odaiId}`);
  revalidatePath("/");
  return {};
}

/** メンバーがアプリ内からメンバーを招待できるようにする。実処理は Supabase Edge Function 側。 */
export async function inviteMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "メールアドレスを入力してください" };

  await requireMember();
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "ログインが必要です" };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const res = await fetch(`${supabaseUrl()}/functions/v1/invite-member`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ email, redirectTo: siteUrl ? `${siteUrl}/auth/callback` : undefined }),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) return { error: json.error ?? "招待に失敗しました" };

  return {};
}
