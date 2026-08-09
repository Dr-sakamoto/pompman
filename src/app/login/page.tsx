"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ErrorText, Panel } from "@/components/ui";

/**
 * メール + パスワードでログインする。
 *
 * マジックリンク（メール送信）はメールアプリ・ブラウザの組み合わせで壊れやすく、
 * SMTP の運用も必要になるのでやめた。アカウントは管理者が作り、パスワードは
 * 管理者から本人へ直接渡す。認証メールは一通も送らない。
 */
export default function LoginPage() {
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
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // handle 未登録なら requireMember() が /onboarding に飛ばす
      window.location.href = "/";
    } catch (err) {
      setError(
        err instanceof Error && err.message === "Invalid login credentials"
          ? "メールアドレスまたはパスワードが違います"
          : err instanceof Error
            ? err.message
            : "ログインできませんでした",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">ログイン</h1>
        <p className="mt-1 text-sm text-muted">
          招待制です。アカウントは管理者が作ります。メールアドレスとパスワードを受け取っていない場合は管理者に聞いてください。
        </p>
      </div>

      <Panel>
        <form onSubmit={onSubmit} className="space-y-4">
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
            />
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
            {busy ? "確認中…" : "ログイン"}
          </button>

          <ErrorText message={error} />
        </form>
      </Panel>
    </div>
  );
}
