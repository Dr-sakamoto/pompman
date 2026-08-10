"use client";

import { useActionState, useState } from "react";
import { signup, type ActionState } from "@/app/actions";
import { ErrorText, Panel } from "@/components/ui";

/**
 * 招待コードでアカウントを作る。
 *
 * 管理者は 4 桁のコードを配るだけで、メールアドレスとパスワードは本人が決める。
 * 引き換えは Edge Function (verify_jwt: false) 側で、コードの原子的な確保と
 * ユーザー作成をまとめて行う。
 *
 * 引き換え・ログインはどちらも Server Action（signup）で行う。クライアント側で
 * signInWithPassword() を呼んでから window.location.href で遷移する方式だと
 * セッション Cookie の書き込みとハードナビゲーションが競合し、ログインした
 * はずなのに毎回ログイン画面に戻される不具合があったため。
 */
export default function SignupPage() {
  const [state, action, pending] = useActionState<ActionState, FormData>(signup, {});
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">招待コードで登録</h1>
        <p className="mt-1 text-sm text-muted">
          管理者から受け取った4桁のコードを入れて、自分のメールアドレスとパスワードを決めてください。
        </p>
      </div>

      <Panel>
        <form action={action} className="space-y-4">
          <div>
            <label htmlFor="code" className="mb-1 block text-sm font-medium">
              招待コード
            </label>
            <input
              id="code"
              name="code"
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
              minLength={8}
              autoComplete="new-password"
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
            disabled={pending || !agreed}
            className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
          >
            {pending ? "登録中…" : "登録する"}
          </button>

          <ErrorText message={state.error} />
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
