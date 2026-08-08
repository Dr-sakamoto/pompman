import Link from "next/link";
import { Panel } from "@/components/ui";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const { message } = await searchParams;
  return (
    <Panel>
      <h1 className="mb-2 text-lg font-bold">ログインできませんでした</h1>
      <p className="mb-4 text-sm text-muted">{message ?? "リンクの有効期限が切れている可能性があります。"}</p>
      <Link href="/login" className="text-sm font-medium text-accent hover:underline">
        もう一度ログインする
      </Link>
    </Panel>
  );
}
