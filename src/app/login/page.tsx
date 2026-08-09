"use client";

import { useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { ErrorText, Panel } from "@/components/ui";

/**
 * メールのリンクをタップして別ブラウザ（Gmailのアプリ内ブラウザ等）で開くと、
 * ログインをリクエストしたブラウザにしかない PKCE の code verifier が見つからず失敗する。
 * リンクは開かず URL ごとコピーして貼ってもらい、中の token を直接 verifyOtp に渡せば
 * verifier なしでログインできるので、この問題を回避できる。
 */
function extractTokenHash(input: string): { tokenHash: string; type: EmailOtpType } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    let url = new URL(trimmed);

    // Gmail 等がリンクをクリック計測用に包んでいる場合があるので、中の URL を掘り出す
    const wrapped = url.searchParams.get("q") ?? url.searchParams.get("u");
    if (wrapped) {
      try {
        url = new URL(wrapped);
      } catch {
        // 包んでいなかった場合はそのまま元の url を使う
      }
    }

    const tokenHash = url.searchParams.get("token_hash") ?? url.searchParams.get("token");
    if (!tokenHash) return null;

    const type = (url.searchParams.get("type") as EmailOtpType | null) ?? "email";
    return { tokenHash, type };
  } catch {
    return null;
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const origin =
        process.env.NEXT_PUBLIC_SITE_URL ??
        (typeof window !== "undefined" ? window.location.origin : "");
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${origin}/auth/callback` },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインリンクを送れませんでした");
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const parsed = extractTokenHash(link);
      if (!parsed) {
        setError("リンクを正しく貼り付けられていないようです");
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        token_hash: parsed.tokenHash,
        type: parsed.type,
      });
      if (error) throw error;

      // handle 未登録なら requireMember() が /onboarding に飛ばす
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインできませんでした");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">メールを送りました</h1>
          <p className="mt-1 text-sm text-muted">
            {email} にログイン用のリンクを送りました。メールアプリ内でリンクを直接開くと失敗することがあるので、
            リンクを<strong className="text-white">長押しして「リンクをコピー」</strong>で選び、下の欄に貼り付けてください。
          </p>
        </div>

        <Panel>
          <form onSubmit={onVerifyLink} className="space-y-4">
            <textarea
              required
              rows={3}
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://... で始まるリンクを貼り付け"
              className="w-full resize-none rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy || link.trim().length === 0}
              className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
            >
              {busy ? "確認中…" : "この内容でログインする"}
            </button>
            <ErrorText message={error} />
          </form>

          <button
            type="button"
            onClick={() => {
              setSent(false);
              setLink("");
              setError(null);
            }}
            className="mt-3 text-xs text-muted hover:text-white"
          >
            メールアドレスを変更する
          </button>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">ログイン</h1>
        <p className="mt-1 text-sm text-muted">
          招待制です。メールアドレスにログイン用のリンクを送ります（パスワードはありません）。
        </p>
      </div>

      <Panel>
        <form onSubmit={onSendLink} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              メールアドレス
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
              placeholder="you@example.com"
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
            {busy ? "送信中…" : "ログインリンクを送る"}
          </button>

          <ErrorText message={error} />
        </form>
      </Panel>
    </div>
  );
}
