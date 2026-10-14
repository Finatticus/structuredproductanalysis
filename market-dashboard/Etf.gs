/**
 * ETF 專區 — 後端（在 Apps Script 新增指令碼檔「Etf」貼上）
 * 依賴 Code.gs（fetch_、fetchAll_、ss_、UA、round_）、Macro.gs（get_、okText_、yahooSession_）
 *
 * 資料：
 *  - 證交所 MIS ETF 即時資料（all_etf.txt）：成交價、預估淨值、折溢價、受益權單位數與當日增減
 *  - Yahoo Finance：成分股與權重、產業權重、規模、費用率、配息、還原權息價格
 *  - 每次讀取時把「受益權單位數／淨值」與「前十大持股」快照存在隱藏工作頁 _etf，用來計算 5／20 日資金流與持股變化
 */
const ETF_SHEET = '_etf';
const ETF_TTL = { tw: 120, high: 21600, us: 600 };

/** 高股息 ETF 比較清單（不存在的代號會自動略過） */
const HIGH_DIV_ETFS = ['0056', '00878', '00919', '00929', '00713', '00915', '00918', '00934', '00939', '00940', '00701', '00731'];

/** 美股主要 ETF */
const US_ETFS = [
  ['SPY', 'S&P 500'], ['VOO', 'S&P 500（Vanguard）'], ['IVV', 'S&P 500（iShares）'], ['VTI', '美國全市場'], ['QQQ', '那斯達克 100'],
  ['DIA', '道瓊工業'], ['IWM', '羅素 2000'], ['SMH', '半導體'], ['SOXX', '半導體（iShares）'], ['XLK', '科技類股'],
  ['XLF', '金融類股'], ['XLE', '能源類股'], ['XLV', '醫療保健'], ['ARKK', 'ARK 創新'], ['TLT', '20 年以上美債'],
  ['IEF', '7–10 年美債'], ['SHY', '1–3 年美債'], ['LQD', '投資級公司債'], ['HYG', '高收益債'], ['GLD', '黃金'],
  ['SLV', '白銀'], ['USO', '原油'], ['VNQ', '不動產 REITs'], ['EEM', '新興市場'], ['EFA', '已開發市場（美國以外）'],
  ['VXUS', '美國以外全球'], ['IBIT', '比特幣現貨'], ['TQQQ', '那斯達克 3 倍'], ['SQQQ', '那斯達克 −3 倍'], ['SCHD', '美股高股息'],
];

function etf_(part, code, force) {
  if (part === 'detail') return etfDetail_(String(code || '').trim().toUpperCase());
  const fn = { tw: etfTw_, high: etfHigh_, us: etfUs_ }[part];
  if (!fn) throw new Error('未知的 ETF 區塊：' + part);
  const cache = CacheService.getScriptCache();
  const key = 'etf_' + part;
  const hit = cache.get(key);
  if (hit) {
    const old = JSON.parse(hit);
    if (!force || Date.now() - old.updated < 30000) return old;
  }
  const data = fn();
  data.updated = Date.now();
  try { cache.put(key, JSON.stringify(data), ETF_TTL[part]); } catch (e) { /* 太大不快取 */ }
  return data;
}

/* ======================== 快照儲存 ======================== */
function etfSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(ETF_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ETF_SHEET);
    sh.getRange('A:A').setNumberFormat('@');
    sh.hideSheet();
  }
  return sh;
}

function etfStoreAll_() {
  const sh = etfSheet_();
  const n = sh.getLastRow();
  const out = {};
  if (n) sh.getRange(1, 1, n, 2).getValues().forEach(function (r, i) { out[r[0]] = { row: i + 1, v: r[1] }; });
  return { sh: sh, map: out };
}

function etfPut_(store, key, value) {
  const s = JSON.stringify(value);
  if (store.map[key]) store.sh.getRange(store.map[key].row, 2).setValue(s);
  else {
    store.sh.appendRow([key, s]);
    store.map[key] = { row: store.sh.getLastRow(), v: s };
  }
}

/** 依日期排序的快照：kind = U（台股單位數）、S（美股單位數） */
function etfSnapshots_(store, kind) {
  return Object.keys(store.map).filter(function (k) { return k.indexOf(kind + '|') === 0; }).sort()
    .map(function (k) { return { d: k.slice(2), v: JSON.parse(store.map[k].v) }; });
}

/** 只保留最近 keep 筆快照（預設 70），避免工作頁無限變大 */
function etfPrune_(store, kind, keep) {
  const keys = Object.keys(store.map).filter(function (k) { return k.indexOf(kind + '|') === 0; }).sort();
  const extra = keys.slice(0, Math.max(0, keys.length - (keep || 70))).map(function (k) { return store.map[k].row; }).sort(function (a, b) { return b - a; });
  if (!extra.length) return;
  extra.forEach(function (r) { store.sh.deleteRow(r); });
  store.map = etfStoreAll_().map; // 刪列後列號會位移，重新讀取
}

/* ======================== 台股 ETF 總覽 ======================== */
function etfMisAll_() {
  const res = fetch_('https://mis.twse.com.tw/stock/data/all_etf.txt?' + Date.now(),
    { muteHttpExceptions: true, headers: { 'User-Agent': UA, Referer: 'https://mis.twse.com.tw/stock/etf_nav.jsp' } });
  const j = JSON.parse(okText_(res) || '{}');
  const rows = [];
  (j.a1 || []).forEach(function (g) {
    (g.msgArray || []).forEach(function (x) {
      const n = function (v) { const f = parseFloat(String(v).replace(/,/g, '')); return isFinite(f) ? f : null; };
      rows.push({
        code: String(x.a).trim(), name: String(x.b).replace(/\(.*$/, '').replace(/（.*$/, '').trim(),
        units: n(x.c), dUnits: n(x.d), price: n(x.e), nav: n(x.f), prem: n(x.g), prevNav: n(x.h),
        date: String(x.i || ''), time: String(x.j || ''),
      });
    });
  });
  if (!rows.length) throw new Error('證交所 ETF 資料暫時無法取得');
  return rows;
}

function etfType_(code) {
  const s = code.slice(-1);
  return { B: '債券', L: '槓桿', R: '反向', U: '期貨／商品', A: '主動式', K: '國外', T: '國外' }[s] || '股票';
}

function etfTw_() {
  const rows = etfMisAll_();
  const date = rows.reduce(function (m, r) { return r.date > m ? r.date : m; }, '');
  const ds = date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6, 8);
  // 單位數快照：同一天覆寫（盤中與收盤後的單位數相同，存最新即可）
  const store = etfStoreAll_();
  const snap = {};
  rows.forEach(function (r) { if (r.units != null) snap[r.code] = [r.units, r.nav || r.prevNav]; });
  etfPut_(store, 'U|' + ds, snap);
  etfPrune_(store, 'U');
  const hist = etfSnapshots_(store, 'U');
  const back = function (k) { return hist.length > k ? hist[hist.length - 1 - k].v : null; };
  const h5 = back(5), h20 = back(20);
  const flow = function (r, h) {
    if (!h || !h[r.code] || r.units == null) return null;
    const nav = r.nav || r.prevNav;
    return nav ? Math.round((r.units - h[r.code][0]) * nav / 1e6) / 100 : null; // 億元
  };
  return {
    date: ds, snapDays: hist.length,
    rows: rows.map(function (r) {
      const nav = r.nav || r.prevNav;
      return [r.code, r.name, etfType_(r.code), r.price, r.nav, r.prem,
        r.units != null && nav ? Math.round(r.units * nav / 1e6) / 100 : null,           // 規模（億）
        r.dUnits != null && nav ? Math.round(r.dUnits * nav / 1e6) / 100 : null,         // 今日申贖（億）
        flow(r, h5), flow(r, h20), r.units, r.time];
    }),
    fields: ['code', 'name', 'type', 'price', 'nav', 'prem', 'aum', 'flow1', 'flow5', 'flow20', 'units', 'time'],
  };
}

/* ======================== Yahoo 工具 ======================== */
function etfYsym_(code) {
  if (/^\d{4,6}[A-Z]?$/.test(code)) return null; // 台股另外判斷上市／上櫃
  return code;
}

function etfQuoteSummary_(ysym, modules) {
  return yahooSummary_(ysym, modules); // Research.gs
}

/** 近 N 年日線（含還原權息收盤與配息事件） */
function etfChart_(ysym, range) {
  const res = fetch_('https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ysym) + '?range=' + (range || '2y') + '&interval=1d&events=div',
    { muteHttpExceptions: true, headers: { 'User-Agent': UA } });
  const r = JSON.parse(okText_(res) || '{}').chart.result[0];
  const q = r.indicators.quote[0], adj = (r.indicators.adjclose && r.indicators.adjclose[0].adjclose) || q.close;
  const off = r.meta.gmtoffset || 0;
  const t = [], c = [], a = [];
  (r.timestamp || []).forEach(function (ts, i) {
    if (q.close[i] == null) return;
    t.push(Utilities.formatDate(new Date((ts + off) * 1000), 'UTC', 'yyyy-MM-dd'));
    c.push(round_(q.close[i]));
    a.push(round_(adj[i] != null ? adj[i] : q.close[i]));
  });
  const dv = (r.events && r.events.dividends) || {};
  const divs = Object.keys(dv).map(function (k) {
    return [Utilities.formatDate(new Date((dv[k].date + off) * 1000), 'UTC', 'yyyy-MM-dd'), round_(dv[k].amount)];
  }).sort(function (x, y) { return x[0] < y[0] ? -1 : 1; });
  return { t: t, c: c, a: a, divs: divs, name: r.meta.shortName || r.meta.longName || ysym, currency: r.meta.currency };
}

/** 報酬（價格與含息）、近 12 個月配息、殖利率 */
function etfReturns_(ch) {
  const n = ch.c.length;
  const back = function (arr, k) { return n > k ? arr[n - 1 - k] : null; };
  const pct = function (a, b) { return a != null && b ? Math.round((a / b - 1) * 10000) / 100 : null; };
  const lastDay = ch.t[n - 1];
  const yearAgo = Utilities.formatDate(new Date(Date.parse(lastDay) - 365 * 86400000), 'UTC', 'yyyy-MM-dd');
  const d12 = ch.divs.filter(function (d) { return d[0] > yearAgo; });
  const sum12 = d12.reduce(function (s, d) { return s + d[1]; }, 0);
  return {
    price: ch.c[n - 1], r1m: pct(ch.c[n - 1], back(ch.c, 21)), r1y: pct(ch.c[n - 1], back(ch.c, 250)),
    tr1y: pct(ch.a[n - 1], back(ch.a, 250)), tr3m: pct(ch.a[n - 1], back(ch.a, 63)),
    div12: Math.round(sum12 * 10000) / 10000, divN: d12.length, yld: ch.c[n - 1] ? Math.round(sum12 / ch.c[n - 1] * 10000) / 100 : null,
    lastDiv: ch.divs.length ? ch.divs[ch.divs.length - 1] : null,
  };
}

/* ======================== 完整持股與股數（MoneyDJ） ======================== */
// 台股 ETF：投信每日公告的全部持股與股數（資料日通常是前一個交易日）；美股 ETF：每月更新一次
// 來源沒有歷史查詢，所以每次查詢與每日排程（setupEtf）都存一筆快照在 _etf（P|代號|日期），用來算 1／5 個交易日增減
const ETF_HOLD_KEEP = 12;          // 每檔保留最近 12 筆持股快照
const ETF_TRACK_MAX = 40;          // 每日排程最多追蹤幾檔
const ETF_TRACK_DAYS = 60;         // 超過 60 天沒人查詢的 ETF 不再追蹤
const ETF_TRACK_DEFAULT = ['0050', '0056', '00878', '00919', '00929', '006208'];

function etfFullHoldings_(code, isTw) {
  const url = 'https://www.moneydj.com/ETF/X/Basic/Basic0007B.xdjhtm?etfid=' + encodeURIComponent(isTw ? code + '.TW' : code);
  const html = okText_(fetch_(url, { muteHttpExceptions: true, headers: { 'User-Agent': UA } }));
  if (!html) return null;
  const dm = html.match(/資料日期[：:]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!dm) return null;
  const date = dm[1] + '-' + ('0' + dm[2]).slice(-2) + '-' + ('0' + dm[3]).slice(-2);
  const rows = [];
  const re = /<td class="col05">([\s\S]*?)<\/td>\s*<td class="col06">([\s\S]*?)<\/td>\s*<td class="col07">([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html))) {
    const label = decodeHtml_(m[1].replace(/<[^>]*>/g, ''));
    const pm = label.match(/^(.*)\(([^()]+)\)\s*$/);
    const name = pm ? pm[1].trim() : label;
    const sym = pm ? pm[2].replace(/\.(TW|TWO|US)$/i, '') : label; // 債券、期貨等沒有代號，以名稱識別
    const w = parseFloat(m[2].replace(/,/g, ''));
    const sh = parseFloat(m[3].replace(/,/g, ''));
    rows.push([sym, name, isFinite(w) ? w : null, isFinite(sh) ? sh : null]); // 代號、名稱、權重%、持有股數（期貨為口數）
  }
  return rows.length ? { date: date, rows: rows } : null;
}

/** 抓一次並存成快照（同一資料日不重複存） */
function etfHoldSnap_(store, code, isTw) {
  const full = etfFullHoldings_(code, isTw);
  if (!full) return null;
  const k = 'P|' + code + '|' + full.date;
  if (!store.map[k]) {
    // 只在寫入工作頁時上鎖（抓網頁時不鎖，fetch_ 的計數也會用到同一把鎖）
    const lock = LockService.getScriptLock();
    const locked = lock.tryLock(10000);
    try {
      store.map = etfStoreAll_().map; // 其他執行可能剛寫入，重新讀取列號
      if (!store.map[k]) {
        try { etfPut_(store, k, full.rows); } catch (e) { /* 單格超過 5 萬字（極大型 ETF）就不存 */ }
        etfPrune_(store, 'P|' + code, ETF_HOLD_KEEP);
      }
    } finally {
      if (locked) lock.releaseLock();
    }
  }
  return full;
}

/**
 * 與 1／5 個交易日前的快照比較。tdays = 交易日清單（升冪，台股用 Yahoo 日線日期）；
 * 美股（月資料）傳 null，改成與前一筆快照比較。剛好那天沒有快照時，用更早最近的一筆並標示實際日期。
 */
function etfHoldDiff_(store, code, full, tdays) {
  const snaps = etfSnapshots_(store, 'P|' + code)
    .map(function (s) { return { d: s.d.slice(code.length + 1), v: s.v }; })
    .filter(function (s) { return s.d < full.date; });
  if (!snaps.length) return { snaps: 0, cmp: [] };
  const target = function (k) {
    let i = tdays.length - 1;
    while (i >= 0 && tdays[i] > full.date) i--;
    if (i < 0) return null;
    if (tdays[i] !== full.date) i++; // 資料日不在清單中：從下一格起算
    return i - k >= 0 ? tdays[i - k] : null;
  };
  const diff = function (base) {
    const now = {}, old = {};
    full.rows.forEach(function (r) { now[r[0]] = r; });
    base.v.forEach(function (r) { old[r[0]] = r; });
    const out = [];
    Object.keys(Object.assign({}, old, now)).forEach(function (sym) {
      const a = old[sym], b = now[sym];
      const sa = a ? a[3] || 0 : 0, sb = b ? b[3] || 0 : 0;
      if (sa === sb) return;
      // 代號、名稱、股數增減、原股數（新進為 null）、新權重（移出為 null）、原權重
      out.push([sym, (b || a)[1], sb - sa, a ? sa : null, b ? b[2] : null, a ? a[2] : null]);
    });
    return out;
  };
  const cmp = [], seen = {};
  if (!tdays || !tdays.length) {
    const base = snaps[snaps.length - 1];
    cmp.push({ k: 0, label: '上次公布', want: null, date: base.d, exact: true, rows: diff(base) });
  } else {
    [[1, '前 1 個交易日'], [5, '前 5 個交易日']].forEach(function (kv) {
      const t = target(kv[0]);
      if (!t) return;
      const older = snaps.filter(function (s) { return s.d <= t; });
      const base = older.length ? older[older.length - 1] : null;
      if (!base || seen[base.d]) return;
      seen[base.d] = 1;
      cmp.push({ k: kv[0], label: kv[1], want: t, date: base.d, exact: base.d === t, rows: diff(base) });
    });
  }
  return { snaps: snaps.length, cmp: cmp };
}

/** 記錄查詢過的 ETF，給每日排程追蹤 */
function etfTrack_(code) {
  try {
    const props = PropertiesService.getScriptProperties();
    const t = JSON.parse(props.getProperty('etfTrack') || '{}');
    t[code] = Date.now();
    props.setProperty('etfTrack', JSON.stringify(t));
  } catch (e) { /* ignore */ }
}

/** 每日排程：替追蹤中的 ETF 存持股快照（沒人開網頁也會累積，1／5 日增減才算得出來） */
function etfHoldDaily() {
  const props = PropertiesService.getScriptProperties();
  let t = {};
  try { t = JSON.parse(props.getProperty('etfTrack') || '{}'); } catch (e) { t = {}; }
  const cut = Date.now() - ETF_TRACK_DAYS * 86400000;
  Object.keys(t).forEach(function (c) { if (t[c] < cut) delete t[c]; });
  props.setProperty('etfTrack', JSON.stringify(t));
  const list = ETF_TRACK_DEFAULT.concat(Object.keys(t).sort(function (a, b) { return t[b] - t[a]; }))
    .filter(function (c, i, a) { return a.indexOf(c) === i; }).slice(0, ETF_TRACK_MAX);
  const store = etfStoreAll_();
  list.forEach(function (c) {
    try { etfHoldSnap_(store, c, /^\d{4,6}[A-Z]?$/.test(c)); } catch (e) { /* 單檔失敗略過 */ }
  });
}

/** 在編輯器執行一次：建立每日持股快照排程（台北 09 點與 21 點各一次，資料日相同不會重複存） */
function setupEtf() {
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'etfHoldDaily') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('etfHoldDaily').timeBased().everyDays(1).atHour(9).inTimezone('Asia/Taipei').create();
  ScriptApp.newTrigger('etfHoldDaily').timeBased().everyDays(1).atHour(21).inTimezone('Asia/Taipei').create();
  etfHoldDaily();
}

/* ======================== 個別 ETF ======================== */
function etfDetail_(code) {
  if (!code) throw new Error('請輸入 ETF 代號');
  const isTw = /^\d{4,6}[A-Z]?$/.test(code);
  let ysym = code, misRow = null;
  if (isTw) {
    const all = etfMisAll_();
    misRow = all.filter(function (r) { return r.code === code; })[0];
    if (!misRow) throw new Error('證交所查無此 ETF：' + code);
    // 先試 .TW，沒有資料再試 .TWO
    ysym = code + '.TW';
  }
  let ch;
  try { ch = etfChart_(ysym, '3y'); } catch (e) { if (isTw) { ysym = code + '.TWO'; ch = etfChart_(ysym, '3y'); } else throw e; }
  const qs = etfQuoteSummary_(ysym, 'topHoldings,fundProfile,summaryDetail,defaultKeyStatistics,price');
  const th = qs.topHoldings || {}, sd = qs.summaryDetail || {}, ks = qs.defaultKeyStatistics || {}, fp = qs.fundProfile || {};
  const holdings = (th.holdings || []).map(function (h) { return [h.symbol, h.holdingName, raw_(h, 'holdingPercent')]; });
  // 台股成分股：向證交所查中文簡稱（Yahoo 只有英文名）
  const twCodes = holdings.map(function (h) { const m = String(h[0]).match(/^(\d{4,6}[A-Z]?)\.TWO?$/); return m ? m[1] : null; }).filter(function (c) { return c; });
  if (twCodes.length) {
    try {
      const ex = twCodes.map(function (c) { return 'tse_' + c.toLowerCase() + '.tw|otc_' + c.toLowerCase() + '.tw'; }).join('|');
      const j = JSON.parse(okText_(fetch_('https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&ex_ch=' + encodeURIComponent(ex),
        { muteHttpExceptions: true, headers: { 'User-Agent': UA, Referer: 'https://mis.twse.com.tw/stock/index.jsp' } })) || '{}');
      const zh = {};
      (j.msgArray || []).forEach(function (x) { if (x.c && x.n) zh[x.c] = x.n; });
      holdings.forEach(function (h) { const c = String(h[0]).replace(/\.TWO?$/, ''); if (zh[c]) h[1] = zh[c]; });
    } catch (e) { /* 保留英文名稱 */ }
  }
  const sectors = (th.sectorWeightings || []).map(function (o) { const k = Object.keys(o)[0]; return [k, raw_(o, k)]; })
    .filter(function (x) { return x[1] > 0; }).sort(function (a, b) { return b[1] - a[1]; });

  // 完整持股與股數（MoneyDJ）＋ 1／5 個交易日前的增減
  const store = etfStoreAll_();
  let hold = null;
  try {
    const full = etfHoldSnap_(store, code, isTw);
    if (full) {
      const dif = etfHoldDiff_(store, code, full, isTw ? ch.t : null);
      hold = { date: full.date, rows: full.rows, snaps: dif.snaps, cmp: dif.cmp, monthly: !isTw };
    }
  } catch (e) {
    hold = { err: String((e && e.message) || e) };
  }
  etfTrack_(code);

  // 持股變化：和上次記錄的前十大比較
  const hk = 'H|' + code;
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  let hs = store.map[hk] ? JSON.parse(store.map[hk].v) : {};
  const sig = JSON.stringify(holdings.map(function (h) { return [h[0], Math.round((h[2] || 0) * 10000)]; }));
  if (holdings.length && (!hs.cur || hs.cur.sig !== sig)) {
    hs = { prev: hs.cur && hs.cur.d !== today ? hs.cur : hs.prev, cur: { d: today, sig: sig, h: holdings.map(function (h) { return [h[0], h[1], h[2]]; }) } };
    etfPut_(store, hk, hs);
  }

  // 規模與單位數歷史（台股）
  let unitsHist = [];
  if (isTw) {
    unitsHist = etfSnapshots_(store, 'U').map(function (s) {
      const v = s.v[code];
      return v ? [s.d, v[0], v[1]] : null;
    }).filter(function (x) { return x; });
  }
  const fee = (fp.feesExpensesInvestment && raw_(fp.feesExpensesInvestment, 'annualReportExpenseRatio')) || raw_(ks, 'annualReportExpenseRatio');
  return {
    code: code, ysym: ysym, tw: isTw, name: isTw ? misRow.name : (qs.price && (qs.price.shortName || qs.price.longName)) || ch.name,
    currency: ch.currency, family: fp.family || null, category: fp.categoryName || null, type: isTw ? etfType_(code) : null,
    mis: misRow, aum: raw_(sd, 'totalAssets'), fee: fee, yahooYield: raw_(sd, 'yield'), nav: raw_(sd, 'navPrice'),
    holdings: holdings, sectors: sectors, holdPrev: hs.prev || null, holdCurDate: hs.cur ? hs.cur.d : null,
    ret: etfReturns_(ch), chart: { t: ch.t, c: ch.c, a: ch.a }, divs: ch.divs.slice(-24).reverse(), unitsHist: unitsHist,
    hold: hold,
  };
}

/* ======================== 高股息 ETF 比較 ======================== */
function etfHigh_() {
  const all = etfMisAll_();
  const byCode = {};
  all.forEach(function (r) { byCode[r.code] = r; });
  const list = HIGH_DIV_ETFS.filter(function (c) { return byCode[c]; });
  const charts = {};
  const res = fetchAll_(list.map(function (c) {
    return get_('https://query2.finance.yahoo.com/v8/finance/chart/' + c + '.TW?range=2y&interval=1d&events=div');
  }));
  res.forEach(function (r, i) {
    try {
      const x = JSON.parse(okText_(r)).chart.result[0];
      const q = x.indicators.quote[0], adj = (x.indicators.adjclose && x.indicators.adjclose[0].adjclose) || q.close;
      const off = x.meta.gmtoffset || 0, t = [], c = [], a = [];
      x.timestamp.forEach(function (ts, k) {
        if (q.close[k] == null) return;
        t.push(Utilities.formatDate(new Date((ts + off) * 1000), 'UTC', 'yyyy-MM-dd'));
        c.push(q.close[k]); a.push(adj[k] != null ? adj[k] : q.close[k]);
      });
      const dv = (x.events && x.events.dividends) || {};
      const divs = Object.keys(dv).map(function (k) { return [Utilities.formatDate(new Date((dv[k].date + off) * 1000), 'UTC', 'yyyy-MM-dd'), dv[k].amount]; })
        .sort(function (p, q2) { return p[0] < q2[0] ? -1 : 1; });
      charts[list[i]] = etfReturns_({ t: t, c: c, a: a, divs: divs });
    } catch (e) { /* 單檔失敗略過 */ }
  });
  // 費用率（每檔一次 quoteSummary）
  const fees = {};
  try {
    const sess = yahooSession_(false);
    fetchAll_(list.map(function (c) {
      return {
        url: 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/' + c + '.TW?modules=fundProfile,summaryDetail&crumb=' + encodeURIComponent(sess.crumb),
        muteHttpExceptions: true, headers: { 'User-Agent': UA, Cookie: sess.cookie },
      };
    })).forEach(function (r, i) {
      try {
        const q = JSON.parse(okText_(r)).quoteSummary.result[0];
        const fp = q.fundProfile || {};
        fees[list[i]] = { fee: fp.feesExpensesInvestment ? raw_(fp.feesExpensesInvestment, 'annualReportExpenseRatio') : null, family: fp.family || null };
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* 費用率非必要 */ }
  return {
    rows: list.map(function (c) {
      const m = byCode[c], ch = charts[c] || {}, f = fees[c] || {};
      const nav = m.nav || m.prevNav;
      return {
        code: c, name: m.name, price: m.price || ch.price, nav: m.nav, prem: m.prem, aum: m.units && nav ? Math.round(m.units * nav / 1e6) / 100 : null,
        flow1: m.dUnits != null && nav ? Math.round(m.dUnits * nav / 1e6) / 100 : null,
        div12: ch.div12, divN: ch.divN, yld: ch.yld, lastDiv: ch.lastDiv, r1y: ch.r1y, tr1y: ch.tr1y, tr3m: ch.tr3m, fee: f.fee, family: f.family,
      };
    }),
  };
}

/* ======================== 美股 ETF ======================== */
function etfUs_() {
  const syms = US_ETFS.map(function (x) { return x[0]; });
  const sess = yahooSession_(false);
  const qres = fetch_('https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + syms.join(',') +
    '&fields=regularMarketPrice,regularMarketChangePercent,sharesOutstanding,netAssets,navPrice,ytdReturn,fiftyTwoWeekHigh,fiftyTwoWeekLow&crumb=' + encodeURIComponent(sess.crumb),
    { muteHttpExceptions: true, headers: { 'User-Agent': UA, Cookie: sess.cookie } });
  const q = {};
  try { JSON.parse(okText_(qres)).quoteResponse.result.forEach(function (x) { q[x.symbol] = x; }); } catch (e) { /* ignore */ }
  const perf = sparkPerf_(syms); // Macro.gs：1D／1W／1M／3M／YTD

  // 流通單位數快照 → 估算資金流（單位數變化 × 淨值）
  const store = etfStoreAll_();
  const ds = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  const snap = {};
  syms.forEach(function (s) { const x = q[s]; if (x && x.sharesOutstanding) snap[s] = [x.sharesOutstanding, x.navPrice || x.regularMarketPrice]; });
  if (Object.keys(snap).length) { etfPut_(store, 'S|' + ds, snap); etfPrune_(store, 'S'); }
  const hist = etfSnapshots_(store, 'S');
  const flowK = function (s, k) {
    if (hist.length <= k || !snap[s]) return null;
    const old = hist[hist.length - 1 - k].v[s];
    return old ? Math.round((snap[s][0] - old[0]) * snap[s][1] / 1e6) : null; // 百萬美元
  };
  return {
    snapDays: hist.length, date: ds,
    rows: US_ETFS.map(function (x) {
      const s = x[0], o = q[s] || {}, p = perf[s] || {};
      return {
        sym: s, name: x[1], price: o.regularMarketPrice || p.price, d1: o.regularMarketChangePercent != null ? Math.round(o.regularMarketChangePercent * 100) / 100 : p.d1,
        w1: p.w1, m1: p.m1, m3: p.m3, ytd: p.ytd, aum: o.netAssets || null, shares: o.sharesOutstanding || null,
        f1: flowK(s, 1), f5: flowK(s, 5), f20: flowK(s, 20), spark: p.spark,
      };
    }),
  };
}

/* ======================== 回測用價格 ======================== */
/** 解析代號（台股／美股／其他）並回傳近 N 年日線、還原權息價與配息 */
function bars_(raw, years) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s) throw new Error('請輸入代號');
  let r, cat;
  if (/^\d{4,6}[A-Z]?$/.test(s)) { r = resolveSymbol_('tw', s); cat = 'tw'; }
  else { r = resolveSymbol_('global', s); cat = 'global'; }
  const ysym = toYahoo_(r.source);
  const res = fetch_('https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ysym) + '?range=' + (years || 10) + 'y&interval=1d&events=div',
    { muteHttpExceptions: true, headers: { 'User-Agent': UA } });
  const j = JSON.parse(okText_(res) || '{}');
  const x = j.chart && j.chart.result && j.chart.result[0];
  if (!x || !x.timestamp) throw new Error('查無歷史資料：' + s);
  const q = x.indicators.quote[0], adj = (x.indicators.adjclose && x.indicators.adjclose[0].adjclose) || q.close;
  const off = x.meta.gmtoffset || 0;
  const out = { code: r.symbol, cat: cat, name: r.name || x.meta.shortName || r.symbol, ysym: ysym, currency: x.meta.currency, t: [], o: [], h: [], l: [], c: [], v: [], a: [] };
  const seen = {};
  x.timestamp.forEach(function (ts, i) {
    if (q.close[i] == null || q.open[i] == null) return;
    const d = Utilities.formatDate(new Date((ts + off) * 1000), 'UTC', 'yyyy-MM-dd');
    if (seen[d] != null) { const k = seen[d]; out.c[k] = round_(q.close[i]); out.a[k] = round_(adj[i]); return; }
    seen[d] = out.t.length;
    out.t.push(d); out.o.push(round_(q.open[i])); out.h.push(round_(q.high[i] != null ? q.high[i] : q.close[i]));
    out.l.push(round_(q.low[i] != null ? q.low[i] : q.close[i])); out.c.push(round_(q.close[i]));
    out.v.push(q.volume[i] || 0); out.a.push(round_(adj[i] != null ? adj[i] : q.close[i]));
  });
  const dv = (x.events && x.events.dividends) || {};
  out.divs = Object.keys(dv).map(function (k) { return [Utilities.formatDate(new Date((dv[k].date + off) * 1000), 'UTC', 'yyyy-MM-dd'), round_(dv[k].amount)]; })
    .sort(function (p, q2) { return p[0] < q2[0] ? -1 : 1; });
  out.etf = cat === 'tw' && /^00/.test(r.symbol);
  return out;
}
