import type { NextConfig } from "next";

// anon key は公開前提のキー（RLS で保護されている）。デプロイ方法によっては
// プロジェクトの環境変数がビルド/実行時に渡らないことがあるため、
// 未設定時のフォールバックとしてここに置いておく。
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://vahvzonvhewkgnofuxqv.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZhaHZ6b252aGV3a2dub2Z1eHF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNjAyNjQsImV4cCI6MjEwMTczNjI2NH0.in5Tb8Wp18UjkLFRLBtP19kdM5hanK0qAsgTY_8XSwU",
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? "https://pompman.vercel.app",
  },
};

export default nextConfig;
