/**
 * 個股研究 — 後端（在 Apps Script 新增指令碼檔「Research」貼上）
 * 台股：FinMind（token 放在指令碼屬性 FINMIND_TOKEN）＋ Yahoo 走勢；美股／其他：Yahoo Finance
 * 依賴 Code.gs（fetch_、fetchAll_、getHistory_、resolveSymbol_、toYahoo_、getQuotes_）
 *      Macro.gs（get_、okText_、yahooSession_、finmindToken_）、Calendar.gs（nqHead_、nqEarnDate_）
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
  return { price: h, bench: bench };
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
