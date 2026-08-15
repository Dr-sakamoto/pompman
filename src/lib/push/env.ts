/**
 * VAPID キー。未設定でも動かせる（通知機能そのものを丸ごと無効化する）ように、
 * 他の env.ts と違って required() では落とさない。
 *
 * 通知は「なくてもアプリは成立する」機能なので、鍵を入れ忘れただけで
 * ログイン等の本体機能まで巻き込んで壊すのは避ける。
 */

export function vapidPublicKey(): string | undefined {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
}

export function vapidPrivateKey(): string | undefined {
  return process.env.VAPID_PRIVATE_KEY;
}

export function vapidSubject(): string {
  return process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";
}

export function pushEnabled(): boolean {
  return Boolean(vapidPublicKey() && vapidPrivateKey());
}
