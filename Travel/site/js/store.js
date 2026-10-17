/* 資料層
 * - 資料存在 Google 試算表（透過 Apps Script），瀏覽器保留一份快取以便快速開啟
 * - 每次開啟自動雙向同步（多裝置共用）
 * - 刪除採「墓碑」標記，確保同步時不會被別台裝置的舊資料復活 */
(function () {
  const KEY = 'ta.trips.v1';
  const SETTINGS_KEY = 'ta.settings.v1';
  const PROFILE_ID = '__profile';
  const listeners = new Set();

  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => {
    const json = JSON.stringify(v);
    try { localStorage.setItem(k, json); return; } catch { }
    // 空間不足：先清掉可以重抓的天氣快取再試一次
    try { Object.keys(localStorage).filter(x => /^ta\.(wx|clim)\./.test(x)).forEach(x => localStorage.removeItem(x)); localStorage.setItem(k, json); }
    catch (e) { TA.u.toast('瀏覽器儲存空間不足：' + e.message, 'err'); }
  };

  let trips = load(KEY, []);
  let settings = Object.assign({ gasUrl: '', gasToken: '', baseCurrency: 'TWD', homeTz: 'Asia/Taipei', lastSync: '' }, load(SETTINGS_KEY, {}));

  const persist = () => { save(KEY, trips); listeners.forEach(fn => fn()); };

  function statusOf(t) {
    if (t.status && t.status !== 'auto') return t.status;
    const today = TA.u.todayStr();
    if (t.endDate && t.endDate < today) return 'done';
    if (t.startDate && t.startDate <= today) return 'ongoing';
    return 'planning';
  }

  const Store = {
    statusOf,
    STATUS: { planning: '安排中', ongoing: '旅行中', done: '已完成' },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    all() { return trips.filter(t => !t.deleted && !t.kind); },

    /** 個人足跡：居住地與沒有排行程的造訪紀錄（存在雲端，跟旅程一起同步） */
    profile() {
      return trips.find(t => t.id === PROFILE_ID && !t.deleted) || { id: PROFILE_ID, kind: 'profile', v: 2, title: '個人足跡（非旅程）', home: '台灣', extras: [] };
    },
    saveProfile(p) {
      Store.upsert({ ...p, id: PROFILE_ID, kind: 'profile', v: 2, title: '個人足跡（非旅程）' });
    },
    /** 其他設定型資料（例如行李模板），跟旅程一起存在雲端 */
    record(id) { return trips.find(t => t.id === id && !t.deleted) || null; },
    /** 同一種類的所有紀錄（例如訪客新增的願望，每筆一列） */
    records(kind) { return trips.filter(t => t.kind === kind && !t.deleted); },
    saveRecord(id, kind, title, data) { Store.upsert({ ...data, id, kind, v: 2, title }); },
    get(id) { return trips.find(t => t.id === id && !t.deleted) || null; },

    /** 訪客模式：只能看，任何寫入都擋下 */
    isGuest() { return settings.role === 'guest'; },
    /** 這位訪客能不能在這趟旅程新增願望（管理者在「這趟的願望清單」開放） */
    canWish(tripId) { return Store.isGuest() && !!settings.perms?.wishTrips?.includes(tripId); },
    denied(quiet) { if (!Store.isGuest()) return false; if (!quiet) TA.u.toast('訪客模式只能瀏覽，無法修改', 'err'); return true; },

    upsert(trip, { silent = false, quiet = false } = {}) {
      if (Store.denied(quiet)) return trip;
      trip.updatedAt = new Date().toISOString();
      const i = trips.findIndex(t => t.id === trip.id);
      if (i >= 0) trips[i] = trip; else trips.push(trip);
      persist();
      if (!silent) Store.push([trip]);
      return trip;
    },
    remove(id) {
      if (Store.denied()) return;
      const t = trips.find(x => x.id === id);
      if (!t) return;
      const now = new Date().toISOString();
      const tombs = [{ id, deleted: true, updatedAt: now }];
      trips[trips.indexOf(t)] = tombs[0];
      // 這趟的記帳一起刪掉
      const ex = trips.findIndex(x => x.id === '__exp_' + id && !x.deleted);
      if (ex >= 0) { trips[ex] = { id: '__exp_' + id, deleted: true, updatedAt: now }; tombs.push(trips[ex]); }
      persist();
      Store.push(tombs);
    },
    newTrip(partial = {}) {
      const now = new Date().toISOString();
      return Object.assign({
        v: 2, id: TA.u.uid('t'), title: '', countries: [], cities: [], startDate: '', endDate: '', status: 'auto',
        cover: '', summary: '', tags: [], facts: [], intro: '', days: [], sections: [], createdAt: now, updatedAt: now,
      }, partial);
    },

    /** 舊格式行程轉成新格式，並存回雲端 */
    async migrate() {
      const old = trips.filter(t => !t.deleted && !(t.v >= 2));
      if (!old.length) return 0;
      const conv = old.map(t => TA.legacy.convertTrip(t));
      conv.forEach(c => { c.updatedAt = new Date().toISOString(); trips[trips.findIndex(t => t.id === c.id)] = c; });
      persist();
      await Store.push(conv);
      return conv.length;
    },

    /** 還放在外部網站的圖片 */
    externalImages() {
      const set = new Set();
      const re = /<img[^>]+src="(https?:\/\/[^"]+)"/g;
      const own = u => /googleusercontent\.com|drive\.google\.com/.test(u);
      for (const t of Store.all()) {
        const html = [t.intro, ...(t.days || []).flatMap(d => [d.notes, ...(d.blocks || []).map(b => b.body)]), ...(t.sections || []).map(s => s.body), ...(t.bookings || []).map(b => b.note || '')].join('');
        for (const m of html.matchAll(re)) if (!own(m[1])) set.add(m[1].replace(/&amp;/g, '&'));
        if (t.cover && /^https?:/.test(t.cover) && !/googleusercontent\.com/.test(t.cover)) set.add(t.cover);
      }
      return [...set];
    },
    /** 把外部圖片搬到自己的 Google Drive（可中斷，重跑會接續） */
    async migrateImages(onProgress, batch = 12) {
      const urls = Store.externalImages();
      let done = 0, failed = 0;
      for (let i = 0; i < urls.length; i += batch) {
        const part = urls.slice(i, i + batch);
        onProgress && onProgress(done, urls.length, failed, true);
        const r = await Store.call('importImages', { urls: part });
        const map = r.map || {};
        failed += (r.failed || []).length;
        const changed = [];
        trips = trips.map(t => {
          if (t.deleted) return t;
          let j = JSON.stringify(t), hit = false;
          for (const [from, to] of Object.entries(map)) if (j.includes(from)) { j = j.split(from).join(to); hit = true; }
          if (!hit) return t;
          const n = JSON.parse(j); n.updatedAt = new Date().toISOString(); changed.push(n); return n;
        });
        persist();
        if (changed.length) await Store.call('save', { trips: changed });
        done += part.length;
        onProgress && onProgress(done, urls.length, failed);
      }
      return { total: urls.length, failed };
    },

    // ---- 設定 ----
    settings() { return settings; },
    setSettings(p) { settings = Object.assign(settings, p); save(SETTINGS_KEY, settings); listeners.forEach(fn => fn()); },


    // ---- 備份 ----
    exportJSON() { return JSON.stringify({ app: 'travel-journal', version: 1, exportedAt: new Date().toISOString(), trips: trips.filter(t => !t.deleted) }, null, 1); },
    importJSON(text) {
      if (Store.denied()) return 0;
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : data.trips;
      if (!Array.isArray(list)) throw new Error('格式不正確');
      let n = 0;
      // 還原的資料視為最新版本，避免下次同步被雲端或其他裝置較新的舊資料蓋回去
      const now = new Date().toISOString();
      list.forEach(t => { if (t && t.id) t.updatedAt = now; });
      for (const t of list) { if (!t.id) continue; const i = trips.findIndex(x => x.id === t.id); if (i >= 0) trips[i] = t; else trips.push(t); n++; }
      persist(); Store.push(list);
      return n;
    },
    // ---- 登入 ----
    // config.js 的網址優先，改了 config 所有裝置就會一起換到新網址
    gasUrl() { return (window.TA_CONFIG && TA_CONFIG.gasUrl) || settings.gasUrl || ''; },
    isAuthed() { return !!(settings.gasToken && Store.gasUrl()); },
    loggingIn: false,
    async login(url, token, onStep) {
      const prev = { gasUrl: settings.gasUrl, gasToken: settings.gasToken };
      settings.gasUrl = url; settings.gasToken = token;
      let r;
      Store.loggingIn = true;
      // 先用 ping 確認密碼（很快、不下載資料），通過後再同步一次
      try { r = await Store.call('ping'); }
      catch (e) { Object.assign(settings, prev); throw e; }
      finally { Store.loggingIn = false; }
      Store.setSettings({ gasUrl: url === (window.TA_CONFIG && TA_CONFIG.gasUrl) ? '' : url, gasToken: token, role: r.role || 'admin', perms: r.perms || null, dataVer: null });
      onStep && onStep('載入資料中…');
      // 密碼已確認；資料下載失敗也先進入網站，之後會自動重試
      try { await Store.sync(); } catch (e) { console.warn(e); }
    },
    logout() {
      trips = []; save(KEY, trips);
      pending.clear(); savePending();
      Store.setSettings({ gasToken: '', lastSync: '', role: '', perms: null, dataVer: null });
      Object.keys(localStorage).filter(k => k.startsWith('ta.draft') || k === GUESTS_KEY).forEach(k => localStorage.removeItem(k));
    },

    // ---- Google Apps Script 連線 ----
    syncing: false,
    hasRemote() { return Store.isAuthed(); },
    /** 呼叫 Apps Script。逾時、網路不穩、Google 暫時回傳錯誤頁時，會自動重試（新增類動作除外） */
    async call(action, payload = {}) {
      const SAFE = ['list', 'ping', 'guests', 'save', 'meta', 'checkLinks', 'setGuests'];
      const tries = SAFE.includes(action) ? 3 : 1;
      let last;
      for (let i = 0; i < tries; i++) {
        if (i) await new Promise(r => setTimeout(r, [0, 1500, 4000][i]));
        try { return await callOnce(action, payload); }
        catch (e) { last = e; if (e.fatal || !navigator.onLine) break; }
      }
      throw last;
    },
    /** 待上傳的筆數（存在本機、還沒送到雲端） */
    pendingCount() { return pending.size; },
    /** 修改先存本機，再排隊上傳（合併成一次送出，失敗會自動重試） */
    push(list) {
      if (!Store.hasRemote() || Store.isGuest()) return Promise.resolve(true);
      list.forEach(t => t && t.id && pending.add(t.id));
      savePending();
      listeners.forEach(fn => fn());
      return flush(600);
    },
    flush: () => flush(0),
    /** 同步；已經有一次在跑（例如存檔後的自動同步）就等它跑完，再補跑一次確保最新 */
    async sync() {
      if (!Store.hasRemote()) return { pulled: 0, pushed: 0, changed: 0 };
      if (Store._syncP) { await Store._syncP.catch(() => { }); return Store.sync(); }
      Store._syncP = Store._sync();
      try { return await Store._syncP; } finally { Store._syncP = null; }
    },
    async _sync() {
      Store.syncing = true; listeners.forEach(fn => fn());
      try {
        // 1. 先把本機還沒上傳的修改送出去
        const pushedBefore = pending.size;
        if (pending.size && !Store.isGuest()) await flush(0);
        // 2. 帶上已知的版本號；雲端沒有變就不用整份下載
        const r = await Store.call('list', { ver: settings.dataVer ?? null });
        if (Store.isGuest()) Store.setSettings({ perms: r.perms || null });
        if (r.unchanged) {
          Store.setSettings({ lastSync: new Date().toISOString() });
          return { pulled: 0, pushed: pushedBefore - pending.size, changed: 0 };
        }
        // 3. 雙向合併：以 updatedAt 較新者為準
        const remote = r.trips || [];
        const map = new Map(trips.map(t => [t.id, t]));
        let changed = 0;
        for (const x of remote) {
          const l = map.get(x.id);
          if (!l || (x.updatedAt || '') > (l.updatedAt || '')) { map.set(x.id, x); changed++; pending.delete(x.id); }
          else if ((l.updatedAt || '') > (x.updatedAt || '')) pending.add(l.id);
        }
        const remoteIds = new Set(remote.map(x => x.id));
        for (const l of trips) if (!remoteIds.has(l.id)) pending.add(l.id);
        trips = [...map.values()];
        save(KEY, trips);
        Store.setSettings({ dataVer: r.ver ?? null, lastSync: new Date().toISOString() });
        if (Store.isGuest()) pending.clear();
        savePending();
        const n = pending.size;
        if (n) await flush(0);
        return { pulled: remote.length, pushed: pushedBefore + n - pending.size, changed };
      } finally {
        Store.syncing = false; listeners.forEach(fn => fn());
      }
    },
  };

  // ---------- 連線細節 ----------
  async function callOnce(action, payload) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ['save', 'importImages', 'checkLinks'].includes(action) ? 90000 : 30000);
    let res, text;
    try {
      res = await fetch(Store.gasUrl(), {
        method: 'POST',
        // text/plain 避免 CORS 預檢（GAS 不支援 OPTIONS）
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: settings.gasToken, ...payload }),
        signal: ctrl.signal,
      });
      text = await res.text();
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? '連線逾時，Apps Script 回應太慢' : navigator.onLine ? '無法連線到 Apps Script' : '目前沒有網路');
    } finally { clearTimeout(timer); }
    let j;
    try { j = JSON.parse(text); }
    catch {
      // Google 回了網頁而不是資料：多半是暫時忙碌，或部署權限不是「所有人」
      const err = new Error(/accounts\.google\.com|ServiceLogin/i.test(text)
        ? 'Apps Script 要求登入 Google：請把部署的「存取權」設為「所有人」'
        : `Apps Script 暫時沒有正常回應${res && !res.ok ? `（HTTP ${res.status}）` : ''}，請稍後再試`);
      if (/accounts\.google\.com|ServiceLogin/i.test(text)) err.fatal = true;
      throw err;
    }
    if (!j.ok) {
      const err = new Error(j.error || '連線失敗');
      // 密碼被改掉或訪客密碼被刪除：登出這台裝置
      if (j.error === '密碼錯誤') { err.fatal = true; if (!Store.loggingIn && Store.isAuthed()) { Store.logout(); location.reload(); } }
      if (/訪客模式|未知動作|沒有開放|請填寫/.test(j.error || '')) err.fatal = true;
      throw err;
    }
    // 寫入後記下新的版本號（期間沒有別人寫入才算數，否則下次同步會整份重抓）
    if (j.ver != null && j.prev != null && settings.dataVer === j.prev) Store.setSettings({ dataVer: j.ver });
    return j;
  }

  // ---------- 上傳佇列 ----------
  const PENDING_KEY = 'ta.pending.v1';
  const GUESTS_KEY = 'ta.guests.cache';
  const pending = new Set(load(PENDING_KEY, []));
  function savePending() { try { localStorage.setItem(PENDING_KEY, JSON.stringify([...pending])); } catch { } }
  let flushTimer = 0, waiters = [], running = null, retryN = 0, retryTimer = 0, warned = false;

  function flush(delay) {
    return new Promise(res => {
      waiters.push(res);
      clearTimeout(flushTimer);
      flushTimer = setTimeout(async () => { const ws = waiters; waiters = []; const ok = await flushNow(); ws.forEach(f => f(ok)); }, delay);
    });
  }
  async function flushNow() {
    while (running) await running.catch(() => { });          // 一次只送一批
    if (!pending.size || !Store.hasRemote() || Store.isGuest()) return true;
    running = (async () => {
      const ids = [...pending];
      const recs = ids.map(id => trips.find(t => t.id === id)).filter(Boolean);
      const stamp = new Map(recs.map(r => [r.id, r.updatedAt]));
      for (let i = 0; i < recs.length; i += 20) await Store.call('save', { trips: recs.slice(i, i + 20) });
      // 送出期間又被改過的，留著下一輪再送
      ids.forEach(id => { const cur = trips.find(t => t.id === id); if (!cur || cur.updatedAt === stamp.get(id)) pending.delete(id); });
      savePending();
    })();
    try {
      await running;
      retryN = 0; warned = false; clearTimeout(retryTimer);
      return true;
    } catch (e) {
      console.warn('上傳失敗', e);
      if (!warned) {
        warned = true;
        if (!navigator.onLine) TA.u.toast('目前離線，已先存在這台裝置，恢復連線後會自動上傳');
        else TA.u.toast('雲端暫時存不進去，已存在這台裝置，稍後自動重試：' + e.message, 'err');
      }
      if (navigator.onLine && !e.fatal) { clearTimeout(retryTimer); retryTimer = setTimeout(() => flush(0), [5, 15, 60, 180][Math.min(retryN++, 3)] * 1000); }
      return false;
    } finally { running = null; listeners.forEach(fn => fn()); }
  }
  window.addEventListener('online', () => { if (pending.size) flush(500); });
  // 關掉或切到背景前，盡量把還沒上傳的送出去
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && pending.size) flush(0); });

  // ---- 訪客密碼（管理者專用）：先顯示上次的清單，背景再更新 ----
  Store.guestsCached = () => load(GUESTS_KEY, null);
  let guestsAt = 0, guestsP = null;
  const keepGuests = g => { guestsAt = Date.now(); try { localStorage.setItem(GUESTS_KEY, JSON.stringify(g)); } catch { } return g; };
  // 一分鐘內重複打開不用再問 Apps Script；同時多處要求只發一次
  Store.guests = async () => {
    if (Date.now() - guestsAt < 60000 && Store.guestsCached()) return Store.guestsCached();
    guestsP = guestsP || Store.call('guests').then(r => keepGuests(r.guests || [])).finally(() => (guestsP = null));
    return guestsP;
  };
  Store.setGuests = async list => keepGuests((await Store.call('setGuests', { guests: list })).guests || []);

  window.TA = window.TA || {};
  TA.store = Store;
})();
