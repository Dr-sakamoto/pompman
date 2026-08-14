import { createClient } from "@/lib/supabase/server";
import { pushEnabled } from "./env";
import { sendPushToTargets, type PushTarget } from "./send";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 新しいお題が出たことを、出題者以外の購読者に知らせる。 */
export async function notifyNewOdai(odaiId: number, authorId: string, text: string): Promise<void> {
  if (!pushEnabled()) return;

  const supabase = await createClient();
  const { data } = await supabase.rpc("push_targets_for_new_odai", { p_author_id: authorId });
  const targets = (data ?? []) as PushTarget[];
  if (targets.length === 0) return;

  await sendPushToTargets(supabase, targets, {
    title: "新しいお題",
    body: truncate(text, 60),
    url: `${SITE_URL}/odai/${odaiId}`,
  });
}

/**
 * まだ通知していない結果発表を拾って知らせる。
 *
 * closed への遷移がどの経路で起きたかは呼び出し側では分からない
 * （0016 マイグレーション参照）ので、経路を問わずここを叩けば
 * 新しく閉じたぶんだけ拾える。何も無ければ何もしない。
 */
export async function notifyNewlyClosedOdai(): Promise<void> {
  if (!pushEnabled()) return;

  const supabase = await createClient();
  const { data: closedRows } = await supabase.rpc("claim_newly_closed_odai");
  const closedIds = ((closedRows ?? []) as { id: number }[]).map((r) => r.id);
  if (closedIds.length === 0) return;

  const { data: odaiRows } = await supabase
    .from("odai")
    .select("id, text")
    .in("id", closedIds);

  for (const odai of (odaiRows ?? []) as { id: number; text: string }[]) {
    const { data } = await supabase.rpc("push_targets_for_closed_odai", { p_odai_id: odai.id });
    const targets = (data ?? []) as PushTarget[];
    if (targets.length === 0) continue;

    await sendPushToTargets(supabase, targets, {
      title: "結果発表",
      body: truncate(odai.text, 60),
      url: `${SITE_URL}/odai/${odai.id}`,
    });
  }
}
