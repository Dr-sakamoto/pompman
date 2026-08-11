"use client";

import { useActionState, useState } from "react";
import { login, type ActionState } from "@/app/actions";
import { ErrorText, Panel } from "@/components/ui";

/**
 * メール + パスワードでログインする。
 *
 * マジックリンク（メール送信）はメールアプリ・ブラウザの組み合わせで壊れやすく、
 * SMTP の運用も必要になるのでやめた。アカウントは管理者が作り、パスワードは
 * 管理者から本人へ直接渡す。認証メールは一通も送らない。
 *
 * ログイン処理は Server Action（login）で行う。クライアント側で
 * signInWithPassword() を呼んでから window.location.href で遷移する方式だと
 * セッション Cookie の書き込みとハードナビゲーションが競合し、ログインした
 * はずなのに毎回ログイン画面に戻される不具合があったため。
 */
export default function LoginPage() {
  const [state, action, pending] = useActionState<ActionState, FormData>(login, {});
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">ログイン</h1>
        <p className="mt-1 text-sm text-muted">
          招待制です。アカウントは管理者が作ります。メールアドレスとパスワードを受け取っていない場合は管理者に聞いてください。
        </p>
      </div>

      <Panel>
        <form action={action} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              メールアドレス
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="username"
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
              name="password"
              type="password"
              required
              autoComplete="current-password"
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
            disabled={pending || !agreed}
            className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
          >
            {pending ? "確認中…" : "ログイン"}
          </button>

          <ErrorText message={state.error} />
        </form>
      </Panel>

      <p className="text-sm text-muted">
        招待コードを受け取った方は{" "}
        <a href="/signup" className="font-medium text-accent hover:underline">
          こちらから登録
        </a>
      </p>
    </div>
  );
}
