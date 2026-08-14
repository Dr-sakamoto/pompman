"use client";

import { useEffect, useRef, useState } from "react";

const THRESHOLD = 64;
const MAX_PULL = 96;

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      // ページの一番上まで戻っている時だけ引っ張り開始とみなす。
      // 途中のスクロール中にここが発火しても普段のスクロールを邪魔しない。
      if (window.scrollY <= 0 && !refreshing) {
        startY.current = e.touches[0].clientY;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (startY.current === null || refreshing) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        setPull(0);
        return;
      }
      // 抵抗をつけて、引っ張るほど反応が鈍くなるようにする。
      const damped = Math.min(MAX_PULL, delta * 0.4);
      setPull(damped);
      e.preventDefault();
    }

    function onTouchEnd() {
      if (startY.current === null || refreshing) {
        startY.current = null;
        return;
      }
      startY.current = null;
      if (pull >= THRESHOLD) {
        setRefreshing(true);
        setPull(THRESHOLD);
        window.location.reload();
      } else {
        setPull(0);
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [pull, refreshing]);

  const ready = pull >= THRESHOLD;

  return (
    <div ref={containerRef}>
      <div
        aria-hidden
        className="flex items-center justify-center overflow-hidden text-muted"
        style={{
          height: pull,
          transition: startY.current === null ? "height 0.2s ease" : undefined,
        }}
      >
        <span
          className={`text-lg ${refreshing ? "animate-spin" : ""}`}
          style={{
            transform: refreshing ? undefined : `rotate(${ready ? 180 : pull * 2}deg)`,
            transition: "transform 0.15s ease",
          }}
        >
          ↻
        </span>
      </div>
      <div
        style={{
          transform: `translateY(${pull}px)`,
          transition: startY.current === null ? "transform 0.2s ease" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
