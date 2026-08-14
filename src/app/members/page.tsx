import Link from "next/link";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Panel } from "@/components/ui";
import { RealNameEditor } from "@/components/RealNameEditor";
import type { AppUser } from "@/lib/types";

export default async function MembersPage() {
  const { user } = await requireMember();
  const supabase = await createClient();
  const isAdmin = user.role === "admin";

  const { data: userRows } = await supabase
    .from("users")
    .select("id, handle, created_at")
    .order("created_at", { ascending: true });

  const members = (userRows ?? []) as Pick<AppUser, "id" | "handle" | "created_at">[];

  // 本名メモは管理者にしか見えない（RLS でも強制済み。ここは無駄な問い合わせを省くだけ）。
  const realNameByUserId = new Map<string, string>();
  if (isAdmin) {
    const { data: realNameRows } = await supabase
      .from("member_real_names")
      .select("user_id, real_name");
    for (const row of realNameRows ?? []) {
      realNameByUserId.set(row.user_id, row.real_name);
    }
  }

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted hover:text-white">
        ← 一覧
      </Link>
      <div>
        <h1 className="text-2xl font-bold">メンバー</h1>
        <p className="mt-1 text-sm text-muted">
          現在{members.length}人が参加しています。大喜利の回答・採点には影響しません。
        </p>
      </div>

      <Panel className="divide-y divide-line p-0">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between px-4 py-3">
            <span className="flex items-center gap-2">
              <span className="font-medium">{m.handle}</span>
              {isAdmin && (
                <RealNameEditor userId={m.id} realName={realNameByUserId.get(m.id) ?? null} />
              )}
            </span>
            <span className="text-xs text-muted">
              {new Date(m.created_at).toLocaleDateString("ja-JP")} 参加
            </span>
          </div>
        ))}
      </Panel>

      {user.role === "admin" && (
        <p className="text-sm text-muted">
          パスワードを忘れた人がいたら{" "}
          <Link href="/invites" className="font-medium text-accent hover:underline">
            招待ページ
          </Link>{" "}
          から再設定できます。
        </p>
      )}
    </div>
  );
}
