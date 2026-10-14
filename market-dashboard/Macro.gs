/**
 * 總經與板塊分析 — 後端（與 Code.gs 放在同一個 Apps Script 專案，新增一個檔案貼上即可）
 * 只在使用者點開「總經與板塊分析」時才抓取；各區塊有各自的快取時間。
 */

/* 各區塊快取秒數（CacheService 上限 21600） */
const MACRO_TTL = {
  news: 180, sectors: 120, cross: 120, curve: 1800, fomc: 600, econ: 21600,
  margin: 1800, inst: 1800, margin_otc: 1800, inst_otc: 1800,
  flow: 1800, flow_otc: 1800, twmacro: 21600,
};
const MACRO_FORCE_MIN_MS = 30000; // 強制重新整理的最短間隔，保護額度

function macro_(part, force, acc) {
  const parts = {
    news: macroNews_, sectors: macroSectors_, cross: macroCross_, curve: macroCurve_,
    fomc: macroFomc_, margin: macroMargin_, inst: macroInst_, econ: macroEcon_,
    margin_otc: macroMarginOtc_, inst_otc: macroInstOtc_,
    flow: macroFlow_, flow_otc: macroFlowOtc_, twmacro: macroTwMacro_,
  };
  if (!parts[part]) throw new Error('未知的區塊：' + part);
  return partCache_('m_' + part, MACRO_TTL[part], force, function () { return parts[part](acc); });
}

/**
 * 區塊快取（總經、財金日曆共用）：
 *  - 快取有效期間直接回傳；強制更新在 30 秒內重複按也沿用快取（保護額度）
 *  - 來源失敗時回傳最近 6 小時內成功的資料（標記 stale），前端照常顯示並在背景重試
 */
function partCache_(key, ttl, force, fn) {
  const hit = cacheGetBig_(key);
  if (hit) {
    const old = JSON.parse(hit);
    if (!force || Date.now() - old.updated < MACRO_FORCE_MIN_MS) return old;
  }
  let data;
  try {
    data = fn();
  } catch (err) {
    const backup = hit || cacheGetBig_('ms_' + key);
    if (!backup) throw err;
    const old = JSON.parse(backup);
    old.stale = String((err && err.message) || err).slice(0, 120);
    return old;
  }
  data.updated = Date.now();
  const text = JSON.stringify(data);
  if (data.stale) { cachePutBig_(key, text, Math.min(ttl, 300)); return data; } // 用的是舊資料：只快取 5 分鐘，之後再試
  cachePutBig_(key, text, ttl);
  cachePutBig_('ms_' + key, text, 21600); // 備援副本，保留 6 小時
  return data;
}

function get_(url) {
  return { url: url, muteHttpExceptions: true, headers: { 'User-Agent': UA } };
}

function okText_(res) {
  return res && res.getResponseCode() === 200 ? res.getContentText() : null;
}

function pct_(a, b) {
  return a != null && b ? Math.round((a / b - 1) * 10000) / 100 : null;
}

function ymd_(d) { return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd'); }

function decodeHtml_(s) {
  return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(n); })
    .trim();
}

/* ======================== 1. 重大新聞 ======================== */
function macroNews_() {
  const cats = [['headline', '頭條'], ['tw_stock', '台股'], ['wd_stock', '國際股'], ['tw_macro', '總經']];
  const reqs = cats.map(function (c) { return get_('https://api.cnyes.com/media/api/v1/newslist/category/' + c[0] + '?limit=25'); });
  reqs.push(get_('https://www.cnbc.com/id/100003114/device/rss/rss.html'));
  const res = fetchAll_(reqs);

  const tabs = cats.map(function (c, i) {
    let items = [];
    try {
      items = JSON.parse(okText_(res[i])).items.data.map(function (x) {
        return { t: decodeHtml_(x.title), u: 'https://news.cnyes.com/news/id/' + x.newsId, ts: x.publishAt * 1000, s: '鉅亨網' };
      });
    } catch (e) { /* 單一來源失敗不影響其他 */ }
    return { key: c[0], name: c[1], items: items };
  });

  let cnbc = [];
  try {
    const xml = okText_(res[cats.length]);
    cnbc = (xml.match(/<item>[\s\S]*?<\/item>/g) || []).slice(0, 25).map(function (it) {
      const tag = function (n) { const m = it.match(new RegExp('<' + n + '>([\\s\\S]*?)</' + n + '>')); return m ? decodeHtml_(m[1]) : ''; };
      return { t: tag('title'), u: tag('link'), ts: Date.parse(tag('pubDate')) || null, s: 'CNBC' };
    }).filter(function (x) { return x.t && x.u; });
  } catch (e) { /* ignore */ }
  tabs.push({ key: 'cnbc', name: 'CNBC（英）', items: cnbc });
  // 全部來源都沒資料：視為失敗（改用上次成功的資料並自動重試），不要回傳空框架
  if (!tabs.some(function (t) { return t.items.length; })) throw new Error('鉅亨網與 CNBC 新聞暫時無法取得');
  return { tabs: tabs, missing: tabs.filter(function (t) { return !t.items.length; }).map(function (t) { return t.name; }) };
}

/* ======================== Yahoo 多檔績效 ======================== */
/** 一次抓多檔近 1 年日線，計算 1D/1W/1M/3M/YTD 漲跌幅 */
function sparkPerf_(symbols) {
  const reqs = chunk_(symbols, 20).map(function (c) {
    return get_('https://query1.finance.yahoo.com/v7/finance/spark?range=1y&interval=1d&symbols=' + c.map(encodeURIComponent).join(','));
  });
  const out = {};
  fetchAll_(reqs).forEach(function (r) {
    try {
      JSON.parse(okText_(r)).spark.result.forEach(function (x) {
        const resp = x.response && x.response[0];
        if (resp) { const p = perfOf_(resp); if (p) out[x.symbol] = p; }
      });
    } catch (e) { /* ignore */ }
  });
  // spark 失敗或缺漏的代號：改用 v8 chart 逐檔補抓（格式相同）
  const miss = symbols.filter(function (s) { return !out[s]; });
  if (miss.length && miss.length <= 40) {
    fetchAll_(miss.map(function (s) {
      return get_('https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(s) + '?range=1y&interval=1d');
    })).forEach(function (r, i) {
      try {
        const p = perfOf_(JSON.parse(okText_(r)).chart.result[0]);
        if (p) out[miss[i]] = p;
      } catch (e) { /* ignore */ }
    });
  }
  return out;
}

function perfOf_(resp) {
  const m = resp.meta, ts = resp.timestamp || [];
  const cl = ((resp.indicators && resp.indicators.quote[0]) || {}).close || [];
  const pts = [];
  ts.forEach(function (t, i) { if (cl[i] != null) pts.push([t, cl[i]]); });
  if (!pts.length) return null;
  const n = pts.length;
  const price = m.regularMarketPrice != null ? m.regularMarketPrice : pts[n - 1][1];
  const back = function (k) { return n - 1 - k >= 0 ? pts[n - 1 - k][1] : null; };
  const off = m.gmtoffset || 0;
  const yearOf = function (t) { return new Date((t + off) * 1000).getUTCFullYear(); };
  const yNow = yearOf(pts[n - 1][0]);
  let ytdBase = null;
  for (let i = n - 1; i >= 0; i--) { if (yearOf(pts[i][0]) < yNow) { ytdBase = pts[i][1]; break; } }
  const bases = { d1: back(1), w1: back(5), m1: back(21), m3: back(63), ytd: ytdBase };
  const out = { price: round_(price), name: m.shortName || m.symbol, a: {} };
  Object.keys(bases).forEach(function (k) {
    out[k] = pct_(price, bases[k]);
    out.a[k] = bases[k] != null ? round_(price - bases[k]) : null; // 絕對變動（利率用 bp）
  });
  out.spark = pts.slice(-64).filter(function (_, i, a) { return i % 2 === 0 || i === a.length - 1; })
    .map(function (p) { return round_(p[1]); });
  return out;
}

/* ======================== 2. 板塊輪動 ======================== */
const US_SECTORS = [
  ['XLK', '科技'], ['XLC', '通訊服務'], ['XLY', '非必需消費'], ['XLP', '必需消費'], ['XLV', '醫療保健'],
  ['XLF', '金融'], ['XLI', '工業'], ['XLE', '能源'], ['XLB', '原物料'], ['XLU', '公用事業'], ['XLRE', '房地產'],
];
const US_THEMES = [
  ['SMH', '半導體'], ['IGV', '軟體'], ['XBI', '生技'], ['ITA', '航太國防'], ['KRE', '區域銀行'], ['XHB', '住宅建商'],
];
/** 證交所 MIS 類股指數代碼（排除電子工業等彙總指數） */
const TW_SECTOR_CODES = [
  't24', 't25', 't26', 't27', 't28', 't29', 't30', 't31', 't17', 't15', 't01', 't02', 't03', 't04', 't05',
  't06', 't21', 't22', 't08', 't09', 't10', 't11', 't12', 't14', 't16', 't18', 't23', 't20',
];

function macroSectors_() {
  const syms = US_SECTORS.concat(US_THEMES).map(function (x) { return x[0]; }).concat(['SPY']);
  const perf = sparkPerf_(syms);
  const pick = function (list, group) {
    return list.map(function (x) {
      const p = perf[x[0]] || {};
      return { sym: x[0], name: x[1], group: group, d1: p.d1, w1: p.w1, m1: p.m1, m3: p.m3, ytd: p.ytd };
    });
  };
  const spy = perf.SPY || {};
  const usOk = Object.keys(perf).length > syms.length * 0.3;
  const out = {
    us: pick(US_SECTORS, '產業').concat(pick(US_THEMES, '主題')),
    usBench: { sym: 'SPY', name: 'S&P 500', d1: spy.d1, w1: spy.w1, m1: spy.m1, m3: spy.m3, ytd: spy.ytd },
  };
  if (!usOk) out.usErr = 'Yahoo 美股類股報價暫時無法取得';
  try { Object.assign(out, twSectors_()); } catch (e) { out.twErr = String(e.message || e); }
  // 美股與台股都沒資料：視為失敗，不要回傳空框架
  if (!usOk && out.twErr) throw new Error(out.usErr + '；' + out.twErr);
  return out;
}

function twSectors_() {
  const ex = TW_SECTOR_CODES.concat(['t00']).map(function (c) { return 'tse_' + c + '.tw'; }).join('|');
  const res = fetch_('https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&_=' + Date.now() + '&ex_ch=' + encodeURIComponent(ex),
    { muteHttpExceptions: true, headers: { 'User-Agent': UA, Referer: 'https://mis.twse.com.tw/stock/index.jsp' } });
  const arr = (JSON.parse(okText_(res) || '{}').msgArray) || [];
  if (!arr.length) throw new Error('證交所類股指數暫時無法取得');
  const now = {};
  let day = null;
  arr.forEach(function (x) {
    const price = num_(x.z) || num_(x.pz) || num_(x.y);
    now[x.c] = { name: x.n, price: price, prev: num_(x.y) };
    if (x.d && (!day || x.d > day)) day = x.d;
  });

  // 以最新交易日推算各期基準日，取該日（或之前最近交易日）收盤
  const base = new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8)));
  const shiftDays = function (n) { return new Date(base.getTime() - n * 86400000); };
  const shiftMonths = function (n) { const d = new Date(base); d.setUTCMonth(d.getUTCMonth() - n); return d; };
  const hist = {
    w1: twIndexCloses_(shiftDays(7)),
    m1: twIndexCloses_(shiftMonths(1)),
    m3: twIndexCloses_(shiftMonths(3)),
    ytd: twIndexCloses_(new Date(Date.UTC(base.getUTCFullYear() - 1, 11, 31))),
  };
  const row = function (code) {
    const x = now[code];
    if (!x) return null;
    const r = { sym: code, name: String(x.name || code).replace(/類?指數$/, ''), d1: pct_(x.price, x.prev) };
    ['w1', 'm1', 'm3', 'ytd'].forEach(function (k) { r[k] = pct_(x.price, hist[k][x.name]); });
    return r;
  };
  return {
    tw: TW_SECTOR_CODES.map(row).filter(function (r) { return r; }),
    twBench: Object.assign(row('t00') || {}, { name: '加權指數' }),
    twDate: day,
  };
}

/** 證交所 MI_INDEX 某日類股收盤 {指數名稱: 收盤}；非交易日往前找，結果快取 6 小時 */
function twIndexCloses_(date) {
  const cache = CacheService.getScriptCache();
  for (let i = 0; i < 7; i++) {
    const ds = Utilities.formatDate(new Date(date.getTime() - i * 86400000), 'UTC', 'yyyyMMdd');
    const key = 'twidx_' + ds;
    const hit = cache.get(key);
    if (hit === 'none') continue;
    if (hit) return JSON.parse(hit);
    const res = fetch_('https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=' + ds + '&type=IND&response=json',
      { muteHttpExceptions: true, headers: { 'User-Agent': UA } });
    const text = okText_(res);
    if (!text) return {}; // 連線失敗（或來源暫停中）：不要當成非交易日，也不要再往前一天一天試
    let map = null, parsed = false;
    try {
      const t = (JSON.parse(text).tables || [])[0];
      parsed = true;
      if (t && t.data && t.data.length) {
        map = {};
        t.data.forEach(function (r) { map[r[0]] = parseFloat(String(r[1]).replace(/,/g, '')); });
      }
    } catch (e) { /* 不是 JSON：可能被限流 */ }
    if (!parsed) return {};
    cache.put(key, map ? JSON.stringify(map) : 'none', 21600);
    if (map) return map;
    Utilities.sleep(400); // 證交所有頻率限制，逐筆慢慢查
  }
  return {};
}

/* ======================== 6a. 跨資產與市場情緒 ======================== */
const CROSS_GROUPS = [
  ['股市', [['^GSPC', 'S&P 500'], ['^NDX', '那斯達克 100'], ['^SOX', '費城半導體'], ['^DJI', '道瓊工業'], ['^RUT', '羅素 2000'],
    ['^TWII', '台灣加權'], ['^N225', '日經 225'], ['^KS11', '韓國綜合'], ['^HSI', '恆生指數'], ['000001.SS', '上證指數'], ['^STOXX50E', '歐洲斯托克 50']]],
  ['匯率', [['DX-Y.NYB', '美元指數'], ['TWD=X', '美元/台幣'], ['JPY=X', '美元/日圓'], ['EURUSD=X', '歐元/美元']]],
  ['美債殖利率', [['^IRX', '13 週'], ['^FVX', '5 年'], ['^TNX', '10 年'], ['^TYX', '30 年']]],
  ['商品', [['GC=F', '黃金'], ['SI=F', '白銀'], ['CL=F', 'WTI 原油'], ['HG=F', '銅'], ['NG=F', '天然氣']]],
  ['加密', [['BTC-USD', '比特幣'], ['ETH-USD', '以太幣']]],
  ['波動率', [['^VIX', 'VIX'], ['^VIX3M', 'VIX 3 個月']]],
];

function macroCross_() {
  const syms = [];
  CROSS_GROUPS.forEach(function (g) { g[1].forEach(function (x) { syms.push(x[0]); }); });
  const perf = sparkPerf_(syms);
  // 大多數代號都沒資料（Yahoo 被擋或失敗）：視為失敗，改用上次成功的資料並自動重試
  if (Object.keys(perf).length < syms.length * 0.3) throw new Error('Yahoo 跨資產報價暫時無法取得（' + Object.keys(perf).length + '／' + syms.length + '）');
  const groups = CROSS_GROUPS.map(function (g) {
    return {
      name: g[0],
      rate: g[0] === '美債殖利率',
      items: g[1].map(function (x) { return Object.assign({ sym: x[0] }, perf[x[0]] || {}, { name: x[1] }); }),
    };
  });
  let fng = null;
  try {
    const j = JSON.parse(okText_(fetch_('https://api.alternative.me/fng/?limit=2', { muteHttpExceptions: true })));
    fng = { value: +j.data[0].value, cls: j.data[0].value_classification, prev: +j.data[1].value };
  } catch (e) { /* ignore */ }
  return { groups: groups, fng: fng };
}

/* ======================== 3. 美債殖利率曲線與利差 ======================== */
// FRED 的美國財政部固定期限殖利率（一次請求取得所有期限近 3 年日資料）
const TENOR_IDS = ['DGS1MO', 'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3', 'DGS5', 'DGS7', 'DGS10', 'DGS20', 'DGS30'];
const TENOR_LABELS = ['1M', '3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '20Y', '30Y'];

// 美國財政部每日殖利率 CSV 的欄位（與 TENOR_LABELS 同順序）
const TREASURY_COLS = ['1 Mo', '3 Mo', '6 Mo', '1 Yr', '2 Yr', '3 Yr', '5 Yr', '7 Yr', '10 Yr', '20 Yr', '30 Yr'];

/**
 * 美國財政部官方每日殖利率（FRED 的 DGS 系列就是轉載這份資料）：回應快、不需金鑰。
 * 每年一個檔案，抓近 4 年。回傳 { 'yyyy-MM-dd': [各天期] }
 */
function treasuryCurve_(cut) {
  const y = +Utilities.formatDate(new Date(), 'America/New_York', 'yyyy');
  const years = [y, y - 1, y - 2, y - 3];
  const res = fetchAll_(years.map(function (yy) {
    return get_('https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/' + yy +
      '/all?type=daily_treasury_yield_curve&field_tdr_date_value=' + yy + '&page&_format=csv');
  }));
  const out = {};
  res.forEach(function (r) {
    const text = okText_(r);
    if (!text) return;
    let csv;
    try { csv = Utilities.parseCsv(text); } catch (e) { return; }
    const head = (csv[0] || []).map(function (h) { return String(h).replace(/"/g, '').trim(); });
    const idx = TREASURY_COLS.map(function (c) { return head.indexOf(c); });
    if (idx[8] < 0) return; // 沒有 10 年期欄位：格式不對
    csv.slice(1).forEach(function (row) {
      const m = String(row[0]).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (!m) return;
      const d = m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
      if (d < cut) return;
      const v = idx.map(function (j) { if (j < 0) return null; const x = parseFloat(row[j]); return isFinite(x) ? x : null; });
      if (v[8] != null) out[d] = v;
    });
  });
  return out;
}

/** 備援：FRED 的固定期限殖利率（FRED 網站對程式請求常常很慢或沒回應） */
function fredCurve_(cosd) {
  const url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + TENOR_IDS.join(',') +
    '&cosd=' + TENOR_IDS.map(function () { return cosd; }).join(',');
  const text = okText_(fetch_(url, { muteHttpExceptions: true, headers: { 'User-Agent': UA } }));
  const byDate = {};
  if (!text) return byDate;
  const csv = Utilities.parseCsv(text);
  const idx = TENOR_IDS.map(function (id) { return csv[0].indexOf(id); });
  csv.slice(1).forEach(function (r) {
    const v = idx.map(function (j) { const x = parseFloat(r[j]); return isFinite(x) ? x : null; });
    if (v[8] != null) byDate[r[0]] = v; // 至少要有 10 年期
  });
  return byDate;
}

function macroCurve_() {
  const cosd = Utilities.formatDate(new Date(Date.now() - 3 * 365 * 86400000), 'UTC', 'yyyy-MM-dd');
  let byDate = treasuryCurve_(cosd), src = '美國財政部';
  if (Object.keys(byDate).length < 30) { byDate = fredCurve_(cosd); src = 'FRED'; }
  const dates = Object.keys(byDate).sort();
  if (!dates.length) throw new Error('美債殖利率資料暫時無法取得');
  const last = dates[dates.length - 1];
  const back = function (days) {
    const t = Date.parse(last) - days * 86400000;
    for (let i = dates.length - 1; i >= 0; i--) if (Date.parse(dates[i]) <= t) return dates[i];
    return dates[0];
  };
  const curve = function (label, d) { return { label: label, date: d, y: byDate[d] }; };
  const T = {};
  TENOR_LABELS.forEach(function (l, i) { T[l] = i; });
  const bp = function (v, a, b) { return v[T[a]] != null && v[T[b]] != null ? Math.round((v[T[a]] - v[T[b]]) * 100) : null; };
  const spreads = { d: dates, s102: [], s103m: [], s305: [] };
  dates.forEach(function (d) {
    const v = byDate[d];
    spreads.s102.push(bp(v, '10Y', '2Y'));
    spreads.s103m.push(bp(v, '10Y', '3M'));
    spreads.s305.push(bp(v, '30Y', '5Y'));
  });
  return {
    tenors: TENOR_LABELS, src: src,
    curves: [curve('最新', last), curve('1 週前', back(7)), curve('1 個月前', back(30)), curve('1 年前', back(365))],
    spreads: spreads,
  };
}

/* ======================== 4. FOMC 利率預測 ======================== */
const MONTHS_EN = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ZQ_CODES = 'FGHJKMNQUVXZ';

function macroFomc_() {
  const res = fetchAll_([
    get_('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),
    get_('https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json'),
  ]);
  const meetings = parseFomc_(okText_(res[0]) || '');
  const effrJ = JSON.parse(okText_(res[1]) || '{}').refRates[0];
  const effr = effrJ.percentRate, from = effrJ.targetRateFrom, to = effrJ.targetRateTo;

  const today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  const next = meetings.filter(function (m) { return m.end >= today; }).slice(0, 3);
  if (!next.length) throw new Error('無法解析 FOMC 會議日期');

  // 需要的期貨月份：本月 ~ 第三次會議的下個月
  const ym = function (y, m) { return y + '-' + ('0' + m).slice(-2); };
  const addM = function (k, n) { const y = +k.slice(0, 4), m = +k.slice(5) - 1 + n; return ym(y + Math.floor(m / 12), (m % 12 + 12) % 12 + 1); };
  const months = [];
  let k = addM(today.slice(0, 7), -1);
  const lastK = addM(next[next.length - 1].end.slice(0, 7), 1);
  while (k <= lastK) { months.push(k); k = addM(k, 1); }
  const symOf = function (k) { return 'ZQ' + ZQ_CODES[+k.slice(5) - 1] + k.slice(2, 4) + '.CBT'; };
  const rate = {};
  try {
    const j = JSON.parse(okText_(fetch_('https://query1.finance.yahoo.com/v7/finance/spark?range=5d&interval=1d&symbols=' +
      months.map(function (k) { return encodeURIComponent(symOf(k)); }).join(','), { muteHttpExceptions: true, headers: { 'User-Agent': UA } })));
    j.spark.result.forEach(function (x) {
      const m = x.response && x.response[0] && x.response[0].meta;
      const kk = months.filter(function (k) { return symOf(k) === x.symbol; })[0];
      if (m && kk && m.regularMarketPrice) rate[kk] = 100 - m.regularMarketPrice;
    });
  } catch (e) { /* ignore */ }

  // CME FedWatch 法：由各月 30 天期聯邦基金期貨的平均利率，反推每次會議前後的利率
  const meetingMonth = {};
  meetings.forEach(function (m) { meetingMonth[m.end.slice(0, 7)] = true; });
  let prevEnd = null, baseRate = null;
  const out = next.map(function (mt, idx) {
    const key = mt.end.slice(0, 7);
    const y = +key.slice(0, 4), mo = +key.slice(5);
    const N = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const d = +mt.end.slice(8); // 決議日（新利率次日生效）
    const r = rate[key], nk = addM(key, 1), pk = addM(key, -1);
    let start = null, end = null;
    if (r != null) {
      if (d >= N) { start = r; end = rate[nk] != null ? rate[nk] : r; }
      else if (!meetingMonth[nk] && rate[nk] != null) { end = rate[nk]; start = (r * N - end * (N - d)) / d; }
      else {
        start = idx > 0 && prevEnd != null ? prevEnd : (!meetingMonth[pk] && rate[pk] != null ? rate[pk] : effr);
        end = (r * N - start * d) / (N - d);
      }
    }
    if (idx === 0) baseRate = start;
    prevEnd = end;
    return {
      start: mt.start, end: mt.end, sep: mt.sep,
      implied: end != null ? Math.round(end * 1000) / 1000 : null,
      move: end != null && start != null ? Math.round((end - start) * 10000) / 100 : null,  // 本次會議隱含變動 bp
      cum: end != null && baseRate != null ? Math.round((end - baseRate) * 10000) / 100 : null, // 相對目前累計 bp
    };
  });
  out.forEach(function (m, i) {
    const bps = i === 0 ? m.move : m.cum;
    m.dist = bps == null ? [] : distribution_(bps / 25, from, to);
  });
  return { effr: effr, effrDate: effrJ.effectiveDate, from: from, to: to, meetings: out };
}

/** 隱含 25bp 步數 → 機率分布（相鄰兩種結果線性內插） */
function distribution_(steps, from, to) {
  const lo = Math.floor(steps + 1e-9), f = steps - lo;
  return [[lo, 1 - f], [lo + 1, f]].filter(function (x) { return x[1] > 0.005; }).map(function (x) {
    return { moves: x[0], p: Math.round(x[1] * 1000) / 10, from: from + x[0] * 0.25, to: to + x[0] * 0.25 };
  });
}

function parseFomc_(html) {
  const out = [];
  const re = /(\d{4}) FOMC Meetings/g;
  const heads = [];
  let m;
  while ((m = re.exec(html))) heads.push({ year: +m[1], at: m.index });
  heads.forEach(function (h, i) {
    const seg = html.slice(h.at, i + 1 < heads.length ? heads[i + 1].at : h.at + 20000);
    const rows = seg.match(/fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g) || [];
    rows.forEach(function (row) {
      const mm = row.match(/<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</);
      const mon = mm[1].trim().toLowerCase().split('/').map(function (s) { return MONTHS_EN[s.slice(0, 3)]; });
      const dt = mm[2].trim();
      const dm = dt.match(/^(\d+)(?:-(\d+))?(\*)?/);
      if (!dm || !mon[0] || /notation|unscheduled|cancel/i.test(dt)) return;
      const m1 = mon[0], m2 = mon[1] || mon[0];
      const d1 = +dm[1], d2 = dm[2] ? +dm[2] : d1;
      const f = function (mo, d) { return h.year + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2); };
      out.push({ start: f(m1, d1), end: f(m2, d2), sep: !!dm[3] });
    });
  });
  return out.sort(function (a, b) { return a.end < b.end ? -1 : 1; })
    .filter(function (x, i, a) { return !i || x.end !== a[i - 1].end; });
}

/* ======================== 5. 台股信用交易 ======================== */
// FinMind 免費 API 未帶 token 時依 IP 限流，Google 伺服器 IP 多人共用容易被擋。
// 到 https://finmindtrade.com 免費註冊後，把 token 貼在這裡可大幅提高成功率（不填也能用，會改走交易所備援）。
// FinMind token：建議放在「專案設定 → 指令碼屬性」的 FINMIND_TOKEN（優先使用），並把下面這行清空。
// 網頁使用瀏覽器資料引擎時，Macro.gs 會和網頁一起上傳；token 寫在這裡會被看到。
const FINMIND_TOKEN = ''; // 已移到指令碼屬性 FINMIND_TOKEN
function finmindToken_() {
  try { return PropertiesService.getScriptProperties().getProperty('FINMIND_TOKEN') || FINMIND_TOKEN; } catch (e) { return FINMIND_TOKEN; }
}

function finmind_(dataset, days) {
  const start = Utilities.formatDate(new Date(Date.now() - days * 86400000), 'Asia/Taipei', 'yyyy-MM-dd');
  return get_('https://api.finmindtrade.com/api/v4/data?dataset=' + dataset + '&start_date=' + start +
    (finmindToken_() ? '&token=' + encodeURIComponent(finmindToken_()) : ''));
}

/** FinMind 回應 → data 陣列；失敗回傳 null 並記下原因 */
function finmindData_(res, why) {
  const text = res ? res.getContentText() : '';
  try {
    const j = JSON.parse(text);
    if (j.status === 200 && j.data && j.data.length) return j.data;
    why.msg = 'FinMind：' + String(j.msg || 'HTTP ' + res.getResponseCode()).replace(/\s*https?:\S+/g, '').replace(/[.。\s]+$/, '');
  } catch (e) {
    why.msg = 'FinMind：HTTP ' + (res ? res.getResponseCode() : '?');
  }
  return null;
}

function macroMargin_() {
  const res = fetchAll_([
    finmind_('TaiwanStockTotalMarginPurchaseShortSale', 200),
    get_('https://query2.finance.yahoo.com/v8/finance/chart/%5ETWII?range=1y&interval=1d'),
  ]);
  const why = {};
  const rows = {};
  (finmindData_(res[0], why) || []).forEach(function (x) {
    const r = rows[x.date] = rows[x.date] || {};
    if (x.name === 'MarginPurchase') r.units = x.TodayBalance;
    else if (x.name === 'ShortSale') r.short = x.TodayBalance;
    else if (x.name === 'MarginPurchaseMoney') r.money = Math.round(x.TodayBalance / 1e6) / 100; // 億元
  });

  const taiex = {};
  try {
    const r = JSON.parse(okText_(res[1])).chart.result[0];
    const off = r.meta.gmtoffset || 0, c = r.indicators.quote[0].close;
    r.timestamp.forEach(function (t, i) { if (c[i] != null) taiex[ymd_(new Date((t + off) * 1000))] = round_(c[i]); });
  } catch (e) { /* ignore */ }

  let out;
  const dates = Object.keys(rows).filter(function (d) { return rows[d].money != null && rows[d].units != null; }).sort();
  if (dates.length >= 2) {
    out = {
      src: 'FinMind（證交所資料）',
      d: dates,
      money: dates.map(function (d) { return rows[d].money; }),
      units: dates.map(function (d) { return rows[d].units; }),
      short: dates.map(function (d) { return rows[d].short; }),
    };
  } else {
    // 備援：證交所逐日查詢並永久保存
    const h = dayHistory_('tse_margin');
    if (!h.length) throw new Error('信用交易資料暫時無法取得（' + (why.msg || '證交所無回應') + '）');
    out = {
      src: '證交所（' + (why.msg || 'FinMind 無資料') + '，改用備援）',
      d: h.map(function (r) { return r[0]; }),
      money: h.map(function (r) { return r[1]; }),
      units: h.map(function (r) { return r[2]; }),
      short: h.map(function (r) { return r[3]; }),
      filling: h.length < DAY_SRC.tse_margin.keep,
    };
  }
  out.idxName = '加權指數';
  out.taiex = out.d.map(function (d) { return taiex[d] != null ? taiex[d] : null; });
  return out;
}

/* ======================== 6b. 三大法人買賣超 ======================== */
function macroInst_() {
  const why = {};
  const rows = {};
  (finmindData_(fetchAll_([finmind_('TaiwanStockTotalInstitutionalInvestors', 60)])[0], why) || []).forEach(function (x) {
    const r = rows[x.date] = rows[x.date] || { f: 0, it: 0, dl: 0, total: null };
    const net = (x.buy - x.sell) / 1e8;
    if (x.name === 'Foreign_Investor' || x.name === 'Foreign_Dealer_Self') r.f += net;
    else if (x.name === 'Investment_Trust') r.it += net;
    else if (x.name === 'Dealer_self' || x.name === 'Dealer_Hedging') r.dl += net;
    else if (x.name === 'total') r.total = net;
  });
  const r2 = function (v) { return Math.round(v * 100) / 100; };
  const dates = Object.keys(rows).sort();
  if (dates.length >= 5) {
    return {
      src: 'FinMind（證交所資料）',
      rows: dates.slice(-30).map(function (d) {
        const r = rows[d];
        return { d: d, f: r2(r.f), it: r2(r.it), dl: r2(r.dl), total: r2(r.total != null ? r.total : r.f + r.it + r.dl) };
      }),
    };
  }
  // 備援：證交所逐日查詢並永久保存
  const h = dayHistory_('tse_inst');
  if (!h.length) throw new Error('三大法人資料暫時無法取得（' + (why.msg || '證交所無回應') + '）');
  return {
    src: '證交所（' + (why.msg || 'FinMind 無資料') + '，改用備援）',
    rows: h.slice(-30).map(function (r) { return { d: r[0], f: r[1], it: r[2], dl: r[3], total: r[4] }; }),
    filling: h.length < DAY_SRC.tse_inst.keep,
  };
}

/* ======================== 逐日資料（上櫃、證交所備援） ======================== */
// 櫃買中心沒有歷史區間 API；證交所備援也只能逐日查。查過的日子永久存在「指令碼屬性」，之後只補新日期；
// 每次開啟最多補 per 天，第一次先有約一個月，之後幾次開啟補到 keep 個交易日。
const DAY_SRC = {
  margin: { prop: 'otc_margin', keep: 120, per: 25, batch: 5, pause: 300 },      // 上櫃信用交易
  inst: { prop: 'otc_inst', keep: 30, per: 25, batch: 5, pause: 300 },          // 上櫃三大法人
  tse_margin: { prop: 'tse_margin', keep: 120, per: 20, batch: 3, pause: 1200 }, // 證交所有頻率限制，慢一點
  tse_inst: { prop: 'tse_inst', keep: 30, per: 20, batch: 3, pause: 1200 },
};

function dayUrl_(kind, ds) {
  const slash = ds.replace(/-/g, '%2F'), compact = ds.replace(/-/g, '');
  return {
    margin: 'https://www.tpex.org.tw/www/zh-tw/margin/balance?date=' + slash + '&response=json',
    inst: 'https://www.tpex.org.tw/www/zh-tw/insti/summary?type=Daily&date=' + slash + '&response=json',
    tse_margin: 'https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=' + compact + '&selectType=MS&response=json',
    tse_inst: 'https://www.twse.com.tw/rwd/zh/fund/BFI82U?type=day&dayDate=' + compact + '&response=json',
  }[kind];
}

/** 解析單日回應；非交易日回傳 null，失敗丟錯。信用交易 [億, 融資張, 融券張]；法人 [外資, 投信, 自營, 合計]（億） */
function dayParse_(kind, text) {
  const j = JSON.parse(text);
  const n = function (s) { return parseFloat(String(s).replace(/,/g, '')); };
  const r2 = function (v) { return Math.round(v * 100) / 100; };
  if (kind === 'margin') {
    const t = j.tables[0];
    if (!t.summary || t.summary.length < 2) return null;
    // summary[0]：合計(張)，[6] 資餘額、[14] 券餘額；summary[1]：融資金(仟元)，[6] 今日餘額
    return [Math.round(n(t.summary[1][6]) / 1e3) / 100, n(t.summary[0][6]), n(t.summary[0][14])];
  }
  if (kind === 'inst') {
    const t = j.tables[0];
    if (!t.data || !t.data.length) return null;
    const row = {};
    t.data.forEach(function (r) { row[String(r[0]).trim()] = n(r[3]) / 1e8; });
    const f = row['外資及陸資合計'] || 0, it = row['投信'] || 0, dl = row['自營商合計'] || 0;
    return [r2(f), r2(it), r2(dl), r2(row['三大法人合計'] != null ? row['三大法人合計'] : f + it + dl)];
  }
  if (kind === 'tse_margin') {
    const t = j.stat === 'OK' && j.tables && j.tables[0];
    if (!t || !t.data || t.data.length < 3) return null;
    const row = {};
    t.data.forEach(function (r) { row[String(r[0]).trim()] = n(r[5]); }); // [5] 今日餘額
    return [Math.round(row['融資金額(仟元)'] / 1e3) / 100, row['融資(交易單位)'], row['融券(交易單位)']];
  }
  // tse_inst
  if (j.stat !== 'OK' || !j.data || !j.data.length) return null;
  const row = {};
  j.data.forEach(function (r) { row[String(r[0]).trim()] = n(r[3]) / 1e8; });
  const f = (row['外資及陸資(不含外資自營商)'] || 0) + (row['外資自營商'] || 0);
  const it = row['投信'] || 0;
  const dl = (row['自營商(自行買賣)'] || 0) + (row['自營商(避險)'] || 0);
  return [r2(f), r2(it), r2(dl), r2(row['合計'] != null ? row['合計'] : f + it + dl)];
}

/** 回傳 [[YYYY-MM-DD, values...], ...]（由舊到新） */
function dayHistory_(kind) {
  const cfg = DAY_SRC[kind];
  const props = PropertiesService.getScriptProperties();
  let st = {};
  try { st = JSON.parse(props.getProperty(cfg.prop) || '{}'); } catch (e) { st = {}; }
  st.d = st.d || {};  // 日期 → 數值
  st.x = st.x || [];  // 已確認的非交易日

  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const t0 = Date.parse(today + 'T00:00:00Z');
  const recent = ymd_(new Date(t0 - 3 * 86400000)); // 近 3 天可能尚未公布，不標記為非交易日
  const span = Math.ceil(cfg.keep * 1.6) + 10;
  const cands = [];
  for (let i = 0; i < span; i++) {
    const d = new Date(t0 - i * 86400000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    cands.push(ymd_(d));
  }
  const have = Object.keys(st.d).length;
  const missing = cands.filter(function (ds) {
    return !st.d[ds] && st.x.indexOf(ds) < 0;
  }).filter(function (ds, i) {
    return have < cfg.keep || ds >= recent || i < 5; // 已有足夠歷史時，只補最近的日子
  }).slice(0, cfg.per);

  chunk_(missing, cfg.batch).forEach(function (batch, bi) {
    if (bi) Utilities.sleep(cfg.pause);
    fetchAll_(batch.map(function (ds) { return get_(dayUrl_(kind, ds)); })).forEach(function (res, i) {
      const ds = batch[i];
      const text = okText_(res);
      if (!text) return;
      try {
        const v = dayParse_(kind, text);
        if (v && v.every(function (x) { return isFinite(x); })) st.d[ds] = v;
        else if (!v && ds < recent) st.x.push(ds);
      } catch (e) { /* 單日失敗下次再試 */ }
    });
  });

  const dates = Object.keys(st.d).sort().slice(-(cfg.keep + 5));
  const keep = {};
  dates.forEach(function (d) { keep[d] = st.d[d]; });
  const oldest = cands[cands.length - 1];
  props.setProperty(cfg.prop, JSON.stringify({ d: keep, x: st.x.filter(function (d) { return d >= oldest; }) }));
  return dates.map(function (d) { return [d].concat(keep[d]); });
}

function macroMarginOtc_() {
  const h = dayHistory_('margin');
  if (!h.length) throw new Error('櫃買中心信用交易資料暫時無法取得');
  const idx = {};
  try {
    JSON.parse(okText_(fetchAll_([get_('https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=TPEx&start_date=' + h[0][0])])[0]))
      .data.forEach(function (x) { idx[x.date] = x.close; });
  } catch (e) { /* 指數疊圖非必要 */ }
  return {
    src: '櫃買中心（上櫃）',
    idxName: '櫃買指數',
    d: h.map(function (r) { return r[0]; }),
    money: h.map(function (r) { return r[1]; }),
    units: h.map(function (r) { return r[2]; }),
    short: h.map(function (r) { return r[3]; }),
    taiex: h.map(function (r) { return idx[r[0]] != null ? idx[r[0]] : null; }),
    filling: h.length < DAY_SRC.margin.keep, // 歷史仍在逐步補齊
  };
}

function macroInstOtc_() {
  const h = dayHistory_('inst');
  if (!h.length) throw new Error('櫃買中心三大法人資料暫時無法取得');
  return {
    src: '櫃買中心',
    rows: h.slice(-30).map(function (r) { return { d: r[0], f: r[1], it: r[2], dl: r[3], total: r[4] }; }),
    filling: h.length < DAY_SRC.inst.keep,
  };
}

/* ======================== 資金流向排行（個股法人買賣超） ======================== */
function macroFlow_() { return flowData_('tse'); }
function macroFlowOtc_() { return flowData_('otc'); }

/** 最近交易日的個股外資、投信買賣超（張），附最近收盤價供估算金額；只回傳各排行可能用到的候選股 */
function flowData_(mkt) {
  const n = function (s) { return parseFloat(String(s).replace(/,/g, '')) || 0; };
  let date = null, list = null;
  for (let i = 0; i < 8 && !list; i++) {
    const ds = Utilities.formatDate(new Date(Date.now() - i * 86400000), 'Asia/Taipei', 'yyyy-MM-dd');
    const dow = new Date(ds + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const url = mkt === 'tse'
      ? 'https://www.twse.com.tw/rwd/zh/fund/T86?date=' + ds.replace(/-/g, '') + '&selectType=ALLBUT0999&response=json'
      : 'https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?type=Daily&sect=EW&date=' + ds.replace(/-/g, '%2F') + '&response=json';
    try {
      const j = JSON.parse(okText_(fetch_(url, { muteHttpExceptions: true, headers: { 'User-Agent': UA } })));
      const rows = mkt === 'tse' ? (j.stat === 'OK' && j.data) : (j.tables && j.tables[0] && j.tables[0].data);
      if (rows && rows.length) {
        date = ds;
        // 上市 T86：[4] 外陸資(不含自營商) + [7] 外資自營商、[10] 投信；上櫃：[10] 外資合計、[13] 投信（單位：股）
        list = rows.map(function (r) {
          return mkt === 'tse'
            ? { c: String(r[0]).trim(), nm: String(r[1]).trim(), f: (n(r[4]) + n(r[7])) / 1000, it: n(r[10]) / 1000 }
            : { c: String(r[0]).trim(), nm: String(r[1]).trim(), f: n(r[10]) / 1000, it: n(r[13]) / 1000 };
        });
      }
    } catch (e) { /* 往前一天 */ }
    if (!list) Utilities.sleep(300);
  }
  if (!list) throw new Error((mkt === 'tse' ? '證交所' : '櫃買中心') + '個股法人資料暫時無法取得');

  // 最近收盤價（估算買賣超金額用）
  const price = {};
  try {
    const arr = JSON.parse(okText_(fetch_(mkt === 'tse'
      ? 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
      : 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', { muteHttpExceptions: true, headers: { 'User-Agent': UA } })));
    arr.forEach(function (x) {
      const c = String(x.Code || x.SecuritiesCompanyCode || '').trim();
      const p = parseFloat(x.ClosingPrice || x.Close);
      if (c && isFinite(p)) price[c] = p;
    });
  } catch (e) { /* 沒有價格就只能看張數 */ }

  const all = list.map(function (x) {
    x.p = price[x.c] || null;
    x.etf = /^0/.test(x.c) ? 1 : 0;
    return x;
  });
  const pick = {};
  ['f', 'it'].forEach(function (k) {
    [false, true].forEach(function (byAmt) {
      [0, 1].forEach(function (withEtf) {
        const v = function (x) { return byAmt ? x[k] * (x.p || 0) : x[k]; };
        const arr = all.filter(function (x) { return withEtf || !x.etf; }).sort(function (a, b) { return v(b) - v(a); });
        arr.slice(0, 10).concat(arr.slice(-10)).forEach(function (x) { pick[x.c] = x; });
      });
    });
  });
  return {
    date: date,
    rows: Object.keys(pick).map(function (c) {
      const x = pick[c];
      return [x.c, x.nm, Math.round(x.f), Math.round(x.it), x.p, x.etf];
    }),
  };
}

/* ======================== 財報日曆（自選清單） ======================== */
/** Yahoo 需要 cookie + crumb 才能查財報日期；取得後快取 6 小時 */
/**
 * Yahoo cookie + crumb。依序嘗試多個 cookie 來源與兩個 API 主機；全部失敗時改用上次成功的組合
 * （crumb 通常可用很久），並在 10 分鐘內不再重試，避免每個請求都卡在認證上。
 */
function yahooSession_(renew) {
  const cache = CacheService.getScriptCache();
  const props = PropertiesService.getScriptProperties();
  if (!renew) {
    const hit = cache.get('ysess');
    if (hit) return JSON.parse(hit);
  }
  const last = props.getProperty('ysessLast');
  if (cache.get('ysessFail')) {
    YAHOO_DEGRADED_ = 'Yahoo 認證暫時失敗';
    if (last && !renew) return JSON.parse(last);
    throw new Error('Yahoo 認證暫時失敗，稍後自動重試');
  }
  let s = null, why = '';
  const cookieUrls = ['https://fc.yahoo.com', 'https://finance.yahoo.com/', 'https://login.yahoo.com/'];
  for (let i = 0; i < cookieUrls.length && !s; i++) {
    const r1 = fetch_(cookieUrls[i], { muteHttpExceptions: true, followRedirects: false, headers: { 'User-Agent': UA } });
    const hd = r1.getAllHeaders();
    const viaProxy = hd['X-Set-Cookie'] || hd['x-set-cookie']; // 中繼站已整理成「名稱=值; 名稱=值」
    let sc = hd['Set-Cookie'] || hd['set-cookie'] || [];
    if (!Array.isArray(sc)) sc = [sc];
    const cookie = viaProxy ? String(viaProxy) : sc.map(function (c) { return String(c).split(';')[0]; }).filter(function (c) { return c; }).join('; ');
    if (!cookie) { why = '取不到 cookie'; continue; }
    ['query1', 'query2'].some(function (host) {
      const r2 = fetch_('https://' + host + '.finance.yahoo.com/v1/test/getcrumb', { muteHttpExceptions: true, headers: { 'User-Agent': UA, Cookie: cookie } });
      const crumb = r2.getResponseCode() === 200 ? r2.getContentText().trim() : '';
      if (crumb && !/[<\s]/.test(crumb)) { s = { cookie: cookie, crumb: crumb }; return true; }
      why = 'HTTP ' + r2.getResponseCode();
      return false;
    });
  }
  if (!s) {
    cache.put('ysessFail', '1', 600);
    YAHOO_DEGRADED_ = 'Yahoo 認證失敗（' + why + '）';
    if (last && !renew) return JSON.parse(last);
    throw new Error('Yahoo 認證失敗（' + why + '）');
  }
  cache.put('ysess', JSON.stringify(s), 21600);
  props.setProperty('ysessLast', JSON.stringify(s));
  return s;
}

/* ======================== 台灣景氣與央行 ======================== */
const NDC_ZIP_FALLBACK = 'https://ws.ndc.gov.tw/Download.ashx?u=LzAwMS9hZG1pbmlzdHJhdG9yLzEwL3JlbGZpbGUvNTc4MS82MzkyL2VhMjM1YmQ5LWQwNTItNGE2OS1hYmZjLWQ1Yzc4NWQzZDBlMi56aXA%3d&n=5pmv5rCj5oyH5qiZ5Y%2bK54eI6JmfLnppcA%3d%3d&icon=.zip';

function macroTwMacro_() {
  const res = fetchAll_([
    get_('https://data.gov.tw/api/v2/rest/dataset/6099'),
    get_('https://www.cbc.gov.tw/tw/lp-640-1.html'),
  ]);
  const out = {};

  // 國發會景氣對策信號（政府資料開放平臺取得最新下載網址）
  try {
    let zipUrl = NDC_ZIP_FALLBACK;
    try {
      const dist = JSON.parse(okText_(res[0])).result.distribution;
      const z = dist.filter(function (x) { return /zip/i.test(x.resourceFormat); })[0];
      if (z && z.resourceDownloadUrl) zipUrl = z.resourceDownloadUrl;
    } catch (e) { /* 用備用網址 */ }
    const zr = fetch_(zipUrl, { muteHttpExceptions: true, headers: { 'User-Agent': UA } });
    if (zr.getResponseCode() !== 200) throw new Error('HTTP ' + zr.getResponseCode());
    const files = Utilities.unzip(zr.getBlob().setContentType('application/zip'));
    let csv = null;
    files.forEach(function (f) {
      const t = f.getDataAsString('UTF-8').replace(/^﻿/, '');
      if (t.indexOf('景氣對策信號綜合分數') >= 0 && t.indexOf('領先指標綜合指數') >= 0) csv = Utilities.parseCsv(t);
    });
    if (!csv) throw new Error('找不到景氣指標檔案');
    const h = csv[0];
    const col = function (name) { return h.indexOf(name); };
    const cs = col('景氣對策信號綜合分數'), cl = col('景氣對策信號'), cLead = col('領先指標不含趨勢指數'), cCoin = col('同時指標不含趨勢指數');
    const rows = csv.slice(1).filter(function (r) { return r[cs] !== '' && r[cs] != null; }).map(function (r) {
      const d = String(r[0]);
      return { m: d.slice(0, 4) + '-' + d.slice(4, 6), score: +r[cs], light: r[cl], lead: round_(+r[cLead]), coin: round_(+r[cCoin]) };
    }).sort(function (a, b) { return a.m < b.m ? -1 : 1; });
    out.ndc = { latest: rows[rows.length - 1], prev: rows[rows.length - 2], hist: rows.slice(-24) };
  } catch (e) {
    out.ndcErr = '國發會資料暫時無法取得（' + (e.message || e) + '）';
  }

  // 中央銀行利率
  try {
    const text = okText_(res[1]).replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const re = /(\d{4})\/(\d{1,2})\/(\d{1,2}) ([\d.]+) ([\d.]+) ([\d.]+)/g;
    const changes = [];
    let m;
    while ((m = re.exec(text)) && changes.length < 8) {
      changes.push({ d: m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2), r: +m[4], sec: +m[5], st: +m[6] });
    }
    if (!changes.length) throw new Error('解析失敗');
    out.cbc = { latest: changes[0], changes: changes };
  } catch (e) {
    out.cbcErr = '央行利率暫時無法取得（' + (e.message || e) + '）';
  }
  out.cbcNext = cbcNextMeetings_(Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'), 2);
  return out;
}

/* ======================== 6c. 美國經濟數據（FRED） ======================== */
const ECON_SERIES = [
  { id: 'CPIAUCSL', name: 'CPI 年增率', unit: '%', tf: 'yoy', freq: 'M' },
  { id: 'CPILFESL', name: '核心 CPI 年增率', unit: '%', tf: 'yoy', freq: 'M' },
  { id: 'PCEPILFE', name: '核心 PCE 年增率（Fed 目標 2%）', unit: '%', tf: 'yoy', freq: 'M' },
  { id: 'UNRATE', name: '失業率', unit: '%', tf: 'lv', freq: 'M' },
  { id: 'PAYEMS', name: '非農新增就業', unit: '千人', tf: 'diff', freq: 'M' },
  { id: 'A191RL1Q225SBEA', name: '實質 GDP（季增年率）', unit: '%', tf: 'lv', freq: 'Q' },
  { id: 'ICSA', name: '初領失業救濟金', unit: '千人', tf: 'k', freq: 'W' },
  { id: 'UMCSENT', name: '密大消費者信心', unit: '', tf: 'lv', freq: 'M' },
];

/**
 * FRED API 金鑰（免費，https://fredaccount.stlouisfed.org/apikeys 申請），放在指令碼屬性 FRED_KEY。
 * 有金鑰時走官方 API（api.stlouisfed.org，給程式用的正式管道，穩定快速）；
 * 沒有時退回 FRED 網站的 CSV 下載（網站對程式請求常常很慢或沒回應）。
 */
function fredKey_() {
  try { return PropertiesService.getScriptProperties().getProperty('FRED_KEY') || ''; } catch (e) { return ''; }
}

/** FRED 數列 → [[日期, 數值]]（API 或 CSV，依有無金鑰） */
function fredParse_(text, viaApi) {
  if (viaApi) {
    return (JSON.parse(text).observations || []).filter(function (o) { return o.value !== '.' && o.value !== ''; })
      .map(function (o) { return [o.date, parseFloat(o.value)]; });
  }
  return Utilities.parseCsv(text).slice(1).filter(function (r) { return r[1] !== '' && r[1] !== '.'; })
    .map(function (r) { return [r[0], parseFloat(r[1])]; });
}

/** 每個數列上次成功的結果存在指令碼屬性（保留到下次成功），來源失敗時沿用，不會整張表變成錯誤 */
function econBackup_(id, row) {
  const p = PropertiesService.getScriptProperties(), k = 'fredbk_' + id;
  try {
    if (row) { p.setProperty(k, JSON.stringify(row)); return row; }
    const s = p.getProperty(k);
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}

/** 抓不到時的原因（給使用者看得懂的說明） */
function econWhy_(codes, key) {
  if (!key) return '未設定 FRED_KEY：FRED 網站對程式請求常常沒回應，請在指令碼屬性加入 FRED_KEY（見說明）';
  if (codes.indexOf(400) >= 0 || codes.indexOf(403) >= 0) return 'FRED API 拒絕（HTTP ' + (codes.indexOf(400) >= 0 ? 400 : 403) + '）：FRED_KEY 可能打錯或已失效，請到 fredaccount.stlouisfed.org 確認';
  if (codes.indexOf(429) >= 0) return 'FRED API 暫時限流（HTTP 429），稍後自動重試';
  if (codes.indexOf(599) >= 0 || codes.indexOf(0) >= 0) return 'FRED API 連線逾時或暫停中，稍後自動重試';
  return 'FRED API 暫時無法取得（HTTP ' + codes.join('/') + '）';
}

function macroEcon_() {
  const cosd = Utilities.formatDate(new Date(Date.now() - 4 * 365 * 86400000), 'UTC', 'yyyy-MM-dd');
  const key = fredKey_();
  const res = fetchAll_(ECON_SERIES.map(function (s) {
    return get_(key
      ? 'https://api.stlouisfed.org/fred/series/observations?series_id=' + s.id + '&api_key=' + encodeURIComponent(key) + '&file_type=json&observation_start=' + cosd
      : 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + s.id + '&cosd=' + cosd);
  }));
  let okCount = 0, oldCount = 0;
  const codes = [];
  const rows = ECON_SERIES.map(function (s, i) {
    try {
      const text = okText_(res[i]);
      if (text == null) throw new Error('HTTP ' + (res[i] ? res[i].getResponseCode() : 0));
      let pts = fredParse_(text, !!key);
      if (s.tf === 'yoy') pts = pts.slice(12).map(function (p, j) { return [p[0], (p[1] / pts[j][1] - 1) * 100]; });
      else if (s.tf === 'diff') pts = pts.slice(1).map(function (p, j) { return [p[0], p[1] - pts[j][1]]; });
      else if (s.tf === 'k') pts = pts.map(function (p) { return [p[0], p[1] / 1000]; });
      const tail = pts.slice(-13);
      const n = tail.length;
      if (!n) throw new Error('沒有資料');
      okCount++;
      const r1 = function (v) { return Math.round(v * 100) / 100; };
      return econBackup_(s.id, {
        name: s.name, unit: s.unit, freq: s.freq, id: s.id,
        date: tail[n - 1][0], latest: r1(tail[n - 1][1]), prev: n > 1 ? r1(tail[n - 2][1]) : null,
        series: tail.map(function (p) { return r1(p[1]); }),
      });
    } catch (e) {
      const c = res[i] ? res[i].getResponseCode() : 0;
      if (codes.indexOf(c) < 0) codes.push(c);
      const old = econBackup_(s.id);
      if (old) { oldCount++; return old; } // 沿用上次成功的數值（經濟數據一個月才更新一次，影響很小）
      return { name: s.name, unit: s.unit, freq: s.freq, id: s.id, err: true };
    }
  });
  const why = econWhy_(codes, key);
  // 全部失敗又沒有舊資料：視為失敗（前端沿用上次的資料並自動重試）
  if (!okCount && !oldCount) throw new Error(why);
  const out = { rows: rows, api: !!key };
  if (!okCount) out.stale = why; // 全部都是舊資料：照常顯示，背景繼續重試
  return out;
}
