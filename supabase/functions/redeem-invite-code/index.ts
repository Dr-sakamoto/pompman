import { createClient } from "npm:@supabase/supabase-js@2";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[0-9]{4}$/;
const MIN_PASSWORD_LENGTH = 8;

/**
 * 招待コードを引き換えて、本人が決めたメールアドレス+パスワードでアカウントを作る。
 *
 * 登録前の人が呼ぶので verify_jwt: false（未認証で到達できる）。
 * したがって「有効な未使用コードを持っていること」だけが唯一の関門になる。
 * コードの確保は DB 側で原子的に行い、同じコードで二重登録できないようにする。
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  let body: { code?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "不正なリクエストです" }, 400);
  }

  const code = (body.code ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!CODE_RE.test(code)) {
    return json({ error: "招待コードは4桁の数字です" }, 400);
  }
  if (!EMAIL_RE.test(email)) {
    return json({ error: "メールアドレスが不正です" }, 400);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return json({ error: `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください` }, 400);
  }

  // コードを原子的に確保する。ここを通れたのは 1 リクエストだけ。
  const { data: claimed, error: claimError } = await admin.rpc("claim_invite_code", {
    p_code: code,
  });
  if (claimError) {
    return json({ error: claimError.message }, 500);
  }
  if (!claimed) {
    return json({ error: "招待コードが違うか、すでに使われています" }, 400);
  }

  // 以降で失敗したらコードを未使用に戻す（使い捨てのまま溶かさない）
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    // 確認メールを送らない運用なので、ここで確認済みにする
    email_confirm: true,
  });

  if (createError || !created?.user) {
    await admin.rpc("release_invite_code", { p_code: code });
    const message = createError?.message ?? "登録に失敗しました";
    return json(
      {
        error: /already|registered|exists/i.test(message)
          ? "このメールアドレスはすでに登録されています"
          : message,
      },
      400,
    );
  }

  await admin.rpc("finalize_invite_code", {
    p_code: code,
    p_user: created.user.id,
  });

  return json({ ok: true }, 200);
});

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
