import { Panel } from "@/components/ui";
import { ANSWER_DEADLINE_DAYS } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function answerProgressRatios({
  answerCount,
  memberCount,
  createdAt,
}: {
  answerCount: number;
  memberCount: number;
  createdAt: string;
}) {
  const dataRatio = memberCount > 0 ? Math.min(1, answerCount / memberCount) : 0;

  const elapsedMs = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const deadlineMs = ANSWER_DEADLINE_DAYS * DAY_MS;
  const timeRatio = Math.min(1, elapsedMs / deadlineMs);
  const elapsedDays = Math.min(ANSWER_DEADLINE_DAYS, Math.floor(elapsedMs / DAY_MS));

  return { dataRatio, timeRatio, elapsedDays };
}

export function AnswerProgress({
  answerCount,
  memberCount,
  createdAt,
}: {
  answerCount: number;
  memberCount: number;
  createdAt: string;
}) {
  const { dataRatio, timeRatio, elapsedDays } = answerProgressRatios({
    answerCount,
    memberCount,
    createdAt,
  });

  return (
    <Panel className="space-y-3">
      <p className="text-xs font-bold text-muted">採点フェーズまでの進み具合（どちらか先に埋まったら移行）</p>
      <ProgressBar label="回答数" current={`${answerCount}/${memberCount}人`} ratio={dataRatio} />
      <ProgressBar label="経過日数" current={`${elapsedDays}/${ANSWER_DEADLINE_DAYS}日`} ratio={timeRatio} />
    </Panel>
  );
}

export function AnswerProgressMini({
  answerCount,
  memberCount,
  createdAt,
}: {
  answerCount: number;
  memberCount: number;
  createdAt: string;
}) {
  const { dataRatio, timeRatio } = answerProgressRatios({ answerCount, memberCount, createdAt });
  const percent = Math.round(Math.max(dataRatio, timeRatio) * 100);

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full max-w-[8rem] overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs text-muted">
        {answerCount}/{memberCount}人
      </span>
    </div>
  );
}

function ProgressBar({
  label,
  current,
  ratio,
}: {
  label: string;
  current: string;
  ratio: number;
}) {
  const percent = Math.round(ratio * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span>{current}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
