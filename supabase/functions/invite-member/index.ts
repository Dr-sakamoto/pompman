import { createClient } from "npm:@supabase/supabase-js@2";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/**
 * 管理者がメンバーのメールアドレスとパスワードを直接登録する。
 *
 * 招待メールを送らないので SMTP 設定に一切依存しない。管理者が決めたパスワードを
 * LINE なり口頭なりで本人に渡し、本人はメール+パスワードでログインする。
 *
 * 他人のパスワードを書き換えられる操作なので admin ロール限定。
 */
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 呼び出し元の本人確認
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user: caller },
  } = await callerClient.auth.getUser();
  if (!caller) {
    return json({ error: "認証が必要です" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: profile } = await admin
    .from("users")
    .select("role")
    .eq("id", caller.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return json({ error: "管理者のみ実行できます" }, 403);
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "不正なリクエストです" }, 400);
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!EMAIL_RE.test(email)) {
    return json({ error: "メールアドレスが不正です" }, 400);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return json({ error: `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください` }, 400);
  }

  // 既存ユーザーならパスワードの再設定、居なければ新規作成。
  // listUsers に email フィルタが無いバージョンがあるので自前で突き合わせる。
  const existing = await findUserByEmail(admin, email);

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, created: false });
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    // 招待メールを送らないので、ここで確認済みにしないとログインできない
    email_confirm: true,
  });
  if (error) return json({ error: error.message }, 400);

  return json({ ok: true, created: true });
});

async function findUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<{ id: string } | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;

    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return { id: hit.id };

    if (data.users.length < 200) return null;
  }
  return null;
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
