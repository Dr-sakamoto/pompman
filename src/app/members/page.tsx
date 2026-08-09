import Link from "next/link";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Panel } from "@/components/ui";
import type { AppUser } from "@/lib/types";

export default async function MembersPage() {
  await requireMember();
  const supabase = await createClient();

  const { data: userRows } = await supabase
    .from("users")
    .select("id, handle, created_at")
    .order("created_at", { ascending: true });

  const members = (userRows ?? []) as Pick<AppUser, "id" | "handle" | "created_at">[];

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted hover:text-white">
        ← 一覧
      </Link>
      <div>
        <h1 className="text-2xl font-bold">メンバー</h1>
        <p className="mt-1 text-sm text-muted">
          現在{members.length}人が参加しています。大喜利の回答・投票には影響しません。
        </p>
      </div>

      <Panel className="divide-y divide-line p-0">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between px-4 py-3">
            <span className="font-medium">{m.handle}</span>
            <span className="text-xs text-muted">
              {new Date(m.created_at).toLocaleDateString("ja-JP")} 参加
            </span>
          </div>
        ))}
      </Panel>
    </div>
  );
}
