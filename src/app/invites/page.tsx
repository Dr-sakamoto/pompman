import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Panel } from "@/components/ui";
import { InviteCodeIssuer } from "./InviteCodeIssuer";
import { MemberForm } from "@/components/MemberForm";

type InviteCode = {
  code: string;
  created_at: string;
  used_at: string | null;
};

export default async function InvitesPage() {
  // 管理者以外は requireAdmin が / に飛ばす
  await requireAdmin();
  const supabase = await createClient();

  const { data: codeRows } = await supabase
    .from("invite_codes")
    .select("code, created_at, used_at")
    .order("created_at", { ascending: false });

  const codes = (codeRows ?? []) as InviteCode[];
  const unused = codes.filter((c) => !c.used_at);
  const used = codes.filter((c) => c.used_at);

  return (
    <div className="space-y-6">
      <Link href="/" className="block text-sm text-muted hover:text-white">
        ← 一覧
      </Link>

      <div>
        <h1 className="text-2xl font-bold">招待</h1>
        <p className="mt-1 text-sm text-muted">
          4桁のコードを発行して配ってください。受け取った人は
          <span className="text-white">/signup</span>{" "}
          でコードを入れ、自分でメールアドレスとパスワードを決めて登録します。
        </p>
      </div>

      <InviteCodeIssuer />

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-muted">未使用のコード（{unused.length}）</h2>
        {unused.length === 0 ? (
          <p className="text-sm text-muted">ありません。上から発行してください。</p>
        ) : (
          <Panel>
            <ul className="flex flex-wrap gap-2">
              {unused.map((c) => (
                <li
                  key={c.code}
                  className="rounded-md border border-accent/50 px-3 py-1 font-mono text-lg font-bold tracking-widest text-accent"
                >
                  {c.code}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </section>

      {used.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-muted">使用済み（{used.length}）</h2>
          <Panel>
            <ul className="flex flex-wrap gap-2">
              {used.map((c) => (
                <li
                  key={c.code}
                  className="rounded-md border border-line px-3 py-1 font-mono text-sm text-muted line-through"
                >
                  {c.code}
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      )}

      <section className="space-y-2 border-t border-line pt-6">
        <h2 className="text-sm font-bold text-muted">パスワードを忘れた人がいたら</h2>
        <p className="text-sm text-muted">
          メール送信を使わない構成なので、パスワードの再設定は管理者が行います。
          既存のメールアドレスを入れて新しいパスワードを設定し、本人に伝えてください。
        </p>
        <MemberForm />
      </section>
    </div>
  );
}
