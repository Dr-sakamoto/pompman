import { Panel } from "@/components/ui";
import {
  AUTO_CLOSE_AGE_DAYS,
  AUTO_CLOSE_MIN_PARTICIPANTS,
  AUTO_UNLOCK_IDLE_HOURS,
  type CloseProgressRow,
} from "@/lib/types";

/**
 * 結果発表までの進捗バー。お題ごとに2本。
 *
 * 自動締め切りの条件は進み方の違う2本立てで（0013 / 0014）、片方は人、
 * もう片方は時間で進む。1本の棒にまとめると「あと何をすれば発表されるのか」も
 * 「あと何時間で勝手に発表されるのか」も両方分からなくなるので、そのまま2本出す。
 *
 *   人数 —— 参加者が全員やり切ったか。自分（と他の参加者）が動かせる棒
 *   時間 —— お題の寿命。放っておいても勝手に進む棒
 *
 * 先に満タンになったほうで発表される。数値は DB 側の odai_close_progress() が
 * 判定と同じ数え方で返したものを、そのまま比率にしているだけ。
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Tone = "accent" | "muted";

type Derived = {
  people: { value: string; ratio: number; note: string; tone: Tone };
  time: { value: string; ratio: number; note: string; tone: Tone };
  /** 多様性（参加者）とデータ量（回答・選好ペア）の現在値。回答0件のときは無し。 */
  harvest: string | null;
};

/** 「2日と3時間」「45分」。1分未満は「まもなく」。 */
function formatSpan(ms: number): string {
  if (ms <= 0) return "まもなく";
  const minutes = Math.floor(ms / MINUTE);
  if (minutes < 60) return `${Math.max(1, minutes)}分`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days}日` : `${days}日と${rest}時間`;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function derive(row: CloseProgressRow): Derived {
  // PostgREST は bigint も数値で返すが、既存コード（odai_answer_counts）に
  // 合わせて念のため通しておく。
  const answers = Number(row.answer_count);
  const participants = Number(row.participants);
  const unlocked = Number(row.unlocked);
  const scored = Number(row.scored);
  const finished = Number(row.finished);
  const pairs = Number(row.preference_pairs);

  const createdAt = Date.parse(row.created_at);
  const asOf = Date.parse(row.as_of);
  const readyAt = Date.parse(row.ready_at);
  const closeAt = Date.parse(row.close_at);

  const hasAnswers = answers > 0;
  const graceLeft = readyAt - asOf; // 「全員やり切った」が効き始めるまで
  const timeLeft = closeAt - asOf; // 寿命が尽きるまで

  /*
   * 人数バーの分母は「参加者」ではなく「参加者と最低人数の大きいほう」。
   * 参加者が1人のお題は、その1人がやり切っても発表されない（最低2人が要る）ので、
   * 1/1 で満タンに見えてはいけない。1/2 と出せば「あと1人来れば動く」が分かる。
   */
  const needed = Math.max(participants, AUTO_CLOSE_MIN_PARTICIPANTS);
  const peopleRatio = clamp01(finished / needed);

  const peopleNote = !hasAnswers
    ? "まだ誰も回答していません"
    : participants < AUTO_CLOSE_MIN_PARTICIPANTS
      ? `参加者があと${AUTO_CLOSE_MIN_PARTICIPANTS - participants}人でこの条件が動きます`
      : finished < participants
        ? `解禁 ${unlocked}/${participants}人・採点 ${scored}/${participants}人`
        : graceLeft > 0
          ? `全員やり切りました。お題を出してから${AUTO_UNLOCK_IDLE_HOURS}時間（あと${formatSpan(graceLeft)}）で発表されます`
          : "まもなく発表されます";

  /*
   * 残りが自動解禁のしきい値を切ったら急かす。ここを過ぎると、いま書いた回答は
   * 自動解禁が間に合わない＝自分で解禁しないと採点できないまま発表される。
   */
  const urgent = hasAnswers && timeLeft <= AUTO_UNLOCK_IDLE_HOURS * HOUR;

  const timeNote = !hasAnswers
    ? `回答が1件も無いお題は、${AUTO_CLOSE_AGE_DAYS}日経っても発表されません`
    : timeLeft <= 0
      ? "寿命が来ています。次に誰かが開いたときに発表されます"
      : `お題を出してから${AUTO_CLOSE_AGE_DAYS}日で自動発表`;

  return {
    people: {
      value: `${finished}/${needed}人`,
      ratio: peopleRatio,
      note: peopleNote,
      tone: "accent",
    },
    time: {
      // 回答が0件のお題は寿命が来ても発表されないので、残り時間を出すと嘘になる
      // （一覧の細いバーには説明が付かないぶん、ここで言い切っておく）。
      value: !hasAnswers ? "回答待ち" : timeLeft > 0 ? `あと${formatSpan(timeLeft)}` : "まもなく",
      ratio: clamp01((asOf - createdAt) / (closeAt - createdAt)),
      note: timeNote,
      tone: urgent ? "accent" : "muted",
    },
    harvest: hasAnswers
      ? pairs > 0
        ? `いま発表すると、参加者${participants}人・回答${answers}件から選好ペア${pairs}組が残ります`
        : `いま発表すると、参加者${participants}人・回答${answers}件。選好ペアはまだ0組（採点が入ると増えます）`
      : null,
  };
}

const FILL: Record<Tone, string> = {
  accent: "bg-accent",
  muted: "bg-white/35",
};

function Bar({
  label,
  value,
  ratio,
  note,
  tone,
}: {
  label: string;
  value: string;
  ratio: number;
  note: string;
  tone: Tone;
}) {
  const percent = Math.round(ratio * 100);

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-bold">{label}</span>
        <span className={tone === "accent" ? "font-bold text-accent" : "text-muted"}>{value}</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label}の進捗`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-white/10"
      >
        <div
          className={`h-full rounded-full transition-[width] ${FILL[tone]}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-muted">{note}</p>
    </div>
  );
}

/** お題の詳細（phase=open）用。2本のバーと、いま取れる教師データの量。 */
export function CloseProgress({ progress }: { progress: CloseProgressRow }) {
  const d = derive(progress);

  return (
    <Panel className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-bold">結果発表まで</p>
        <p className="text-xs text-muted">先に埋まったほうで自動発表</p>
      </div>

      <Bar label="人数" {...d.people} />
      <Bar label="時間" {...d.time} />

      {d.harvest && <p className="border-t border-line pt-2 text-xs text-muted">{d.harvest}</p>}
    </Panel>
  );
}

function MiniBar({ label, value, ratio, tone }: { label: string; value: string; ratio: number; tone: Tone }) {
  const percent = Math.round(ratio * 100);

  return (
    <div className="flex items-center gap-2 text-[10px] text-muted">
      <span className="w-6 shrink-0">{label}</span>
      <span
        role="progressbar"
        aria-label={`${label}の進捗`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1 flex-1 overflow-hidden rounded-full bg-white/10"
      >
        <span
          className={`block h-full rounded-full ${FILL[tone]}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="w-24 shrink-0 whitespace-nowrap text-right tabular-nums">{value}</span>
    </div>
  );
}

/** 一覧のカード用。同じ2本を細く出す（説明は詳細画面に置く）。 */
export function CloseProgressMini({ progress }: { progress: CloseProgressRow }) {
  const d = derive(progress);

  return (
    <div className="mt-3 space-y-1">
      <MiniBar label="人数" value={d.people.value} ratio={d.people.ratio} tone={d.people.tone} />
      <MiniBar label="時間" value={d.time.value} ratio={d.time.ratio} tone={d.time.tone} />
    </div>
  );
}
