import type { Phase } from "@/lib/types";
import { PHASE_LABEL } from "@/lib/types";

const PHASE_STYLE: Record<Phase, string> = {
  open: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  closed: "bg-white/5 text-muted border-line",
};

export function PhaseBadge({ phase }: { phase: Phase }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${PHASE_STYLE[phase]}`}
    >
      {PHASE_LABEL[phase]}
    </span>
  );
}

export function TodoBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-ink">
      {children}
    </span>
  );
}

export function ErrorText({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {message}
    </p>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-line bg-panel p-4 ${className}`}>{children}</div>
  );
}

/**
 * 読み込み中の骨組み（loading.tsx から使う）。
 *
 * このアプリの画面はどれもログイン確認とデータ取得が終わるまで描画できない。
 * loading.tsx を置かないと、その間ブラウザは前の画面を出したまま黙って待つので、
 * タップしても何も起きていないように見える。中身の形だけ先に出しておけば、
 * 遷移そのものは即座に起きる。
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/10 ${className}`} aria-hidden />;
}
