"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitPicks, type ActionState } from "@/app/actions";
import { ErrorText, Panel } from "@/components/ui";
import type { AnswerView, Pick } from "@/lib/types";

const RANK_LABEL = ["1位", "2位", "3位"];

/**
 * 採点そのもの（面白かった順に選んで送る）。
 *
 * 回答・採点中（OpenPhase）と、結果発表後の後追い採点（RetroPhase）で同じものを使う。
 * どちらも「誰が書いたかを知らないまま、他人の採点も見ないまま選ぶ」形は同じで、
 * 違うのは**やり直せるかどうか**だけ:
 *
 *   発表前 … 結果発表まで何度でも選び直せる
 *   発表後 … 送った瞬間に結果が開くので一度きり（retro）
 *
 * 実際の許可判定はすべて DB 側（0023）。ここが出し分けているのは文言だけ。
 */
export function PickForm({
  odaiId,
  answers,
  myPicks,
  mySkipped,
  maxPicks,
  pickable,
  retro = false,
}: {
  odaiId: number;
  answers: AnswerView[];
  myPicks: Pick[];
  mySkipped: boolean;
  maxPicks: number;
  pickable: number;
  retro?: boolean;
}) {
  const [selected, setSelected] = useState<number[]>(() =>
    myPicks
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .map((p) => p.answer_id),
  );
  const [state, action, pending] = useActionState<ActionState, FormData>(submitPicks, {});
  const [skipState, skipAction, skipPending] = useActionState<ActionState, FormData>(
    submitPicks,
    {},
  );

  function toggle(answerId: number) {
    setSelected((prev) => {
      const at = prev.indexOf(answerId);
      if (at !== -1) return prev.filter((id) => id !== answerId);
      if (prev.length >= maxPicks) return prev;
      return [...prev, answerId];
    });
  }

  // 選び直しの途中で対象の回答が消えることはない（回答は削除できない）ので、
  // 送信対象は選択順そのままでよい。
  const alreadyPicked = myPicks.length > 0;

  // 文言はここで組む。同じ形の画面が3通り（発表前 / 後追い / 選べる回答が0件）あり、
  // JSX の中で入れ子の三項にすると読めなくなる。
  const intro =
    pickable === 0
      ? retro
        ? "このお題にはあなた以外の回答がないので、選べるものがありません。下から採点を終えると結果が出ます。"
        : "まだ他の人の回答がありません。集まったら面白い順に選んでください。今は下から「採点を終える」だけ押せます。"
      : retro
        ? `面白かった順に最大${maxPicks}つ選んでください。送ると採点が記録され、そのあとに結果（誰が書いたか・誰が誰を選んだか）が出ます。`
        : `面白かった順に最大${maxPicks}つ選んでください。途中まででも送れます。回答が増えたら何度でも選び直せます。`;

  const skipNote = retro
    ? pickable > 0
      ? "面白い回答が無かったときはこちら。「見た上で誰も選ばなかった」という記録が残り、そのあと結果が出ます。"
      : "選ぶ回答が無いまま採点を終えます。そのあと結果が出ます。"
    : pickable > 0
      ? "面白い回答が無かったときはこちら。採点は0件のまま終えたことになります。"
      : "他の人の回答が増えるまで待たずに採点を終える宣言です。回答が増えたらいつでも選び直せます。";

  const skipInitial = useRef(true);
  useEffect(() => {
    if (skipInitial.current) {
      skipInitial.current = false;
      return;
    }
    if (!skipPending && !skipState.error) setSelected([]);
  }, [skipState, skipPending]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{intro}</p>

      {mySkipped && selected.length === 0 && (
        <p className="text-sm text-muted">
          「何も選ばない」で採点を終えています。気が変わったら下から選んで送信し直せます。
        </p>
      )}

      <ul className="space-y-2">
        {answers.map((a) => {
          const at = selected.indexOf(a.id);
          const rank = at === -1 ? null : at + 1;
          const disabled = a.is_mine;

          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => toggle(a.id)}
                disabled={disabled}
                className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition ${
                  disabled
                    ? "cursor-not-allowed border-line bg-panel/40 opacity-45"
                    : rank
                      ? "border-accent bg-accent/10"
                      : "border-line bg-panel hover:border-white/25"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-6 w-10 shrink-0 items-center justify-center rounded text-xs font-bold ${
                    rank ? "bg-accent text-ink" : "border border-line text-muted"
                  }`}
                >
                  {rank ? RANK_LABEL[rank - 1] : "―"}
                </span>
                <span className="whitespace-pre-wrap">{a.text}</span>
              </button>
              {disabled && <p className="mt-1 pl-1 text-xs text-muted">あなたの回答（選べません）</p>}
            </li>
          );
        })}
      </ul>

      <Panel>
        {pickable > 0 && (
          <form action={action} className="space-y-3">
            <input type="hidden" name="odai_id" value={odaiId} />
            {selected.map((id, i) => (
              <input key={id} type="hidden" name={`rank_${i + 1}`} value={id} />
            ))}
            <button
              type="submit"
              disabled={pending || selected.length === 0}
              className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink disabled:opacity-40"
            >
              {pending
                ? "送信中…"
                : selected.length === 0
                  ? "採点する回答を選んでください"
                  : retro
                    ? `この順位で採点して結果を見る（${selected.length}件）`
                    : alreadyPicked
                      ? `選び直して送信（${selected.length}件）`
                      : `この順位で採点する（${selected.length}件）`}
            </button>
            {retro ? (
              <p className="text-xs text-muted">
                送ったあとは選び直せません（結果を見てから付けた順位は、他の人に
                合わせただけの記録になってしまうため）。
              </p>
            ) : (
              alreadyPicked && (
                <p className="text-xs text-muted">
                  採点済みです。結果発表までは何度でも選び直せます。誰が誰を選んだかは
                  結果発表まで他の人には見えません。
                </p>
              )
            )}
            <ErrorText message={state.error} />
          </form>
        )}

        {/*
          他人の回答がまだ0件（pickable=0）でも押せる。回答が無い以上「選ぶ」ことは
          できないが、「もう次の操作は無い」ことは宣言できてよい —— これが無いと、
          無回答で解禁した人は自動で finished 扱いになる（0021）だけで、結果発表後の
          「採点した人」表示や貢献度ランキングには一切現れず、採点したのに
          何もしていないことにされる。
        */}
        <form
          action={skipAction}
          className={`space-y-2 ${pickable > 0 ? "mt-3 border-t border-line pt-3" : ""}`}
        >
          <input type="hidden" name="odai_id" value={odaiId} />
          <button
            type="submit"
            disabled={skipPending}
            className="w-full rounded-md border border-line px-4 py-2 text-sm hover:border-white/25 disabled:opacity-40"
          >
            {skipPending
              ? "送信中…"
              : retro
                ? "何も選ばない（採点を終えて結果を見る）"
                : "何も選ばない（採点を終える）"}
          </button>
          <p className="text-xs text-muted">{skipNote}</p>
          <ErrorText message={skipState.error} />
        </form>
      </Panel>
    </div>
  );
}
