/**
 * 個股研究 — 後端（在 Apps Script 新增指令碼檔「Research」貼上）
 * 台股：FinMind（token 放在指令碼屬性 FINMIND_TOKEN）＋ Yahoo 走勢；美股／其他：Yahoo Finance
 * 依賴 Code.gs（fetch_、fetchAll_、getHistory_、resolveSymbol_、toYahoo_、getQuotes_）
 *      Macro.gs（get_、okText_、yahooSession_、finmindToken_、sparkPerf_）、Calendar.gs（nqHead_、nqEarnDate_、nthDow_）、Etf.gs（etfSheet_，ETF 持有反查）
 */

const RESEARCH_TTL = 600; // 同一檔 10 分鐘內重複查詢直接用快取

function research_(raw, force) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s) throw new Error('請輸入股票代號');
  const key = 'rs_' + s;
  if (!force) {
    const hit = cacheGetBig_(key);
    if (hit) return JSON.parse(hit);
  }
  // Code.gs withBackup_：整個失敗 → 回傳最後成功資料；Yahoo 認證失敗造成欄位空白 → 用最後成功資料補上
  const data = withBackup_(key, function () { return /^\d{4,6}[A-Z]?$/.test(s) ? researchTw_(s) : researchYahoo_(s); });
  if (!data.stale) cachePutBig_(key, JSON.stringify(data), RESEARCH_TTL);
  return data;
}

function fmId_(dataset, id, start) {
  return get_('https://api.finmindtrade.com/api/v4/data?dataset=' + dataset + (id ? '&data_id=' + encodeURIComponent(id) : '') +
    (start ? '&start_date=' + start : '') + (finmindToken_() ? '&token=' + encodeURIComponent(finmindToken_()) : ''));
}

function fmRows_(res) {
  try {
    const j = JSON.parse(okText_(res));
    return j.status === 200 && j.data ? j.data : [];
  } catch (e) { return []; }
}

function daysAgo_(n) { return Utilities.formatDate(new Date(Date.now() - n * 86400000), 'Asia/Taipei', 'yyyy-MM-dd'); }
function r2_(v) { return v == null || !isFinite(v) ? null : Math.round(v * 100) / 100; }

/** 精簡的歷史價格（近 5 年日線）＋基準指數收盤（近 2 年） */
function researchPrices_(source, benchSym) {
  const h = getHistory_(source, '1d');
  let bench = null;
  try {
    const b = getHistory_('yahoo:' + benchSym, '1d');
    const from = b.t.length - 520;
    bench = { sym: benchSym, t: b.t.slice(Math.max(0, from)), c: b.c.slice(Math.max(0, from)) };
  } catch (e) { /* 相對強弱非必要 */ }
  // 近 10 年月線（含還原權息）：季節性、長期報酬用
  let mo = null;
  try {
    const ysym = toYahoo_(source);
    const r = JSON.parse(okText_(fetch_('https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ysym) + '?range=10y&interval=1mo',
      { muteHttpExceptions: true, headers: { 'User-Agent': UA } }))).chart.result[0];
    const q = r.indicators.quote[0], adj = (r.indicators.adjclose && r.indicators.adjclose[0].adjclose) || q.close, off = r.meta.gmtoffset || 0;
    mo = { t: [], c: [], a: [] };
    r.timestamp.forEach(function (ts, i) {
      if (q.close[i] == null) return;
      mo.t.push(Utilities.formatDate(new Date((ts + off) * 1000), 'UTC', 'yyyy-MM'));
      mo.c.push(r2_(q.close[i])); mo.a.push(r2_(adj[i] != null ? adj[i] : q.close[i]));
    });
  } catch (e) { /* 長期資料非必要 */ }
  return { price: h, bench: bench, mo: mo };
}

/** Yahoo quoteSummary（失敗回傳 {}） */
function yahooSummary_(ysym, modules) {
  const q = function (sess) {
    return fetch_('https://query2.finance.yahoo.com/v10/finance/quoteSummary/' + encodeURIComponent(ysym) +
      '?modules=' + modules + '&crumb=' + encodeURIComponent(sess.crumb),
      { muteHttpExceptions: true, headers: { 'User-Agent': UA, Cookie: sess.cookie } });
  };
  try {
    let res = q(yahooSession_(false));
    if (res.getResponseCode() === 401 || res.getResponseCode() === 403) res = q(yahooSession_(true));
    return JSON.parse(res.getContentText()).quoteSummary.result[0] || {};
  } catch (e) {
    YAHOO_DEGRADED_ = YAHOO_DEGRADED_ || 'Yahoo 資料暫時無法取得';
    return {};
  }
}

function raw_(o, k) {
  const v = o && o[k];
  return v && typeof v === 'object' ? (v.raw != null ? v.raw : null) : v != null ? v : null;
}

function analystOf_(qs) {
  const fd = qs.financialData || {};
  const tr = (qs.recommendationTrend && qs.recommendationTrend.trend && qs.recommendationTrend.trend[0]) || null;
  const hist = ((qs.upgradeDowngradeHistory && qs.upgradeDowngradeHistory.history) || []).slice(0, 8).map(function (h) {
    return { t: h.epochGradeDate * 1000, firm: h.firm, from: h.fromGrade, to: h.toGrade, act: h.action, pt: h.currentPriceTarget || null };
  });
  const out = {
    mean: raw_(fd, 'targetMeanPrice'), high: raw_(fd, 'targetHighPrice'), low: raw_(fd, 'targetLowPrice'),
    rec: raw_(fd, 'recommendationMean'), key: fd.recommendationKey || null, n: raw_(fd, 'numberOfAnalystOpinions'),
    trend: tr ? { sb: tr.strongBuy, b: tr.buy, h: tr.hold, s: tr.sell, ss: tr.strongSell } : null, hist: hist,
  };
  return out.mean || out.n || out.trend ? out : null;
}

function profileOf_(qs) {
  const ap = qs.assetProfile || {};
  return {
    sector: ap.sector || null, industry: ap.industry || null, summary: ap.longBusinessSummary || null,
    employees: ap.fullTimeEmployees || null, website: ap.website || null, country: ap.country || null,
  };
}

/* ======================== 台股 ======================== */
function researchTw_(code) {
  const r = resolveSymbol_('tw', code); // 判斷上市／上櫃／興櫃
  const res = fetchAll_([
    fmId_('TaiwanStockPER', code, daysAgo_(5 * 365 + 10)),
    fmId_('TaiwanStockFinancialStatements', code, daysAgo_(6 * 365)),
    fmId_('TaiwanStockMonthRevenue', code, daysAgo_(3 * 365 + 60)),
    fmId_('TaiwanStockInstitutionalInvestorsBuySell', code, daysAgo_(100)),
    fmId_('TaiwanStockMarginPurchaseShortSale', code, daysAgo_(200)),
    fmId_('TaiwanStockShareholding', code, daysAgo_(400)),
    fmId_('TaiwanStockDividend', code, daysAgo_(7 * 365)),
    fmId_('TaiwanStockInfo', code, null),
  ]);
  const out = { mkt: 'TW', code: code, source: r.source, ysym: toYahoo_(r.source), currency: 'TWD' };
  Object.assign(out, researchPrices_(r.source, '^TWII'));

  const info = fmRows_(res[7]);
  const inf = info.filter(function (x) { return x.industry_category && x.industry_category !== 'Index'; })[0] || info[0] || {};
  out.name = inf.stock_name || r.name || code;
  out.industry = inf.industry_category || null;
  out.board = inf.type === 'twse' ? '上市' : inf.type === 'tpex' ? '上櫃' : inf.type === 'emerging' ? '興櫃' : (/\.TWO$/.test(out.ysym) ? '上櫃' : '上市');

  // 估值歷史（日）
  const per = fmRows_(res[0]);
  out.val = {
    d: per.map(function (x) { return x.date; }),
    pe: per.map(function (x) { return x.PER > 0 ? x.PER : null; }),
    pb: per.map(function (x) { return x.PBR > 0 ? x.PBR : null; }),
    yld: per.map(function (x) { return x.dividend_yield; }),
  };

  // 財報（單季）
  const fs = {};
  fmRows_(res[1]).forEach(function (x) { (fs[x.date] = fs[x.date] || {})[x.type] = x.value; });
  out.q = Object.keys(fs).sort().map(function (d) {
    const v = fs[d];
    return {
      p: d, rev: v.Revenue, gp: v.GrossProfit, op: v.OperatingIncome,
      ni: v.EquityAttributableToOwnersOfParent != null ? v.EquityAttributableToOwnersOfParent : v.IncomeAfterTaxes, eps: v.EPS,
    };
  }).filter(function (x) { return x.rev != null || x.eps != null; });

  // 月營收
  const mr = fmRows_(res[2]).map(function (x) { return { y: x.revenue_year, m: x.revenue_month, rev: x.revenue }; });
  const key = function (y, m) { return y * 100 + m; };
  const byYm = {};
  mr.forEach(function (x) { byYm[key(x.y, x.m)] = x.rev; });
  out.rev = mr.sort(function (a, b) { return key(a.y, a.m) - key(b.y, b.m); }).map(function (x) {
    const ly = byYm[key(x.y - 1, x.m)], pm = byYm[x.m === 1 ? key(x.y - 1, 12) : key(x.y, x.m - 1)];
    return { ym: x.y + '-' + ('0' + x.m).slice(-2), rev: x.rev, yoy: ly ? r2_((x.rev / ly - 1) * 100) : null, mom: pm ? r2_((x.rev / pm - 1) * 100) : null };
  }).slice(-25);

  // 法人（張）
  const inst = {};
  fmRows_(res[3]).forEach(function (x) {
    const o = inst[x.date] = inst[x.date] || { f: 0, it: 0, dl: 0 };
    const net = (x.buy - x.sell) / 1000;
    if (/^Foreign/.test(x.name)) o.f += net;
    else if (x.name === 'Investment_Trust') o.it += net;
    else if (/^Dealer/.test(x.name)) o.dl += net;
  });
  out.inst = Object.keys(inst).sort().slice(-60).map(function (d) {
    return { d: d, f: Math.round(inst[d].f), it: Math.round(inst[d].it), dl: Math.round(inst[d].dl) };
  });

  // 融資融券（張）
  out.margin = fmRows_(res[4]).map(function (x) {
    return { d: x.date, mb: x.MarginPurchaseTodayBalance, sb: x.ShortSaleTodayBalance, lim: x.MarginPurchaseLimit };
  }).slice(-120);

  // 外資持股比例
  out.foreign = fmRows_(res[5]).map(function (x) { return { d: x.date, r: x.ForeignInvestmentSharesRatio }; });
  const sh = fmRows_(res[5]);
  out.shares = sh.length ? sh[sh.length - 1].NumberOfSharesIssued : null;

  // 股利
  out.div = fmRows_(res[6]).map(function (x) {
    return {
      y: x.year, cash: r2_((x.CashEarningsDistribution || 0) + (x.CashStatutorySurplus || 0)),
      stock: r2_((x.StockEarningsDistribution || 0) + (x.StockStatutorySurplus || 0)),
      ex: x.CashExDividendTradingDate || x.StockExDividendTradingDate || '', pay: x.CashDividendPaymentDate || '',
    };
  }).filter(function (x) { return x.cash || x.stock; }).reverse();

  // Yahoo：英文簡介、分析師、下次財報
  const qs = yahooSummary_(out.ysym, 'assetProfile,financialData,recommendationTrend,calendarEvents');
  out.profile = profileOf_(qs);
  out.analyst = analystOf_(qs);
  out.nextEarnings = nextEarningsOf_(qs);
  return out;
}

function nextEarningsOf_(qs) {
  const ce = qs.calendarEvents && qs.calendarEvents.earnings;
  const d = ce && ce.earningsDate && ce.earningsDate[0];
  return d && d.raw ? d.raw * 1000 : null;
}

/* ======================== 美股／其他（Yahoo＋Nasdaq） ======================== */
/**
 * 資料來源分三層，任何一層失敗都不影響其他：
 *  1. Yahoo 財報／估值時間序列（fundamentals-timeseries）：不需要認證 → 單季／年度財報、市值、本益比、預估本益比、股價淨值比、PEG
 *  2. Nasdaq（僅美國上市股票，不需要認證）→ 公司簡介、產業、殖利率、機構持股、放空、分析師目標價、下次財報日
 *  3. Yahoo quoteSummary（需要 cookie＋crumb 認證；Google／Cloudflare 主機常被 Yahoo 拒絕）→ 有拿到就優先使用
 * 以前全部依賴第 3 層，認證失敗時市值、本益比、財報、籌碼、簡介都會空白。
 */
function researchYahoo_(raw) {
  const r = resolveSymbol_('global', raw);
  const ysym = toYahoo_(r.source);
  const q = getQuotes_([r.source])[r.source];
  if (!q || q.price == null) throw new Error('查無此代號：' + raw);
  const bench = /\.T$/.test(ysym) ? '^N225' : /\.HK$/.test(ysym) ? '^HSI' : /\.KS$|\.KQ$/.test(ysym) ? '^KS11' : '^GSPC';
  const out = { mkt: 'US', code: r.symbol, source: r.source, ysym: ysym };
  Object.assign(out, researchPrices_(r.source, bench));

  // ---- 第 1、2 層：不需要認證，一次平行抓 ----
  const usListed = /^[A-Z][A-Z0-9]{0,5}(-[A-Z])?$/.test(ysym); // 美國上市（沒有交易所後綴，例如 AAPL、BRK-B）
  const nq = ysym.replace('-', '.');
  const finTypes = ['TotalRevenue', 'GrossProfit', 'OperatingIncome', 'NetIncome', 'DilutedEPS'];
  const valTypes = ['trailingMarketCap', 'trailingPeRatio', 'trailingForwardPeRatio', 'trailingPbRatio', 'trailingPegRatio'];
  const tsTypes = finTypes.map(function (t) { return 'quarterly' + t; }).concat(finTypes.map(function (t) { return 'annual' + t; }), valTypes);
  const p1 = Math.floor(Date.now() / 1000) - 7 * 365 * 86400, p2 = Math.floor(Date.now() / 1000);
  const reqs = [
    get_('https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/' + encodeURIComponent(ysym) +
      '?type=' + tsTypes.join(',') + '&period1=' + p1 + '&period2=' + p2),
    get_('https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ysym) + '?range=10y&interval=3mo&events=div'),
  ];
  const NQ = usListed ? [
    'quote/' + nq + '/summary?assetclass=stocks', 'company/' + nq + '/company-profile', 'quote/' + nq + '/short-interest?assetClass=stocks',
    'company/' + nq + '/institutional-holdings?limit=1&type=TOTAL', 'analyst/' + nq + '/targetprice', 'analyst/' + nq + '/earnings-date',
  ] : [];
  NQ.forEach(function (x) { reqs.push({ url: 'https://api.nasdaq.com/api/' + x, muteHttpExceptions: true, headers: nqHead_() }); });
  let res = [];
  try { res = fetchAll_(reqs); } catch (e) { res = []; }
  const nqData = function (i) { try { return JSON.parse(okText_(res[2 + i])).data || null; } catch (e) { return null; } };

  // 財報與估值時間序列
  const series = {}, val = {};
  try {
    (JSON.parse(okText_(res[0])).timeseries.result || []).forEach(function (x) {
      const t = x.meta.type[0];
      const pts = (x[t] || []).filter(function (p) { return p && p.reportedValue; });
      if (valTypes.indexOf(t) >= 0) { if (pts.length) val[t] = pts[pts.length - 1].reportedValue.raw; return; }
      pts.forEach(function (p) { (series[p.asOfDate] = series[p.asOfDate] || {})[t] = p.reportedValue.raw; });
    });
  } catch (e) { /* 財報非必要 */ }
  const pick = function (prefix) {
    return Object.keys(series).sort().map(function (d) {
      const v = series[d];
      return { p: d, rev: v[prefix + 'TotalRevenue'], gp: v[prefix + 'GrossProfit'], op: v[prefix + 'OperatingIncome'], ni: v[prefix + 'NetIncome'], eps: v[prefix + 'DilutedEPS'] };
    }).filter(function (x) { return x.rev != null || x.eps != null; });
  };
  out.q = pick('quarterly');
  out.a = pick('annual');

  // 股利（近 10 年）
  try {
    const dv = (JSON.parse(okText_(res[1])).chart.result[0].events || {}).dividends || {};
    out.div = Object.keys(dv).map(function (k) { return { t: dv[k].date * 1000, cash: r2_(dv[k].amount) }; })
      .sort(function (a, b) { return b.t - a.t; });
  } catch (e) { out.div = []; }

  // ---- 第 3 層：Yahoo quoteSummary（需要認證，失敗回傳 {}） ----
  const qs = yahooSummary_(ysym, 'price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,recommendationTrend,upgradeDowngradeHistory,calendarEvents');
  const pr = qs.price || {}, sd = qs.summaryDetail || {}, ks = qs.defaultKeyStatistics || {}, fd = qs.financialData || {};
  const sum = (nqData(0) || {}).summaryData || {}, prof = nqData(1) || {}, own = (nqData(3) || {}).ownershipSummary || {};
  const sv = function (o, k) { return o && o[k] && o[k].value != null ? o[k].value : null; };
  const shortRows = ((nqData(2) || {}).shortInterestTable || {}).rows || [];

  out.name = pr.shortName || pr.longName || q.name || sv(prof, 'CompanyName') || r.symbol;
  out.currency = pr.currency || q.currency || (usListed ? 'USD' : null);
  out.profile = profileOf_(qs);
  if (!out.profile.summary && sv(prof, 'CompanyDescription')) {
    out.profile = {
      sector: sv(prof, 'Sector'), industry: sv(prof, 'Industry'), summary: sv(prof, 'CompanyDescription'),
      employees: null, website: sv(prof, 'CompanyUrl'), country: sv(prof, 'Region'), src: 'Nasdaq',
    };
  }
  out.industry = out.profile.industry || sv(sum, 'Industry');
  out.analyst = analystOf_(qs) || nqAnalyst_(nqData(4));
  out.nextEarnings = nextEarningsOf_(qs) || nqEarnDate_(nqData(5));

  const first = function () { for (let i = 0; i < arguments.length; i++) if (arguments[i] != null && isFinite(arguments[i])) return arguments[i]; return null; };
  const ownShares = nqNum_(sv(own, 'ShareoutstandingTotal'));
  const shares = first(raw_(ks, 'sharesOutstanding'), ownShares != null ? ownShares * 1e6 : null);
  const sNow = shortRows[0] ? nqNum_(shortRows[0].interest) : null, sPrev = shortRows[1] ? nqNum_(shortRows[1].interest) : null;
  const instPct = nqNum_(sv(own, 'SharesOutstandingPCT'));
  const yFloat = raw_(ks, 'shortPercentOfFloat');
  out.stats = {
    mcap: first(raw_(sd, 'marketCap'), raw_(pr, 'marketCap'), nqNum_(sv(sum, 'MarketCap')), val.trailingMarketCap),
    pe: first(raw_(sd, 'trailingPE'), val.trailingPeRatio),
    fpe: first(raw_(sd, 'forwardPE'), val.trailingForwardPeRatio),
    pb: first(raw_(ks, 'priceToBook'), val.trailingPbRatio),
    yld: raw_(sd, 'dividendYield') != null ? raw_(sd, 'dividendYield') * 100 : nqNum_(sv(sum, 'Yield')),
    beta: first(raw_(sd, 'beta'), betaOf_(out.price, out.bench)),
    peg: first(raw_(ks, 'pegRatio'), val.trailingPegRatio),
    roe: raw_(fd, 'returnOnEquity'), de: raw_(fd, 'debtToEquity'), fcf: raw_(fd, 'freeCashflow'), cur: raw_(fd, 'currentRatio'),
    inst: first(raw_(ks, 'heldPercentInstitutions'), instPct != null ? instPct / 100 : null),
    insider: raw_(ks, 'heldPercentInsiders'),
    shortPct: first(yFloat, sNow && shares ? sNow / shares : null),
    shortBase: yFloat != null ? 'float' : sNow && shares ? 'shares' : null, // 放空比例的分母：流通股（Yahoo）或總股數（Nasdaq 換算）
    shortRatio: first(raw_(ks, 'shortRatio'), shortRows[0] ? +shortRows[0].daysToCover : null),
    shortNow: first(raw_(ks, 'sharesShort'), sNow), shortPrev: first(raw_(ks, 'sharesShortPriorMonth'), sPrev),
    shortDate: raw_(ks, 'sharesShort') == null && shortRows[0] ? shortRows[0].settlementDate : null,
  };
  out.shares = shares;
  // 備援來源已補齊主要欄位：不算「Yahoo 資料不完整」（可正常存為備援、不顯示警告）
  if (YAHOO_DEGRADED_ && out.stats.mcap != null && out.q.length && (out.profile.summary || !usListed)) YAHOO_DEGRADED_ = '';
  return out;
}

/** Nasdaq 的文字數字（"$1,234.5"、"76.56%"、"N/A"）→ 數字 */
function nqNum_(s) {
  if (s == null) return null;
  const v = parseFloat(String(s).replace(/[$,%\s]/g, ''));
  return isFinite(v) ? v : null;
}

/** Nasdaq 分析師目標價 → 與 analystOf_ 相同格式（Nasdaq 只有買進／持有／賣出三級） */
function nqAnalyst_(d) {
  const c = d && d.consensusOverview;
  if (!c) return null;
  const n = (c.buy || 0) + (c.hold || 0) + (c.sell || 0);
  if (!c.priceTarget && !n) return null;
  return {
    mean: c.priceTarget || null, high: c.highPriceTarget || null, low: c.lowPriceTarget || null,
    rec: null, key: null, n: n || null, trend: n ? { sb: 0, b: c.buy || 0, h: c.hold || 0, s: c.sell || 0, ss: 0 } : null, hist: [], src: 'Nasdaq',
  };
}

/** 近一年日報酬對基準指數的 Beta（quoteSummary 拿不到時自行計算） */
function betaOf_(price, bench) {
  try {
    if (!price || !bench) return null;
    const bm = {};
    bench.t.forEach(function (t, i) { bm[t] = bench.c[i]; });
    const xs = [], ys = [];
    let pi = -1;
    for (let i = Math.max(0, price.t.length - 253); i < price.t.length; i++) {
      if (bm[price.t[i]] == null) continue;
      if (pi >= 0 && price.c[pi]) { ys.push(price.c[i] / price.c[pi] - 1); xs.push(bm[price.t[i]] / bm[price.t[pi]] - 1); }
      pi = i;
    }
    if (xs.length < 120) return null;
    const avg = function (a) { return a.reduce(function (s, v) { return s + v; }, 0) / a.length; };
    const mx = avg(xs), my = avg(ys);
    let cov = 0, vx = 0;
    for (let i = 0; i < xs.length; i++) { cov += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) * (xs[i] - mx); }
    return vx ? Math.round(cov / vx * 100) / 100 : null;
  } catch (e) { return null; }
}

/* =========================================================
 * 延伸資料：主要資料顯示後，前端在背景分組平行載入（action researchx），各組獨立快取
 *  台股：fin 財務體質、chips 進階籌碼、events 新聞與事件、peers 同業比較
 *  美股：fin 財務體質與 10 年財報、est 分析師預估與財報驚喜、own 內部人／機構／選擇權、events 新聞與申報、peers 同業比較
 * ========================================================= */
const RX_TTL = { fin: 21600, chips: 3600, events: 1800, peers: 21600, est: 21600, own: 7200 };
const SEC_UA = 'MarketWatchDashboard/1.0 (personal research tool)';

function researchX_(raw, part, force) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s) throw new Error('請輸入股票代號');
  const tw = /^\d{4,6}[A-Z]?$/.test(s);
  const fn = (tw ? { fin: rxTwFin_, chips: rxTwChips_, events: rxTwEvents_, peers: rxTwPeers_ }
    : { fin: rxUsFin_, est: rxUsEst_, own: rxUsOwn_, events: rxUsEvents_, peers: rxUsPeers_ })[part];
  if (!fn) throw new Error('未知的資料類別：' + part);
  const key = 'rx_' + part + '_' + s;
  if (!force) {
    const hit = cacheGetBig_(key);
    if (hit) return JSON.parse(hit);
  }
  const data = fn(s);
  data.updated = Date.now();
  cachePutBig_(key, JSON.stringify(data), RX_TTL[part]);
  return data;
}

function rxNum_(s) {
  if (s == null) return null;
  const v = parseFloat(String(s).replace(/[$,%\s]/g, ''));
  return isFinite(v) ? v : null;
}
function rxOpt_(h) { return { muteHttpExceptions: true, headers: Object.assign({ 'User-Agent': UA }, h || {}) }; }

/* ---------------- 台股：財務體質 ---------------- */
/** FinMind 財報（長表）→ { 日期: { 科目: 數值 } } */
function rxPivot_(rows) {
  const o = {};
  rows.forEach(function (x) { if (!/_per$/.test(x.type)) (o[x.date] = o[x.date] || {})[x.type] = x.value; });
  return o;
}

function rxTwFin_(code) {
  const from = daysAgo_(6 * 365 + 30);
  const res = fetchAll_([
    fmId_('TaiwanStockBalanceSheet', code, from), fmId_('TaiwanStockCashFlowsStatement', code, from), fmId_('TaiwanStockFinancialStatements', code, from),
  ]);
  const bs = rxPivot_(fmRows_(res[0])), cf = rxPivot_(fmRows_(res[1])), is = rxPivot_(fmRows_(res[2]));
  const dates = Object.keys(bs).concat(Object.keys(is)).filter(function (d, i, a) { return a.indexOf(d) === i; }).sort();
  if (!dates.length) throw new Error('FinMind 財報資料暫時無法取得');
  // 現金流量表是當年累計：減去同年前一季，換算成單季
  const cfDates = Object.keys(cf).sort();
  const cfq = function (d, k) {
    const v = cf[d] && cf[d][k];
    if (v == null) return null;
    const prev = cfDates.filter(function (x) { return x < d && x.slice(0, 4) === d.slice(0, 4); }).pop();
    return prev && cf[prev][k] != null ? v - cf[prev][k] : v;
  };
  const g = function (o, d, keys) { const r = o[d] || {}; for (let i = 0; i < keys.length; i++) if (r[keys[i]] != null) return r[keys[i]]; return null; };
  const sum = function (o, d, keys) { const r = o[d] || {}; let t = null; keys.forEach(function (k) { if (r[k] != null) t = (t || 0) + r[k]; }); return t; };
  const rows = dates.map(function (d) {
    const ocf = cfq(d, 'CashFlowsFromOperatingActivities') != null ? cfq(d, 'CashFlowsFromOperatingActivities') : cfq(d, 'NetCashInflowFromOperatingActivities');
    const capex = cfq(d, 'PropertyAndPlantAndEquipment');
    return {
      p: d,
      ta: g(bs, d, ['TotalAssets']), tl: g(bs, d, ['Liabilities']), eq: g(bs, d, ['EquityAttributableToOwnersOfParent', 'Equity']),
      ca: g(bs, d, ['CurrentAssets']), cl: g(bs, d, ['CurrentLiabilities']), cash: g(bs, d, ['CashAndCashEquivalents']),
      inv: g(bs, d, ['Inventories']), ar: sum(bs, d, ['AccountsReceivableNet', 'AccountsReceivableDuefromRelatedPartiesNet', 'NotesReceivableNet']),
      re: g(bs, d, ['RetainedEarnings']), ppe: g(bs, d, ['PropertyPlantAndEquipment']),
      debt: sum(bs, d, ['ShorttermBorrowings', 'ShortTermBorrowings', 'LongtermBorrowings', 'BondsPayable', 'CurrentPortionOfLongtermBorrowings', 'ShorttermNotesAndBillsPayable']),
      ocf: ocf, capex: capex, fcf: ocf != null && capex != null ? ocf + capex : null, dep: cfq(d, 'Depreciation'),
      rev: g(is, d, ['Revenue']), cogs: g(is, d, ['CostOfGoodsSold']), gp: g(is, d, ['GrossProfit']), op: g(is, d, ['OperatingIncome']),
      pti: g(is, d, ['PreTaxIncome']), ni: g(is, d, ['EquityAttributableToOwnersOfParent', 'IncomeAfterTaxes']), eps: g(is, d, ['EPS']),
      sh: g(bs, d, ['OrdinaryShare']) != null ? g(bs, d, ['OrdinaryShare']) / 10 : null, // 股本 ÷ 面額 10 元
    };
  }).filter(function (r) { return r.ta != null || r.rev != null; });
  return { mkt: 'TW', q: rows.slice(-24), cur: 'TWD', src: 'FinMind（公開資訊觀測站財報）' };
}

/* ---------------- 台股：進階籌碼 ---------------- */
function rxTwChips_(code) {
  const res = fetchAll_([
    fmId_('TaiwanDailyShortSaleBalances', code, daysAgo_(200)),
    fmId_('TaiwanStockDayTrading', code, daysAgo_(100)),
  ]);
  const sbl = fmRows_(res[0]).map(function (x) {
    return {
      d: x.date, sb: Math.round((x.SBLShortSalesCurrentDayBalance || 0) / 1000), ss: Math.round((x.SBLShortSalesShortSales || 0) / 1000),
      sr: Math.round((x.SBLShortSalesReturns || 0) / 1000), mb: Math.round((x.MarginShortSalesCurrentDayBalance || 0) / 1000),
    };
  }).slice(-120);
  const dt = fmRows_(res[1]).map(function (x) {
    return { d: x.date, v: Math.round((x.Volume || 0) / 1000), amt: Math.round(((x.BuyAmount || 0) + (x.SellAmount || 0)) / 2 / 1e6) / 100 }; // 張、億
  }).slice(-60);
  let tdcc = null, tdccErr = '';
  try { tdcc = rxTdcc_(code, 12); } catch (e) { tdccErr = String((e && e.message) || e); }
  let etfs = null;
  try { etfs = rxEtfHolders_(code); } catch (e) { etfs = null; }
  return { sbl: sbl, dt: dt, tdcc: tdcc, tdccErr: tdccErr, etfs: etfs };
}

/** 集保股權分散表（近 n 週）：集保網站查詢頁的表單 token 只能用一次，每次回應會附新的 token，接力查詢 */
function rxTdcc_(code, n) {
  const key = 'tdcc_' + code;
  const hit = cacheGetBig_(key);
  if (hit) return JSON.parse(hit);
  const U = 'https://www.tdcc.com.tw/portal/zh/smWeb/qryStock';
  const tokOf = function (html) { const m = String(html).match(/name="SYNCHRONIZER_TOKEN"[^>]*value="([^"]*)"/); return m ? m[1] : ''; };
  let r = fetch_(U, rxOpt_());
  let html = okText_(r);
  if (!html) throw new Error('集保結算所暫時無法連線');
  const hd = r.getAllHeaders();
  let sc = hd['Set-Cookie'] || hd['set-cookie'] || [];
  if (!Array.isArray(sc)) sc = [sc];
  const cookie = hd['X-Set-Cookie'] ? String(hd['X-Set-Cookie']) : sc.map(function (c) { return String(c).split(';')[0]; }).join('; '); // 經中繼站時為 X-Set-Cookie
  const dates = (html.match(/<option value="(\d{8})"/g) || []).map(function (x) { return x.match(/\d{8}/)[0]; }).slice(0, n);
  let tok = tokOf(html);
  const weeks = [];
  for (let i = 0; i < dates.length && tok; i++) {
    r = fetch_(U, {
      method: 'post', muteHttpExceptions: true, headers: { 'User-Agent': UA, Cookie: cookie },
      payload: { SYNCHRONIZER_TOKEN: tok, SYNCHRONIZER_URI: '/portal/zh/smWeb/qryStock', method: 'submit', firDate: dates[0], scaDate: dates[i], sqlMethod: 'StockNo', stockNo: code, stockName: '' },
    });
    html = okText_(r) || '';
    tok = tokOf(html);
    const lv = [];
    const re = /<td[^>]*>\s*(\d{1,2})\s*<\/td>\s*<td[^>]*>\s*([^<]*?)\s*<\/td>\s*<td[^>]*>\s*([\d,]+)\s*<\/td>\s*<td[^>]*>\s*([\d,]+)\s*<\/td>\s*<td[^>]*>\s*([\d.]+)\s*<\/td>/g;
    let m;
    while ((m = re.exec(html))) lv.push([+m[1], rxNum_(m[3]), rxNum_(m[4]), rxNum_(m[5])]); // 級距、人數、股數、比例%
    if (lv.length >= 15) weeks.push({ d: dates[i].slice(0, 4) + '-' + dates[i].slice(4, 6) + '-' + dates[i].slice(6), lv: lv.filter(function (x) { return x[0] <= 15; }) });
  }
  if (!weeks.length) throw new Error('集保股權分散資料暫時無法取得');
  const out = weeks.reverse(); // 舊 → 新
  cachePutBig_(key, JSON.stringify(out), 21600);
  return out;
}

/** 哪些 ETF 持有這檔（ETF 專區每日記錄的完整持股快照，只涵蓋追蹤中的 ETF） */
function rxEtfHolders_(code) {
  let idx = null;
  const hit = cacheGetBig_('etfh_idx');
  if (hit) idx = JSON.parse(hit);
  else {
    idx = {};
    const sh = etfSheet_(ETF_HOLD_SHEET);
    const n = sh.getLastRow();
    if (!n) return [];
    const keys = sh.getRange(1, 1, n, 1).getValues().map(function (r) { return String(r[0]); });
    const by = {};
    keys.forEach(function (k, i) {
      const m = k.match(/^P\|([^|]+)\|(\d{4}-\d{2}-\d{2})$/);
      if (!m) return;
      (by[m[1]] = by[m[1]] || []).push({ d: m[2], row: i + 1 });
    });
    Object.keys(by).forEach(function (etf) {
      const s = by[etf].sort(function (a, b) { return a.d < b.d ? -1 : 1; });
      const last = s[s.length - 1], prev = s.length > 1 ? s[s.length - 2] : null;
      let cur = [], old = [];
      try { cur = JSON.parse(sh.getRange(last.row, 2).getValue()); } catch (e) { return; }
      try { if (prev) old = JSON.parse(sh.getRange(prev.row, 2).getValue()); } catch (e) { old = []; }
      const om = {};
      old.forEach(function (r) { om[r[0]] = r[3]; });
      cur.forEach(function (r) {
        if (!/^\d{4,6}[A-Z]?$/.test(String(r[0]))) return;
        (idx[r[0]] = idx[r[0]] || []).push([etf, r[2], r[3], om[r[0]] != null ? om[r[0]] : null, last.d, prev ? prev.d : '']);
      });
    });
    cachePutBig_('etfh_idx', JSON.stringify(idx), 21600);
  }
  const names = rxTwMarket_().nm || {};
  return (idx[code] || []).map(function (x) { return { etf: x[0], name: names[x[0]] || '', w: x[1], sh: x[2], prev: x[3], d: x[4], pd: x[5] }; })
    .sort(function (a, b) { return (b.w || 0) - (a.w || 0); });
}

/* ---------------- 台股：新聞與事件 ---------------- */
function rxTwEvents_(code) {
  const res = fetchAll_([
    get_('https://ess.api.cnyes.com/ess/api/v1/news/keyword?q=' + encodeURIComponent(code) + '&limit=20&page=1'),
    fmId_('TaiwanStockDividendResult', code, daysAgo_(10 * 365)),
    get_('https://openapi.twse.com.tw/v1/announcement/notetrans'), get_('https://openapi.twse.com.tw/v1/announcement/punish'),
    get_('https://www.tpex.org.tw/openapi/v1/tpex_trading_warning_information'), get_('https://www.tpex.org.tw/openapi/v1/tpex_disposal_information'),
  ]);
  let news = [];
  try {
    news = (JSON.parse(okText_(res[0])).data.items || []).map(function (x) {
      return { t: String(x.title || '').replace(/<\/?mark>/g, ''), ts: (x.publishAt || 0) * 1000, u: 'https://news.cnyes.com/news/id/' + x.newsId, s: '鉅亨網' };
    });
  } catch (e) { news = []; }
  const divs = fmRows_(res[1]).map(function (x) {
    return { d: x.date, before: x.before_price, ref: x.reference_price, amt: x.stock_and_cache_dividend, kind: x.stock_or_cache_dividend };
  });
  const arr = function (r) { try { const j = JSON.parse(okText_(r)); return Array.isArray(j) ? j : []; } catch (e) { return []; } };
  const notes = [];
  arr(res[2]).filter(function (x) { return String(x.Code).trim() === code; }).forEach(function (x) { notes.push({ kind: '注意股票', text: x.RecentlyMetAttentionSecuritiesCriteria || '' }); });
  arr(res[3]).filter(function (x) { return String(x.Code).trim() === code; }).forEach(function (x) { notes.push({ kind: '處置股票', text: (x.DispositionMeasures || '') + '：' + (x.DispositionPeriod || '') + '（' + (x.ReasonsOfDisposition || '') + '）' }); });
  arr(res[4]).filter(function (x) { return String(x.SecuritiesCompanyCode).trim() === code; }).forEach(function (x) { notes.push({ kind: '注意股票', text: x.TradingInformation || '' }); });
  arr(res[5]).filter(function (x) { return String(x.SecuritiesCompanyCode).trim() === code; }).forEach(function (x) { notes.push({ kind: '處置股票', text: (x.DispositionPeriod || '') + '（' + (x.DispositionReasons || '') + '）' }); });
  return { news: news, divs: divs, notes: notes };
}

/* ---------------- 台股：同業比較 ---------------- */
/** 上市＋上櫃全市場快照（產業、股數、收盤、本益比、淨值比、殖利率、月營收年增），快取 6 小時 */
function rxTwMarket_() {
  const hit = cacheGetBig_('tw_mkt_map');
  if (hit) return JSON.parse(hit);
  const res = fetchAll_([
    get_('https://openapi.twse.com.tw/v1/opendata/t187ap05_L'), get_('https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL'),
    get_('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'), get_('https://openapi.twse.com.tw/v1/opendata/t187ap03_L'),
    get_('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O'), get_('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis'),
    get_('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'), get_('https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O'),
  ]);
  const arr = function (r) { try { const j = JSON.parse(okText_(r)); return Array.isArray(j) ? j : []; } catch (e) { return []; } };
  const m = {}, nm = {};
  const S = function (c, mk) { c = String(c || '').trim(); return c ? (m[c] = m[c] || { mk: mk }) : null; };
  arr(res[0]).forEach(function (x) { const o = S(x['公司代號'], 'tse'); if (!o) return; o.n = x['公司名稱']; o.ind = x['產業別']; o.ry = rxNum_(x['營業收入-去年同月增減(%)']); o.cy = rxNum_(x['累計營業收入-前期比較增減(%)']); o.ym = x['資料年月']; });
  arr(res[1]).forEach(function (x) { const o = m[String(x.Code).trim()]; if (!o) return; o.pe = rxNum_(x.PEratio); o.pb = rxNum_(x.PBratio); o.y = rxNum_(x.DividendYield); });
  arr(res[2]).forEach(function (x) { const c = String(x.Code).trim(); nm[c] = x.Name; const o = m[c]; if (o) o.c = rxNum_(x.ClosingPrice); });
  arr(res[3]).forEach(function (x) { const o = m[String(x['公司代號']).trim()]; if (o) o.sh = rxNum_(x['已發行普通股數或TDR原股發行股數']); });
  arr(res[4]).forEach(function (x) { const o = S(x['公司代號'], 'otc'); if (!o) return; o.n = x['公司名稱']; o.ind = x['產業別']; o.ry = rxNum_(x['營業收入-去年同月增減(%)']); o.cy = rxNum_(x['累計營業收入-前期比較增減(%)']); o.ym = x['資料年月']; });
  arr(res[5]).forEach(function (x) { const o = m[String(x.SecuritiesCompanyCode).trim()]; if (!o) return; o.pe = rxNum_(x.PriceEarningRatio); o.pb = rxNum_(x.PriceBookRatio); o.y = rxNum_(x.YieldRatio); });
  arr(res[6]).forEach(function (x) { const c = String(x.SecuritiesCompanyCode).trim(); nm[c] = x.CompanyName; const o = m[c]; if (o) o.c = rxNum_(x.Close); });
  arr(res[7]).forEach(function (x) { const o = m[String(x.SecuritiesCompanyCode).trim()]; if (o) o.sh = rxNum_(x.IssueShares); });
  Object.keys(m).forEach(function (c) { const o = m[c]; if (!o.n && nm[c]) o.n = nm[c]; o.cap = o.sh && o.c ? Math.round(o.sh * o.c / 1e6) / 100 : null; }); // 市值（億）
  const out = { m: m, nm: nm };
  if (Object.keys(m).length > 500) cachePutBig_('tw_mkt_map', JSON.stringify(out), 21600);
  return out;
}

function rxTwPeers_(code) {
  const M = rxTwMarket_().m;
  const me = M[code];
  if (!me || !me.ind) throw new Error('查無產業別（ETF 或興櫃股票沒有同業比較）');
  const list = Object.keys(M).filter(function (c) { return M[c].ind === me.ind && M[c].cap; })
    .sort(function (a, b) { return M[b].cap - M[a].cap; });
  let pick = list.slice(0, 8);
  if (pick.indexOf(code) < 0) pick = pick.slice(0, 7).concat([code]);
  const ys = pick.map(function (c) { return c + (M[c].mk === 'otc' ? '.TWO' : '.TW'); });
  const perf = sparkPerf_(ys);
  return {
    ind: me.ind, total: list.length, rank: list.indexOf(code) + 1,
    rows: pick.map(function (c, i) {
      const o = M[c], p = perf[ys[i]] || {};
      return { c: c, n: o.n, mk: o.mk, cap: o.cap, c0: o.c, pe: o.pe, pb: o.pb, y: o.y, ry: o.ry, cy: o.cy, ym: o.ym, m1: p.m1, ytd: p.ytd, m3: p.m3, me: c === code };
    }),
  };
}

/* ---------------- 美股：財務體質與 10 年財報 ---------------- */
function rxYsym_(s) {
  const r = resolveSymbol_('global', s);
  const ysym = toYahoo_(r.source);
  return { ysym: ysym, us: /^[A-Z][A-Z0-9]{0,5}(-[A-Z])?$/.test(ysym), nq: ysym.replace('-', '.') };
}

const RX_US_TYPES = {
  ta: 'TotalAssets', tl: 'TotalLiabilitiesNetMinorityInterest', eq: 'StockholdersEquity', ca: 'CurrentAssets', cl: 'CurrentLiabilities',
  cash: 'CashAndCashEquivalents', inv: 'Inventory', ar: 'AccountsReceivable', debt: 'TotalDebt', re: 'RetainedEarnings', ppe: 'NetPPE',
  ocf: 'OperatingCashFlow', capex: 'CapitalExpenditure', fcf: 'FreeCashFlow', buyback: 'RepurchaseOfCapitalStock', div: 'CashDividendsPaid',
  sh: 'OrdinarySharesNumber', rev: 'TotalRevenue', cogs: 'CostOfRevenue', gp: 'GrossProfit', op: 'OperatingIncome', ni: 'NetIncome',
  eps: 'DilutedEPS', ebit: 'EBIT', dep: 'DepreciationAndAmortization', pti: 'PretaxIncome',
};

function rxUsFin_(s) {
  const Y = rxYsym_(s);
  const keys = Object.keys(RX_US_TYPES);
  const types = keys.map(function (k) { return 'quarterly' + RX_US_TYPES[k]; }).concat(keys.map(function (k) { return 'annual' + RX_US_TYPES[k]; }));
  const p1 = Math.floor(Date.now() / 1000) - 7 * 365 * 86400, p2 = Math.floor(Date.now() / 1000);
  const series = { quarterly: {}, annual: {} };
  try {
    const j = JSON.parse(okText_(fetch_('https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/' + encodeURIComponent(Y.ysym) +
      '?type=' + types.join(',') + '&period1=' + p1 + '&period2=' + p2, rxOpt_())));
    (j.timeseries.result || []).forEach(function (x) {
      const t = x.meta.type[0], per = /^quarterly/.test(t) ? 'quarterly' : 'annual', name = t.replace(/^(quarterly|annual)/, '');
      const k = keys.filter(function (kk) { return RX_US_TYPES[kk] === name; })[0];
      (x[t] || []).forEach(function (pt) { if (pt && pt.reportedValue) (series[per][pt.asOfDate] = series[per][pt.asOfDate] || { p: pt.asOfDate })[k] = pt.reportedValue.raw; });
    });
  } catch (e) { /* 改用 SEC */ }
  const rows = function (o) {
    return Object.keys(o).sort().map(function (d) {
      const r = o[d];
      if (r.fcf == null && r.ocf != null && r.capex != null) r.fcf = r.ocf + r.capex;
      return r;
    });
  };
  const out = { mkt: 'US', q: rows(series.quarterly), a: rows(series.annual), cur: 'USD', src: 'Yahoo Finance' };
  if (Y.us) {
    try { out.sec = rxSecFacts_(Y.ysym); } catch (e) { out.secErr = String((e && e.message) || e); }
  }
  if (!out.q.length && !out.a.length && !out.sec) throw new Error('財報資料暫時無法取得');
  return out;
}

/** 美國證管會公司代號（ticker → CIK）：EDGAR 公司搜尋（www.sec.gov 的對照檔需要聯絡 Email，這個不用），快取 6 小時 */
function rxCik_(ticker) {
  const ck = 'sec_cik_' + ticker;
  const hit = CacheService.getScriptCache().get(ck);
  if (hit) return hit;
  const j = JSON.parse(okText_(fetch_('https://efts.sec.gov/LATEST/search-index?keysTyped=' + encodeURIComponent(ticker),
    { muteHttpExceptions: true, headers: { 'User-Agent': SEC_UA } })) || '{}');
  const hits = (j.hits && j.hits.hits) || [];
  const want = [ticker, ticker.replace('-', '.'), ticker.replace('-', '')];
  const h = hits.filter(function (x) {
    const t = String((x._source && x._source.tickers) || '').split(/,\s*/);
    return t.some(function (k) { return want.indexOf(k) >= 0; });
  })[0];
  if (!h) throw new Error('SEC 查無此代號');
  const cik = ('0000000000' + h._id).slice(-10);
  CacheService.getScriptCache().put(ck, cik, 21600);
  return cik;
}

// 美國公司（us-gaap）與外國公司（IFRS，例如 TSM）的科目名稱；付款類（資本支出、股利、買回）SEC 為正值，這裡轉成負值與 Yahoo 一致
// 不取 EPS：SEC 為當年原始申報值，沒有依股票分割調整，跨年比較會失真
const SEC_TAGS = {
  'us-gaap': {
    rev: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
    gp: ['GrossProfit'], op: ['OperatingIncomeLoss'], ni: ['NetIncomeLoss', 'ProfitLoss'],
    ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
    capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
    div: ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'], buyback: ['PaymentsForRepurchaseOfCommonStock'],
    eq: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'], ta: ['Assets'],
  },
  'ifrs-full': {
    rev: ['Revenue', 'RevenueFromContractsWithCustomers'], gp: ['GrossProfit'], op: ['ProfitLossFromOperatingActivities'],
    ni: ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'],
    ocf: ['CashFlowsFromUsedInOperatingActivities'], capex: ['PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities'],
    div: ['DividendsPaidClassifiedAsFinancingActivities'], buyback: ['PaymentsToAcquireOrRedeemEntitysShares'],
    eq: ['EquityAttributableToOwnersOfParent', 'Equity'], ta: ['Assets'],
  },
};
const SEC_NEG = { capex: 1, div: 1, buyback: 1 };

/** SEC XBRL 年度財報（依 SEC 曆年對齊的 frame），最多 12 年 */
function rxSecFacts_(ticker) {
  const cik = rxCik_(ticker);
  const j = JSON.parse(okText_(fetch_('https://data.sec.gov/api/xbrl/companyfacts/CIK' + cik + '.json', { muteHttpExceptions: true, headers: { 'User-Agent': SEC_UA } })) || '{}');
  const tax = j.facts && j.facts['us-gaap'] && Object.keys(j.facts['us-gaap']).length > 20 ? 'us-gaap' : j.facts && j.facts['ifrs-full'] ? 'ifrs-full' : null;
  if (!tax) throw new Error('SEC 沒有這家公司的結構化財報');
  const g = j.facts[tax], tags = SEC_TAGS[tax];
  const years = {};
  let cur = '';
  Object.keys(tags).forEach(function (k) {
    tags[k].forEach(function (tag) {
      if (!g[tag]) return;
      const units = g[tag].units || {};
      const uk = Object.keys(units).filter(function (u) { return k === 'eps' ? /\/shares$/.test(u) : !/\//.test(u); })[0];
      if (!uk) return;
      if (k === 'rev' && !cur) cur = uk;
      units[uk].forEach(function (x) {
        const m = String(x.frame || '').match(/^CY(\d{4})(Q4I)?$/);
        if (!m) return;
        const r = years[+m[1]] = years[+m[1]] || { y: +m[1] };
        if (r[k] == null) r[k] = SEC_NEG[k] ? -Math.abs(x.val) : x.val;
      });
    });
  });
  const rows = Object.keys(years).map(Number).sort().slice(-12).map(function (y) { return years[y]; }).filter(function (r) { return r.rev != null || r.ni != null; });
  if (!rows.length) throw new Error('SEC 年度財報資料不足');
  return { name: j.entityName || '', cik: cik, cur: cur || 'USD', ifrs: tax === 'ifrs-full', rows: rows };
}

/* ---------------- 美股：分析師預估與財報驚喜 ---------------- */
function rxNq_(path) { return { url: 'https://api.nasdaq.com/api/' + path, muteHttpExceptions: true, headers: nqHead_() }; }
function rxNqData_(r) { try { return JSON.parse(okText_(r)).data || null; } catch (e) { return null; } }

function rxUsEst_(s) {
  const Y = rxYsym_(s);
  if (!Y.us) throw new Error('非美國上市股票沒有 Nasdaq 預估資料');
  const res = fetchAll_([rxNq_('analyst/' + Y.nq + '/earnings-forecast'), rxNq_('company/' + Y.nq + '/earnings-surprise')]);
  const f = rxNqData_(res[0]) || {}, su = rxNqData_(res[1]) || {};
  const fr = function (x) { return { p: x.fiscalEnd, avg: rxNum_(x.consensusEPSForecast), hi: rxNum_(x.highEPSForecast), lo: rxNum_(x.lowEPSForecast), n: rxNum_(x.noOfEstimates), up: rxNum_(x.up), dn: rxNum_(x.down) }; };
  const out = {
    qf: ((f.quarterlyForecast || {}).rows || []).map(fr), yf: ((f.yearlyForecast || {}).rows || []).map(fr),
    surprise: (((su.earningsSurpriseTable || {}).rows) || []).map(function (x) {
      const m = String(x.dateReported || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return { p: x.fiscalQtrEnd, d: m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : '', eps: rxNum_(x.eps), est: rxNum_(x.consensusForecast), sp: rxNum_(x.percentageSurprise) };
    }),
  };
  if (!out.qf.length && !out.yf.length && !out.surprise.length) throw new Error('Nasdaq 預估資料暫時無法取得');
  return out;
}

/* ---------------- 美股：內部人、機構、選擇權 ---------------- */
function rxUsOwn_(s) {
  const Y = rxYsym_(s);
  if (!Y.us) throw new Error('非美國上市股票沒有 Nasdaq 持股資料');
  const res = fetchAll_([
    rxNq_('company/' + Y.nq + '/insider-trades?limit=20&type=ALL&sortColumn=lastDate&sortOrder=DESC'),
    rxNq_('company/' + Y.nq + '/institutional-holdings?limit=10&type=TOTAL&sortColumn=marketValue&sortOrder=DESC'),
  ]);
  const it = rxNqData_(res[0]) || {}, ih = rxNqData_(res[1]) || {};
  const rowsOf = function (t) { return (t && t.rows) || []; };
  const out = {
    insiderSum: rowsOf(it.numberOfTrades).concat(rowsOf(it.numberOfSharesTraded)).map(function (x) { return { k: x.insiderTrade, m3: rxNum_(x.months3), m12: rxNum_(x.months12) }; }),
    insiders: rowsOf((it.transactionTable || {}).table).map(function (x) {
      const m = String(x.lastDate || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return { who: x.insider, rel: x.relation, d: m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : x.lastDate, type: x.transactionType, sh: rxNum_(x.sharesTraded), px: rxNum_(x.lastPrice), held: rxNum_(x.sharesHeld) };
    }),
    instPct: rxNum_(((ih.ownershipSummary || {}).SharesOutstandingPCT || {}).value),
    instVal: rxNum_(((ih.ownershipSummary || {}).TotalHoldingsValue || {}).value),
    active: rowsOf(ih.activePositions).concat(rowsOf(ih.newSoldOutPositions)).map(function (x) { return { k: x.positions, holders: rxNum_(x.holders), sh: rxNum_(x.shares) }; }),
    holders: rowsOf((ih.holdingsTransactions || {}).table).map(function (x) {
      return { who: x.ownerName, d: x.date, sh: rxNum_(x.sharesHeld), chg: rxNum_(x.sharesChange), chgPct: rxNum_(x.sharesChangePCT), val: rxNum_(x.marketValue) };
    }),
  };
  try { out.opt = rxUsOptions_(Y.nq); } catch (e) { out.optErr = String((e && e.message) || e); }
  return out;
}

/** 最近的月選擇權（第三個週五）：Put/Call 比、最大未平倉履約價、最大痛點 */
function rxUsOptions_(nq) {
  const today = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  const cands = [0, 1, 2].map(function (k) { const mm = (m - 1 + k) % 12 + 1, yy = y + Math.floor((m - 1 + k) / 12); return nthDow_(yy, mm, 5, 3); })
    .filter(function (d) { return d > addDays_(today, 3); }); // 3 天內到期的不看（未平倉多已了結）
  for (let i = 0; i < cands.length && i < 2; i++) {
    const d = rxNqData_(fetch_('https://api.nasdaq.com/api/quote/' + nq + '/option-chain?assetclass=stocks&limit=600&fromdate=' + cands[i] + '&todate=' + cands[i] +
      '&excode=oprac&callput=callput&money=all&type=all', { muteHttpExceptions: true, headers: nqHead_() }));
    const rows = ((d && d.table && d.table.rows) || []).filter(function (x) { return x.strike; });
    if (!rows.length) continue;
    const ks = rows.map(function (x) {
      return { k: rxNum_(x.strike), c: rxNum_(x.c_Openinterest) || 0, p: rxNum_(x.p_Openinterest) || 0, cv: rxNum_(x.c_Volume) || 0, pv: rxNum_(x.p_Volume) || 0 };
    }).filter(function (x) { return x.k != null; }).sort(function (a, b) { return a.k - b.k; });
    const tot = function (f) { return ks.reduce(function (s2, x) { return s2 + x[f]; }, 0); };
    if (!(tot('c') + tot('p'))) continue;
    const px = rxNum_((String(d.lastTrade || '').match(/\$([\d.,]+)/) || [])[1]);
    const maxBy = function (f) { return ks.reduce(function (b, x) { return x[f] > b[f] ? x : b; }, ks[0]); };
    // 最大痛點：到期時讓買方總價值最小的履約價
    let pain = null, best = Infinity;
    ks.forEach(function (t) {
      const v = ks.reduce(function (s2, x) { return s2 + x.c * Math.max(0, t.k - x.k) + x.p * Math.max(0, x.k - t.k); }, 0);
      if (v < best) { best = v; pain = t.k; }
    });
    const near = px ? ks.filter(function (x) { return Math.abs(x.k / px - 1) <= 0.25 && (x.c || x.p); }) : ks;
    return {
      exp: cands[i], px: px, callOI: tot('c'), putOI: tot('p'), callVol: tot('cv'), putVol: tot('pv'),
      maxCall: { k: maxBy('c').k, oi: maxBy('c').c }, maxPut: { k: maxBy('p').k, oi: maxBy('p').p }, pain: pain,
      strikes: near.map(function (x) { return [x.k, x.c, x.p]; }),
    };
  }
  throw new Error('選擇權資料暫時無法取得');
}

/* ---------------- 美股：新聞與 SEC 申報 ---------------- */
const SEC_FORMS = { '10-K': '年報', '10-Q': '季報', '8-K': '重大事件', 'DEF 14A': '股東會委託書', '20-F': '外國公司年報', '6-K': '外國公司報告', 'S-1': '上市申請', '10-K/A': '年報修正', '10-Q/A': '季報修正' };
const SEC_8K_ITEMS = { '1.01': '重大合約', '1.02': '終止重大合約', '2.01': '完成收購／處分', '2.02': '財報公布', '2.03': '新增債務', '2.05': '重組／裁員', '2.06': '資產減損', '3.02': '私募增資', '5.02': '董事／高層異動', '5.03': '章程修訂', '5.07': '股東會投票結果', '7.01': '公平揭露資訊', '8.01': '其他事件' };

function rxUsEvents_(s) {
  const Y = rxYsym_(s);
  let news = [];
  try {
    const j = JSON.parse(okText_(fetch_('https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(Y.ysym) + '&newsCount=15&quotesCount=0', rxOpt_())));
    news = (j.news || []).map(function (x) { return { t: x.title, u: x.link, s: x.publisher, ts: (x.providerPublishTime || 0) * 1000 }; });
  } catch (e) { news = []; }
  let filings = [], filingsErr = '';
  if (Y.us) {
    try {
      const cik = rxCik_(Y.ysym);
      const j = JSON.parse(okText_(fetch_('https://data.sec.gov/submissions/CIK' + cik + '.json', { muteHttpExceptions: true, headers: { 'User-Agent': SEC_UA } })));
      const r = j.filings.recent;
      for (let i = 0; i < r.form.length && filings.length < 15; i++) {
        if (!SEC_FORMS[r.form[i]]) continue;
        const items = String(r.items[i] || '').split(',').map(function (x) { return SEC_8K_ITEMS[x.trim()]; }).filter(Boolean);
        filings.push({
          form: r.form[i], zh: SEC_FORMS[r.form[i]], d: r.filingDate[i], items: items.join('、'),
          u: 'https://www.sec.gov/Archives/edgar/data/' + (+cik) + '/' + String(r.accessionNumber[i]).replace(/-/g, '') + '/' + r.primaryDocument[i],
        });
      }
    } catch (e) { filingsErr = String((e && e.message) || e); }
  }
  return { news: news, filings: filings, filingsErr: filingsErr };
}

/* ---------------- 美股：同業比較 ---------------- */
function rxUsPeers_(s) {
  const Y = rxYsym_(s);
  let peers = [];
  try {
    const j = JSON.parse(okText_(fetch_('https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/' + encodeURIComponent(Y.ysym), rxOpt_())));
    peers = ((j.finance.result[0] || {}).recommendedSymbols || []).map(function (x) { return x.symbol; });
  } catch (e) { peers = []; }
  if (!peers.length) throw new Error('Yahoo 查無同業清單');
  const syms = [Y.ysym].concat(peers.filter(function (p) { return p !== Y.ysym; }).slice(0, 7));
  const p1 = Math.floor(Date.now() / 1000) - 2 * 365 * 86400, p2 = Math.floor(Date.now() / 1000);
  const T = ['trailingMarketCap', 'trailingPeRatio', 'trailingForwardPeRatio', 'trailingPbRatio', 'trailingPsRatio', 'quarterlyTotalRevenue', 'quarterlyGrossProfit', 'quarterlyOperatingIncome', 'quarterlyNetIncome'];
  const res = fetchAll_(syms.map(function (sy) {
    return get_('https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/' + encodeURIComponent(sy) + '?type=' + T.join(',') + '&period1=' + p1 + '&period2=' + p2);
  }));
  const perf = sparkPerf_(syms);
  return {
    rows: syms.map(function (sy, i) {
      const v = {};
      try {
        (JSON.parse(okText_(res[i])).timeseries.result || []).forEach(function (x) {
          const t = x.meta.type[0], pts = (x[t] || []).filter(function (p) { return p && p.reportedValue; });
          v[t] = pts.map(function (p) { return p.reportedValue.raw; });
        });
      } catch (e) { /* 這檔沒有 */ }
      const last = function (k) { const a = v[k] || []; return a.length ? a[a.length - 1] : null; };
      const rev = v.quarterlyTotalRevenue || [], n = rev.length;
      const p = perf[sy] || {};
      return {
        s: sy, n: p.name || sy, me: i === 0, price: p.price, cap: last('trailingMarketCap'), pe: last('trailingPeRatio'), fpe: last('trailingForwardPeRatio'),
        pb: last('trailingPbRatio'), ps: last('trailingPsRatio'),
        ry: n >= 5 && rev[n - 5] ? r2_((rev[n - 1] / rev[n - 5] - 1) * 100) : null,
        gm: n && last('quarterlyGrossProfit') != null ? r2_(last('quarterlyGrossProfit') / rev[n - 1] * 100) : null,
        om: n && last('quarterlyOperatingIncome') != null ? r2_(last('quarterlyOperatingIncome') / rev[n - 1] * 100) : null,
        nm: n && last('quarterlyNetIncome') != null ? r2_(last('quarterlyNetIncome') / rev[n - 1] * 100) : null,
        m1: p.m1, m3: p.m3, ytd: p.ytd,
      };
    }),
  };
}
