"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Panel } from "@/components/ui";

/**
 * implicit フローではセッション情報が URL の #フラグメントに載る。
 * フラグメントはサーバーに送られないので、ここはサーバー側 Route Handler ではなく
 * クライアントコンポーネントにして、ブラウザ上で supabase-js に処理させる。
 */
export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setError("ログインリンクが不正です");
        return;
      }

      const { data: profile } = await supabase
        .from("users")
        .select("id")
        .eq("id", session.user.id)
        .maybeSingle();

      window.location.href = profile ? "/" : "/onboarding";
    })();
  }, []);

  if (error) {
    return (
      <Panel>
        <h1 className="mb-2 text-lg font-bold">ログインできませんでした</h1>
        <p className="text-sm text-muted">{error}</p>
      </Panel>
    );
  }

  return (
    <Panel>
      <p className="text-sm text-muted">ログイン処理中…</p>
    </Panel>
  );
}
