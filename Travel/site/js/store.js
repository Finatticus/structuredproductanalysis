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
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { TA.u.toast('瀏覽器儲存空間不足：' + e.message, 'err'); } };

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
    saveRecord(id, kind, title, data) { Store.upsert({ ...data, id, kind, v: 2, title }); },
    get(id) { return trips.find(t => t.id === id && !t.deleted) || null; },

    /** 訪客模式：只能看，任何寫入都擋下 */
    isGuest() { return settings.role === 'guest'; },
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
      const tomb = { id, deleted: true, updatedAt: new Date().toISOString() };
      trips[trips.indexOf(t)] = tomb;
      persist();
      Store.push([tomb]);
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

    // ---- 訪客密碼（管理者專用） ----
    async guests() { return (await Store.call('guests')).guests || []; },
    async setGuests(list) { return (await Store.call('setGuests', { guests: list })).guests || []; },

    // ---- 備份 ----
    exportJSON() { return JSON.stringify({ app: 'travel-journal', version: 1, exportedAt: new Date().toISOString(), trips: trips.filter(t => !t.deleted) }, null, 1); },
    importJSON(text) {
      if (Store.denied()) return 0;
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : data.trips;
      if (!Array.isArray(list)) throw new Error('格式不正確');
      let n = 0;
      for (const t of list) { if (!t.id) continue; const i = trips.findIndex(x => x.id === t.id); if (i >= 0) trips[i] = t; else trips.push(t); n++; }
      persist(); Store.push(list);
      return n;
    },
    // ---- 登入 ----
    // config.js 的網址優先，改了 config 所有裝置就會一起換到新網址
    gasUrl() { return (window.TA_CONFIG && TA_CONFIG.gasUrl) || settings.gasUrl || ''; },
    isAuthed() { return !!(settings.gasToken && Store.gasUrl()); },
    loggingIn: false,
    async login(url, token) {
      const prev = { gasUrl: settings.gasUrl, gasToken: settings.gasToken };
      settings.gasUrl = url; settings.gasToken = token;
      let r;
      Store.loggingIn = true;
      try { r = await Store.call('list'); }
      catch (e) { Object.assign(settings, prev); throw e; }
      finally { Store.loggingIn = false; }
      Store.setSettings({ gasUrl: url === (window.TA_CONFIG && TA_CONFIG.gasUrl) ? '' : url, gasToken: token, role: r.role || 'admin' });
      await Store.sync();
    },
    logout() {
      trips = []; save(KEY, trips);
      Store.setSettings({ gasToken: '', lastSync: '', role: '' });
      Object.keys(localStorage).filter(k => k.startsWith('ta.draft')).forEach(k => localStorage.removeItem(k));
    },

    // ---- Google Apps Script 同步 ----
    syncing: false,
    hasRemote() { return Store.isAuthed(); },
    async call(action, payload = {}) {
      const res = await fetch(Store.gasUrl(), {
        method: 'POST',
        // text/plain 避免 CORS 預檢（GAS 不支援 OPTIONS）
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, token: settings.gasToken, ...payload }),
      });
      const j = await res.json();
      if (!j.ok) {
        // 密碼被改掉或訪客密碼被刪除：登出這台裝置
        if (j.error === '密碼錯誤' && !Store.loggingIn && Store.isAuthed()) { Store.logout(); location.reload(); }
        throw new Error(j.error || '連線失敗');
      }
      return j;
    },
    async push(list) {
      if (!Store.hasRemote() || Store.isGuest()) return;
      try { await Store.call('save', { trips: list }); }
      catch (e) {
        console.warn(e);
        if (!navigator.onLine) TA.u.toast('目前離線，已先存在這台裝置，恢復連線後會自動上傳');
        else TA.u.toast('雲端儲存失敗，已存在本機：' + e.message, 'err');
      }
    },
    /** 雙向合併：以 updatedAt 較新者為準 */
    async sync() {
      if (!Store.hasRemote() || Store.syncing) return;
      Store.syncing = true; listeners.forEach(fn => fn());
      try {
        const { trips: remote } = await Store.call('list');
        const map = new Map(trips.map(t => [t.id, t]));
        const toPush = [];
        for (const r of remote) {
          const l = map.get(r.id);
          if (!l || (r.updatedAt || '') > (l.updatedAt || '')) map.set(r.id, r);
          else if ((l.updatedAt || '') > (r.updatedAt || '')) toPush.push(l);
        }
        const remoteIds = new Set(remote.map(r => r.id));
        for (const l of trips) if (!remoteIds.has(l.id)) toPush.push(l);
        trips = [...map.values()];
        save(KEY, trips);
        if (toPush.length && !Store.isGuest()) await Store.call('save', { trips: toPush });
        Store.setSettings({ lastSync: new Date().toISOString() });
        return { pulled: remote.length, pushed: toPush.length };
      } finally {
        Store.syncing = false; listeners.forEach(fn => fn());
      }
    },
  };

  window.TA = window.TA || {};
  TA.store = Store;
})();
