import { createClient } from "npm:@supabase/supabase-js@2";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 呼び出し元の本人確認。招待は既存メンバー(users に登録済み)のみに許可する。
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user: caller },
  } = await callerClient.auth.getUser();
  if (!caller) {
    return new Response(JSON.stringify({ error: "認証が必要です" }), { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: profile } = await admin
    .from("users")
    .select("id")
    .eq("id", caller.id)
    .maybeSingle();
  if (!profile) {
    return new Response(JSON.stringify({ error: "メンバー登録が必要です" }), { status: 403 });
  }

  let body: { email?: string; redirectTo?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "不正なリクエストです" }), { status: 400 });
  }

  const email = (body.email ?? "").trim();
  if (!EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ error: "メールアドレスが不正です" }), { status: 400 });
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: body.redirectTo,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
