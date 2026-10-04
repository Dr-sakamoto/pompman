import { createClient } from "@/lib/supabase/server";
import { PickBoard } from "./PickBoard";

type SetRow = {
  id: number;
  submitted_at: string | null;
  ai_set_items: { answer_id: number; position: number; picked: boolean; ai_answers: { text: string } }[];
};

/**
 * 1つのお題で「10個見る → 選ぶ → 次の10個」を回す部分と、自分が選んだものの一覧。
 * 週1お題（/）と相談（/ask/[id]）で共通。
 */
export async function OdaiPlay({ odaiId, picksLabel }: { odaiId: number; picksLabel: string }) {
  const supabase = await createClient();
  const { data: setRows } = await supabase
    .from("ai_sets")
    .select("id, submitted_at, ai_set_items(answer_id, position, picked, ai_answers(text))")
    .eq("ai_odai_id", odaiId)
    .order("created_at");
  const sets = (setRows ?? []) as unknown as SetRow[];
  const open = sets.find((s) => !s.submitted_at);
  const done = sets.filter((s) => s.submitted_at);
  const myPicks = done.flatMap((s) => s.ai_set_items.filter((i) => i.picked));
  const seenCount = done.reduce((n, s) => n + s.ai_set_items.length, 0);

  return (
    <>
      <PickBoard
        odaiId={odaiId}
        setId={open?.id ?? null}
        items={
          open
            ? [...open.ai_set_items]
                .sort((a, b) => a.position - b.position)
                .map((i) => ({ answerId: i.answer_id, text: i.ai_answers.text }))
            : []
        }
      />

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-muted">
            {picksLabel}（{seenCount}個中 {myPicks.length}個）
          </h2>
          {myPicks.length > 0 && (
            <ul className="space-y-2">
              {myPicks.map((i) => (
                <li key={i.answer_id} className="rounded-lg border border-line bg-panel px-4 py-3">
                  {i.ai_answers.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
