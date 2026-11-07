// 离线缓存：联网时先拿最新版（3 秒拿不到就用缓存），断网时用缓存
const CACHE = 'shufang-v3';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'zip.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('library.json')) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const net = fetch(e.request, { cache: 'no-cache' }).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; });
    const timeout = new Promise((ok) => setTimeout(ok, 3000));
    try {
      const r = await Promise.race([net, timeout]);
      if (r) return r;
    } catch (err) { /* 断网 */ }
    return (await c.match(e.request, { ignoreSearch: true })) || net;
  })());
});
