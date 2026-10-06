import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { OdaiPlay } from "@/app/ai/OdaiPlay";

// 回答が足りないと、その場で AI が書いて審査役が採点する。
export const maxDuration = 300;

export default async function ConsultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const odaiId = Number(id);
  if (!Number.isInteger(odaiId)) notFound();

  const supabase = await createClient();
  const [, { data: odai }] = await Promise.all([
    requireMember(),
    supabase.from("ai_odai").select("id, text").eq("id", odaiId).eq("kind", "consult").maybeSingle(),
  ]);
  if (!odai) notFound();

  return (
    <div className="space-y-6">
      <Link href="/ask" className="text-sm text-muted hover:text-white">
        ← 相談一覧
      </Link>
      <div className="space-y-1">
        <p className="text-xs text-muted">相談</p>
        <h1 className="text-xl font-bold leading-snug">{odai.text}</h1>
      </div>
      <OdaiPlay odaiId={odaiId} picksLabel="この相談で選んだもの" />
    </div>
  );
}
