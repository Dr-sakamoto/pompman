import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pushEnabled, vapidPrivateKey, vapidPublicKey, vapidSubject } from "./env";

export type PushTarget = {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url: string;
};

/**
 * 宛先ぶんまとめて送る。1件の失敗が他の宛先を巻き込まないよう
 * Promise.allSettled でまとめて待つ。
 *
 * 失効した購読（410/404）は次回以降も送り続けて無駄打ちしないよう、
 * ここで消しておく。それ以外のエラーは黙って捨てる
 * （通知はなくてもアプリは成立するので、送信失敗で本編を止めない）。
 */
export async function sendPushToTargets(
  supabase: SupabaseClient,
  targets: PushTarget[],
  payload: PushPayload,
): Promise<void> {
  if (!pushEnabled() || targets.length === 0) return;

  webpush.setVapidDetails(vapidSubject(), vapidPublicKey()!, vapidPrivateKey()!);

  const body = JSON.stringify(payload);

  await Promise.allSettled(
    targets.map(async (target) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: target.endpoint,
            keys: { p256dh: target.p256dh, auth: target.auth },
          },
          body,
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await supabase.rpc("delete_stale_push_subscription", { p_endpoint: target.endpoint });
        }
      }
    }),
  );
}
