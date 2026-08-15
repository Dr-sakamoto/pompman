import Link from "next/link";
import { requireMember } from "@/lib/session";
import { Panel } from "@/components/ui";
import { HandleEditForm } from "./HandleEditForm";

export default async function SettingsPage() {
  const { user } = await requireMember();

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-muted hover:text-white">
        ← 一覧
      </Link>
      <div>
        <h1 className="text-2xl font-bold">設定</h1>
      </div>

      <Panel className="space-y-3">
        <div>
          <h2 className="font-bold">表示名</h2>
          <p className="mt-1 text-sm text-muted">
            結果画面で回答者として表示される名前です。変更は30日に1回までです。
          </p>
        </div>
        <HandleEditForm handle={user.handle} handleChangedAt={user.handle_changed_at} />
      </Panel>
    </div>
  );
}
