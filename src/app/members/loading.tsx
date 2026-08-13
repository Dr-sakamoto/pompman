import { Skeleton } from "@/components/ui";

/** メンバー一覧。見出しと行の形だけ先に出す。 */
export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-16" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="divide-y divide-line rounded-lg border border-line bg-panel">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between px-4 py-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
