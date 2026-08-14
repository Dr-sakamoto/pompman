import { Skeleton } from "@/components/ui";

/** ランキング。見出しと行の形だけ先に出す。 */
export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-16" />
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>

      <div className="divide-y divide-line rounded-lg border border-line bg-panel">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="h-4 w-6" />
            <Skeleton className="h-5 flex-1" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
