"use client";

import { useState } from "react";

export function ShareButton() {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const url = window.location.origin;
    const shareData = { title: "大喜利", text: "身内の大喜利に招待するよ", url };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // ユーザーがキャンセルした場合など。何もしない。
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードが使えない環境では何もしない
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className="text-sm text-muted hover:text-white"
    >
      {copied ? "コピーしました" : "招待リンクを共有"}
    </button>
  );
}
