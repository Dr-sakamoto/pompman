"use client";

import { useState } from "react";
import Image from "next/image";
import { Panel } from "@/components/ui";

// docs/odai-mvp-spec.md: 「AI（回答生成・報酬モデル）の着手は、picksが数百件貯まってから」
const AI_INTRODUCTION_TARGET_PICKS = 300;

const STAGES: { min: number; label: string; flavor: string }[] = [
  { min: 0, label: "休眠中", flavor: "まだ石のように静か。pickが集まるほど輝きだす。" },
  { min: 25, label: "目覚めかけ", flavor: "うっすら光り始めた。もう少し。" },
  { min: 50, label: "覚醒進行中", flavor: "半分まで来た。育ってきている実感がある。" },
  { min: 75, label: "覚醒直前", flavor: "あと少しで色がつく。ラストスパート。" },
  { min: 100, label: "覚醒完了", flavor: "教師データが目標に到達。AI参加の準備が整った。" },
];

function stageFor(percent: number) {
  return [...STAGES].reverse().find((s) => percent >= s.min) ?? STAGES[0];
}

export function AiProgress({ picksCount }: { picksCount: number }) {
  const [expanded, setExpanded] = useState(false);

  const remaining = Math.max(0, AI_INTRODUCTION_TARGET_PICKS - picksCount);
  const ratio = Math.min(1, picksCount / AI_INTRODUCTION_TARGET_PICKS);
  const percent = Math.round(ratio * 100);
  const reached = remaining === 0;
  const stage = stageFor(percent);

  // マスコットは1枚絵のまま、進捗に応じて彩度・発光・浮遊で「育ち具合」を出す。
  // 0%はほぼ石（グレースケール）、100%で満開に発光する。
  const grayscale = Math.round((1 - ratio) * 100);
  const glow = 4 + ratio * 22;

  return (
    <Panel className="space-y-0 p-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <span
          className="relative flex h-14 w-14 shrink-0 items-center justify-center"
          style={{
            filter: `grayscale(${grayscale}%) drop-shadow(0 0 ${glow}px rgba(255,210,63,${
              0.15 + ratio * 0.55
            }))`,
          }}
        >
          <Image
            src="/mascot-crystal.png"
            alt="AI育成マスコット"
            width={56}
            height={56}
            className={`h-14 w-14 object-contain ${reached ? "animate-pulse" : ""}`}
            priority
          />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between text-sm">
            <span className="font-bold">🤖 AI参加まで — {stage.label}</span>
            <span className="text-muted">
              {reached ? (
                "到達！"
              ) : (
                <>
                  あと <span className="font-bold text-accent">{remaining}</span> pick
                </>
              )}
            </span>
          </span>
          <span className="mt-2 block h-2 w-full overflow-hidden rounded-full bg-white/10">
            <span
              className="block h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </span>
        </span>

        <span className="shrink-0 text-xs text-muted" aria-hidden>
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-line px-4 pb-4 pt-3 text-xs text-muted">
          <p>{stage.flavor}</p>
          <div className="flex items-center justify-between">
            <span>教師データ（picks）</span>
            <span className="tabular-nums text-white">
              {picksCount} / {AI_INTRODUCTION_TARGET_PICKS}（{percent}%）
            </span>
          </div>
          <div className="flex gap-1">
            {STAGES.filter((s) => s.min > 0).map((s) => (
              <span
                key={s.min}
                className={`h-1 flex-1 rounded-full ${
                  percent >= s.min ? "bg-accent" : "bg-white/10"
                }`}
                aria-hidden
              />
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
