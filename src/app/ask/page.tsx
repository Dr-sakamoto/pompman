import Link from "next/link";
import { requireMember } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ConsultForm } from "./ConsultForm";

// 相談を出すと、その場で AI が書いて審査役が採点する。
export const maxDuration = 300;

type ConsultRow = {
  id: number;
  text: string;
  created_at: string;
  ai_sets: { ai_set_items: { picked: boolean }[] }[];
};

export default async function AskPage() {
  const supabase = await createClient();
  const [, { data }] = await Promise.all([
    requireMember(),
    supabase
      .from("ai_odai")
      .select("id, text, created_at, ai_sets(ai_set_items(picked))")
      .eq("kind", "consult")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const consults = (data ?? []) as ConsultRow[];

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-muted hover:text-white">
        ← 今週のお題
      </Link>
      <div className="space-y-1">
        <h1 className="text-xl font-bold">相談する</h1>
        <p className="text-sm text-muted">
          ネタで欲しいボケを、大喜利のお題の形で書いてください。AI が大量に書き、
          みんなの「選んだ／選ばなかった」で鍛えた審査役が10個に絞って返します。
          相談の中身はあなたにしか見えません。
        </p>
      </div>

      <ConsultForm />

      {consults.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-muted">これまでの相談</h2>
          <ul className="space-y-2">
            {consults.map((c) => {
              const items = c.ai_sets.flatMap((s) => s.ai_set_items);
              return (
                <li key={c.id}>
                  <Link
                    href={`/ask/${c.id}`}
                    className="block rounded-lg border border-line bg-panel p-4 transition hover:border-white/25"
                  >
                    <p className="font-medium">{c.text}</p>
                    <p className="mt-1 text-xs text-muted">
                      {items.length}個見て {items.filter((i) => i.picked).length}個 選んだ
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
