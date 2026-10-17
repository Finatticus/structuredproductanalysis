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

  async function put(cache, url) {
    let res;
    try { res = await fetch(url, { mode: 'cors', cache: 'reload' }); }
    catch { res = await fetch(url, { mode: 'no-cors' }); }   // 不支援 CORS 的圖片，仍可存成不透明回應
    if (!res.ok && res.type !== 'opaque') throw new Error('HTTP ' + res.status);
    const size = res.type === 'opaque' ? 0 : +(res.headers.get('content-length') || 0);
    await cache.put(url, res);
    return size;
  }

  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
  }

  /** 存一趟旅程；onProgress(done, total, text) */
  async function save(t, onProgress = () => { }) {
    if (!('caches' in window)) throw new Error('這個瀏覽器不支援離線儲存');
    try { await navigator.storage?.persist?.(); } catch { }   // 請瀏覽器不要自動清掉
    const cache = await caches.open(CACHE);
    const shell = shellUrls(), imgs = tripImages(t);
    const places = TA.geo.placePoints(t.countries, t.cities, t);
    const total = shell.length + imgs.length + places.length + 1;
    let done = 0, failed = 0, bytes = 0;
    const step = txt => onProgress(++done, total, txt);

    await pool(shell, 4, async u => { try { bytes += await put(cache, u); } catch { failed++; } step('網站程式'); });
    await pool(imgs, 4, async u => { try { bytes += await put(cache, u); } catch { failed++; } step('圖片與截圖'); });
    // 天氣：重新抓一次，存在本機（離線時顯示這份）
    for (const p of places) {
      try { await TA.weather.forecast(p.ll, true); await TA.weather.history(p.ll); } catch { }
      step('天氣資料');
    }
    try { await TA.ticker.loadRates(true); } catch { }
    step('匯率');

    const r = records();
    r[t.id] = { at: new Date().toISOString(), files: imgs.length, failed, bytes, imgs };
    saveRecords(r);
    return r[t.id];
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

  const fmtBytes = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b > 1e3 ? Math.round(b / 1e3) + ' KB' : b ? b + ' B' : '';

  /** 旅程頁按鈕：下載（或更新／移除）並顯示進度 */
  function dialog(t, onDone) {
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
        U.toast(r.failed ? `已存到手機（${r.failed} 個檔案下載失敗，其餘可離線使用）` : `已存到手機${r.bytes ? '，約 ' + fmtBytes(r.bytes) : ''}`);
        onDone && onDone();
      } catch (e) { go.disabled = false; go.textContent = '重試'; U.toast('下載失敗：' + e.message, 'err'); }
    };
    const rm = U.$('#off-rm', m.el);
    if (rm) rm.onclick = async () => { await remove(t.id); m.close(); U.toast('已移除離線資料'); onDone && onDone(); };
  }

  window.TA = window.TA || {};
  TA.offline = { save, remove, records, dialog, fmtBytes, CACHE };
})();
