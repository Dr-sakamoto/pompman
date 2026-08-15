"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SESSION_BACKUP_COOKIE, SESSION_BACKUP_OPTIONS } from "@/lib/supabase/session-backup";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { requireAdmin, requireMember } from "@/lib/session";
import { HANDLE_CHANGE_COOLDOWN_DAYS, MAX_PICKS } from "@/lib/types";
import { notifyNewOdai, notifyNewlyClosedOdai } from "@/lib/push/notify";

export type ActionState = { error?: string };

/**
 * メール + パスワードでログインする。
 *
 * クライアント側で signInWithPassword() を呼んで window.location.href で
 * 遷移する方式だと、Cookie の書き込み（document.cookie）と直後のハード
 * ナビゲーションのタイミングが競合し、特にモバイルブラウザで Cookie が
 * 反映されないままリダイレクトされ、ログインしたはずなのに毎回ログイン
 * 画面に戻される不具合があった。Server Action で行えば、セッション
 * Cookie はレスポンスの Set-Cookie として確実に書き込まれる。
 */
export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "メールアドレスとパスワードを入力してください" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return {
      error:
        error.message === "Invalid login credentials"
          ? "メールアドレスまたはパスワードが違います"
          : error.message,
    };
  }

  await saveSessionBackup(data.session?.refresh_token);
  redirect("/");
}

/**
 * セッションの控えを保存する。
 * 本体の Cookie が失われても、これがあれば middleware が作り直せる。
 */
async function saveSessionBackup(refreshToken: string | undefined) {
  if (!refreshToken) return;
  const cookieStore = await cookies();
  cookieStore.set(SESSION_BACKUP_COOKIE, refreshToken, SESSION_BACKUP_OPTIONS);
}

/**
 * 招待コードを引き換えてアカウントを作り、そのままログインする。
 * login() と同じ理由で Server Action にしている（Cookie 書き込みの確実性）。
 */
export async function signup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const code = String(formData.get("code") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const res = await fetch(`${supabaseUrl()}/functions/v1/redeem-invite-code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey(),
    },
    body: JSON.stringify({ code, email, password }),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) return { error: json.error ?? "登録に失敗しました" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  await saveSessionBackup(data.session?.refresh_token);
  redirect("/");
}

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

/**
 * 登録済み handle の変更。1〜20文字であることに加え、クールダウン
 * （30日に1回まで）を守っているかは DB 側のトリガーが最終判定する
 * （0018 参照）。ここでのチェックはユーザーへの分かりやすいエラー表示のため。
 */
export async function updateHandle(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const handle = String(formData.get("handle") ?? "").trim();
  if (handle.length < 1 || handle.length > 20) {
    return { error: "表示名は1〜20文字で入力してください" };
  }

  const { user } = await requireMember();

  if (handle === user.handle) return {};

  const changedAt = new Date(user.handle_changed_at).getTime();
  const cooldownMs = HANDLE_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const remainingMs = changedAt + cooldownMs - Date.now();
  if (remainingMs > 0) {
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    return { error: `表示名の変更は前回の変更からあと${remainingDays}日後にできます` };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("users").update({ handle }).eq("id", user.id);

  if (error) {
    if (error.code === "23505") return { error: "その表示名はすでに使われています" };
    if (error.code === "P0001") return { error: "表示名の変更は前回の変更から30日経つまでできません" };
    return { error: error.message };
  }

  revalidatePath("/settings");
  revalidatePath("/members");
  return {};
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

  after(() => notifyNewOdai(data.id, user.id, text));

  revalidatePath("/");
  redirect(`/odai/${data.id}`);
}

export type EditOdaiState = ActionState & { done?: boolean };

/** お題の編集。出題者本人・未回答・open のときだけ通る（判定は DB 側の RLS）。 */
export async function editOdai(
  _prev: EditOdaiState,
  formData: FormData,
): Promise<EditOdaiState> {
  const odaiId = Number(formData.get("odai_id"));
  const text = String(formData.get("text") ?? "").trim();
  if (!Number.isInteger(odaiId)) return { error: "お題が不正です" };
  if (!text) return { error: "お題を入力してください" };
  if (text.length > 200) return { error: "お題は200文字以内にしてください" };

  await requireMember();
  const supabase = await createClient();

  const { error, data } = await supabase
    .from("odai")
    .update({ text })
    .eq("id", odaiId)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "編集できません（すでに回答が付いているか、出題者ではありません）" };
  }

  revalidatePath(`/odai/${odaiId}`);
  revalidatePath("/");
  return { done: true };
}

/** お題の削除。出題者本人・未回答・open のときだけ通る（判定は DB 側の RLS）。 */
export async function deleteOdai(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const odaiId = Number(formData.get("odai_id"));
  if (!Number.isInteger(odaiId)) return { error: "お題が不正です" };

  await requireMember();
  const supabase = await createClient();

  const { error, data } = await supabase.from("odai").delete().eq("id", odaiId).select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "削除できません（すでに回答が付いているか、出題者ではありません）" };
  }

  revalidatePath("/");
  redirect("/");
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

  // rank_1 … rank_MAX_PICKS の順に詰める。空欄は後ろにしか来ない前提。
  const ids: number[] = [];
  for (let rank = 1; rank <= MAX_PICKS; rank++) {
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

  // submit_picks は「全員やり切った」を満たした瞬間にお題を closed へ進めうる
  // （DB 側のトリガー、0013 参照）。起きたかどうかはここでは分からないので、
  // 拾い漏れがないよう毎回呼ぶ（何も閉じていなければ何もしない）。
  after(() => notifyNewlyClosedOdai());

  revalidatePath(`/odai/${odaiId}`);
  revalidatePath("/");
  return {};
}

/**
 * 「出し切ったので他人の回答を見る」を宣言する。片道切符で、以後このお題には
 * 回答を追加できなくなる（判定は DB 側）。
 */
export async function unlockAnswers(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const odaiId = Number(formData.get("odai_id"));
  if (!Number.isInteger(odaiId)) return { error: "お題が不正です" };

  await requireMember();
  const supabase = await createClient();
  const { error } = await supabase.rpc("unlock_answers", { p_odai_id: odaiId });
  if (error) return { error: error.message };

  // submitPicks と同じ理由（最後の1人の解禁でも closed へ進みうる）。
  after(() => notifyNewlyClosedOdai());

  revalidatePath(`/odai/${odaiId}`);
  revalidatePath("/");
  return {};
}

/** 回答・採点を締め切って結果を発表する。出題者だけが呼べる（判定は DB 側）。 */
export async function closeOdai(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const odaiId = Number(formData.get("odai_id"));
  if (!Number.isInteger(odaiId)) return { error: "お題が不正です" };

  await requireMember();
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_odai", { p_odai_id: odaiId });
  if (error) return { error: error.message };

  after(() => notifyNewlyClosedOdai());

  revalidatePath(`/odai/${odaiId}`);
  revalidatePath("/");
  return {};
}

/** Push 通知の購読を保存する。 */
export async function savePushSubscription(sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<{ error?: string }> {
  const { user } = await requireMember();
  const supabase = await createClient();

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
    },
    { onConflict: "endpoint" },
  );

  if (error) return { error: error.message };
  return {};
}

/** Push 通知の購読を解除する。 */
export async function deletePushSubscription(endpoint: string): Promise<{ error?: string }> {
  await requireMember();
  const supabase = await createClient();

  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return { error: error.message };
  return {};
}

export type IssueCodesState = ActionState & { codes?: string[] };

/** 招待コードを発行する。実際の発行と admin チェックは DB 関数側。 */
export async function issueInviteCodes(
  _prev: IssueCodesState,
  formData: FormData,
): Promise<IssueCodesState> {
  const count = Number(formData.get("count"));
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    return { error: "発行数は1〜20で指定してください" };
  }

  await requireAdmin();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_invite_codes", { p_count: count });
  if (error) return { error: error.message };

  revalidatePath("/invites");
  return { codes: (data ?? []) as string[] };
}

export type MemberActionState = ActionState & {
  done?: boolean;
  created?: boolean;
  email?: string;
};

/**
 * 管理者がメンバーのアカウントを作る／パスワードを変更する。
 * 実処理（service role が要る操作）は Supabase Edge Function 側。
 */
export async function upsertMember(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email) return { error: "メールアドレスを入力してください" };
  if (password.length < 8) return { error: "パスワードは8文字以上にしてください" };

  await requireAdmin();
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "ログインが必要です" };

  const res = await fetch(`${supabaseUrl()}/functions/v1/invite-member`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ email, password }),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: string; created?: boolean };
  if (!res.ok) return { error: json.error ?? "登録に失敗しました" };

  revalidatePath("/members");
  revalidatePath("/invites");
  return { done: true, created: json.created ?? false, email };
}

/**
 * 管理者がメンバーの本名メモを登録・更新・削除する。
 * 閲覧・書き込みとも DB 側の RLS で管理者以外を弾く。
 */
export async function setMemberRealName(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = String(formData.get("user_id") ?? "");
  const realName = String(formData.get("real_name") ?? "").trim();

  await requireAdmin();
  const supabase = await createClient();

  if (!realName) {
    const { error } = await supabase.from("member_real_names").delete().eq("user_id", userId);
    if (error) return { error: error.message };
    revalidatePath("/members");
    return {};
  }

  if (realName.length > 40) return { error: "本名は40文字以内にしてください" };

  const { error } = await supabase
    .from("member_real_names")
    .upsert({ user_id: userId, real_name: realName, updated_at: new Date().toISOString() });

  if (error) return { error: error.message };

  revalidatePath("/members");
  return {};
}
