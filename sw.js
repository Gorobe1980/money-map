// お金の流れマップ: 画面(HTML)は常にネットワーク優先で取得し、失敗時だけ控えを使う
const CACHE = "moneymap-shell-v1";
self.addEventListener("install", e => { self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const isDoc = req.mode === "navigate" || req.destination === "document";
  if (!isDoc) return;
  e.respondWith(
    fetch(req, { cache: "no-store" })
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put("shell", copy)); return res; })
      .catch(() => caches.match("shell"))
  );
});
