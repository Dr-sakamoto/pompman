import { Skeleton } from "@/components/ui";

/**
 * 全画面共通の読み込み中表示。
 *
 * これがあると、タップした瞬間にこの骨組みへ切り替わり、サーバーの応答は
 * そのあとで差し替わる。個別の画面（お題の詳細など）は、それぞれの
 * loading.tsx が優先される。
 */
export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="space-y-2">
        <Skeleton className="h-4 w-16" />
        <ul className="space-y-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="rounded-lg border border-line bg-panel p-4">
              <div className="mb-3 flex items-center gap-2">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="ml-auto h-4 w-14" />
              </div>
              <Skeleton className="h-5 w-3/4" />
              {/* 結果発表までの進捗バー（人数・時間）の2本ぶん */}
              <Skeleton className="mt-3 h-1 w-full rounded-full" />
              <Skeleton className="mt-2 h-1 w-full rounded-full" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
