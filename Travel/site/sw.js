/* Service Worker：讓網站可以安裝成 App，並在沒有網路時打開看過的內容
 * - 網站自己的檔案：先連網拿最新版，失敗才用快取（更新會立即生效）
 * - 字型、國旗、外部程式庫：先用快取，背景更新
 * - 雲端資料、定位、天氣、匯率：一律直接連網，不經過這裡 */
const CACHE = 'travel-journal-v2';
const SHELL = ['./', './index.html', './manifest.json', './icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => { }));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const STATIC_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|flagcdn\.com/;

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: false }).then(r => r || caches.match(req, { ignoreSearch: true })).then(r => r || caches.match('./index.html')))
    );
    return;
  }
  if (STATIC_HOSTS.test(url.host)) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
