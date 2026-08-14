import { Skeleton } from "@/components/ui";

/** お題の詳細。見出しと回答欄の形だけ先に出す。 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-16" />

      <div className="space-y-3">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-7 w-full" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-24" />
        {/* 結果発表までの進捗（人数・時間の2本） */}
        <Skeleton className="mt-2 h-1 w-full rounded-full" />
        <Skeleton className="mt-2 h-1 w-full rounded-full" />
      </div>

      <div className="space-y-2 rounded-lg border border-line bg-panel p-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
