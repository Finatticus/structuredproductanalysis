/**
 * 財金日曆 — 後端（在 Apps Script 新增指令碼檔「Calendar」貼上）
 * 依賴 Code.gs（fetch_、fetchAll_、UA、cacheGetBig_、cachePutBig_、getWatchlist_、toYahoo_）
 *      Macro.gs（partCache_、get_、okText_、yahooSession_、macro_）、Portfolio.gs（pfLoad_，選用）
 *
 * 區塊：
 *  econ      經濟日曆（上週／本週／下週）：Forex Factory（本週、高影響）＋ Nasdaq（實際值、上週與下週）＋ Fed／台灣央行
 *  earnings  財報日曆（自選清單）：Yahoo
 *  usearn    美股重要財報（本週與下週、市值 100 億美元以上）：Nasdaq
 *  exdiv     台股除權息預告（上市＋上櫃），標示自選與持股：證交所、櫃買中心
 *  dates     市場重要日期：台美休市、期貨選擇權結算、MSCI 調整、央行會議、月營收與財報期限
 */
const CAL_TTL = { econ: 1800, earnings: 21600, usearn: 3600, exdiv: 3600, dates: 21600 };
function nqHead_() { return { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' }; }
const DAY_MS = 86400000;

function cal_(part, force, acc) {
  const parts = { econ: calEcon_, earnings: calEarnings_, usearn: calUsEarn_, exdiv: calExdiv_, dates: calDates_ };
  if (!parts[part]) throw new Error('未知的日曆區塊：' + part);
  const perAcc = part === 'earnings' || part === 'exdiv'; // 依個人自選清單／持股
  return partCache_('c_' + part + (perAcc ? '_' + acc : ''), CAL_TTL[part], force, function () { return parts[part](acc); });
}

/** 台北時間的週界線：上週一、本週一、下週一、下下週一（毫秒） */
function calWeeks_() {
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const t0 = Date.parse(today + 'T00:00:00+08:00');
  const dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7; // 週一 = 0
  const weekStart = t0 - dow * DAY_MS;
  return { today: today, lastStart: weekStart - 7 * DAY_MS, weekStart: weekStart, nextStart: weekStart + 7 * DAY_MS, end: weekStart + 14 * DAY_MS };
}

/* ======================== Nasdaq（逐日 API，依日期快取） ======================== */
/** 經濟日曆要查的美東日期：上週一～下下週一（台北週一凌晨 = 美東週日；週六沒有數據） */
function calEconDays_(W) {
  const out = [];
  for (let t = W.lastStart - DAY_MS; t < W.end; t += DAY_MS) {
    const d = Utilities.formatDate(new Date(t + 12 * 3600000), 'America/New_York', 'yyyy-MM-dd');
    if (new Date(d + 'T12:00:00Z').getUTCDay() !== 6 && out.indexOf(d) < 0) out.push(d);
  }
  return out;
}

/** 美股財報要查的美東日期：本週與下週的平日 */
function calEarnDays_(W) {
  const out = [];
  for (let t = W.weekStart; t < W.end; t += DAY_MS) {
    const d = Utilities.formatDate(new Date(t + 12 * 3600000), 'America/New_York', 'yyyy-MM-dd');
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    if (dow >= 1 && dow <= 5 && out.indexOf(d) < 0) out.push(d);
  }
  return out;
}

function nqUrl_(kind, d) { return 'https://api.nasdaq.com/api/calendar/' + kind + '?date=' + d; }

/**
 * 瀏覽器引擎用：列出這個區塊接下來要逐一抓的網址（還沒快取的），
 * 讓瀏覽器先平行抓好再交給引擎計算（引擎只能逐一同步請求）。
 */
const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

function calPlan_(part) {
  const W = calWeeks_();
  const list = part === 'econ' ? calEconDays_(W).map(function (d) { return ['economicevents', d]; })
    : part === 'usearn' ? calEarnDays_(W).map(function (d) { return ['earnings', d]; }) : [];
  const urls = list.filter(function (x) { return !cacheGetBig_('nq_' + x[0] + '_' + x[1]); }).map(function (x) { return nqUrl_(x[0], x[1]); });
  if (part === 'econ') urls.unshift(FF_URL);
  return urls;
}
/** kind = economicevents | earnings；dates = 美東日期 yyyy-MM-dd。回傳 { 日期: rows 或 null（失敗） } */
function nqDays_(kind, dates) {
  const todayEt = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  const out = {}, miss = [];
  dates.forEach(function (d) {
    const hit = cacheGetBig_('nq_' + kind + '_' + d);
    if (hit) out[d] = JSON.parse(hit); else miss.push(d);
  });
  if (!miss.length) return out;
  const res = fetchAll_(miss.map(function (d) {
    return { url: nqUrl_(kind, d), muteHttpExceptions: true, headers: nqHead_() };
  }));
  res.forEach(function (r, i) {
    const d = miss[i];
    let rows = null;
    try {
      const j = JSON.parse(okText_(r));
      rows = (j.data && j.data.rows) || [];
    } catch (e) { rows = null; }
    out[d] = rows;
    // 已過去的日期資料不會再變，快取 6 小時；今天以後 30 分鐘
    if (rows) cachePutBig_('nq_' + kind + '_' + d, JSON.stringify(rows), d < todayEt ? 21600 : 1800);
  });
  return out;
}

function nqVal_(v) {
  const s = String(v == null ? '' : v).replace(/&nbsp;/g, '').trim();
  return s === 'N/A' ? '' : s;
}

/** 數字比較用：'1,716K' → 1716、'-0.3%' → -0.3、'($0.13)' → -0.13 */
function calNum_(s) {
  s = String(s || '').replace(/,/g, '').trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return neg ? -Math.abs(v) : v;
}

/* ======================== 經濟日曆 ======================== */
const CAL_CC = { USD: '美國', EUR: '歐元區', JPY: '日本', CNY: '中國', GBP: '英國', TWD: '台灣' };
const NQ_CC = { 'United States': 'USD', 'Euro Zone': 'EUR', Eurozone: 'EUR', Japan: 'JPY', China: 'CNY', 'United Kingdom': 'GBP', Taiwan: 'TWD' };
// Nasdaq 沒有重要性分級：只取各國的重點數據
const NQ_KEEP = {
  USD: /^(CPI|Core CPI|PPI|Core PPI|Nonfarm Payrolls|Unemployment Rate|Average Hourly Earnings|Initial Jobless Claims|Retail Sales|Core Retail Sales|GDP|Core PCE Price Index|PCE Price index|ISM Manufacturing PMI|ISM Non-Manufacturing PMI|Michigan Consumer Sentiment|CB Consumer Confidence|JOLTS Job Openings|ADP Nonfarm Employment Change|Durable Goods Orders|Core Durable Goods Orders|Fed Interest Rate Decision|FOMC Statement|FOMC Meeting Minutes|Fed Chair \w+ Speaks|Personal Spending|Existing Home Sales|New Home Sales|Philadelphia Fed Manufacturing Index)$/i,
  EUR: /^(CPI|Core CPI|GDP|Unemployment Rate|ECB Interest Rate Decision|Deposit Facility Rate|ECB President \w+ Speaks|HCOB Eurozone Manufacturing PMI|HCOB Eurozone Services PMI|ZEW Economic Sentiment|Retail Sales)$/i,
  JPY: /^(National CPI|National Core CPI|Tokyo CPI|GDP|BoJ Interest Rate Decision|Interest Rate Decision|BOJ Gov \w+ Speaks|Tankan.*|Unemployment Rate|Retail Sales)$/i,
  CNY: /^(CPI|PPI|GDP|Industrial Production|Retail Sales|Manufacturing PMI|Non-Manufacturing PMI|Caixin Manufacturing PMI|Caixin Services PMI|Exports|Imports|Trade Balance|Loan Prime Rate.*|Interest Rate Decision)$/i,
  GBP: /^(CPI|Core CPI|GDP|Unemployment Rate|Retail Sales|BoE Interest Rate Decision|Interest Rate Decision|BoE Gov \w+ Speaks)$/i,
};
const CAL_ZH = {
  // Forex Factory
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
  // Nasdaq
  CPI: 'CPI', 'Core CPI': '核心 CPI', PPI: 'PPI', 'Core PPI': '核心 PPI', 'Nonfarm Payrolls': '非農新增就業', 'Average Hourly Earnings': '平均時薪',
  'Initial Jobless Claims': '初領失業金', 'Retail Sales': '零售銷售', 'Core Retail Sales': '核心零售銷售', GDP: 'GDP',
  'Core PCE Price Index': '核心 PCE 物價', 'PCE Price index': 'PCE 物價', 'ISM Non-Manufacturing PMI': 'ISM 服務業 PMI',
  'Michigan Consumer Sentiment': '密大消費者信心', 'ADP Nonfarm Employment Change': 'ADP 就業人數', 'Durable Goods Orders': '耐久財訂單',
  'Core Durable Goods Orders': '核心耐久財訂單', 'Fed Interest Rate Decision': 'FOMC 利率決議', 'Personal Spending': '個人支出',
  'Existing Home Sales': '成屋銷售', 'New Home Sales': '新屋銷售', 'Philadelphia Fed Manufacturing Index': '費城聯準製造業指數',
  'HCOB Eurozone Manufacturing PMI': '製造業 PMI', 'HCOB Eurozone Services PMI': '服務業 PMI', 'ZEW Economic Sentiment': 'ZEW 經濟景氣',
  'Deposit Facility Rate': 'ECB 存款利率', 'ECB Interest Rate Decision': 'ECB 利率決議', 'National CPI': '全國 CPI', 'National Core CPI': '全國核心 CPI',
  'Tokyo CPI': '東京 CPI', 'BoJ Interest Rate Decision': '日銀利率決議', 'Industrial Production': '工業生產', 'Manufacturing PMI': '製造業 PMI',
  'Non-Manufacturing PMI': '非製造業 PMI', 'Caixin Manufacturing PMI': '財新製造業 PMI', 'Caixin Services PMI': '財新服務業 PMI',
  Exports: '出口', Imports: '進口', 'Interest Rate Decision': '利率決議', 'BoE Interest Rate Decision': '英國央行利率決議',
};

function calZh_(t) {
  if (CAL_ZH[t]) return CAL_ZH[t];
  const m = t.match(/^(Fed Chair(?:man)?|ECB President|BOJ Gov|BOE Gov|BoE Gov)\s+(\w+)\s+Speaks$/i);
  if (m) return ({ 'fed chair': 'Fed 主席', 'fed chairman': 'Fed 主席', 'ecb president': 'ECB 總裁', 'boj gov': '日銀總裁', 'boe gov': '英國央行總裁' }[m[1].toLowerCase()] || m[1]) + ' ' + m[2] + ' 談話';
  if (/^Loan Prime Rate/i.test(t)) return '貸款市場報價利率（LPR）' + (/5Y/i.test(t) ? ' 5 年' : /1Y/i.test(t) ? ' 1 年' : '');
  if (/^Tankan/i.test(t)) return '短觀 ' + t.replace(/^Tankan\s*/i, '');
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

/** Nasdaq 經濟事件 → { ts, cc, en, act, fc, prev } */
function nqEconRows_(byDay) {
  const out = [];
  Object.keys(byDay).forEach(function (d) {
    (byDay[d] || []).forEach(function (r) {
      const cc = NQ_CC[r.country];
      if (!cc || !/^\d{1,2}:\d{2}$/.test(String(r.gmt || ''))) return;
      const ts = Utilities.parseDate(d + ' ' + r.gmt, 'America/New_York', 'yyyy-MM-dd HH:mm').getTime();
      out.push({ ts: ts, cc: cc, en: String(r.eventName || '').trim(), act: nqVal_(r.actual), fc: nqVal_(r.consensus), prev: nqVal_(r.previous) });
    });
  });
  return out;
}

/** 同名事件一次公布兩個數字（例如 CPI 月增與年增）時，依前值大小補上標示 */
function nqLabelPairs_(list) {
  const groups = {};
  list.forEach(function (e) { const k = e.ts + '|' + e.cc + '|' + e.en; (groups[k] = groups[k] || []).push(e); });
  Object.keys(groups).forEach(function (k) {
    const g = groups[k];
    if (g.length !== 2 || !/^(Core )?(CPI|PPI|National (Core )?CPI|Tokyo CPI)$|Retail Sales$/i.test(g[0].en)) return;
    // 年增率通常明顯大於月增率：比較實際、預期、前值的絕對值總和
    const size = function (e) { return [e.act, e.fc, e.prev].reduce(function (s, v) { return s + Math.abs(calNum_(v) || 0); }, 0); };
    const a = size(g[0]), b = size(g[1]);
    const yy = a > b ? g[0] : g[1], mm = a > b ? g[1] : g[0];
    mm.t = calZh_(mm.en) + ' 月增率';
    yy.t = calZh_(yy.en) + ' 年增率';
  });
  return list;
}

/** Forex Factory 事件 → 對應的 Nasdaq 事件（補實際值）：同國家、時間相差 10 分鐘內，再比名稱與前值／預期 */
function calMatch_(ev, nq) {
  const words = function (s) { return String(s).toLowerCase().replace(/m\/m|y\/y|q\/q/g, ' ').match(/[a-z]+/g) || []; };
  const ew = words(ev.en);
  const same = function (a, b) { const x = calNum_(a), y = calNum_(b); return x != null && y != null && Math.abs(x - y) < 1e-9; };
  let best = null, bestScore = 0;
  nq.forEach(function (n) {
    if (n.cc !== ev.cc || Math.abs(n.ts - ev.ts) > 10 * 60000) return;
    const nw = words(n.en);
    let score = ew.filter(function (w) { return w.length > 2 && nw.indexOf(w) >= 0; }).length;
    if (/employment change/i.test(ev.en) && /payrolls/i.test(n.en)) score += 2;
    if (/claims/i.test(ev.en) && /initial jobless/i.test(n.en)) score += 2;
    if (/federal funds rate/i.test(ev.en) && /rate decision/i.test(n.en)) score += 2;
    if (ev.prev && same(ev.prev, n.prev)) score += 3;
    if (ev.fc && same(ev.fc, n.fc)) score += 2;
    if (score > bestScore) { bestScore = score; best = n; }
  });
  return bestScore >= 2 ? best : null;
}

function calEcon_() {
  const W = calWeeks_();
  const now = Date.now();
  const props = PropertiesService.getScriptProperties();
  // 美東日期：涵蓋上週一～下下週一（台北週一凌晨 = 美東週日）
  const etDays = calEconDays_(W);
  const ffRes = fetch_(FF_URL, { muteHttpExceptions: true, headers: { 'User-Agent': UA } });
  const nqByDay = nqDays_('economicevents', etDays);
  const nqOk = etDays.filter(function (d) { return nqByDay[d]; }).length;
  const nqAll = nqLabelPairs_(nqEconRows_(nqByDay));
  const nqKeep = nqAll.filter(function (e) { return NQ_KEEP[e.cc] && NQ_KEEP[e.cc].test(e.en); })
    .map(function (e) { return { ts: e.ts, cc: e.cc, t: e.t || calZh_(e.en), en: e.en, act: e.act, fc: e.fc, prev: e.prev, src: 'NQ' }; });
  const inRange = function (a, b) { return function (e) { return e.ts >= a && e.ts < b; }; };

  // 本週：Forex Factory 高影響事件（並存一份快照，下週可當「上週」用）
  let ff = [], ffOk = false;
  try {
    JSON.parse(okText_(ffRes)).forEach(function (x) {
      ffOk = true;
      if (x.impact !== 'High' || !CAL_CC[x.country]) return;
      const ts = Date.parse(x.date);
      if (!(ts >= W.weekStart && ts < W.nextStart)) return;
      ff.push({ ts: ts, cc: x.country, t: calZh_(x.title), en: x.title, fc: x.forecast || '', prev: x.previous || '', src: 'FF' });
    });
  } catch (e) { ffOk = false; }
  if (ff.length) {
    try {
      props.setProperty('ffw_' + W.weekStart, JSON.stringify(ff.map(function (e) { return [e.ts, e.cc, e.en, e.fc, e.prev]; })));
      props.getKeys().filter(function (k) { return /^ffw_\d+$/.test(k) && +k.slice(4) < W.lastStart; }).forEach(function (k) { props.deleteProperty(k); });
    } catch (e) { /* 快照非必要 */ }
  }
  const withActual = function (e) {
    if (e.ts > now) return e;
    const m = calMatch_(e, nqAll);
    if (m) { e.act = m.act; if (!e.fc) e.fc = m.fc; if (!e.prev) e.prev = m.prev; }
    return e;
  };

  // 上週：有上週的 Forex Factory 快照就用（中文名稱一致、只含高影響），否則用 Nasdaq 的重點數據
  let last = [];
  let lastSnap = null;
  try { lastSnap = JSON.parse(props.getProperty('ffw_' + W.lastStart) || 'null'); } catch (e) { lastSnap = null; }
  if (lastSnap && lastSnap.length) {
    last = lastSnap.map(function (a) { return withActual({ ts: a[0], cc: a[1], t: calZh_(a[2]), en: a[2], fc: a[3], prev: a[4], src: 'FF' }); });
  } else {
    last = nqKeep.filter(inRange(W.lastStart, W.weekStart));
  }
  const thisWeek = ffOk ? ff.map(withActual) : nqKeep.filter(inRange(W.weekStart, W.nextStart));
  let next = nqKeep.filter(inRange(W.nextStart, W.end));
  const fredUsed = !next.length;
  if (fredUsed) next = calFredNext_(W); // Nasdaq 失敗時退回 FRED 公布日程

  const events = last.concat(thisWeek, next);
  // FOMC（已有利率決議時不重複）
  try {
    macro_('fomc', false).meetings.forEach(function (mt) {
      const ts = Utilities.parseDate(mt.end + ' 14:00', 'America/New_York', 'yyyy-MM-dd HH:mm').getTime();
      if (ts < W.lastStart || ts >= W.end) return;
      const dup = events.some(function (e) { return e.cc === 'USD' && /利率決議/.test(e.t) && Math.abs(e.ts - ts) < DAY_MS; });
      if (!dup) events.push({ ts: ts, cc: 'USD', t: 'FOMC 利率決議' + (mt.sep ? '（含經濟預測）' : ''), fc: '', prev: '', src: 'Fed' });
    });
  } catch (e) { /* ignore */ }
  // 台灣央行理監事會（依慣例推估）
  cbcNextMeetings_(Utilities.formatDate(new Date(W.lastStart), 'Asia/Taipei', 'yyyy-MM-dd'), 2).forEach(function (ds) {
    const ts = Date.parse(ds + 'T16:00:00+08:00');
    if (ts >= W.lastStart && ts < W.end) events.push({ ts: ts, cc: 'TWD', t: '台灣央行理監事會（日期依慣例推估）', fc: '', prev: '', src: 'CBC' });
  });
  events.sort(function (a, b) { return a.ts - b.ts; });
  return {
    lastStart: W.lastStart, weekStart: W.weekStart, nextStart: W.nextStart, end: W.end,
    ff: ffOk, nq: nqOk, nqDays: etDays.length, lastFromFF: !!(lastSnap && lastSnap.length), fred: fredUsed, events: events,
  };
}

// FRED 發布日程（Nasdaq 無法取得時的下週備援）：rid → 名稱、對應 macroEcon_ 的數列（顯示前值）
const FRED_RELEASES = [
  [10, 'CPI 消費者物價指數', 'CPIAUCSL'], [50, '非農就業報告（非農／失業率）', 'PAYEMS'], [53, 'GDP 國內生產毛額', 'A191RL1Q225SBEA'],
  [54, '個人所得與支出（PCE 物價）', 'PCEPILFE'], [9, '零售銷售', ''], [46, 'PPI 生產者物價指數', ''],
  [192, 'JOLTS 職缺', ''], [180, '初領失業救濟金', 'ICSA'],
];

function calFredNext_(W) {
  const year = +Utilities.formatDate(new Date(W.nextStart), 'Asia/Taipei', 'yyyy');
  const years = [year].concat(Utilities.formatDate(new Date(W.end), 'Asia/Taipei', 'yyyy') !== String(year) ? [year + 1] : []);
  const reqs = [];
  FRED_RELEASES.forEach(function (r) { years.forEach(function (yy) { reqs.push(get_('https://fred.stlouisfed.org/releases/calendar?rid=' + r[0] + '&y=' + yy)); }); });
  const res = fetchAll_(reqs);
  let econ = null;
  try { econ = macro_('econ', false); } catch (e) { /* 前值非必要 */ }
  const prevOf = function (id) {
    const r = econ && econ.rows.filter(function (x) { return x.id === id && !x.err; })[0];
    return r ? r.latest + (r.unit === '%' ? '%' : r.unit ? ' ' + r.unit : '') : '';
  };
  const out = [];
  let k = 0;
  FRED_RELEASES.forEach(function (rel) {
    years.forEach(function () {
      const html = okText_(res[k++]);
      if (!html) return;
      const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, '|').replace(/\s+/g, ' ').replace(/(\|\s*)+/g, '|');
      const re = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) ([A-Z][a-z]+ \d{1,2}, \d{4})\|(?:Updated\|)?(\d{1,2}:\d{2} [ap]m)/g;
      let m;
      while ((m = re.exec(text))) {
        const ts = Utilities.parseDate(m[1] + ' ' + m[2], 'America/Chicago', 'MMMM d, yyyy h:mm a').getTime();
        if (ts < W.nextStart || ts >= W.end) continue;
        out.push({ ts: ts, cc: 'USD', t: rel[1], fc: '', prev: rel[2] ? prevOf(rel[2]) : '', src: 'FRED' });
      }
    });
  });
  return out;
}

/* ======================== 財報日曆（自選清單） ======================== */
function calEarnings_(acc) {
  const items = getWatchlist_(acc).filter(function (it) {
    return (it.category === 'tw' || it.category === 'global') && toYahoo_(it.source);
  });
  if (!items.length) return { rows: [] };
  const syms = items.map(function (it) { return toYahoo_(it.source); });
  // 1) Yahoo（需要 cookie＋crumb 認證；Google／Cloudflare 主機常被拒絕）
  const bySym = {};
  let yahooErr = '';
  try {
    const query = function (sess) {
      return fetch_('https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + syms.map(encodeURIComponent).join(',') +
        '&fields=earningsTimestamp,earningsTimestampStart,earningsTimestampEnd,isEarningsDateEstimate&crumb=' + encodeURIComponent(sess.crumb),
        { muteHttpExceptions: true, headers: { 'User-Agent': UA, Cookie: sess.cookie } });
    };
    let res = query(yahooSession_(false));
    if (res.getResponseCode() === 401 || res.getResponseCode() === 403) res = query(yahooSession_(true));
    if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
    (JSON.parse(res.getContentText()).quoteResponse.result || []).forEach(function (q) { bySym[q.symbol] = q; });
  } catch (e) { yahooErr = String((e && e.message) || e); }
  // 2) 美國上市股票 Yahoo 沒給日期時：改查 Nasdaq（不需要認證）
  const nqIdx = [];
  syms.forEach(function (s, i) { if (/^[A-Z][A-Z0-9]{0,5}(-[A-Z])?$/.test(s) && !(bySym[s] && (bySym[s].earningsTimestampStart || bySym[s].earningsTimestamp))) nqIdx.push(i); });
  const nqTs = {};
  if (nqIdx.length) {
    try {
      fetchAll_(nqIdx.map(function (i) {
        return { url: 'https://api.nasdaq.com/api/analyst/' + syms[i].replace('-', '.') + '/earnings-date', muteHttpExceptions: true, headers: nqHead_() };
      })).forEach(function (r, k) {
        try { const t = nqEarnDate_(JSON.parse(okText_(r)).data); if (t) nqTs[syms[nqIdx[k]]] = t; } catch (e) { /* 這檔沒有 */ }
      });
    } catch (e) { /* Nasdaq 也失敗 */ }
  }
  const rows = items.map(function (it, i) {
    const q = bySym[syms[i]] || {};
    const s = q.earningsTimestampStart || q.earningsTimestamp;
    const e = q.earningsTimestampEnd || s;
    if (!s && nqTs[syms[i]]) return { cat: it.category, symbol: it.symbol, name: it.name, start: nqTs[syms[i]], end: nqTs[syms[i]], est: false, dayOnly: true, src: 'Nasdaq' };
    return {
      cat: it.category, symbol: it.symbol, name: it.name,
      start: s ? s * 1000 : null, end: e ? e * 1000 : null, est: !!q.isEarningsDateEstimate,
    };
  });
  // Yahoo 與 Nasdaq 都沒有任何日期：視為失敗（沿用上次的資料並自動重試）
  if (yahooErr && !Object.keys(nqTs).length && items.some(function (it) { return it.category === 'global'; })) {
    throw new Error('財報日期暫時無法取得（Yahoo ' + yahooErr + '）');
  }
  return { rows: rows, note: yahooErr ? 'Yahoo 財報日期暫時無法取得：美國上市股票改用 Nasdaq；台股先顯示法定公告期限，其他市場暫無日期' : '' };
}

/** Nasdaq 下次財報日（"Earnings announcement* for AAPL: Nov 02, 2026"）→ 該日 UTC 中午（台北同一天） */
function nqEarnDate_(d) {
  const m = d && String(d.announcement || '').match(/:\s*([A-Za-z]{3}) (\d{1,2}), (\d{4})/);
  if (!m) return null;
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m[1]);
  return mon < 0 ? null : Date.UTC(+m[3], mon, +m[2], 12);
}

/* ======================== 美股重要財報 ======================== */
const US_EARN_MIN_CAP = 1e10; // 市值 100 億美元以上

function calUsEarn_() {
  const W = calWeeks_();
  const days = calEarnDays_(W);
  const byDay = nqDays_('earnings', days);
  const ok = days.filter(function (d) { return byDay[d]; }).length;
  if (!ok) throw new Error('Nasdaq 財報日程暫時無法取得');
  const rows = [];
  days.forEach(function (d) {
    (byDay[d] || []).forEach(function (r) {
      const cap = calNum_(String(r.marketCap || '').replace(/\$/g, ''));
      if (!(cap >= US_EARN_MIN_CAP)) return;
      rows.push({
        d: d, sym: String(r.symbol || ''), name: String(r.name || ''), cap: cap,
        time: /pre-market/.test(r.time) ? 'pre' : /after-hours/.test(r.time) ? 'after' : '',
        fc: calNum_(r.epsForecast), eps: r.eps != null ? calNum_(r.eps) : null, surprise: calNum_(r.surprise),
        lastYear: calNum_(r.lastYearEPS), fq: String(r.fiscalQuarterEnding || ''), n: calNum_(r.noOfEsts),
      });
    });
  });
  rows.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : b.cap - a.cap; });
  return { days: days, okDays: ok, today: Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd'), minCap: US_EARN_MIN_CAP, rows: rows };
}

/* ======================== 台股除權息預告 ======================== */
function rocDate_(s) {
  s = String(s || '');
  let m = s.match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日/);
  if (!m) m = s.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (!m) return null;
  return (+m[1] + 1911) + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

/** 證交所寫「息／權／權息」、櫃買中心寫「除息／除權／除權息」：統一成後者 */
function exType_(s) {
  s = String(s || '').trim();
  return /^除/.test(s) ? s : s ? '除' + s : '';
}

function calExdivBase_() {
  const hit = cacheGetBig_('c_exdiv_base');
  if (hit) return JSON.parse(hit);
  const res = fetchAll_([
    get_('https://www.twse.com.tw/rwd/zh/exRight/TWT48U?response=json&_=' + Date.now()),
    get_('https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost'),
  ]);
  const rows = [], why = [];
  const num = function (v) { const f = parseFloat(String(v).replace(/,/g, '')); return isFinite(f) ? f : null; };
  try {
    const j = JSON.parse(okText_(res[0]));
    (j.data || []).forEach(function (r) {
      const d = rocDate_(r[0]);
      if (!d) return;
      const cashTxt = String(r[7] || '');
      rows.push({ d: d, code: String(r[1]).trim(), name: String(r[2]).trim(), mkt: 'tse', type: exType_(r[3]),
        cash: /</.test(cashTxt) ? null : num(cashTxt), stock: num(r[4]), note: /</.test(cashTxt) ? cashTxt.replace(/<[^>]+>/g, '').trim() : '' });
    });
  } catch (e) { why.push('證交所'); }
  try {
    JSON.parse(okText_(res[1])).forEach(function (r) {
      const d = rocDate_(r.ExRrightsExDividendDate);
      if (!d) return;
      rows.push({ d: d, code: String(r.SecuritiesCompanyCode).trim(), name: String(r.CompanyName).trim(), mkt: 'otc',
        type: exType_(r.ExRrightsExDividend), cash: num(r.CashDividend), stock: num(r.StockDividendRatio), note: '' });
    });
  } catch (e) { why.push('櫃買中心'); }
  if (!rows.length) throw new Error('除權息資料暫時無法取得（' + why.join('、') + '）');
  const out = { rows: rows, partial: why };
  cachePutBig_('c_exdiv_base', JSON.stringify(out), 3600);
  return out;
}

function calExdiv_(acc) {
  const base = calExdivBase_();
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const from = Utilities.formatDate(new Date(Date.now() - 7 * DAY_MS), 'Asia/Taipei', 'yyyy-MM-dd');
  // 自選（台股）與投資組合持股（股數）
  const watch = {};
  getWatchlist_(acc).forEach(function (it) { if (it.category === 'tw') watch[it.symbol] = 1; });
  const held = {};
  try {
    if (typeof pfLoad_ === 'function') {
      pfLoad_(acc).txns.forEach(function (t) {
        if (t.cat !== 'tw') return;
        const q = t.type === 'buy' || t.type === 'stock' ? t.qty : t.type === 'sell' ? -t.qty : 0;
        held[t.sym] = (held[t.sym] || 0) + (q || 0);
      });
    }
  } catch (e) { /* 投資組合未安裝 */ }
  const rows = base.rows.filter(function (r) { return r.d >= from; }).map(function (r) {
    const q = held[r.code] > 0 ? held[r.code] : 0;
    return Object.assign({}, r, { watch: !!watch[r.code], qty: q || null, est: q && r.cash != null ? Math.round(q * r.cash) : null });
  }).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (b.qty || 0) - (a.qty || 0); });
  return { today: today, rows: rows, partial: base.partial };
}

/* ======================== 市場重要日期 ======================== */
function ymdUtc_(y, m, d) { return Utilities.formatDate(new Date(Date.UTC(y, m - 1, d)), 'UTC', 'yyyy-MM-dd'); }
function nthDow_(y, m, dow, n) { // 第 n 個星期 dow（0=日）；n = -1 為最後一個
  if (n > 0) { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return ymdUtc_(y, m, 1 + ((dow - first + 7) % 7) + (n - 1) * 7); }
  const lastD = new Date(Date.UTC(y, m, 0)); const back = (lastD.getUTCDay() - dow + 7) % 7;
  return ymdUtc_(y, m, lastD.getUTCDate() - back);
}
function addDays_(ds, k) { return Utilities.formatDate(new Date(Date.parse(ds + 'T00:00:00Z') + k * DAY_MS), 'UTC', 'yyyy-MM-dd'); }
function dowOf_(ds) { return new Date(ds + 'T00:00:00Z').getUTCDay(); }

/** 紐約證交所休市日（依規則計算） */
function usHolidays_(y) {
  const obs = function (ds) { const w = dowOf_(ds); return w === 6 ? addDays_(ds, -1) : w === 0 ? addDays_(ds, 1) : ds; };
  // 復活節（Anonymous Gregorian algorithm）
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const em = Math.floor((h + l - 7 * m + 114) / 31), ed = ((h + l - 7 * m + 114) % 31) + 1;
  const list = [
    [obs(ymdUtc_(y, 1, 1)), '元旦'], [nthDow_(y, 1, 1, 3), '馬丁路德金恩紀念日'], [nthDow_(y, 2, 1, 3), '總統日'],
    [addDays_(ymdUtc_(y, em, ed), -2), '耶穌受難日'], [nthDow_(y, 5, 1, -1), '陣亡將士紀念日'], [obs(ymdUtc_(y, 6, 19)), '六月節'],
    [obs(ymdUtc_(y, 7, 4)), '獨立紀念日'], [nthDow_(y, 9, 1, 1), '勞動節'], [nthDow_(y, 11, 4, 4), '感恩節'], [obs(ymdUtc_(y, 12, 25)), '聖誕節'],
  ];
  // 元旦遇週六不在前一年 12/31 補休
  return list.filter(function (x) { return x[0].slice(0, 4) === String(y) && dowOf_(x[0]) !== 0 && dowOf_(x[0]) !== 6; });
}

function calDates_() {
  const today = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  const until = addDays_(today, 120);
  const y = +today.slice(0, 4);
  const items = [];
  const push = function (d, mkt, kind, title, note) { if (d >= today && d <= until) items.push({ d: d, mkt: mkt, kind: kind, t: title, note: note || '' }); };

  // 台股休市（證交所公告）
  const twClosed = {};
  let twOk = false;
  try {
    const j = JSON.parse(okText_(fetch_('https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?response=json', { muteHttpExceptions: true, headers: { 'User-Agent': UA } })));
    (j.data || []).forEach(function (r) {
      const d = String(r[0]).slice(0, 10), name = String(r[1] || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      twOk = true;
      const closed = !/交易日/.test(name);
      if (closed) twClosed[d] = 1;
      if (closed && (dowOf_(d) === 0 || dowOf_(d) === 6)) return; // 週末本來就休市，不列出
      push(d, 'TW', closed ? 'holiday' : 'info', closed ? '台股休市：' + name : name, String(r[2] || '').replace(/\s+/g, ' ').trim());
    });
  } catch (e) { /* 休市表非必要 */ }
  const twOpen = function (d) { const w = dowOf_(d); return w !== 0 && w !== 6 && !twClosed[d]; };
  const nextTw = function (d) { while (!twOpen(d)) d = addDays_(d, 1); return d; };

  // 美股休市
  const usClosed = {};
  [y, y + 1].forEach(function (yy) { usHolidays_(yy).forEach(function (h) { usClosed[h[0]] = 1; push(h[0], 'US', 'holiday', '美股休市：' + h[1]); }); });
  const usOpen = function (d) { const w = dowOf_(d); return w !== 0 && w !== 6 && !usClosed[d]; };
  const prevUs = function (d) { while (!usOpen(d)) d = addDays_(d, -1); return d; };

  for (let k = 0; k < 6; k++) {
    const mm = ((new Date().getUTCMonth() + k) % 12) + 1, yy = y + Math.floor((new Date().getUTCMonth() + k) / 12);
    // 台指期／台指選擇權月結算：第三個星期三（遇休市順延）
    push(nextTw(nthDow_(yy, mm, 3, 3)), 'TW', 'settle', '台指期／台指選擇權月結算');
    // 美股月選擇權到期：第三個星期五（遇休市提前）；3/6/9/12 月為四巫日
    const opex = prevUs(nthDow_(yy, mm, 5, 3));
    push(opex, 'US', 'settle', [3, 6, 9, 12].indexOf(mm) >= 0 ? '美股四巫日（期貨、選擇權同時到期）' : '美股月選擇權到期');
    // 上市櫃公司月營收公布期限：每月 10 日
    push(ymdUtc_(yy, mm, 10), 'TW', 'report', '上市櫃月營收公布期限', '每月 10 日前公布上月營收');
    // MSCI 季度調整：2／5／8／11 月最後一個交易日收盤生效
    if ([2, 5, 8, 11].indexOf(mm) >= 0) push(prevUs(ymdUtc_(yy, mm + 1, 0)), 'TW', 'index', 'MSCI 季度調整生效（收盤）', '通常在生效日前約 2 週公布名單');
  }
  // 台股財報公告期限（一般公司）
  [[3, 31, '年報'], [5, 15, 'Q1 財報'], [8, 14, 'Q2 財報'], [11, 14, 'Q3 財報']].forEach(function (x) {
    [y, y + 1].forEach(function (yy) { push(ymdUtc_(yy, x[0], x[1]), 'TW', 'report', '上市櫃' + x[2] + '公告期限'); });
  });
  // 央行會議
  try {
    macro_('fomc', false).meetings.forEach(function (mt) { push(mt.end, 'US', 'cb', 'FOMC 利率決議' + (mt.sep ? '（含經濟預測）' : ''), '台北時間隔日凌晨 2:00 公布'); });
  } catch (e) { /* ignore */ }
  cbcNextMeetings_(today, 2).forEach(function (d) { push(d, 'TW', 'cb', '台灣央行理監事會', '日期依慣例推估（每季末月第三個週四）'); });

  items.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
  return { today: today, until: until, twHolidays: twOk, items: items };
}
