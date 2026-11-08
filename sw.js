// 离线缓存：联网时先拿最新版（3 秒拿不到就用缓存），断网时用缓存
const CACHE = 'shufang-shell';
const FONT_CACHE = 'shufang-fonts';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'zip.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== FONT_CACHE) await caches.delete(k);
    // 以前不小心存下的书包、版本号文件，清掉
    const c = await caches.open(CACHE);
    for (const req of await c.keys()) if (req.url.includes('/shufang-data/') || req.url.includes('version.json')) await c.delete(req);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // 字体：用过一次就存起来，断网也能用
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(FONT_CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith('library.json') || url.pathname.endsWith('version.json') || url.pathname.includes('/shufang-data/')) return;
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
