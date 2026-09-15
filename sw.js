// お金の流れマップ: 画面(HTML)は常にネットワーク優先で取得し、失敗時だけ控えを使う。プッシュ通知の表示も担う
const CACHE = "moneymap-shell-v1";
self.addEventListener("install", e => { self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return;
  const isDoc = req.mode === "navigate" || req.destination === "document";
  if (!isDoc) return;
  e.respondWith(
    fetch(req, { cache: "no-store" })
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("shell", copy)); } return res; })
      .catch(() => caches.match("shell"))
  );
});
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "お金の流れマップ";
  e.waitUntil(self.registration.showNotification(title, { body: d.body || "", tag: "moneymap-" + (d.tag || "day"), renotify: false, data: { url: d.url || "/" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const w = list.find(c => c.url.startsWith(self.location.origin));
    if (w) return w.focus();
    return self.clients.openWindow(target);
  }));
});
