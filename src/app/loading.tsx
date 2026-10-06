import { Skeleton } from "@/components/ui";

/**
 * 全画面共通の読み込み中表示。
 *
 * これがあると、タップした瞬間にこの骨組みへ切り替わり、サーバーの応答は
 * そのあとで差し替わる。個別の画面は、それぞれの loading.tsx が優先される。
 */
export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-3/4" />
      </div>
      <div className="space-y-3 rounded-lg border border-line bg-panel p-4">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
      <ul className="space-y-2">
        {[0, 1, 2].map((i) => (
          <li key={i} className="rounded-lg border border-line bg-panel p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="mt-2 h-3 w-32" />
          </li>
        ))}
      </ul>
    </div>
  );
}
