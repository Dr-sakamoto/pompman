"use client";

import { useActionState, useOptimistic, useState } from "react";
import { closeAnswers, submitAnswer, type ActionState } from "@/app/actions";
import { AnswerProgress } from "@/components/AnswerProgress";
import { ErrorText, Panel } from "@/components/ui";
import type { AnswerView, Odai } from "@/lib/types";

export function AnsweringPhase({
  odai,
  myAnswer,
  isOwner,
  progress,
}: {
  odai: Odai;
  myAnswer: AnswerView | null;
  isOwner: boolean;
  progress: { answerCount: number; memberCount: number } | null;
}) {
  const [error, setError] = useState<string>();
  // 送信に失敗したときフォームは作り直されるので、書いた内容は React 側で持っておく。
  // 非制御のままだと、通信エラーで戻ってきたときに入力が消えてしまう。
  const [draft, setDraft] = useState("");

  /*
   * 送信した瞬間に自分の回答を表示してしまう。
   *
   * 実際には「Server Action → DB へ INSERT → revalidatePath でページ再取得」
   * の往復が終わるまで確定しないが、書いた本人にとっては結果の分かりきった
   * 操作なので、その間ボタンを見つめさせる意味がない。
   *
   * useOptimistic なので、送信が失敗すれば表示は自動で入力フォームに戻り、
   * 下にエラーが出る。成功すれば往復の完了時に myAnswer（サーバーが返した
   * 本物）へそのまま切り替わるので、画面のちらつきもない。
   */
  const [optimisticText, showAnswer] = useOptimistic<string | null, string>(
    myAnswer?.text ?? null,
    (_current, justSubmitted) => justSubmitted,
  );

  async function submit(formData: FormData) {
    setError(undefined);
    showAnswer(String(formData.get("text") ?? ""));

    const result = await submitAnswer({}, formData);
    if (result.error) setError(result.error);
  }

  const submitted = optimisticText !== null;

  return (
    <div className="space-y-4">
      {progress && (
        <AnswerProgress
          answerCount={progress.answerCount}
          memberCount={progress.memberCount}
          createdAt={odai.created_at}
        />
      )}

      {submitted ? (
        <Panel>
          <p className="mb-1 text-xs font-bold text-muted">あなたの回答</p>
          <p className="whitespace-pre-wrap">{optimisticText}</p>
        </Panel>
      ) : (
        <Panel>
          <form action={submit} className="space-y-3">
            <input type="hidden" name="odai_id" value={odai.id} />
            <textarea
              name="text"
              required
              rows={3}
              maxLength={500}
              placeholder="回答を書く"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full resize-none rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-accent"
            />
            <button
              type="submit"
              className="w-full rounded-md bg-accent px-4 py-2 font-bold text-ink"
            >
              回答する
            </button>
            <ErrorText message={error} />
          </form>
        </Panel>
      )}

      <p className="text-sm text-muted">
        回答受付中は、他の人の回答の中身は見えません（進み具合はバーで確認できます）。
        {submitted && " 回答は1人1つで、あとから変更できません。"}
      </p>

      {isOwner && <CloseAnswersButton odaiId={odai.id} />}
    </div>
  );
}

function CloseAnswersButton({ odaiId }: { odaiId: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(closeAnswers, {});

  return (
    <form action={action} className="space-y-2 border-t border-line pt-4">
      <input type="hidden" name="odai_id" value={odaiId} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md border border-line px-4 py-2 text-sm font-medium hover:border-white/25 disabled:opacity-40"
      >
        {pending ? "処理中…" : "回答を締め切って投票へ"}
      </button>
      <p className="text-xs text-muted">出題者だけが操作できます。回答が2件以上必要です。</p>
      <ErrorText message={state.error} />
    </form>
  );
}
