/* Service Worker：讓網站可以安裝成 App，並在沒有網路時打開
 * - 網站自己的檔案：先連網拿最新版；連不上或超過 4 秒就用存好的版本
 * - 圖片、國旗、字型、外部程式庫：有存就直接用（離線下載的旅程圖片在這裡）
 * - 雲端資料、定位、天氣、匯率：一律直接連網，不經過這裡
 * 離線下載的檔案存在 'travel-journal-offline'，更新網站時不會被清掉 */
const CACHE = 'travel-journal-v3';
const OFFLINE = 'travel-journal-offline';
const SHELL = ['./', './index.html', './manifest.json', './icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => { }));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== OFFLINE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const STATIC_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|flagcdn\.com/;
const IMAGE_HOSTS = /googleusercontent\.com|drive\.google\.com|flagcdn\.com/;

const fromCache = req => caches.match(req).then(r => r || caches.match(req, { ignoreSearch: true }));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 網站本身：先連網，失敗或太慢就用快取
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const net = fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      });
      const timeout = new Promise(r => setTimeout(r, 4000, null));
      try {
        const res = await Promise.race([net, timeout]);
        if (res) return res;
        const cached = await fromCache(req);
        return cached || await net;
      } catch {
        return (await fromCache(req)) || (req.mode === 'navigate' ? (await caches.match('./index.html', { ignoreSearch: true })) || (await caches.match('./')) : Response.error());
      }
    })());
    return;
  }
  // 圖片：有存就用（離線下載的旅程圖片），沒有才連網
  if (IMAGE_HOSTS.test(url.host) || req.destination === 'image') {
    e.respondWith(fromCache(req).then(hit => hit || fetch(req)));
    return;
  }
  // 字型、外部程式庫：先用快取，背景更新
  if (STATIC_HOSTS.test(url.host)) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req) || await caches.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
