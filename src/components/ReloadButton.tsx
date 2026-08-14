"use client";

export function ReloadButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      aria-label="再読み込み"
      className="text-sm text-muted hover:text-white"
    >
      ↻
    </button>
  );
}
