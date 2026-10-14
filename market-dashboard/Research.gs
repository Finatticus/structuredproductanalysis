/**
 * 個股研究 — 後端（在 Apps Script 新增指令碼檔「Research」貼上）
 * 台股：FinMind（需 Macro.gs 的 FINMIND_TOKEN）＋ Yahoo 走勢；美股／其他：Yahoo Finance
 * 依賴 Code.gs（fetch_、fetchAll_、getHistory_、resolveSymbol_、toYahoo_、getQuotes_）
 *      Macro.gs（get_、okText_、yahooSession_、FINMIND_TOKEN）
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

/* ======================== 美股／其他（Yahoo） ======================== */
function researchYahoo_(raw) {
  const r = resolveSymbol_('global', raw);
  const ysym = toYahoo_(r.source);
  const q = getQuotes_([r.source])[r.source];
  if (!q || q.price == null) throw new Error('查無此代號：' + raw);
  const bench = /\.T$/.test(ysym) ? '^N225' : /\.HK$/.test(ysym) ? '^HSI' : /\.KS$|\.KQ$/.test(ysym) ? '^KS11' : '^GSPC';
  const out = { mkt: 'US', code: r.symbol, source: r.source, ysym: ysym };
  Object.assign(out, researchPrices_(r.source, bench));

  const qs = yahooSummary_(ysym, 'price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,recommendationTrend,upgradeDowngradeHistory,calendarEvents');
  const pr = qs.price || {}, sd = qs.summaryDetail || {}, ks = qs.defaultKeyStatistics || {}, fd = qs.financialData || {};
  out.name = pr.shortName || pr.longName || q.name || r.symbol;
  out.currency = pr.currency || null;
  out.profile = profileOf_(qs);
  out.industry = out.profile.industry;
  out.analyst = analystOf_(qs);
  out.nextEarnings = nextEarningsOf_(qs);
  out.stats = {
    mcap: raw_(sd, 'marketCap') || raw_(pr, 'marketCap'), pe: raw_(sd, 'trailingPE'), fpe: raw_(sd, 'forwardPE'),
    pb: raw_(ks, 'priceToBook'), yld: raw_(sd, 'dividendYield') != null ? raw_(sd, 'dividendYield') * 100 : null,
    beta: raw_(sd, 'beta'), peg: raw_(ks, 'pegRatio'), roe: raw_(fd, 'returnOnEquity'), de: raw_(fd, 'debtToEquity'),
    fcf: raw_(fd, 'freeCashflow'), cur: raw_(fd, 'currentRatio'),
    inst: raw_(ks, 'heldPercentInstitutions'), insider: raw_(ks, 'heldPercentInsiders'),
    shortPct: raw_(ks, 'shortPercentOfFloat'), shortRatio: raw_(ks, 'shortRatio'),
    shortNow: raw_(ks, 'sharesShort'), shortPrev: raw_(ks, 'sharesShortPriorMonth'),
  };
  out.shares = raw_(ks, 'sharesOutstanding');

  // 財報時間序列（季＋年）
  const types = ['TotalRevenue', 'GrossProfit', 'OperatingIncome', 'NetIncome', 'DilutedEPS'];
  const tsTypes = types.map(function (t) { return 'quarterly' + t; }).concat(types.map(function (t) { return 'annual' + t; }));
  const p1 = Math.floor(Date.now() / 1000) - 7 * 365 * 86400, p2 = Math.floor(Date.now() / 1000);
  const series = {};
  try {
    const sess = yahooSession_(false);
    const res = fetch_('https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/' + encodeURIComponent(ysym) +
      '?type=' + tsTypes.join(',') + '&period1=' + p1 + '&period2=' + p2 + '&crumb=' + encodeURIComponent(sess.crumb),
      { muteHttpExceptions: true, headers: { 'User-Agent': UA, Cookie: sess.cookie } });
    (JSON.parse(res.getContentText()).timeseries.result || []).forEach(function (x) {
      const t = x.meta.type[0];
      (x[t] || []).forEach(function (p) {
        if (!p) return;
        (series[p.asOfDate] = series[p.asOfDate] || {})[t] = p.reportedValue.raw;
      });
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
    const j = JSON.parse(okText_(fetch_('https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ysym) + '?range=10y&interval=3mo&events=div',
      { muteHttpExceptions: true, headers: { 'User-Agent': UA } })));
    const dv = (j.chart.result[0].events || {}).dividends || {};
    out.div = Object.keys(dv).map(function (k) { return { t: dv[k].date * 1000, cash: r2_(dv[k].amount) }; })
      .sort(function (a, b) { return b.t - a.t; });
  } catch (e) { out.div = []; }
  return out;
}
