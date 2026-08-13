import type { NextConfig } from "next";

// anon key は公開前提のキー（RLS で保護されている）。デプロイ方法によっては
// プロジェクトの環境変数がビルド/実行時に渡らないことがあるため、
// 未設定時のフォールバックとしてここに置いておく。
//
// 【重要】ここは「環境変数が無いとき」のフォールバックでしかない。Vercel 側に
// 古い（ムンバイの）値が残っていると、そちらが優先されて接続先が戻ってしまう。
// プロジェクトを移したら Vercel の環境変数も必ず同時に直すこと。
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://zdlqgguggqaxxfphhlff.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkbHFnZ3VnZ3FheHhmcGhobGZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MjE0MTksImV4cCI6MjEwMjE5NzQxOX0.PuYi81suRw6c4d7_B1SulkIs0HNxMOcrkqfNCe9wH3c",
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? "https://pompman.vercel.app",
  },
};

export default nextConfig;
