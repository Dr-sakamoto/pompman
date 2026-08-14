import {
  AUTO_CLOSE_MIN_PARTICIPANTS,
  AUTO_UNLOCK_IDLE_HOURS,
  type CloseProgressRow,
} from "@/lib/types";

/**
 * 結果発表までの進捗バー。お題ごとに2本。
 *
 * 自動締め切りの条件は進み方の違う2本立てで（0013 / 0015）、片方は人、
 * もう片方は時間で進む。1本の棒にまとめると「あと誰が何をすれば発表されるのか」も
 * 「あと何時間で勝手に発表されるのか」も両方分からなくなるので、そのまま2本出す。
 * 先に満タンになったほうで発表される。
 *
 *   人数 —— やり切った参加者 / max(参加者, 2)。自分と他の参加者が動かせる棒
 *   時間 —— 作成からの経過 / 3日。放っておいても勝手に進む棒
 *
 * 出すのは棒と値だけ。見出しも説明文も置かない —— バーは一目で見るもので、
 * 横に文章があると読む対象に化け、そのぶん読み飛ばされる。ラベル（人数 / 時間）
 * すら値から分かる（「1/2人」「あと2日18時間」）ので、画面には出さず
 * スクリーンリーダー向けにだけ残してある。
 *
 * 一覧でも詳細でも同じものを出す。お題1件について知りたいのは
 * 「あとどれだけで発表されるか」だけで、それは場所によって変わらない。
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Tone = "accent" | "muted";

type Track = { value: string; ratio: number; tone: Tone };

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

function derive(row: CloseProgressRow): { people: Track; time: Track } {
  // PostgREST は bigint も数値で返すが、既存コード（odai_answer_counts）に
  // 合わせて念のため通しておく。
  const answers = Number(row.answer_count);
  const participants = Number(row.participants);
  const finished = Number(row.finished);

  const createdAt = Date.parse(row.created_at);
  const asOf = Date.parse(row.as_of);
  const closeAt = Date.parse(row.close_at);

  const hasAnswers = answers > 0;
  const timeLeft = closeAt - asOf;

  /*
   * 人数バーの分母は「参加者」ではなく「参加者と最低人数の大きいほう」。
   * 参加者が1人のお題は、その1人がやり切っても発表されない（最低2人が要る）ので、
   * 1/1 で満タンに見えてはいけない。1/2 と出せば「あと1人来れば動く」が分かる。
   */
  const needed = Math.max(participants, AUTO_CLOSE_MIN_PARTICIPANTS);

  /*
   * 残りが自動解禁のしきい値を切ったら色で急かす。ここを過ぎると、いま書いた回答は
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
  };
}

const FILL: Record<Tone, string> = {
  accent: "bg-accent",
  muted: "bg-white/35",
};

function Bar({ label, track }: { label: string; track: Track }) {
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
          className={`block h-full rounded-full transition-[width] ${FILL[track.tone]}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="w-20 shrink-0 whitespace-nowrap text-right tabular-nums">{track.value}</span>
    </div>
  );
}

export function CloseProgress({
  progress,
  className = "",
}: {
  progress: CloseProgressRow;
  className?: string;
}) {
  const d = derive(progress);

  return (
    <div className={`space-y-1 ${className}`}>
      <Bar label="人数" track={d.people} />
      <Bar label="時間" track={d.time} />
    </div>
  );
}
