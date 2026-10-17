/* 離線下載：把一趟旅程需要的所有東西存進手機
 * - 網站程式（含緊急資訊資料）、旅程內容裡的所有圖片、國旗
 * - 天氣（預報與歷史）重新抓一次存在本機
 * 旅程文字本來就存在瀏覽器裡；圖片等檔案存在 Cache Storage（Service Worker 離線時會從這裡拿）
 * 紀錄存在 localStorage 'ta.offline.v1'：{ tripId: { at, files, failed, bytes } } */
(function () {
  const CACHE = 'travel-journal-offline';
  const KEY = 'ta.offline.v1';
  const U = TA.u;

  const records = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  const saveRecords = r => { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { } };

  /** 網站本身需要的檔案（照 index.html 實際載入的網址，含版本號） */
  function shellUrls() {
    const urls = new Set(['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png']);
    document.querySelectorAll('script[src]').forEach(s => urls.add(s.src));
    document.querySelectorAll('link[rel="stylesheet"]').forEach(l => urls.add(l.href));
    const v = (document.querySelector('script[src*="app.js"]')?.src.split('v=')[1]) || '1';
    urls.add(new URL('js/emergency-data.js?v=' + v, location.href).href);
    return [...urls];
  }

  /** 旅程內容裡用到的所有圖片 */
  function tripImages(t) {
    const html = [t.intro, ...(t.days || []).flatMap(d => [d.notes, ...(d.blocks || []).map(b => b.body)]), ...(t.sections || []).map(s => s.body), ...(t.bookings || []).map(b => b.note || '')].join('');
    const set = new Set([...html.matchAll(/<img[^>]+src="(https?:\/\/[^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&')));
    if (t.cover && /^https?:/.test(t.cover)) set.add(t.cover);
    (t.countries || []).forEach(c => { const k = TA.countries.find(c); if (k) [20, 40, 80].forEach(w => set.add(TA.countries.flagUrl(k, w))); });
    return [...set];
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const RETRY = [408, 425, 429, 500, 502, 503, 504];
  /** 失敗原因翻成人看得懂的話 */
  function why(e) {
    const m = String(e?.message || e);
    if (e?.name === 'QuotaExceededError' || /quota/i.test(m)) return '手機儲存空間不足';
    if (/HTTP 404|HTTP 410/.test(m)) return '檔案已不存在（原網址失效）';
    if (/HTTP 403|HTTP 401/.test(m)) return '對方網站不允許下載';
    if (/HTTP 429/.test(m)) return '對方網站暫時限制太頻繁的下載';
    if (/HTTP 5\d\d/.test(m)) return '對方網站暫時故障';
    if (/HTTP/.test(m)) return m;
    return navigator.onLine ? '連線失敗或對方網站不允許讀取' : '下載途中斷線';
  }
  /** 一般下載：遇到「太頻繁」或對方暫時故障時，等一下再試（最多 3 次） */
  async function fetchOk(url) {
    let last;
    for (let i = 0; i < 3; i++) {
      if (i) await sleep(1200 * i + Math.random() * 600);
      let res;
      try { res = await fetch(url, { mode: 'cors', cache: 'reload' }); }
      catch (e) { last = e; break; }                 // CORS 不允許或斷線：交給下一個方法
      if (res.ok) return res;
      last = new Error('HTTP ' + res.status);
      if (!RETRY.includes(res.status)) break;
    }
    throw last;
  }
  async function put(cache, url, isImg) {
    let res, err;
    try { res = await fetchOk(url); } catch (e) { err = e; }
    // 對方網站不允許跨網站讀取（不是 HTTP 錯誤）：改存成不透明回應，離線一樣能顯示，只是量不到大小
    if (!res && isImg && !/^HTTP/.test(String(err?.message))) {
      try { const o = await fetch(url, { mode: 'no-cors', cache: 'reload' }); if (o.type === 'opaque') { await cache.put(url, o); return 0; } } catch (e) { err = e; }
    }
    if (!res) throw err || new Error('下載失敗');
    const size = +(res.headers.get('content-length') || 0);
    await cache.put(url, res);
    return size;
  }

  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
  }

  /** 存一趟旅程；onProgress(done, total, text) */
  async function save(t, onProgress = () => { }) {
    if (isLocalFile()) throw new Error('直接打開本機檔案（file://）時無法離線下載，請用網址開啟');
    if (!('caches' in window)) throw new Error('這個瀏覽器不支援離線儲存');
    try { await navigator.storage?.persist?.(); } catch { }   // 請瀏覽器不要自動清掉
    const cache = await caches.open(CACHE);
    const shell = shellUrls(), imgs = tripImages(t);
    const places = TA.geo.placePoints(t.countries, t.cities, t);
    const total = shell.length + imgs.length + places.length + 1;
    let done = 0, bytes = 0;
    const fails = [];
    const step = txt => onProgress(++done, total, txt);
    const quotaHit = () => fails.some(f => f.why === '手機儲存空間不足');

    await pool(shell, 3, async u => { try { bytes += await put(cache, u, false); } catch (e) { fails.push({ url: u, kind: 'shell', why: why(e) }); } step('網站程式'); });
    // 舊版本的網站程式（網址帶舊版本號）用不到了，順手清掉
    try { const cur = new Set(shell.map(u => new URL(u, location.href).href)); for (const req of await cache.keys()) if (new URL(req.url).origin === location.origin && !cur.has(req.url)) await cache.delete(req); } catch { }
    // 同一個圖片網站一次下載太多會被限制，圖片一次只抓 2 張
    await pool(imgs, 2, async u => {
      if (quotaHit()) { fails.push({ url: u, kind: 'img', why: '手機儲存空間不足' }); return step('圖片與截圖'); }
      try { bytes += await put(cache, u, true); } catch (e) { fails.push({ url: u, kind: 'img', why: why(e) }); }
      step('圖片與截圖');
    });
    // 天氣：重新抓一次，存在本機（離線時顯示這份）
    for (const p of places) {
      try { await TA.weather.forecast(p.ll, true); await TA.weather.history(p.ll); } catch { }
      step('天氣資料');
    }
    try { await TA.ticker.loadRates(true); } catch { }
    step('匯率');

    const r = records();
    const imgFails = fails.filter(f => f.kind === 'img');
    r[t.id] = { at: new Date().toISOString(), files: imgs.length, failed: imgFails.length, shellFailed: fails.length - imgFails.length, fails: fails.slice(0, 80), bytes, imgs };
    saveRecords(r);
    return r[t.id];
  }

  /** 只重試上次失敗的檔案 */
  async function retryFailed(id, onProgress = () => { }) {
    const r = records(), x = r[id];
    if (!x?.fails?.length) return x;
    const cache = await caches.open(CACHE);
    const still = [];
    let done = 0;
    for (const f of x.fails) {
      try { x.bytes = (x.bytes || 0) + await put(cache, f.url, f.kind === 'img'); }
      catch (e) { still.push({ ...f, why: why(e) }); }
      onProgress(++done, x.fails.length);
    }
    x.fails = still; x.failed = still.filter(f => f.kind === 'img').length; x.shellFailed = still.length - x.failed;
    r[id] = x; saveRecords(r);
    return x;
  }

  /** 失敗清單（對話框） */
  function failsDialog(id, onDone) {
    const x = records()[id], t = TA.store.get(id);
    if (!x) return;
    const short = u => { try { const v = new URL(u, location.href); return v.host + (v.pathname.length > 28 ? v.pathname.slice(0, 26) + '…' : v.pathname); } catch { return u; } };
    const groups = {};
    (x.fails || []).forEach(f => (groups[f.why] = groups[f.why] || []).push(f));
    const m = U.modal(`
      <p>${t ? U.esc(t.title) + '：' : ''}${(x.fails || []).length ? `有 ${(x.fails || []).length} 個檔案沒有存到手機，其他內容可以正常離線使用。` : '全部檔案都已存到手機。'}</p>
      ${Object.entries(groups).map(([w, list]) => `<div class="of-g"><b>${U.esc(w)}</b><small>${list.length} 個</small>
        <ul>${list.slice(0, 12).map(f => `<li>${f.kind === 'shell' ? '網站程式　' : ''}<a href="${U.esc(f.url)}" target="_blank" rel="noopener">${U.esc(short(f.url))}</a></li>`).join('')}${list.length > 12 ? `<li class="muted">還有 ${list.length - 12} 個</li>` : ''}</ul></div>`).join('')}
      ${groups['檔案已不存在（原網址失效）'] ? '<p class="hint">原網址失效的圖片，可以到「設定 → 資料健檢」找出是哪一天的內容，重新上傳圖片。</p>' : ''}
      <div class="progress" hidden><div class="bar"><i></i></div><span class="ptxt"></span></div>
      <div class="modal-actions"><button class="btn ghost" data-close>關閉</button>${(x.fails || []).length ? '<button class="btn primary" id="of-retry">重試失敗的項目</button>' : ''}</div>`, { title: '離線下載結果', small: true });
    const b = U.$('#of-retry', m.el);
    if (b) b.onclick = async () => {
      if (!navigator.onLine) return U.toast('目前沒有網路', 'err');
      b.disabled = true; b.textContent = '重試中…';
      const pg = U.$('.progress', m.el); pg.hidden = false;
      const y = await retryFailed(id, (d, n) => { U.$('.bar i', m.el).style.width = (d / n * 100) + '%'; U.$('.ptxt', m.el).textContent = `${d} / ${n}`; });
      m.close();
      U.toast(y.fails.length ? `還有 ${y.fails.length} 個檔案無法下載` : '全部補齊了');
      onDone && onDone();
      if (y.fails.length) failsDialog(id, onDone);
    };
  }

  /** 移除一趟旅程的離線圖片（其他已存旅程也用到的圖片會保留） */
  async function remove(id) {
    const r = records();
    const mine = r[id]?.imgs || [];
    delete r[id];
    const keep = new Set(Object.values(r).flatMap(x => x.imgs || []));
    const cache = await caches.open(CACHE);
    await Promise.all(mine.filter(u => !keep.has(u)).map(u => cache.delete(u)));
    if (!Object.keys(r).length) await caches.delete(CACHE);
    saveRecords(r);
  }

  const fmtBytes = b => b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b > 1e3 ? Math.round(b / 1e3) + ' KB' : b ? b + ' B' : '0 KB';

  // ---------- 用量：設定頁「離線資料」 ----------
  /** 一個快取檔案的大小；不支援跨網域讀取的圖片（不透明回應）量不到，回傳 null */
  async function sizeOf(res) {
    if (!res || res.type === 'opaque') return null;
    const len = +(res.headers.get('content-length') || 0);
    if (len) return len;
    try { return (await res.clone().blob()).size; } catch { return null; }
  }
  /** localStorage 裡某些 key 的大小（瀏覽器以 UTF-16 存，每字約 2 bytes） */
  function lsSize(test) {
    let n = 0, keys = 0;
    try { for (const k of Object.keys(localStorage)) if (test(k)) { n += (k.length + (localStorage.getItem(k) || '').length) * 2; keys++; } } catch { }
    return { bytes: n, keys };
  }
  const isWx = k => /^ta\.(wx|clim)\./.test(k);
  /** 算出這台裝置上各部分佔多少空間 */
  async function usage() {
    const rec = records();
    const out = { trips: [], shell: { bytes: 0, files: 0 }, site: { bytes: 0, files: 0 }, unknown: 0 };
    const sizes = new Map();
    if ('caches' in window) {
      if (await caches.has(CACHE)) try {
        const c = await caches.open(CACHE);
        const shell = new Set(shellUrls().map(u => new URL(u, location.href).href));
        for (const req of await c.keys()) {
          const sz = await sizeOf(await c.match(req));
          sizes.set(req.url, sz);
          if (shell.has(req.url) || new URL(req.url).origin === location.origin) { out.shell.bytes += sz || 0; out.shell.files++; }
        }
      } catch { }
      try {
        for (const k of await caches.keys()) {
          if (k === CACHE) continue;
          const c = await caches.open(k);
          for (const req of await c.keys()) { out.site.bytes += (await sizeOf(await c.match(req))) || 0; out.site.files++; }
        }
      } catch { }
    }
    // 圖片被多趟共用時，只算在第一趟（加總才不會重複）
    const counted = new Set();
    for (const [id, x] of Object.entries(rec)) {
      let bytes = 0, unknown = 0, shared = 0;
      for (const u of x.imgs || []) {
        if (counted.has(u)) { shared++; continue; }
        counted.add(u);
        const sz = sizes.get(u);
        if (sz == null) { if (sizes.has(u)) unknown++; } else bytes += sz;
      }
      out.unknown += unknown;
      out.trips.push({ id, trip: TA.store.get(id), at: x.at, files: (x.imgs || []).length, failed: x.failed || 0, fails: x.fails || (x.failed ? Array.from({ length: x.failed }, () => ({ why: '舊版下載，原因未記錄' })) : []), bytes, unknown, shared });
    }
    out.trips.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    out.weather = lsSize(isWx);
    out.weather.cities = new Set(Object.keys(localStorage).filter(isWx).map(k => (k.match(/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/) || [''])[0])).size;
    out.data = lsSize(k => k === 'ta.trips.v1' || k === 'ta.pending.v1');
    try { const e = await navigator.storage?.estimate?.(); if (e) { out.used = e.usage; out.quota = e.quota; } } catch { }
    try { out.persisted = await navigator.storage?.persisted?.(); } catch { }
    return out;
  }
  /** 清掉天氣暫存（之後打開天氣會重新抓） */
  function clearWeather() { try { Object.keys(localStorage).filter(isWx).forEach(k => localStorage.removeItem(k)); } catch { } }
  /** 清掉全部離線下載：圖片、離線用的網站程式、天氣暫存。旅程資料本身保留 */
  async function clearAll() {
    try { await caches.delete(CACHE); } catch { }
    saveRecords({});
    clearWeather();
  }

  /** 旅程頁按鈕：下載（或更新／移除）並顯示進度 */
  /** 直接打開電腦裡的 index.html（file://）時，瀏覽器不允許離線功能 */
  const isLocalFile = () => location.protocol === 'file:';
  function localFileNotice() {
    U.modal(`<p>你現在是直接打開電腦裡的 <code>index.html</code>（網址開頭是 <code>file://</code>）。這種方式下，瀏覽器不允許網站把檔案存起來，所以離線下載一定會失敗；安裝成 App、離線開啟也一樣不能用。</p>
      <p>請改用網址開啟（你的 GitHub Pages 網址，開頭是 <code>https://</code>），在那裡按「離線下載」就可以了。其他功能（瀏覽、編輯、同步）用本機檔案測試沒有問題。</p>
      <div class="modal-actions"><button class="btn primary" data-close>知道了</button></div>`, { title: '本機檔案無法離線下載', small: true });
  }

  function dialog(t, onDone) {
    if (isLocalFile()) return localFileNotice();
    const rec = records()[t.id];
    const m = U.modal(`
      <p>${rec ? `已於 ${new Date(rec.at).toLocaleString('zh-TW')} 存到這台裝置。` : '把這趟旅程存到這台裝置，沒有網路（飛機上、eSIM 還沒開通）也能打開 App 查看。'}</p>
      <ul class="off-list"><li>每日行程、訂位、行李清單、願望清單</li><li>所有截圖與訂房確認等圖片</li><li>出發須知與緊急資訊（駐外館處、緊急電話）</li><li>各城市天氣（以下載當下的資料為準）</li></ul>
      <p class="hint">建議出發前一天在有 Wi-Fi 時按一次；內容修改後再按一次更新。Google 地圖導航不包含在內，可先在 Google 地圖 App 下載離線地圖。</p>
      <div class="progress" hidden><div class="bar"><i></i></div><span class="ptxt"></span></div>
      <div class="modal-actions">${rec ? '<button class="btn danger" id="off-rm">移除離線資料</button><span style="flex:1"></span>' : ''}
        <button class="btn ghost" data-close>關閉</button><button class="btn primary" id="off-go">${rec ? '重新下載' : '開始下載'}</button></div>`, { title: '離線下載', small: true });
    const go = U.$('#off-go', m.el);
    go.onclick = async () => {
      if (!navigator.onLine) return U.toast('目前沒有網路，請連上網路後再下載', 'err');
      go.disabled = true; go.textContent = '下載中…';
      const pg = U.$('.progress', m.el); pg.hidden = false;
      try {
        const r = await save(t, (d, total, txt) => { U.$('.bar i', m.el).style.width = (d / total * 100) + '%'; U.$('.ptxt', m.el).textContent = `${txt}　${d} / ${total}`; });
        m.close();
        onDone && onDone();
        if (r.fails?.length) failsDialog(t.id, onDone);
        else U.toast(`已存到手機${r.bytes ? '，約 ' + fmtBytes(r.bytes) : ''}`);
      } catch (e) { go.disabled = false; go.textContent = '重試'; U.toast('下載失敗：' + e.message, 'err'); }
    };
    const rm = U.$('#off-rm', m.el);
    if (rm) rm.onclick = async () => { await remove(t.id); m.close(); U.toast('已移除離線資料'); onDone && onDone(); };
  }

  window.TA = window.TA || {};
  /** 網站更新後，快取裡帶舊版本號的程式檔就用不到了：只留現在這一版 */
  async function pruneSite() {
    if (!('caches' in window)) return;
    const cur = new Set(shellUrls().map(u => new URL(u, location.href).href));
    for (const k of await caches.keys()) {
      if (k === CACHE) continue;
      const c = await caches.open(k);
      for (const req of await c.keys()) {
        const u = new URL(req.url);
        if (u.origin === location.origin && u.searchParams.has('v') && !cur.has(req.url)) await c.delete(req);
      }
    }
  }
  setTimeout(() => pruneSite().catch(() => { }), 8000);

  TA.offline = { isLocalFile, save, remove, records, dialog, fmtBytes, CACHE, usage, clearWeather, clearAll, pruneSite, retryFailed, failsDialog };
})();
