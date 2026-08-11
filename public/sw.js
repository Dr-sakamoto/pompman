/*
 * v1 は「全ての GET レスポンスをキャッシュし、通信に失敗したらキャッシュを返す」
 * という作りだった。これがログイン状態を壊していた。
 *
 * - install 時に "/" を addAll していた。Service Worker の登録はログイン画面でも
 *   走るので、未ログイン状態で "/" を取得 → middleware が /login にリダイレクト →
 *   その「ログイン画面のHTML」が "/" のキャッシュとして焼き付いていた。
 * - fetch ハンドラが通信失敗時に caches.match() を返すため、タスクキル直後の
 *   再起動（電波が復帰しきっていない＝一番失敗しやすい瞬間）に、
 *   ログイン済みでも上記の古いログイン画面が表示されていた。
 *
 * ログイン状態は Cookie で決まりサーバー側でしか判定できないので、
 * HTML は一切キャッシュしない。キャッシュするのはアイコンなどの静的アセットだけ。
 */
const CACHE_NAME = "ogiri-shell-v2";
const PRECACHE_URLS = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** キャッシュしてよいのは、認証状態に左右されない静的アセットだけ。 */
function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/manifest.webmanifest" ||
    /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // HTML・Server Action・RSC などは素通しする。
  // ここで肩代わりすると、古い認証状態の画面を返してしまう。
  if (!isStaticAsset(url)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, copy))
            .catch(() => {});
        }
        return response;
      });
    }),
  );
});
