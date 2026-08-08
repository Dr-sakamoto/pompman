import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "大喜利",
    short_name: "大喜利",
    description: "身内で遊ぶ招待制の大喜利アプリ",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0f0f11",
    theme_color: "#0f0f11",
    lang: "ja",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
