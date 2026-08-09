import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { ShareButton } from "@/components/ShareButton";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "大喜利",
  description: "身内で遊ぶ招待制の大喜利アプリ。リンクから開いてホーム画面に追加できます。",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "大喜利",
  },
  openGraph: {
    title: "大喜利",
    description: "身内で遊ぶ招待制の大喜利アプリ",
    url: siteUrl,
    siteName: "大喜利",
    locale: "ja_JP",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f0f11",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen antialiased">
        <RegisterServiceWorker />
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              大喜利
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/members" className="text-sm text-muted hover:text-white">
                メンバー
              </Link>
              <ShareButton />
              <form action="/logout" method="post">
                <button type="submit" className="text-sm text-muted hover:text-white">
                  ログアウト
                </button>
              </form>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
