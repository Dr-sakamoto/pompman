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
 * もう片方は時間で進む。1本の棒にまとめると「あと誰が何をすれば発表されるのか」も
 * 「あと何時間で勝手に発表されるのか」も両方分からなくなるので、そのまま2本出す。
 *
 *   人数 —— 参加者が全員やり切ったか。自分（と他の参加者）が動かせる棒
 *   時間 —— お題の寿命。放っておいても勝手に進む棒
 *
 * 先に満タンになったほうで発表される。
 *
 * 文字は極力足さない。バーは一目で見るものなので、毎回同じ説明を横に置くと
 * 読み飛ばす対象になり、バー自体まで読み飛ばされる。1本につき「ラベル・棒・値」の
 * 1行だけにして、文章はお題ごとに変わる1行（下の line）に集約する。
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Tone = "accent" | "muted";

type Track = { value: string; ratio: number; tone: Tone };

type Derived = {
  people: Track;
  time: Track;
  /** 状態に応じて変わる1行。多様性（参加者）とデータ量（選好ペア）もここに出す。 */
  line: string;
};

/** 「2日4時間」「45分」。1分未満は「まもなく」。 */
function formatSpan(ms: number): string {
  if (ms <= 0) return "まもなく";
  const minutes = Math.floor(ms / MINUTE);
  if (minutes < 60) return `${Math.max(1, minutes)}分`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days}日` : `${days}日${rest}時間`;
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

  /*
   * 残りが自動解禁のしきい値を切ったら急かす。ここを過ぎると、いま書いた回答は
   * 自動解禁が間に合わない＝自分で解禁しないと採点できないまま発表される。
   */
  const urgent = hasAnswers && timeLeft <= AUTO_UNLOCK_IDLE_HOURS * HOUR;

  return {
    people: {
      value: `${finished}/${needed}人`,
      ratio: clamp01(finished / needed),
      tone: "accent",
    },
    time: {
      // 回答が0件のお題は寿命が来ても発表されないので、残り時間を出すと嘘になる。
      value: !hasAnswers ? "回答待ち" : timeLeft > 0 ? `あと${formatSpan(timeLeft)}` : "まもなく",
      ratio: clamp01((asOf - createdAt) / (closeAt - createdAt)),
      tone: urgent ? "accent" : "muted",
    },
    line: !hasAnswers
      ? `回答が0件のお題は、${AUTO_CLOSE_AGE_DAYS}日経っても発表されません`
      : participants < AUTO_CLOSE_MIN_PARTICIPANTS
        ? `あと${AUTO_CLOSE_MIN_PARTICIPANTS - participants}人が回答すれば、人数でも発表できます`
        : finished >= participants && graceLeft > 0
          ? `全員やり切りました。あと${formatSpan(graceLeft)}で発表されます`
          : pairs > 0
            ? // 参加者の数は人数バーの分母がすでに出しているので、ここでは繰り返さない
              `いま発表すると選好ペア${pairs}組`
            : "採点が入ると選好ペアが貯まります",
  };
}

const FILL: Record<Tone, string> = {
  accent: "bg-accent",
  muted: "bg-white/35",
};

/** ラベル・棒・値で1行。詳細画面用。 */
function Bar({ label, track }: { label: string; track: Track }) {
  const percent = Math.round(track.ratio * 100);

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-8 shrink-0 font-bold">{label}</span>
      <span
        role="progressbar"
        aria-label={`${label}の進捗`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 flex-1 overflow-hidden rounded-full bg-white/10"
      >
        <span
          className={`block h-full rounded-full transition-[width] ${FILL[track.tone]}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span
        className={`w-24 shrink-0 whitespace-nowrap text-right tabular-nums ${
          track.tone === "accent" ? "font-bold text-accent" : "text-muted"
        }`}
      >
        {track.value}
      </span>
    </div>
  );
}

/** お題の詳細（phase=open）用。 */
export function CloseProgress({ progress }: { progress: CloseProgressRow }) {
  const d = derive(progress);

  return (
    <Panel className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-bold">結果発表まで</p>
        <p className="text-xs text-muted">先に埋まったほうで自動発表</p>
      </div>

      <Bar label="人数" track={d.people} />
      <Bar label="時間" track={d.time} />

      <p className="text-xs text-muted">{d.line}</p>
    </Panel>
  );
}

/**
 * 一覧のカード用。ラベルは落として棒と値だけにする
 * （「2/3人」「あと2日」で、どちらの棒かは値から分かる）。
 */
function MiniBar({ track, label }: { track: Track; label: string }) {
  const percent = Math.round(track.ratio * 100);

  return (
    <div className="flex items-center gap-2 text-[10px] text-muted">
      <span
        role="progressbar"
        aria-label={`${label}の進捗`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1 flex-1 overflow-hidden rounded-full bg-white/10"
      >
        <span
          className={`block h-full rounded-full ${FILL[track.tone]}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="w-16 shrink-0 whitespace-nowrap text-right tabular-nums">{track.value}</span>
    </div>
  );
}

export function CloseProgressMini({ progress }: { progress: CloseProgressRow }) {
  const d = derive(progress);

  return (
    <div className="mt-3 space-y-1">
      <MiniBar label="人数" track={d.people} />
      <MiniBar label="時間" track={d.time} />
    </div>
  );
}
