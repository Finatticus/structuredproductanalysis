/**
 * 總經與板塊分析 — 後端（與 Code.gs 放在同一個 Apps Script 專案，新增一個檔案貼上即可）
 * 只在使用者點開「總經與板塊分析」時才抓取；各區塊有各自的快取時間。
 */

/* 各區塊快取秒數（CacheService 上限 21600） */
const MACRO_TTL = {
  news: 180, sectors: 120, cross: 120, curve: 1800, fomc: 600, econ: 21600,
  margin: 1800, inst: 1800, margin_otc: 1800, inst_otc: 1800,
  flow: 1800, flow_otc: 1800, calendar: 3600, twmacro: 21600, earnings: 21600,
};
const MACRO_FORCE_MIN_MS = 30000; // 強制重新整理的最短間隔，保護額度

function macro_(part, force, acc) {
  const parts = {
    news: macroNews_, sectors: macroSectors_, cross: macroCross_, curve: macroCurve_,
    fomc: macroFomc_, margin: macroMargin_, inst: macroInst_, econ: macroEcon_,
    margin_otc: macroMarginOtc_, inst_otc: macroInstOtc_,
    flow: macroFlow_, flow_otc: macroFlowOtc_, calendar: macroCalendar_, twmacro: macroTwMacro_, earnings: macroEarnings_,
  };
  if (!parts[part]) throw new Error('未知的區塊：' + part);
  const key = 'm_' + part + (part === 'earnings' ? '_' + acc : ''); // 財報日曆依各人自選清單
  const hit = cacheGetBig_(key);
  if (hit) {
    const old = JSON.parse(hit);
    if (!force || Date.now() - old.updated < MACRO_FORCE_MIN_MS) return old;
  }
  let data;
  try {
    data = parts[part](acc);
  } catch (err) {
    // 來源暫時失敗：回傳最近一次成功的資料（標記 stale），前端照常顯示並在背景重試
    const backup = hit || cacheGetBig_('ms_' + key);
    if (!backup) throw err;
    const old = JSON.parse(backup);
    old.stale = String((err && err.message) || err).slice(0, 120);
    return old;
  }
  data.updated = Date.now();
  const text = JSON.stringify(data);
  cachePutBig_(key, text, MACRO_TTL[part]);
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
  return { tabs: tabs };
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
  const out = {
    us: pick(US_SECTORS, '產業').concat(pick(US_THEMES, '主題')),
    usBench: { sym: 'SPY', name: 'S&P 500', d1: spy.d1, w1: spy.w1, m1: spy.m1, m3: spy.m3, ytd: spy.ytd },
  };
  try { Object.assign(out, twSectors_()); } catch (e) { out.twErr = String(e.message || e); }
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
    let map = null;
    try {
      const t = (JSON.parse(okText_(res)).tables || [])[0];
      if (t && t.data && t.data.length) {
        map = {};
        t.data.forEach(function (r) { map[r[0]] = parseFloat(String(r[1]).replace(/,/g, '')); });
      }
    } catch (e) { /* ignore */ }
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

function macroCurve_() {
  const cosd = Utilities.formatDate(new Date(Date.now() - 3 * 365 * 86400000), 'UTC', 'yyyy-MM-dd');
  const url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + TENOR_IDS.join(',') +
    '&cosd=' + TENOR_IDS.map(function () { return cosd; }).join(',');
  const text = okText_(fetch_(url, { muteHttpExceptions: true, headers: { 'User-Agent': UA } }));
  if (!text) throw new Error('美債殖利率資料暫時無法取得');
  const csv = Utilities.parseCsv(text);
  const idx = TENOR_IDS.map(function (id) { return csv[0].indexOf(id); });
  const byDate = {};
  csv.slice(1).forEach(function (r) {
    const v = idx.map(function (j) { const x = parseFloat(r[j]); return isFinite(x) ? x : null; });
    if (v[8] != null) byDate[r[0]] = v; // 至少要有 10 年期
  });
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
    tenors: TENOR_LABELS,
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
const FINMIND_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoicG9zdGxlODQxMjIwQGdtYWlsLmNvbSIsImVtYWlsIjoicG9zdGxlODQxMjIwQGdtYWlsLmNvbSIsInRva2VuX3ZlcnNpb24iOjB9.T58Ouf5sDSu_NEAL1Gok2bwlLWOLQg3CA6UABRu_eqA';

function finmind_(dataset, days) {
  const start = Utilities.formatDate(new Date(Date.now() - days * 86400000), 'Asia/Taipei', 'yyyy-MM-dd');
  return get_('https://api.finmindtrade.com/api/v4/data?dataset=' + dataset + '&start_date=' + start +
    (FINMIND_TOKEN ? '&token=' + encodeURIComponent(FINMIND_TOKEN) : ''));
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
    let sc = r1.getAllHeaders()['Set-Cookie'] || [];
    if (!Array.isArray(sc)) sc = [sc];
    const cookie = sc.map(function (c) { return String(c).split(';')[0]; }).filter(function (c) { return c; }).join('; ');
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

function macroEarnings_(acc) {
  const items = getWatchlist_(acc).filter(function (it) {
    return (it.category === 'tw' || it.category === 'global') && toYahoo_(it.source);
  });
  if (!items.length) return { rows: [] };
  const syms = items.map(function (it) { return toYahoo_(it.source); });
  const query = function (sess) {
    return fetch_('https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + syms.map(encodeURIComponent).join(',') +
      '&fields=earningsTimestamp,earningsTimestampStart,earningsTimestampEnd,isEarningsDateEstimate&crumb=' + encodeURIComponent(sess.crumb),
      { muteHttpExceptions: true, headers: { 'User-Agent': UA, Cookie: sess.cookie } });
  };
  let res = query(yahooSession_(false));
  if (res.getResponseCode() === 401 || res.getResponseCode() === 403) res = query(yahooSession_(true));
  if (res.getResponseCode() !== 200) throw new Error('財報日期暫時無法取得（HTTP ' + res.getResponseCode() + '）');
  const bySym = {};
  (JSON.parse(res.getContentText()).quoteResponse.result || []).forEach(function (q) { bySym[q.symbol] = q; });
  return {
    rows: items.map(function (it, i) {
      const q = bySym[syms[i]] || {};
      const s = q.earningsTimestampStart || q.earningsTimestamp;
      const e = q.earningsTimestampEnd || s;
      return {
        cat: it.category, symbol: it.symbol, name: it.name,
        start: s ? s * 1000 : null, end: e ? e * 1000 : null, est: !!q.isEarningsDateEstimate,
      };
    }),
  };
}

/* ======================== 經濟日曆 ======================== */
// FRED 發布日程（美國重要數據）：rid → 名稱、對應 macroEcon_ 的數列（顯示前值）
const FRED_RELEASES = [
  [10, 'CPI 消費者物價指數', 'CPIAUCSL'], [50, '非農就業報告（非農／失業率）', 'PAYEMS'], [53, 'GDP 國內生產毛額', 'A191RL1Q225SBEA'],
  [54, '個人所得與支出（PCE 物價）', 'PCEPILFE'], [9, '零售銷售', ''], [46, 'PPI 生產者物價指數', ''],
  [192, 'JOLTS 職缺', ''], [180, '初領失業救濟金', 'ICSA'],
];
const CAL_CC = { USD: '美國', EUR: '歐元區', JPY: '日本', CNY: '中國', GBP: '英國', TWD: '台灣' };
const CAL_ZH = {
  'CPI m/m': 'CPI 月增率', 'CPI y/y': 'CPI 年增率', 'Core CPI m/m': '核心 CPI 月增率', 'Core CPI y/y': '核心 CPI 年增率',
  'Non-Farm Employment Change': '非農新增就業', 'Unemployment Rate': '失業率', 'Average Hourly Earnings m/m': '平均時薪月增率',
  'Federal Funds Rate': 'FOMC 利率決議', 'FOMC Statement': 'FOMC 聲明', 'FOMC Press Conference': 'FOMC 記者會',
  'FOMC Meeting Minutes': 'FOMC 會議紀要', 'FOMC Economic Projections': 'FOMC 經濟預測',
  'Advance GDP q/q': 'GDP 初值（季增年率）', 'Prelim GDP q/q': 'GDP 修正值', 'Final GDP q/q': 'GDP 終值',
  'Core PCE Price Index m/m': '核心 PCE 物價月增率', 'Retail Sales m/m': '零售銷售月增率', 'Core Retail Sales m/m': '核心零售銷售月增率',
  'PPI m/m': 'PPI 月增率', 'Core PPI m/m': '核心 PPI 月增率', 'ISM Manufacturing PMI': 'ISM 製造業 PMI', 'ISM Services PMI': 'ISM 服務業 PMI',
  'Unemployment Claims': '初領失業金', 'Prelim UoM Consumer Sentiment': '密大消費者信心初值', 'CB Consumer Confidence': '諮商會消費者信心',
  'JOLTS Job Openings': 'JOLTS 職缺', 'BOJ Policy Rate': '日銀利率決議', 'Main Refinancing Rate': 'ECB 利率決議',
  'Official Bank Rate': '英國央行利率決議', 'GDP q/y': 'GDP 年增率', 'GDP m/m': 'GDP 月增率', 'GDP q/q': 'GDP 季增率', 'Trade Balance': '貿易收支', 'Industrial Production y/y': '工業生產年增率',
};

function calZh_(t) {
  if (CAL_ZH[t]) return CAL_ZH[t];
  const m = t.match(/^(Fed Chair(?:man)?|ECB President|BOJ Gov|BOE Gov)\s+(\w+)\s+Speaks$/);
  if (m) return { 'Fed Chair': 'Fed 主席', 'Fed Chairman': 'Fed 主席', 'ECB President': 'ECB 總裁', 'BOJ Gov': '日銀總裁', 'BOE Gov': '英國央行總裁' }[m[1]] + ' ' + m[2] + ' 談話';
  return t;
}

/** 台灣央行理監事會：慣例為每季末月（3/6/9/12）第三個星期四 */
function cbcNextMeetings_(fromDs, count) {
  const out = [];
  let y = +fromDs.slice(0, 4);
  while (out.length < count) {
    [3, 6, 9, 12].forEach(function (m) {
      const first = new Date(Date.UTC(y, m - 1, 1));
      const d = 1 + ((4 - first.getUTCDay() + 7) % 7) + 14; // 第三個週四
      const ds = y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
      if (ds >= fromDs && out.length < count) out.push(ds);
    });
    y++;
  }
  return out;
}

function macroCalendar_() {
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const t0 = Date.parse(today + 'T00:00:00+08:00');
  const dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7; // 週一 = 0
  const weekStart = t0 - dow * 86400000;           // 本週一 00:00（台北）
  const nextStart = weekStart + 7 * 86400000;
  const end = weekStart + 14 * 86400000;
  const year = +today.slice(0, 4);
  const years = [year].concat(Utilities.formatDate(new Date(end), 'Asia/Taipei', 'yyyy') !== String(year) ? [year + 1] : []);

  const reqs = [get_('https://nfs.faireconomy.media/ff_calendar_thisweek.json')];
  FRED_RELEASES.forEach(function (r) {
    years.forEach(function (yy) { reqs.push(get_('https://fred.stlouisfed.org/releases/calendar?rid=' + r[0] + '&y=' + yy)); });
  });
  const res = fetchAll_(reqs);
  const events = [];

  // 本週：Forex Factory 高影響事件（含預期值、前值）
  let ffOk = false;
  try {
    JSON.parse(okText_(res[0])).forEach(function (x) {
      ffOk = true;
      if (x.impact !== 'High' || !CAL_CC[x.country]) return;
      const ts = Date.parse(x.date);
      if (!(ts >= weekStart && ts < end)) return;
      events.push({ ts: ts, cc: x.country, t: calZh_(x.title), en: x.title, fc: x.forecast || '', prev: x.previous || '', src: 'FF' });
    });
  } catch (e) { /* ignore */ }

  // FRED 發布日程（下週、或本週 FF 失敗時）
  let econ = null;
  try { econ = macro_('econ', false); } catch (e) { /* 前值非必要 */ }
  const prevOf = function (id) {
    const r = econ && econ.rows.filter(function (x) { return x.id === id && !x.err; })[0];
    return r ? r.latest + (r.unit === '%' ? '%' : r.unit ? ' ' + r.unit : '') : '';
  };
  let k = 1;
  FRED_RELEASES.forEach(function (rel) {
    years.forEach(function () {
      const html = okText_(res[k++]);
      if (!html) return;
      const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, '|').replace(/\s+/g, ' ').replace(/(\|\s*)+/g, '|');
      const re = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) ([A-Z][a-z]+ \d{1,2}, \d{4})\|(?:Updated\|)?(\d{1,2}:\d{2} [ap]m)/g;
      let m;
      while ((m = re.exec(text))) {
        const ts = Utilities.parseDate(m[1] + ' ' + m[2], 'America/Chicago', 'MMMM d, yyyy h:mm a').getTime();
        if (ts < (ffOk ? nextStart : weekStart) || ts >= end) continue;
        events.push({ ts: ts, cc: 'USD', t: rel[1], fc: '', prev: rel[2] ? prevOf(rel[2]) : '', src: 'FRED' });
      }
    });
  });

  // FOMC（FF 本週已含利率決議時不重複）
  try {
    macro_('fomc', false).meetings.forEach(function (mt) {
      const ts = Utilities.parseDate(mt.end + ' 14:00', 'America/New_York', 'yyyy-MM-dd HH:mm').getTime();
      if (ts < weekStart || ts >= end) return;
      const dup = events.some(function (e) { return e.en === 'Federal Funds Rate' && Math.abs(e.ts - ts) < 86400000; });
      if (!dup) events.push({ ts: ts, cc: 'USD', t: 'FOMC 利率決議' + (mt.sep ? '（含經濟預測）' : ''), fc: '', prev: '', src: 'Fed' });
    });
  } catch (e) { /* ignore */ }

  // 台灣央行理監事會（依慣例推估）
  cbcNextMeetings_(today, 2).forEach(function (ds) {
    const ts = Date.parse(ds + 'T16:00:00+08:00');
    if (ts >= weekStart && ts < end) events.push({ ts: ts, cc: 'TWD', t: '台灣央行理監事會（日期依慣例推估）', fc: '', prev: '', src: 'CBC' });
  });

  events.sort(function (a, b) { return a.ts - b.ts; });
  return { weekStart: weekStart, nextStart: nextStart, end: end, ff: ffOk, events: events };
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

function macroEcon_() {
  const cosd = Utilities.formatDate(new Date(Date.now() - 4 * 365 * 86400000), 'UTC', 'yyyy-MM-dd');
  const res = fetchAll_(ECON_SERIES.map(function (s) {
    return get_('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + s.id + '&cosd=' + cosd);
  }));
  const rows = ECON_SERIES.map(function (s, i) {
    try {
      const csv = Utilities.parseCsv(okText_(res[i]));
      let pts = csv.slice(1).filter(function (r) { return r[1] !== '' && r[1] !== '.'; })
        .map(function (r) { return [r[0], parseFloat(r[1])]; });
      if (s.tf === 'yoy') pts = pts.slice(12).map(function (p, j) { return [p[0], (p[1] / pts[j][1] - 1) * 100]; });
      else if (s.tf === 'diff') pts = pts.slice(1).map(function (p, j) { return [p[0], p[1] - pts[j][1]]; });
      else if (s.tf === 'k') pts = pts.map(function (p) { return [p[0], p[1] / 1000]; });
      const tail = pts.slice(-13);
      const n = tail.length;
      const r1 = function (v) { return Math.round(v * 100) / 100; };
      return {
        name: s.name, unit: s.unit, freq: s.freq, id: s.id,
        date: tail[n - 1][0], latest: r1(tail[n - 1][1]), prev: n > 1 ? r1(tail[n - 2][1]) : null,
        series: tail.map(function (p) { return r1(p[1]); }),
      };
    } catch (e) {
      return { name: s.name, unit: s.unit, freq: s.freq, id: s.id, err: true };
    }
  });
  return { rows: rows };
}
