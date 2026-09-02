import type { PostgrestError } from "@supabase/supabase-js";

/** `result_reveals` の行（0023）。RLS により自分の行しか返らない。 */
export type RevealRow = { odai_id: number; user_id: string };

/**
 * 「このお題の結果をもう見たか」の判定（0023）。
 *
 * 発表済みのお題で結果を出すのか、後追いの採点画面を出すのかはこれで決まる。
 * 一覧（`src/app/page.tsx`）と詳細（`src/app/odai/[id]/page.tsx`）の両方から
 * 同じ判定が要るので、式を2つ書かずにここへ集める。
 *
 * ## 読めなかったときは「見た」に倒す
 *
 * `result_reveals` が読めないことは実際に起きる —— **コードだけが先に本番へ出て、
 * DB にまだ 0023 が流れていない**とき（README「2. スキーマを流す」）。このとき
 * supabase-js は `data: null` とエラーを返すので、素直に「行が無い＝まだ見ていない」
 * と読むと、発表済みのお題の結果が**全員から見えなくなる**。2026-08-31 のデプロイで
 * まさにそれが起き、発表済み22件の結果が丸ごと開けなくなった（しかも 0023 が無い
 * 以上、代わりに出る後追い採点も `submit_picks` に弾かれる＝完全な行き止まり）。
 *
 * 伏せる判定の本体は DB 側にある（`answers_view` の `author_id` と
 * `picks_select` / `pick_skips_select` の RLS）。画面はそれを繰り返しているだけなので、
 * **判定ができないときに画面が独自に伏せるのは間違い**で、0023 以前の挙動
 * （closed なら結果が見える）に倒すのが正しい。DB がまだ伏せる状態なら、
 * 回答者名も他人の採点もそもそも返ってこないので、倒しても漏れない。
 */
export function revealGate(
  rows: RevealRow[] | null,
  error: PostgrestError | null,
  userId: string,
): (odaiId: number) => boolean {
  if (error) {
    // 黙って倒さない。ズレていることをログに1行残しておけば、次に同じことが
    // 起きたとき「結果が見れない」から原因まで一息で辿れる。
    console.error(
      "[reveal] result_reveals を読めませんでした。0023 が本番 DB に未適用の可能性があります:",
      error.message,
    );
    return () => true;
  }

  const mine = new Set((rows ?? []).filter((r) => r.user_id === userId).map((r) => r.odai_id));
  return (odaiId) => mine.has(odaiId);
}
