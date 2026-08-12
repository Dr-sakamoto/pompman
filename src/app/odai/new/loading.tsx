import { Skeleton } from "@/components/ui";

/** お題の入力欄。フォームの形だけ先に出す。 */
export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-8 w-40" />

      <div className="space-y-4 rounded-lg border border-line bg-panel p-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
