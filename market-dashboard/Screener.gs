/**
 * 選股篩選器 — 後端（在 Apps Script 新增指令碼檔「Screener」貼上）
 *
 * 運作方式：
 *  1. 第一次請在編輯器執行 setupScreener()（會要求授權），它會建立兩個排程：
 *     - screenerBackfill：每 5 分鐘補一段歷史資料（約 250 個交易日），補完自動停止
 *     - screenerDaily：每天 21:40（台北）抓當日全市場快照並重算指標
 *  2. 全市場快照存在試算表「_daily」工作頁（每日每類一列，壓縮後存放）
 *  3. 算好的篩選表存在「_screen」工作頁，網頁篩選時直接讀取，不另外耗用額度
 * 依賴 Code.gs（fetch_、fetchAll_、ss_、UA）、Macro.gs（get_、okText_）
 */

const SCR_DAILY = '_daily';
const SCR_OUT = '_screen';
const SCR_PRICE_DAYS = 250;  // 價量保留交易日數（52 週）
const SCR_FLOW_DAYS = 25;    // 法人、融資保留交易日數
const SCR_TIME_BUDGET = 270000; // 單次執行上限（毫秒），GAS 限制 6 分鐘
const TWSE_PAUSE = 1500;     // 證交所請求間隔，避免被封鎖

/* ======================== 排程 ======================== */
function setupScreener() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (/^screener(Backfill|Daily)$/.test(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('screenerDaily').timeBased().everyDays(1).atHour(21).nearMinute(40).inTimezone('Asia/Taipei').create();
  ScriptApp.newTrigger('screenerBackfill').timeBased().everyMinutes(5).create();
  screenerBackfill();
}

function screenerBackfill() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const done = scrFill_(Date.now());
    screenerCompute_();
    if (done) {
      ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === 'screenerBackfill') ScriptApp.deleteTrigger(t);
      });
    }
  } finally {
    lock.releaseLock();
  }
}

function screenerDaily() {
  const lock = LockService.getScriptLock();
  if (!lock.waitLock(60000)) return;
  try {
    scrFill_(Date.now());
    screenerCompute_();
  } finally {
    lock.releaseLock();
  }
}

/* ======================== 儲存 ======================== */
function scrSheet_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange('A:B').setNumberFormat('@');
    sh.hideSheet();
  }
  return sh;
}

function scrPack_(obj) {
  return Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(obj), 'application/json')).getBytes());
}

function scrUnpack_(s) {
  return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(s), 'application/x-gzip')).getDataAsString());
}

/** 讀取 _daily：{ 'date|kind': row index }；kind = P 價量、I 法人、M 融資、X 非交易日、N 名稱 */
function scrIndex_(sh) {
  const n = sh.getLastRow();
  const idx = {};
  if (!n) return idx;
  sh.getRange(1, 1, n, 2).getValues().forEach(function (r, i) { idx[r[0] + '|' + r[1]] = i + 1; });
  return idx;
}

function scrPut_(sh, idx, date, kind, payload) {
  const k = date + '|' + kind;
  if (idx[k]) sh.getRange(idx[k], 3).setValue(payload);
  else {
    sh.appendRow([date, kind, payload]);
    idx[k] = sh.getLastRow();
  }
}

/* ======================== 抓資料 ======================== */
const SCR_CODE = /^(\d{4}|00\d{2,4}[A-Z]?)$/; // 一般股票與 ETF（排除權證、債券）

function scrNum_(s) {
  const v = parseFloat(String(s).replace(/,/g, ''));
  return isFinite(v) ? v : null;
}

function scrTwse_(url) {
  const res = fetch_(url, { muteHttpExceptions: true, headers: { 'User-Agent': UA } });
  Utilities.sleep(TWSE_PAUSE);
  return JSON.parse(okText_(res) || '{}');
}

/** 價量：{ code: [收, 高, 低, 量(張)] }，names：{ code: 名稱 }；非交易日回傳 null */
function scrFetchP_(ds) {
  const out = {}, names = {};
  const j = scrTwse_('https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=' + ds.replace(/-/g, '') + '&type=ALLBUT0999&response=json');
  const t = (j.tables || []).filter(function (x) { return x.fields && x.fields[0] === '證券代號'; })[0];
  if (!t || !t.data || !t.data.length) return null;
  t.data.forEach(function (r) {
    const c = String(r[0]).trim();
    if (!SCR_CODE.test(c)) return;
    const close = scrNum_(r[8]);
    names[c] = String(r[1]).trim() + '|L';
    if (close) out[c] = [close, scrNum_(r[6]) || close, scrNum_(r[7]) || close, Math.round((scrNum_(r[2]) || 0) / 1000)];
  });
  try {
    const o = JSON.parse(okText_(fetch_('https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=' + ds.replace(/-/g, '%2F') + '&response=json',
      { muteHttpExceptions: true, headers: { 'User-Agent': UA } })));
    ((o.tables && o.tables[0] && o.tables[0].data) || []).forEach(function (r) {
      const c = String(r[0]).trim();
      if (!SCR_CODE.test(c)) return;
      const close = scrNum_(r[2]);
      names[c] = String(r[1]).trim() + '|O';
      if (close) out[c] = [close, scrNum_(r[5]) || close, scrNum_(r[6]) || close, Math.round((scrNum_(r[8]) || 0) / 1000)];
    });
  } catch (e) { /* 上櫃失敗不影響上市 */ }
  return { p: out, names: names };
}

/** 法人：{ code: [外資(張), 投信(張)] } */
function scrFetchI_(ds) {
  const out = {};
  const j = scrTwse_('https://www.twse.com.tw/rwd/zh/fund/T86?date=' + ds.replace(/-/g, '') + '&selectType=ALLBUT0999&response=json');
  (j.stat === 'OK' && j.data || []).forEach(function (r) {
    const c = String(r[0]).trim();
    if (SCR_CODE.test(c)) out[c] = [Math.round(((scrNum_(r[4]) || 0) + (scrNum_(r[7]) || 0)) / 1000), Math.round((scrNum_(r[10]) || 0) / 1000)];
  });
  try {
    const o = JSON.parse(okText_(fetch_('https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?type=Daily&sect=EW&date=' + ds.replace(/-/g, '%2F') + '&response=json',
      { muteHttpExceptions: true, headers: { 'User-Agent': UA } })));
    ((o.tables && o.tables[0] && o.tables[0].data) || []).forEach(function (r) {
      const c = String(r[0]).trim();
      if (SCR_CODE.test(c)) out[c] = [Math.round((scrNum_(r[10]) || 0) / 1000), Math.round((scrNum_(r[13]) || 0) / 1000)];
    });
  } catch (e) { /* ignore */ }
  return Object.keys(out).length ? out : null;
}

/** 融資融券：{ code: [融資餘額(張), 融券餘額(張)] } */
function scrFetchM_(ds) {
  const out = {};
  const j = scrTwse_('https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=' + ds.replace(/-/g, '') + '&selectType=ALL&response=json');
  const t = (j.tables || []).filter(function (x) { return x.fields && x.fields[0] === '代號'; })[0];
  ((t && t.data) || []).forEach(function (r) {
    const c = String(r[0]).trim();
    if (SCR_CODE.test(c)) out[c] = [scrNum_(r[6]) || 0, scrNum_(r[12]) || 0];
  });
  try {
    const o = JSON.parse(okText_(fetch_('https://www.tpex.org.tw/www/zh-tw/margin/balance?date=' + ds.replace(/-/g, '%2F') + '&response=json',
      { muteHttpExceptions: true, headers: { 'User-Agent': UA } })));
    ((o.tables && o.tables[0] && o.tables[0].data) || []).forEach(function (r) {
      const c = String(r[0]).trim();
      if (SCR_CODE.test(c)) out[c] = [scrNum_(r[6]) || 0, scrNum_(r[14]) || 0];
    });
  } catch (e) { /* ignore */ }
  return Object.keys(out).length ? out : null;
}

/**
 * 由新到舊補齊缺少的日資料，時間用完就停；回傳是否已全部補齊。
 * 今天的資料若尚未公布（P/I/M 為空）不會標記為非交易日。
 */
function scrFill_(t0) {
  const sh = scrSheet_(SCR_DAILY);
  const idx = scrIndex_(sh);
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const recent = Utilities.formatDate(new Date(Date.now() - 3 * 86400000), 'Asia/Taipei', 'yyyy-MM-dd');
  const nowH = +Utilities.formatDate(new Date(), 'Asia/Taipei', 'H');
  let trading = 0;
  for (let i = 0; i < 400 && trading < SCR_PRICE_DAYS; i++) {
    const ds = Utilities.formatDate(new Date(Date.now() - i * 86400000), 'Asia/Taipei', 'yyyy-MM-dd');
    const dow = new Date(ds + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6 || idx[ds + '|X']) continue;
    if (ds === today && nowH < 15) continue; // 收盤資料約 14:30 後才有
    if (Date.now() - t0 > SCR_TIME_BUDGET) return false;

    if (!idx[ds + '|P']) {
      const p = scrFetchP_(ds);
      if (!p) {
        if (ds < recent) scrPut_(sh, idx, ds, 'X', '');
        continue;
      }
      scrPut_(sh, idx, ds, 'P', scrPack_(p.p));
      if (!idx['names|N'] || i < 7) scrPut_(sh, idx, 'names', 'N', scrPack_(p.names));
    }
    trading++;
    if (trading <= SCR_FLOW_DAYS) {
      if (!idx[ds + '|I'] && Date.now() - t0 < SCR_TIME_BUDGET) {
        const v = scrFetchI_(ds);
        if (v) scrPut_(sh, idx, ds, 'I', scrPack_(v));
      }
      // 融資約 21:00 公布
      if (!idx[ds + '|M'] && Date.now() - t0 < SCR_TIME_BUDGET && !(ds === today && nowH < 21)) {
        const v = scrFetchM_(ds);
        if (v) scrPut_(sh, idx, ds, 'M', scrPack_(v));
      }
    }
  }
  return true;
}

/* ======================== 計算指標 ======================== */
const SCR_FIELDS = [
  'code', 'name', 'mkt', 'ind', 'etf', 'close', 'r1', 'r5', 'r20', 'r60', 'r120', 'r250', 'vol', 'vol20', 'vr', 'amt',
  'ma5', 'ma10', 'ma20', 'ma60', 'ma120', 'ma240', 'bias20', 'bias60', 'bull', 'bear', 'x520', 'ma60up',
  'hi', 'lo', 'dHi', 'dLo', 'nh', 'nl', 'rsi', 'k', 'd', 'kdx', 'macd', 'macdx', 'hv20',
  'pe', 'pb', 'yld', 'revYoY', 'revMoM', 'revCum', 'revYM',
  'f1', 'f5', 'f20', 'fS', 'it1', 'it5', 'it20', 'itS', 'mb', 'mb5', 'sb', 'sr',
];

function scrRound_(v, d) {
  if (v == null || !isFinite(v)) return null;
  const p = Math.pow(10, d == null ? 2 : d);
  return Math.round(v * p) / p;
}

function screenerCompute_() {
  const sh = scrSheet_(SCR_DAILY);
  const n = sh.getLastRow();
  if (!n) return;
  const rows = sh.getRange(1, 1, n, 3).getValues();
  const byKind = { P: [], I: [], M: [] };
  let names = {};
  rows.forEach(function (r) {
    if (r[1] === 'N') names = scrUnpack_(r[2]);
    else if (byKind[r[1]]) byKind[r[1]].push({ d: String(r[0]), v: r[2] });
  });
  ['P', 'I', 'M'].forEach(function (k) { byKind[k].sort(function (a, b) { return a.d < b.d ? -1 : 1; }); });
  const P = byKind.P.slice(-SCR_PRICE_DAYS).map(function (x) { return { d: x.d, v: scrUnpack_(x.v) }; });
  const I = byKind.I.slice(-SCR_FLOW_DAYS).map(function (x) { return scrUnpack_(x.v); });
  const M = byKind.M.slice(-SCR_FLOW_DAYS).map(function (x) { return scrUnpack_(x.v); });
  if (!P.length) return;
  const latest = P[P.length - 1].v;

  // 基本面（最新）：本益比、淨值比、殖利率、月營收、產業別
  const fund = {}, ind = {};
  const res = fetchAll_([
    get_('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL'),
    get_('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis'),
    get_('https://openapi.twse.com.tw/v1/opendata/t187ap05_L'),
    get_('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O'),
  ]);
  const arr = function (i) { try { return JSON.parse(okText_(res[i])) || []; } catch (e) { return []; } };
  arr(0).forEach(function (x) { fund[x.Code] = { pe: scrNum_(x.PEratio), pb: scrNum_(x.PBratio), yld: scrNum_(x.DividendYield) }; });
  arr(1).forEach(function (x) { fund[x.SecuritiesCompanyCode] = { pe: scrNum_(x.PriceEarningRatio), pb: scrNum_(x.PriceBookRatio), yld: scrNum_(x.YieldRatio) }; });
  arr(2).concat(arr(3)).forEach(function (x) {
    const c = x['公司代號'];
    const f = fund[c] = fund[c] || {};
    f.revYoY = scrNum_(x['營業收入-去年同月增減(%)']);
    f.revMoM = scrNum_(x['營業收入-上月比較增減(%)']);
    f.revCum = scrNum_(x['累計營業收入-前期比較增減(%)']);
    const ym = String(x['資料年月'] || '');
    f.revYM = ym.length >= 5 ? (+ym.slice(0, ym.length - 2) + 1911) + '-' + ym.slice(-2) : null;
    ind[c] = x['產業別'];
  });

  const out = [];
  Object.keys(latest).forEach(function (code) {
    const nm = String(names[code] || '|').split('|');
    const c = [], h = [], l = [], v = [];
    P.forEach(function (day) {
      const x = day.v[code];
      if (x) { c.push(x[0]); h.push(x[1]); l.push(x[2]); v.push(x[3]); }
    });
    const N = c.length;
    if (!N) return;
    const last = c[N - 1];
    const ret = function (k) { return N > k ? (last / c[N - 1 - k] - 1) * 100 : null; };
    const sma = function (k, end) { end = end == null ? N : end; if (end < k) return null; let s = 0; for (let i = end - k; i < end; i++) s += c[i]; return s / k; };
    const avg = function (a, k, end) { if (end < k || k <= 0) return null; let s = 0; for (let i = end - k; i < end; i++) s += a[i]; return s / k; };
    const ma = {};
    [5, 10, 20, 60, 120, 240].forEach(function (k) { ma[k] = sma(k); });
    const ma5p = sma(5, N - 1), ma20p = sma(20, N - 1), ma60p20 = sma(60, N - 20);
    const vol20 = avg(v, Math.min(20, N - 1), N - 1);
    const hi = Math.max.apply(null, h), lo = Math.min.apply(null, l);
    // 創 N 日新高／新低（收盤突破前 N 日最高價）
    const brk = function (arr, dir) {
      let best = 0;
      [20, 60, 120, 250].forEach(function (k) {
        if (N <= k) return;
        const seg = arr.slice(N - 1 - k, N - 1);
        if (dir > 0 ? last > Math.max.apply(null, seg) : last < Math.min.apply(null, seg)) best = k;
      });
      return best;
    };
    // RSI14（Wilder）
    let rsi = null;
    if (N > 15) {
      let g = 0, ls = 0;
      for (let i = 1; i <= 14; i++) { const dd = c[i] - c[i - 1]; if (dd > 0) g += dd; else ls -= dd; }
      g /= 14; ls /= 14;
      for (let i = 15; i < N; i++) { const dd = c[i] - c[i - 1]; g = (g * 13 + Math.max(dd, 0)) / 14; ls = (ls * 13 + Math.max(-dd, 0)) / 14; }
      rsi = ls === 0 ? 100 : 100 - 100 / (1 + g / ls);
    }
    // KD(9,3,3)
    let K = 50, D = 50, Kp = null, Dp = null;
    for (let i = 8; i < N; i++) {
      const hh = Math.max.apply(null, h.slice(i - 8, i + 1)), ll = Math.min.apply(null, l.slice(i - 8, i + 1));
      const rsv = hh === ll ? 50 : (c[i] - ll) / (hh - ll) * 100;
      Kp = K; Dp = D;
      K = K * 2 / 3 + rsv / 3; D = D * 2 / 3 + K / 3;
    }
    const kOk = N > 9;
    // MACD(12,26,9) 柱狀體
    let e12 = null, e26 = null, dea = null, osc = null, oscP = null;
    for (let i = 0; i < N; i++) {
      e12 = e12 == null ? c[i] : c[i] * 2 / 13 + e12 * 11 / 13;
      e26 = e26 == null ? c[i] : c[i] * 2 / 27 + e26 * 25 / 27;
      if (i >= 25) {
        const dif = e12 - e26;
        dea = dea == null ? dif : dif * 0.2 + dea * 0.8;
        oscP = osc; osc = dif - dea;
      }
    }
    // 20 日歷史波動度（年化）
    let hv20 = null;
    if (N > 21) {
      const lr = [];
      for (let i = N - 20; i < N; i++) lr.push(Math.log(c[i] / c[i - 1]));
      const m = lr.reduce(function (a, b) { return a + b; }, 0) / lr.length;
      hv20 = Math.sqrt(lr.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / (lr.length - 1)) * Math.sqrt(252) * 100;
    }
    // 法人：今日、5 日、20 日、連續買賣超天數
    const flow = function (j) {
      const s = I.map(function (day) { return day[code] ? day[code][j] : null; }).filter(function (x) { return x != null; });
      if (!s.length) return [null, null, null, null];
      const sum = function (k) { return s.slice(-k).reduce(function (a, b) { return a + b; }, 0); };
      let streak = 0;
      for (let i = s.length - 1; i >= 0; i--) {
        if (s[i] > 0 && streak >= 0) streak++;
        else if (s[i] < 0 && streak <= 0) streak--;
        else break;
      }
      return [s[s.length - 1], sum(5), sum(20), streak];
    };
    const F = flow(0), IT = flow(1);
    const mbS = M.map(function (day) { return day[code] ? day[code][0] : null; }).filter(function (x) { return x != null; });
    const sbS = M.map(function (day) { return day[code] ? day[code][1] : null; }).filter(function (x) { return x != null; });
    const mb = mbS.length ? mbS[mbS.length - 1] : null, sb = sbS.length ? sbS[sbS.length - 1] : null;
    const mb5 = mbS.length > 5 && mbS[mbS.length - 6] ? (mb / mbS[mbS.length - 6] - 1) * 100 : null;
    const f = fund[code] || {};
    const etf = /^00/.test(code) ? 1 : 0;
    const o = {
      code: code, name: nm[0] || code, mkt: nm[1] || '', ind: etf ? 'ETF' : (ind[code] || ''), etf: etf,
      close: last, r1: ret(1), r5: ret(5), r20: ret(20), r60: ret(60), r120: ret(120), r250: ret(250),
      vol: v[N - 1], vol20: vol20, vr: vol20 ? v[N - 1] / vol20 : null, amt: v[N - 1] * 1000 * last / 1e8,
      ma5: ma[5], ma10: ma[10], ma20: ma[20], ma60: ma[60], ma120: ma[120], ma240: ma[240],
      bias20: ma[20] ? (last / ma[20] - 1) * 100 : null, bias60: ma[60] ? (last / ma[60] - 1) * 100 : null,
      bull: ma[60] && ma[5] > ma[10] && ma[10] > ma[20] && ma[20] > ma[60] ? 1 : 0,
      bear: ma[60] && ma[5] < ma[10] && ma[10] < ma[20] && ma[20] < ma[60] ? 1 : 0,
      x520: ma5p && ma20p ? (ma[5] > ma[20] && ma5p <= ma20p ? 1 : ma[5] < ma[20] && ma5p >= ma20p ? -1 : 0) : 0,
      ma60up: ma[60] && ma60p20 ? (ma[60] > ma60p20 ? 1 : -1) : 0,
      hi: hi, lo: lo, dHi: (last / hi - 1) * 100, dLo: (last / lo - 1) * 100, nh: brk(h, 1), nl: brk(l, -1),
      rsi: rsi, k: kOk ? K : null, d: kOk ? D : null,
      kdx: kOk && Kp != null ? (K > D && Kp <= Dp ? 1 : K < D && Kp >= Dp ? -1 : 0) : 0,
      macd: osc, macdx: osc != null && oscP != null ? (osc > 0 && oscP <= 0 ? 1 : osc < 0 && oscP >= 0 ? -1 : 0) : 0,
      hv20: hv20, pe: f.pe, pb: f.pb, yld: f.yld, revYoY: f.revYoY, revMoM: f.revMoM, revCum: f.revCum, revYM: f.revYM || null,
      f1: F[0], f5: F[1], f20: F[2], fS: F[3], it1: IT[0], it5: IT[1], it20: IT[2], itS: IT[3],
      mb: mb, mb5: mb5, sb: sb, sr: mb ? sb / mb * 100 : null,
    };
    out.push(SCR_FIELDS.map(function (k) {
      const x = o[k];
      return typeof x === 'number' ? scrRound_(x, k === 'close' || /^ma\d/.test(k) || k === 'hi' || k === 'lo' ? 2 : 2) : x;
    }));
  });

  const table = {
    date: P[P.length - 1].d, days: P.length, flowDays: I.length, marginDays: M.length,
    fields: SCR_FIELDS, rows: out, computed: Date.now(),
  };
  const packed = scrPack_(table);
  const osh = scrSheet_(SCR_OUT);
  osh.clear();
  const parts = [];
  for (let i = 0; i < packed.length; i += 45000) parts.push([packed.slice(i, i + 45000)]);
  osh.getRange(1, 1, parts.length, 1).setValues(parts);
  CacheService.getScriptCache().remove('scr_meta');
}

/* ======================== 網頁讀取 ======================== */
function screenerTable_() {
  const sh = ss_().getSheetByName(SCR_OUT);
  const n = sh ? sh.getLastRow() : 0;
  if (!n) {
    const hasTrigger = ScriptApp.getProjectTriggers().some(function (t) { return /^screener/.test(t.getHandlerFunction()); });
    return { ready: false, setup: hasTrigger };
  }
  const packed = sh.getRange(1, 1, n, 1).getValues().map(function (r) { return r[0]; }).join('');
  const t = scrUnpack_(packed);
  t.ready = true;
  t.filling = t.days < SCR_PRICE_DAYS && ScriptApp.getProjectTriggers().some(function (x) { return x.getHandlerFunction() === 'screenerBackfill'; });
  return t;
}
