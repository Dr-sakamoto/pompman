import { Panel } from "@/components/ui";

// docs/odai-mvp-spec.md: 「AI（回答生成・報酬モデル）の着手は、picksが数百件貯まってから」
const AI_INTRODUCTION_TARGET_PICKS = 300;

export function AiProgress({ picksCount }: { picksCount: number }) {
  const remaining = Math.max(0, AI_INTRODUCTION_TARGET_PICKS - picksCount);
  const ratio = Math.min(1, picksCount / AI_INTRODUCTION_TARGET_PICKS);
  const percent = Math.round(ratio * 100);
  const reached = remaining === 0;

  return (
    <Panel className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <p className="font-bold">🤖 AI参加まで</p>
        <p className="text-muted">
          {reached ? (
            "教師データが目標に到達！"
          ) : (
            <>
              あと <span className="font-bold text-accent">{remaining}</span> pick
            </>
          )}
        </p>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-muted">
        {picksCount} / {AI_INTRODUCTION_TARGET_PICKS} picks（選出データ）が貯まりました
      </p>
    </Panel>
  );
}
