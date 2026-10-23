// 離線快取：程式與材質快取在手機裡，第二次開啟不用重新下載。更新版本時把 VERSION 加 1。
const VERSION = 'dixen-v1';
const CORE = [
  './', './index.html', './css/style.css', './manifest.webmanifest',
  './js/main.js', './js/game.js', './js/render.js', './js/terrain.js', './js/physics.js', './js/character.js',
  './js/hud.js', './js/input.js', './js/net.js', './js/api.js', './js/config.js', './js/stats.js', './js/clubs.js',
  './js/courses.js', './js/util.js', './js/audio.js',
  './assets/textures/grass_d.jpg', './assets/textures/grass_n.jpg', './assets/textures/sand_d.jpg', './assets/textures/sand_n.jpg',
  './assets/textures/rock_d.jpg', './assets/textures/rock_n.jpg', './assets/textures/sky.hdr',
  './assets/icons/icon-192.png', './assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // GAS 請求一律走網路
  if (e.request.method !== 'GET' || url.hostname.includes('script.google')) return;
  // 自己的程式：網路優先（拿到新版），離線時用快取
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // CDN（three.js、字型）：快取優先
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(VERSION).then(c => c.put(e.request, copy));
    return r;
  })));
});
