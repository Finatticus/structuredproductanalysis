/* =========================================================
 * 瀏覽器資料引擎（Web Worker）
 * 在瀏覽器背景執行緒載入「同一份」後端程式（Code.gs、Macro.gs、Calendar.gs、Futures.gs），把 Google 專屬服務換成瀏覽器版本：
 *  - UrlFetchApp：同步 XHR，一律經資料中繼站（Cloudflare Worker）→ 不經 Google、不吃 Google 額度、不會被擋
 *  - CacheService：記憶體（本分頁有效）；PropertiesService：由主執行緒存在 localStorage
 *  - Utilities：日期格式、時區換算、CSV 解析等
 * 計算邏輯只有一份，前後端結果一致；試算表相關功能（自選清單、持股）由主執行緒提供資料。
 * 由 engine.js 建立與呼叫，不要直接在頁面載入。
 * ========================================================= */
const ENGINE_FILES = ['Code.gs', 'Macro.gs', 'Calendar.gs', 'Futures.gs'];
const CTX = { proxy: null, props: {}, watchlist: [], txns: [], prefetched: {} };

/* ---------- CacheService（記憶體） ---------- */
const MEM = new Map();
const cacheObj = {
  get(k) { const e = MEM.get(k); if (!e) return null; if (e.exp < Date.now()) { MEM.delete(k); return null; } return e.v; },
  put(k, v, ttl) { MEM.set(k, { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }); },
  putAll(o, ttl) { Object.keys(o).forEach(k => this.put(k, o[k], ttl)); },
  getAll(keys) { const r = {}; keys.forEach(k => { const v = this.get(k); if (v != null) r[k] = v; }); return r; },
  remove(k) { MEM.delete(k); },
  removeAll(keys) { keys.forEach(k => MEM.delete(k)); },
};
self.CacheService = { getScriptCache: () => cacheObj };

/* ---------- PropertiesService（主執行緒存在 localStorage） ---------- */
self.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (k in CTX.props ? CTX.props[k] : null),
    setProperty: (k, v) => { CTX.props[k] = String(v); },
    deleteProperty: k => { delete CTX.props[k]; },
    getKeys: () => Object.keys(CTX.props),
    getProperties: () => Object.assign({}, CTX.props),
  }),
};

/* ---------- 其他服務 ---------- */
const LOCK = { tryLock: () => true, waitLock: () => true, releaseLock() {}, hasLock: () => true };
self.LockService = { getScriptLock: () => LOCK, getDocumentLock: () => LOCK };
self.ScriptApp = { getProjectTriggers: () => [] };
self.Logger = { log: () => {} };
self.SpreadsheetApp = {
  getActiveSpreadsheet() { throw new Error('瀏覽器引擎無法使用試算表'); },
  openById() { throw new Error('瀏覽器引擎無法使用試算表'); },
};
self.ContentService = { createTextOutput: t => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } };

/* ---------- Utilities ---------- */
const DTF = {};
function tzParts(date, tz) {
  const f = DTF[tz] || (DTF[tz] = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }));
  const o = {};
  f.formatToParts(date).forEach(p => { o[p.type] = p.value; });
  if (o.hour === '24') o.hour = '00';
  return o;
}
/** 當地時間（tz）的年月日時分 → 毫秒 */
function zonedToMs(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = tzParts(new Date(t), tz);
    const asTz = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    t = guess - (asTz - t);
  }
  return t;
}
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

self.Utilities = {
  formatDate(date, tz, fmt) {
    const p = tzParts(date, tz || 'UTC');
    return fmt.replace(/yyyy|MM|dd|HH|H|mm|ss/g, t => ({
      yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, H: String(+p.hour), mm: p.minute, ss: p.second,
    })[t]);
  },
  parseDate(str, tz, fmt) {
    let m;
    if (fmt === 'yyyy-MM-dd HH:mm' && (m = String(str).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})/))) {
      return new Date(zonedToMs(+m[1], +m[2], +m[3], +m[4], +m[5], tz));
    }
    if (fmt === 'MMMM d, yyyy h:mm a' && (m = String(str).match(/^([A-Za-z]+) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) ([ap]m)$/i))) {
      let h = +m[4] % 12;
      if (/pm/i.test(m[6])) h += 12;
      return new Date(zonedToMs(+m[3], MONTHS[m[1].toLowerCase()], +m[2], h, +m[5], tz));
    }
    throw new Error('parseDate 不支援的格式：' + fmt);
  },
  parseCsv(text) {
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  },
  sleep() { /* 經中繼站且有斷路器，不需要刻意等待 */ },
  getUuid: () => (self.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
  unzip() { throw new Error('瀏覽器引擎不支援解壓縮'); },
  computeDigest() { throw new Error('瀏覽器引擎不支援'); },
  DigestAlgorithm: {}, Charset: {},
};

/* ---------- UrlFetchApp：同步 XHR 經中繼站 ---------- */
function proxied(u) {
  return CTX.proxy.url + '/?key=' + encodeURIComponent(CTX.proxy.key || '') + '&url=' + encodeURIComponent(u);
}
// 允許瀏覽器跨站讀取（CORS）的網站：用使用者自己的網路直接連，比繞中繼站快，也不會被當成資料中心流量限流
// （實測證交所網站從台灣直連 0.04–1 秒、經 Cloudflare 曾達 19 秒）
const DIRECT_HOSTS = ['www.twse.com.tw', 'api.alternative.me', 'publicreporting.cftc.gov'];
function hostName(u) { const m = String(u).match(/^https?:\/\/([^\/?#:]+)/i); return m ? m[1].toLowerCase() : ''; }

function xfetch(url, opt) {
  opt = opt || {};
  const hasCookie = Object.keys(opt.headers || {}).some(k => /^cookie$/i.test(k));
  if (DIRECT_HOSTS.indexOf(hostName(url)) >= 0 && !hasCookie && !CTX.prefetched[url]) {
    try {
      const r = xfetchVia(url, url, opt);
      if (r.getResponseCode() < 500 && r.getResponseCode() !== 403 && r.getResponseCode() !== 429) return r;
    } catch (e) { /* 直連失敗：改經中繼站 */ }
  }
  return xfetchVia(url, null, opt);
}

/** target = null 時經中繼站 */
function xfetchVia(url, target, opt) {
  opt = opt || {};
  // 主執行緒已平行抓好的內容（見 engine.js 的預先抓取）
  const pre = CTX.prefetched[url];
  if (pre) {
    delete CTX.prefetched[url];
    return { getResponseCode: () => pre.status, getContentText: () => pre.text, getAllHeaders: () => ({}), getHeaders: () => ({}), getBlob() { throw new Error('不支援'); } };
  }
  const x = new XMLHttpRequest();
  x.open(String(opt.method || 'GET').toUpperCase(), target || proxied(url), false);
  x.timeout = 15000;
  const h = target ? {} : (opt.headers || {}); // 直連時不加自訂標頭（避免預檢）
  Object.keys(h).forEach(k => {
    if (/^cookie$/i.test(k)) x.setRequestHeader('X-Cookie', h[k]); // 瀏覽器不能帶跨站 Cookie，由中繼站轉成 Cookie
    else if (/^accept$/i.test(k)) x.setRequestHeader('Accept', h[k]);
    // User-Agent、Referer、Origin 由中繼站依網站自動加上
  });
  // 直連失敗不暫停該網站（呼叫端會改經中繼站再試）；經中繼站也失敗才暫停
  try { x.send(opt.payload || null); } catch (e) { if (!target) hostFailed(url); throw new Error('無法開啟網址：' + url); }
  if (x.status === 0) { if (!target) hostFailed(url); throw new Error('無法開啟網址：' + url); }
  const status = x.status, text = x.responseText;
  if (opt.muteHttpExceptions === false && status >= 400) throw new Error('Request failed for ' + url + ' returned code ' + status);
  const xsc = x.getResponseHeader('X-Set-Cookie');
  return {
    getResponseCode: () => status,
    getContentText: () => text,
    getAllHeaders: () => (xsc ? { 'X-Set-Cookie': xsc } : {}),
    getHeaders: () => (xsc ? { 'X-Set-Cookie': xsc } : {}),
    getBlob() { throw new Error('瀏覽器引擎不支援二進位內容'); },
  };
}
/** 網站沒回應：交給後端程式的斷路器暫停它（同一批的其他請求直接跳過，不用每個都等到逾時） */
function hostFailed(url) {
  try { if (typeof markHostDown_ === 'function') markHostDown_(hostOf_(url), '連線逾時或失敗'); } catch (e) { /* ignore */ }
}
function hostIsDown(url) {
  try { return typeof isHostDown_ === 'function' && isHostDown_(hostOf_(url)); } catch (e) { return false; }
}

const FAIL = { getResponseCode: () => 599, getContentText: () => '', getAllHeaders: () => ({}), getHeaders: () => ({}), getBlob: () => null };
self.UrlFetchApp = {
  fetch: xfetch,
  // 同步 XHR 只能逐一送出；單一網址連不上時回傳 599（不中斷整批，避免重抓）
  fetchAll: reqs => reqs.map(r => { if (hostIsDown(r.url)) return FAIL; try { return xfetch(r.url, r); } catch (e) { return FAIL; } }),
};

/* ---------- 載入後端程式（合併成一段執行，常數才能互相看到） ---------- */
let loaded = false;
function load(version) {
  if (loaded) return;
  const src = ENGINE_FILES.map(f => {
    const x = new XMLHttpRequest();
    x.open('GET', f + '?v=' + encodeURIComponent(version || ''), false);
    x.setRequestHeader('Cache-Control', 'no-cache'); // 每次向伺服器確認是否有新版（後端程式更新後立即生效）
    x.send();
    if (x.status !== 200 && x.status !== 0) throw new Error('無法載入 ' + f + '（HTTP ' + x.status + '）');
    return x.responseText;
  }).join('\n;\n');
  // 附加存取器：取得並清空本次的來源紀錄
  (0, eval)(src + '\n;self.__eng = { takeLog: function () { var l = HOST_LOG_; HOST_LOG_ = []; return l; } };');
  // 試算表相關：改用主執行緒提供的資料
  self.getWatchlist_ = () => CTX.watchlist;
  self.pfLoad_ = () => ({ txns: CTX.txns, meta: {} });
  loaded = true;
}

self.onmessage = e => {
  const { id, fn, args, ctx, version } = e.data;
  const t0 = Date.now();
  try {
    if (ctx) {
      if (ctx.proxy) CTX.proxy = ctx.proxy;
      if (ctx.props) CTX.props = Object.assign({}, ctx.props, CTX.props);
      if (ctx.watchlist) CTX.watchlist = ctx.watchlist;
      if (ctx.txns) CTX.txns = ctx.txns;
      CTX.prefetched = ctx.prefetched || {};
    }
    if (!CTX.proxy || !CTX.proxy.url) throw new Error('未設定資料中繼站');
    if (ctx && ctx.prefetched) CTX.prefetched = ctx.prefetched;
    load(version);
    if (typeof self[fn] !== 'function' || !/^(macro_|cal_|calPlan_|fut_)$/.test(fn)) throw new Error('不支援的功能：' + fn);
    const data = JSON.parse(JSON.stringify(self[fn].apply(null, args || [])));
    self.postMessage({ id, ok: true, data, ms: Date.now() - t0, log: self.__eng.takeLog(), props: CTX.props });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err), ms: Date.now() - t0, log: self.__eng ? self.__eng.takeLog() : [], props: CTX.props });
  }
};
