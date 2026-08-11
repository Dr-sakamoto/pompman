"use client";

import { Panel } from "@/components/ui";

/**
 * 通信できずに描画できなかったときの画面。
 *
 * ここが無いと素の "Internal Server Error" が出るし、かといって /login に
 * 飛ばすとログアウトしたように見えてしまう。セッションは生きている前提で、
 * 再読み込みを促すだけにする。
 */
export default function Error({ reset }: { error: globalThis.Error; reset: () => void }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">読み込めませんでした</h1>
      <Panel className="space-y-3">
        <p className="text-sm text-muted">
          通信が不安定なため、画面を表示できませんでした。ログアウトはされていないので、
          電波の良いところでもう一度お試しください。
        </p>
        <button
          type="button"
          onClick={reset}
          className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink"
        >
          再読み込み
        </button>
      </Panel>
    </div>
  );
}
