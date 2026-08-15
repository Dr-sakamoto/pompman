"use client";

import { useEffect, useState } from "react";
import { deletePushSubscription, savePushSubscription } from "@/app/actions";

/*
 * 通知の入り口はここ1箇所、ボタン1つだけ。
 *
 * 「通知を開いたらポップアップに塞がれる」を避けるため、ここでは何もモーダルに
 * しない。許可ダイアログはブラウザ自身が出すもの（タップの直接の結果としてのみ
 * 発火し、こちらから勝手には出せない）で、それ以外はページに常駐する地味な
 * インライン表示だけにする。ロード時に自動で何かを開くことも一切しない。
 */

function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type Status = "unsupported" | "checking" | "off" | "denied" | "on" | "busy";

export function PushSubscribeToggle() {
  const [status, setStatus] = useState<Status>("checking");
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!vapidPublicKey || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setStatus(sub ? "on" : "off"))
      .catch(() => setStatus("off"));
  }, [vapidPublicKey]);

  if (status === "unsupported" || status === "checking") return null;

  async function handleEnable() {
    setStatus("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
      });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await savePushSubscription({ endpoint: json.endpoint, keys: json.keys });
      setStatus("on");
    } catch {
      setStatus("off");
    }
  }

  async function handleDisable() {
    setStatus("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await deletePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch {
      setStatus("on");
    }
  }

  if (status === "denied") {
    return (
      <p className="text-xs text-muted">
        通知はブラウザ側で拒否されています。受け取るにはブラウザの設定から許可してください。
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={status === "on" ? handleDisable : handleEnable}
      disabled={status === "busy"}
      className="text-xs text-muted hover:text-white disabled:opacity-50"
    >
      {status === "on" ? "🔔 通知を受け取っています（タップで解除）" : "🔕 新着を通知で受け取る"}
    </button>
  );
}
