"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";
import { ErrorText, Panel } from "@/components/ui";

/**
 * 招待コードでアカウントを作る。
 *
 * 管理者は 4 桁のコードを配るだけで、メールアドレスとパスワードは本人が決める。
 * 引き換えは Edge Function (verify_jwt: false) 側で、コードの原子的な確保と
 * ユーザー作成をまとめて行う。
 */
export default function SignupPage() {
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${supabaseUrl()}/functions/v1/redeem-invite-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // verify_jwt: false だが、Edge Function のゲートウェイは apikey を要求する
          apikey: supabaseAnonKey(),
        },
        body: JSON.stringify({ code: code.trim(), email: email.trim(), password }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "登録に失敗しました");

      // 作成できたので、そのままログインして表示名の登録へ進む
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;

      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">招待コードで登録</h1>
        <p className="mt-1 text-sm text-muted">
          管理者から受け取った4桁のコードを入れて、自分のメールアドレスとパスワードを決めてください。
        </p>
      </div>

      <Panel>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="code" className="mb-1 block text-sm font-medium">
              招待コード
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              required
              pattern="[0-9]{4}"
              maxLength={4}
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="1234"
              className="w-full rounded-md border border-line bg-ink px-3 py-2 text-center text-lg tracking-[0.4em] outline-none focus:border-accent"
            />
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              メールアドレス
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              パスワード
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
              placeholder="8文字以上"
            />
            <p className="mt-1 text-xs text-muted">
              次回からはこのメールアドレスとパスワードでログインします。忘れないようにしてください。
            </p>
          </div>

          {/*
            仕様書 §7。文面は運営側で用意する前提なので、ここは要旨のみ。
            後から追加すると必ず揉めるので、最初から同意を取る。
          */}
          <label className="flex gap-2 text-sm text-muted">
            <input
              type="checkbox"
              required
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 shrink-0"
            />
            <span>
              投稿したお題・回答・選出データが本プロジェクトのAI学習に利用されること、学習済みモデルおよびデータを外部に公開しないこと、退会時のデータの取り扱いに同意します。
            </span>
          </label>

          <button
            type="submit"
            disabled={busy || !agreed}
            className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
          >
            {busy ? "登録中…" : "登録する"}
          </button>

          <ErrorText message={error} />
        </form>
      </Panel>

      <p className="text-sm text-muted">
        すでにアカウントがある場合は{" "}
        <a href="/login" className="font-medium text-accent hover:underline">
          ログイン
        </a>
      </p>
    </div>
  );
}
