/**
 * 期貨專區 — 後端（在 Apps Script 新增指令碼檔「Futures」貼上；網頁的瀏覽器資料引擎也會載入這個檔）
 *  台灣：期交所即時行情（MIS）、三大法人期貨未平倉、大額交易人、選擇權籌碼（期交所 OpenAPI 與歷史下載）
 *  美國：期貨行情與期現價差、期限結構（Yahoo Finance）、CFTC 持倉報告（COT）
 *  另有期貨重要日期（結算日、換月、報告公布日，依規則推算）
 * 依賴 Code.gs（fetch_、fetchAll_、UA、round_、chunk_）、Macro.gs（partCache_、get_、okText_、sparkPerf_）、
 *      Calendar.gs（DAY_MS、nthDow_、addDays_、dowOf_、usHolidays_、ymdUtc_）
 */
const FUT_TTL = { tw_quote: 10, tw_inst: 1800, tw_large: 1800, tw_opt: 600, us_quote: 60, us_curve: 600, us_cot: 21600, fut_dates: 21600 };

function fut_(part, force) {
  const parts = {
    tw_quote: futTwQuote_, tw_inst: futTwInst_, tw_large: futTwLarge_, tw_opt: futTwOpt_,
    us_quote: futUsQuote_, us_curve: futUsCurve_, us_cot: futUsCot_, fut_dates: futDates_,
  };
  if (!parts[part]) throw new Error('未知的期貨區塊：' + part);
  return partCache_('f_' + part, FUT_TTL[part], force, function () { return parts[part](); });
}

/* ======================== 期交所共用 ======================== */
const TFX_API = 'https://openapi.taifex.com.tw/v1/';
const TFX_WEB = 'https://www.taifex.com.tw/cht/3/';
const TFX_MIS = 'https://mis.taifex.com.tw/futures/api/getQuoteList';
const FUT_MON = 'ABCDEFGHIJKL'; // 期交所月份代碼：A＝1 月…L＝12 月（選擇權賣權為 M＝1 月…X＝12 月）

/** 期交所即時行情（POST JSON）；MarketType 0＝一般交易時段、1＝盤後（夜盤）。tfxMisOpt_ 給 fetch_，tfxMis_ 給 fetchAll_ */
function tfxMisOpt_(o) {
  return {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'User-Agent': UA },
    payload: JSON.stringify(Object.assign({
      MarketType: '0', SymbolType: 'F', KindID: '1', CID: '', ExpireMonth: '', RowSize: '全部', PageNo: '', SortColumn: '', AscDesc: 'A',
    }, o)),
  };
}
function tfxMis_(o) { return Object.assign({ url: TFX_MIS }, tfxMisOpt_(o)); }
/** 單一 GET 的選項（fetch_ 用，不含網址） */
function futOpt_() { return { muteHttpExceptions: true, headers: { 'User-Agent': UA } }; }
function tfxMisList_(res) {
  try { const j = JSON.parse(okText_(res)); return (j.RtData && j.RtData.QuoteList) || []; } catch (e) { return []; }
}
function tfxJson_(res) {
  try { const j = JSON.parse(okText_(res)); return Array.isArray(j) ? j : []; } catch (e) { return []; }
}
function tfxNum_(s) {
  const v = parseFloat(String(s == null ? '' : s).replace(/[,%\s]/g, ''));
  return isFinite(v) ? v : null;
}
/** 期交所歷史下載（CSV，Big5／MS950 編碼）→ 去掉表頭的列；查詢日期錯誤時回傳 HTML，視為沒有資料 */
function tfxCsv_(res) {
  if (!res || res.getResponseCode() !== 200) return [];
  let t = '';
  try { t = res.getContentText('MS950'); } catch (e) { try { t = res.getContentText('Big5'); } catch (e2) { t = res.getContentText(); } }
  if (/<html|<script/i.test(t.slice(0, 400))) return [];
  return t.split(/\r?\n/).map(function (l) { return l.split(',').map(function (c) { return c.trim(); }); })
    .filter(function (r) { return /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(r[0]); });
}
function tfxDown_(path, from, to, extra) {
  return get_(TFX_WEB + path + '?queryStartDate=' + from.replace(/-/g, '/') + '&queryEndDate=' + to.replace(/-/g, '/') + (extra || ''));
}
function tfxDs_(s) { // 2026/10/13 或 20261013 → 2026-10-13
  s = String(s || '');
  const m = s.match(/^(\d{4})\/?(\d{1,2})\/?(\d{1,2})$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : s;
}
function tpToday_() { return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'); }
/** 身分別：外資、投信、自營商；文字無法辨識時依期交所固定順序（自營商、投信、外資） */
function tfxWho_(s, i) {
  s = String(s || '');
  return /外資/.test(s) ? 'f' : /投信/.test(s) ? 'it' : /自營/.test(s) ? 'dl' : ['dl', 'it', 'f'][i % 3];
}

/* ======================== 台灣期貨即時行情 ======================== */
const TW_FUT = [
  ['TXF', '臺指期', '加權指數'], ['MXF', '小臺指', '加權指數'], ['TMF', '微臺指', '加權指數'],
  ['EXF', '電子期', '電子類指數'], ['FXF', '金融期', '金融類指數'], ['XIF', '非金電期', '非金電指數'],
  ['SOF', '半導體30期', '半導體30指數'], ['GTF', '櫃買期', '櫃買指數'], ['M1F', '中型100期', '中型100指數'],
];

function tfxQuote_(q) {
  const m = String(q.SymbolID).match(/^[A-Z0-9]{3}([A-L])(\d)-[FM]$/);
  if (!m) return null;
  const cy = +String(q.CDate || tpToday_().replace(/-/g, '')).slice(0, 4);
  let y = Math.floor(cy / 10) * 10 + +m[2];
  if (y < cy - 1) y += 10;
  const num = function (k) { const v = tfxNum_(q[k]); return v ? v : null; };
  return {
    ym: y + '/' + ('0' + (FUT_MON.indexOf(m[1]) + 1)).slice(-2), last: num('CLastPrice'), ref: num('CRefPrice'),
    chg: tfxNum_(q.CDiff), pct: tfxNum_(q.CDiffRate), open: num('COpenPrice'), high: num('CHighPrice'), low: num('CLowPrice'),
    vol: tfxNum_(q.CTotalVolume) || 0, oi: tfxNum_(q.OpenInterest), bid: num('CBestBidPrice'), ask: num('CBestAskPrice'),
    date: tfxDs_(q.CDate), time: q.CTime || '',
  };
}

function futTwQuote_() {
  const res = fetchAll_([tfxMis_({ MarketType: '0' }), tfxMis_({ MarketType: '1' })]);
  const day = tfxMisList_(res[0]), night = tfxMisList_(res[1]);
  if (!day.length && !night.length) throw new Error('期交所即時行情暫時無法取得');
  const contracts = function (list, id) {
    const re = new RegExp('^' + id + '[A-L]\\d-[FM]$');
    return list.filter(function (q) { return re.test(q.SymbolID); }).map(tfxQuote_).filter(function (c) { return c; }).slice(0, 2);
  };
  const products = TW_FUT.map(function (p) {
    const sp = day.filter(function (q) { return q.SymbolID === p[0] + '-S'; })[0];
    return {
      id: p[0], name: p[1], idx: p[2],
      spot: sp ? { last: tfxNum_(sp.CLastPrice), chg: tfxNum_(sp.CDiff), pct: tfxNum_(sp.CDiffRate), time: sp.CTime || '', date: tfxDs_(sp.CDate) } : null,
      day: contracts(day, p[0]), night: contracts(night, p[0]),
    };
  }).filter(function (p) { return p.day.length || p.night.length; });
  return { products: products, dayOk: day.length > 0, nightOk: night.length > 0 };
}

/* ======================== 三大法人期貨未平倉 ======================== */
const TW_INST_CONTRACTS = ['臺股期貨', '小型臺指期貨', '微型臺指期貨', '電子期貨', '金融期貨', '股票期貨'];

/** 期交所「三大法人－區分各期貨契約－依日期」下載 → 依日期整理的未平倉淨口數 */
function tfxInstHist_(rows) {
  const by = {}, order = [];
  rows.forEach(function (r) {
    const d = tfxDs_(r[0]);
    if (!by[d]) { by[d] = { n: 0 }; order.push(d); }
    const w = tfxWho_(r[2], by[d].n++);
    by[d][w] = tfxNum_(r[13]);                                                         // 未平倉淨口數
    by[d][w + 'v'] = tfxNum_(r[14]) != null ? Math.round(tfxNum_(r[14]) / 1e3) / 100 : null; // 未平倉淨額（億）
    by[d][w + 't'] = tfxNum_(r[7]);                                                    // 當日交易淨口數
  });
  order.sort();
  const pick = function (k) { return order.map(function (d) { return by[d][k] != null ? by[d][k] : null; }); };
  return { d: order, f: pick('f'), it: pick('it'), dl: pick('dl'), fv: pick('fv'), ft: pick('ft') };
}

function futTwInst_() {
  const today = tpToday_();
  const res = fetchAll_([
    get_(TFX_API + 'MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate'),
    tfxDown_('futContractsDateDown', addDays_(today, -130), today, '&commodityId=TXF'),
    tfxDown_('futContractsDateDown', addDays_(today, -20), today, '&commodityId=MXF'),
    tfxDown_('futContractsDateDown', addDays_(today, -20), today, '&commodityId=TMF'),
    get_(TFX_API + 'DailyMarketReportFut'),
    get_('https://query2.finance.yahoo.com/v8/finance/chart/%5ETWII?range=6mo&interval=1d'),
  ]);
  const latest = tfxJson_(res[0]);
  const H = { '臺股期貨': tfxInstHist_(tfxCsv_(res[1])), '小型臺指期貨': tfxInstHist_(tfxCsv_(res[2])), '微型臺指期貨': tfxInstHist_(tfxCsv_(res[3])) };
  if (!latest.length && !H['臺股期貨'].d.length) throw new Error('期交所三大法人資料暫時無法取得');
  const date = latest.length ? tfxDs_(latest[0].Date) : H['臺股期貨'].d[H['臺股期貨'].d.length - 1];

  // 各契約最新一日（OpenAPI）；有歷史下載的契約另算日變化
  const contracts = TW_INST_CONTRACTS.map(function (name) {
    const out = { name: name };
    const rows = latest.filter(function (x) { return x.ContractCode === name; });
    const h = H[name];
    ['f', 'it', 'dl'].forEach(function (w, i) {
      const x = rows.filter(function (r) { return tfxWho_(r.Item, i) === w; })[0];
      let o = null;
      if (x) {
        o = { oi: tfxNum_(x['OpenInterest(Net)']), val: Math.round((tfxNum_(x['ContractValueofOpenInterest(Net)(Thousands)']) || 0) / 1e3) / 100, tr: tfxNum_(x['TradingVolume(Net)']) };
      } else if (h && h.d.length && h.d[h.d.length - 1] === date) {
        const n = h.d.length - 1;
        o = { oi: h[w][n], val: w === 'f' ? h.fv[n] : null, tr: w === 'f' ? h.ft[n] : null };
      }
      if (o && h && h.d.length >= 2) {
        const n = h.d.indexOf(date);
        if (n > 0 && h[w][n - 1] != null && o.oi != null) o.chg = o.oi - h[w][n - 1];
      }
      out[w] = o;
    });
    return out;
  }).filter(function (c) { return c.f || c.it || c.dl; });

  // 散戶多空比：小台、微台扣掉三大法人後的淨部位 ÷ 全市場未平倉（同一日的期交所每日行情）
  const rep = tfxJson_(res[4]);
  const repDate = rep.length ? tfxDs_(rep[0].Date) : '';
  const totalOi = function (code) {
    return rep.filter(function (x) { return x.Contract === code && /一般/.test(x.TradingSession) && !/\//.test(x['ContractMonth(Week)']); })
      .reduce(function (s, x) { return s + (tfxNum_(x.OpenInterest) || 0); }, 0);
  };
  const retail = {};
  [['mtx', 'MTX', '小型臺指期貨'], ['tmf', 'TMF', '微型臺指期貨']].forEach(function (x) {
    const c = contracts.filter(function (k) { return k.name === x[2]; })[0];
    const oi = repDate === date ? totalOi(x[1]) : 0;
    if (!c || !oi) return;
    const inst = (c.f ? c.f.oi : 0) + (c.it ? c.it.oi : 0) + (c.dl ? c.dl.oi : 0);
    retail[x[0]] = { ratio: Math.round(-inst / oi * 10000) / 100, net: -inst, oi: oi };
  });

  // 台指期法人未平倉歷史＋加權指數
  const h = H['臺股期貨'];
  const twii = {};
  try {
    const r = JSON.parse(okText_(res[5])).chart.result[0], off = r.meta.gmtoffset || 28800;
    r.timestamp.forEach(function (t, i) {
      const c = r.indicators.quote[0].close[i];
      if (c != null) twii[Utilities.formatDate(new Date((t + off) * 1000), 'UTC', 'yyyy-MM-dd')] = round_(c);
    });
  } catch (e) { /* 指數非必要 */ }
  return {
    date: date, contracts: contracts, retail: retail,
    hist: { d: h.d, f: h.f, it: h.it, dl: h.dl, fv: h.fv, twii: h.d.map(function (d) { return twii[d] != null ? twii[d] : null; }) },
  };
}

/* ======================== 大額交易人 ======================== */
/** 期交所最近幾個交易日（由 Put/Call 比資料取得，新→舊） */
function tfxDates_(pcrRows) {
  return (pcrRows || []).map(function (x) { return tfxDs_(x.Date); }).filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); })
    .sort().reverse();
}

function futTwLarge_() {
  const today = tpToday_();
  let dates = tfxDates_(tfxJson_(fetch_(TFX_API + 'PutCallRatio', futOpt_())));
  if (!dates.length) dates = [today, addDays_(today, -6)];
  const rows = tfxCsv_(fetchAll_([tfxDown_('largeTraderFutDown', dates[1] || dates[0], dates[0])])[0])
    .filter(function (r) { return r[1] === 'TX'; });
  if (!rows.length) throw new Error('期交所大額交易人資料暫時無法取得');
  const ds = rows.map(function (r) { return tfxDs_(r[0]); }).filter(function (d, i, a) { return a.indexOf(d) === i; }).sort();
  const last = ds[ds.length - 1], prev = ds.length > 1 ? ds[ds.length - 2] : null;
  const months = rows.map(function (r) { return r[3]; }).filter(function (m) { return /^\d{6}$/.test(m) && m !== '999999' && m !== '666666'; }).sort();
  const near = months[0] || '';
  const get = function (d, m, type) {
    const r = rows.filter(function (x) { return tfxDs_(x[0]) === d && x[3] === m && x[4] === type; })[0];
    return r ? { b5: tfxNum_(r[5]), s5: tfxNum_(r[6]), b10: tfxNum_(r[7]), s10: tfxNum_(r[8]), oi: tfxNum_(r[9]) } : null;
  };
  const pack = function (m, type) { return { cur: get(last, m, type), prev: prev ? get(prev, m, type) : null }; };
  return {
    date: last, prevDate: prev, near: near,
    all: pack('999999', '0'), allSp: pack('999999', '1'), nearAll: pack(near, '0'), nearSp: pack(near, '1'),
  };
}

/* ======================== 選擇權籌碼 ======================== */
function futTwOpt_() {
  const today = tpToday_();
  const res = fetchAll_([
    get_(TFX_API + 'PutCallRatio'),
    tfxDown_('callsAndPutsDateDown', addDays_(today, -60), today, '&commodityId=TXO'),
  ]);
  // Put/Call 比（約近一個月）
  const pcrRows = tfxJson_(res[0]).slice().sort(function (a, b) { return a.Date < b.Date ? -1 : 1; });
  const pcr = {
    d: pcrRows.map(function (x) { return tfxDs_(x.Date); }),
    oi: pcrRows.map(function (x) { return tfxNum_(x['PutCallOIRatio%']); }),
    vol: pcrRows.map(function (x) { return tfxNum_(x['PutCallVolumeRatio%']); }),
    callOi: pcrRows.map(function (x) { return tfxNum_(x.CallOI); }), putOi: pcrRows.map(function (x) { return tfxNum_(x.PutOI); }),
  };
  // 三大法人買權／賣權未平倉（依日期、買賣權、身分別）
  const by = {}, order = [];
  tfxCsv_(res[1]).forEach(function (r) {
    const d = tfxDs_(r[0]), cp = /PUT/i.test(r[2]) ? 'p' : 'c';
    if (!by[d]) { by[d] = { nc: 0, np: 0 }; order.push(d); }
    const w = tfxWho_(r[3], cp === 'c' ? by[d].nc++ : by[d].np++);
    by[d][cp + w] = tfxNum_(r[14]);                                              // 未平倉淨口數
    by[d][cp + w + 'v'] = tfxNum_(r[15]) != null ? Math.round(tfxNum_(r[15]) / 1e3) / 100 : null; // 未平倉淨額（億）
  });
  order.sort();
  const col = function (k) { return order.map(function (d) { return by[d][k] != null ? by[d][k] : null; }); };
  const inst = { d: order };
  ['cf', 'pf', 'cit', 'pit', 'cdl', 'pdl', 'cfv', 'pfv', 'citv', 'pitv', 'cdlv', 'pdlv'].forEach(function (k) { inst[k] = col(k); });

  // 近月台指選擇權各履約價未平倉（期交所即時行情，只取月選擇權）：最大未平倉履約價常被視為壓力與支撐
  let chain = null;
  const ym = function (d) { return d.slice(0, 4) + d.slice(5, 7); };
  const third = nthDow_(+today.slice(0, 4), +today.slice(5, 7), 3, 3);
  const nextMonth = addDays_(today.slice(0, 8) + '01', 32);
  const tries = today > third ? [ym(nextMonth)] : [ym(today), ym(nextMonth)];
  for (let i = 0; i < tries.length && !chain; i++) {
    const list = tfxMisList_(fetch_(TFX_MIS, tfxMisOpt_({ SymbolType: 'O', CID: 'TXO', ExpireMonth: tries[i] })));
    const spotRow = list.filter(function (q) { return /-Q$/.test(q.SymbolID); })[0];
    const ks = {};
    list.forEach(function (q) {
      const m = String(q.SymbolID).match(/^TXO(\d+)([A-X])\d-O$/);
      if (!m) return;
      const k = +m[1], call = m[2] <= 'L';
      const o = ks[k] = ks[k] || { k: k, c: 0, p: 0, cl: null, pl: null };
      o[call ? 'c' : 'p'] = tfxNum_(q.OpenInterest) || 0;
      o[call ? 'cl' : 'pl'] = tfxNum_(q.CLastPrice) || null;
    });
    const all = Object.keys(ks).map(function (k) { return ks[k]; }).sort(function (a, b) { return a.k - b.k; });
    const callOI = all.reduce(function (s, x) { return s + x.c; }, 0), putOI = all.reduce(function (s, x) { return s + x.p; }, 0);
    if (!all.length || !(callOI + putOI)) continue;
    const spot = spotRow ? tfxNum_(spotRow.CLastPrice) : null;
    const maxBy = function (f) { return all.reduce(function (b, x) { return x[f] > b[f] ? x : b; }, all[0]); };
    const mc = maxBy('c'), mp = maxBy('p');
    // 分布圖：現貨上下約 8% 內、有未平倉的履約價（最多 41 檔，取最接近現貨者）
    let near = all.filter(function (x) { return (x.c || x.p) && (!spot || Math.abs(x.k / spot - 1) <= 0.08); });
    if (spot && near.length > 41) near = near.sort(function (a, b) { return Math.abs(a.k - spot) - Math.abs(b.k - spot); }).slice(0, 41).sort(function (a, b) { return a.k - b.k; });
    chain = {
      month: tries[i].slice(0, 4) + '/' + tries[i].slice(4), spot: spot, callOI: callOI, putOI: putOI,
      maxCall: { k: mc.k, oi: mc.c }, maxPut: { k: mp.k, oi: mp.p },
      strikes: near.map(function (x) { return [x.k, x.c, x.p]; }),
    };
  }
  if (!pcr.d.length && !order.length && !chain) throw new Error('期交所選擇權資料暫時無法取得');
  return { date: pcr.d[pcr.d.length - 1] || order[order.length - 1] || '', pcr: pcr, inst: inst, chain: chain };
}

/* ======================== 美國期貨行情 ======================== */
const US_FUT = [
  ['股價指數', [['ES=F', 'S&P 500 期貨', '^GSPC'], ['NQ=F', '那斯達克 100 期貨', '^NDX'], ['YM=F', '道瓊期貨', '^DJI'], ['RTY=F', '羅素 2000 期貨', '^RUT']]],
  ['美國公債', [['ZT=F', '2 年期美債期貨'], ['ZF=F', '5 年期美債期貨'], ['ZN=F', '10 年期美債期貨'], ['ZB=F', '30 年期美債期貨']]],
  ['外匯', [['DX-Y.NYB', '美元指數'], ['6E=F', '歐元期貨'], ['6J=F', '日圓期貨'], ['6B=F', '英鎊期貨'], ['6A=F', '澳幣期貨']]],
  ['能源', [['CL=F', 'WTI 原油'], ['BZ=F', '布蘭特原油'], ['NG=F', '天然氣'], ['RB=F', 'RBOB 汽油'], ['HO=F', '熱燃油']]],
  ['金屬', [['GC=F', '黃金'], ['SI=F', '白銀'], ['HG=F', '銅'], ['PL=F', '白金'], ['PA=F', '鈀金']]],
  ['農產品', [['ZC=F', '玉米'], ['ZW=F', '小麥'], ['ZS=F', '黃豆'], ['KC=F', '咖啡'], ['SB=F', '原糖'], ['CT=F', '棉花'], ['LE=F', '活牛'], ['HE=F', '瘦豬']]],
  ['加密貨幣', [['BTC=F', '比特幣期貨（CME）'], ['ETH=F', '以太幣期貨（CME）']]],
];

function futUsQuote_() {
  const syms = [];
  US_FUT.forEach(function (g) { g[1].forEach(function (x) { syms.push(x[0]); if (x[2]) syms.push(x[2]); }); });
  const perf = sparkPerf_(syms);
  if (!Object.keys(perf).length) throw new Error('Yahoo 期貨報價暫時無法取得');
  return {
    groups: US_FUT.map(function (g) {
      return {
        name: g[0], items: g[1].map(function (x) {
          const p = perf[x[0]] || {}, c = x[2] ? perf[x[2]] : null;
          return {
            sym: x[0], name: x[1], cname: p.name || '', price: p.price, d1: p.d1, w1: p.w1, m1: p.m1, ytd: p.ytd, spark: p.spark,
            cash: c && c.price != null ? { sym: x[2], price: c.price, d1: c.d1 } : null,
          };
        }),
      };
    }),
  };
}

/* ======================== 期限結構 ======================== */
const FUT_CODE = 'FGHJKMNQUVXZ'; // 美國期貨月份代碼：F＝1 月…Z＝12 月
const FUT_CURVES = [
  { key: 'CL', name: 'WTI 原油', ex: 'NYM', m: 'FGHJKMNQUVXZ', n: 12, unit: '美元／桶' },
  { key: 'NG', name: '天然氣', ex: 'NYM', m: 'FGHJKMNQUVXZ', n: 12, unit: '美元／百萬英熱' },
  { key: 'GC', name: '黃金', ex: 'CMX', m: 'GJMQVZ', n: 6, unit: '美元／盎司' },
  { key: 'HG', name: '銅', ex: 'CMX', m: 'HKNUZ', n: 5, unit: '美元／磅' },
  { key: 'ES', name: 'S&P 500 期貨', ex: 'CME', m: 'HMUZ', n: 4, unit: '點' },
  { key: 'ZN', name: '10 年期美債期貨', ex: 'CBT', m: 'HMUZ', n: 3, unit: '價格' },
];
const VIX_TERM = [['^VIX9D', '9 天'], ['^VIX', '30 天'], ['^VIX3M', '3 個月'], ['^VIX6M', '6 個月'], ['^VIX1Y', '1 年']];

function futUsCurve_() {
  const now = new Date();
  const y0 = now.getUTCFullYear(), m0 = now.getUTCMonth() + 1;
  const cand = {};
  FUT_CURVES.forEach(function (c) {
    const list = [];
    for (let k = 0; k < 30 && list.length < c.n + 2; k++) {
      const mm = ((m0 - 1 + k) % 12) + 1, yy = y0 + Math.floor((m0 - 1 + k) / 12);
      const code = FUT_CODE.charAt(mm - 1);
      if (c.m.indexOf(code) < 0) continue;
      list.push({ sym: c.key + code + String(yy).slice(-2) + '.' + c.ex, label: String(yy).slice(-2) + '/' + ('0' + mm).slice(-2) });
    }
    cand[c.key] = list;
  });
  const syms = [];
  Object.keys(cand).forEach(function (k) { cand[k].forEach(function (x) { syms.push(x.sym); }); });
  VIX_TERM.forEach(function (v) { syms.push(v[0]); });
  const meta = {};
  fetchAll_(chunk_(syms, 20).map(function (c) {
    return get_('https://query1.finance.yahoo.com/v7/finance/spark?range=5d&interval=1d&symbols=' + c.map(encodeURIComponent).join(','));
  })).forEach(function (r) {
    try {
      JSON.parse(okText_(r)).spark.result.forEach(function (x) {
        const m = x.response && x.response[0] && x.response[0].meta;
        if (m && m.regularMarketPrice != null) meta[x.symbol] = { price: round_(m.regularMarketPrice), t: m.regularMarketTime || 0, prev: m.chartPreviousClose };
      });
    } catch (e) { /* ignore */ }
  });
  if (!Object.keys(meta).length) throw new Error('Yahoo 期貨報價暫時無法取得');
  const shape = function (pts) {
    if (pts.length < 2) return '';
    const r = pts[pts.length - 1].price / pts[0].price - 1;
    return r > 0.003 ? 'contango' : r < -0.003 ? 'back' : 'flat';
  };
  const curves = FUT_CURVES.map(function (c) {
    const got = cand[c.key].filter(function (x) { return meta[x.sym]; });
    const tMax = Math.max.apply(null, got.map(function (x) { return meta[x.sym].t; }).concat([0]));
    // 已到期的合約 Yahoo 仍會回傳最後價格：排除報價時間落後 4 天以上者
    const pts = got.filter(function (x) { return meta[x.sym].t >= tMax - 4 * 86400; }).slice(0, c.n)
      .map(function (x) { return { label: x.label, sym: x.sym, price: meta[x.sym].price }; });
    return { key: c.key, name: c.name, unit: c.unit, pts: pts, shape: shape(pts) };
  }).filter(function (c) { return c.pts.length >= 2; });
  const vpts = VIX_TERM.filter(function (v) { return meta[v[0]]; }).map(function (v) { return { label: v[1], sym: v[0], price: meta[v[0]].price }; });
  if (vpts.length >= 2) curves.push({ key: 'VIX', name: 'VIX 波動率期限結構', unit: '點', pts: vpts, shape: shape(vpts), idx: true });
  return { curves: curves };
}

/* ======================== CFTC 持倉報告（COT） ======================== */
const COT_MKTS = [
  ['13874A', 'S&P 500（E-mini）', '股價指數'], ['209742', '那斯達克 100（迷你）', '股價指數'], ['124603', '道瓊（迷你）', '股價指數'],
  ['239742', '羅素 2000（迷你）', '股價指數'], ['1170E1', 'VIX 期貨', '股價指數'],
  ['042601', '2 年期美債', '美國公債'], ['044601', '5 年期美債', '美國公債'], ['043602', '10 年期美債', '美國公債'], ['020601', '30 年期美債', '美國公債'],
  ['098662', '美元指數', '外匯'], ['099741', '歐元', '外匯'], ['097741', '日圓', '外匯'], ['096742', '英鎊', '外匯'], ['232741', '澳幣', '外匯'],
  ['067651', 'WTI 原油', '能源'], ['06765T', '布蘭特原油', '能源'], ['023651', '天然氣', '能源'], ['111659', 'RBOB 汽油', '能源'],
  ['088691', '黃金', '金屬'], ['084691', '白銀', '金屬'], ['085692', '銅', '金屬'],
  ['002602', '玉米', '農產品'], ['005602', '黃豆', '農產品'], ['001602', '小麥', '農產品'],
  ['133741', '比特幣（CME）', '加密貨幣'], ['146021', '以太幣（CME）', '加密貨幣'],
];

function futUsCot_() {
  const since = Utilities.formatDate(new Date(Date.now() - 380 * DAY_MS), 'UTC', 'yyyy-MM-dd');
  const where = 'cftc_contract_market_code in(' + COT_MKTS.map(function (m) { return "'" + m[0] + "'"; }).join(',') + ") AND report_date_as_yyyy_mm_dd >= '" + since + "T00:00:00.000'";
  const cols = 'report_date_as_yyyy_mm_dd,cftc_contract_market_code,open_interest_all,noncomm_positions_long_all,noncomm_positions_short_all,' +
    'comm_positions_long_all,comm_positions_short_all,nonrept_positions_long_all,nonrept_positions_short_all';
  const url = 'https://publicreporting.cftc.gov/resource/6dca-aqww.json?$select=' + encodeURIComponent(cols) +
    '&$where=' + encodeURIComponent(where) + '&$order=report_date_as_yyyy_mm_dd&$limit=5000';
  let rows = [];
  try { rows = JSON.parse(okText_(fetch_(url, futOpt_())) || '[]'); } catch (e) { rows = []; }
  if (!rows.length) throw new Error('CFTC 持倉報告暫時無法取得');
  const by = {};
  rows.forEach(function (r) {
    const c = r.cftc_contract_market_code;
    const o = by[c] = by[c] || { d: [], net: [], nl: [], ns: [], comm: [], small: [], oi: [] };
    const n = function (k) { return +r[k] || 0; };
    o.d.push(String(r.report_date_as_yyyy_mm_dd).slice(0, 10));
    o.nl.push(n('noncomm_positions_long_all')); o.ns.push(n('noncomm_positions_short_all'));
    o.net.push(n('noncomm_positions_long_all') - n('noncomm_positions_short_all'));
    o.comm.push(n('comm_positions_long_all') - n('comm_positions_short_all'));
    o.small.push(n('nonrept_positions_long_all') - n('nonrept_positions_short_all'));
    o.oi.push(n('open_interest_all'));
  });
  const mkts = COT_MKTS.filter(function (m) { return by[m[0]] && by[m[0]].d.length; })
    .map(function (m) { return Object.assign({ code: m[0], name: m[1], grp: m[2] }, by[m[0]]); });
  const last = mkts.reduce(function (s, m) { return m.d[m.d.length - 1] > s ? m.d[m.d.length - 1] : s; }, '');
  return { date: last, mkts: mkts };
}

/* ======================== 期貨重要日期 ======================== */
function futTwClosed_() {
  const hit = CacheService.getScriptCache().get('f_twhol');
  if (hit) return JSON.parse(hit);
  const closed = {};
  try {
    const j = JSON.parse(okText_(fetch_('https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?response=json', futOpt_())));
    (j.data || []).forEach(function (r) {
      const d = String(r[0]).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !/交易日/.test(String(r[1] || ''))) closed[d] = String(r[1] || '').trim();
    });
    CacheService.getScriptCache().put('f_twhol', JSON.stringify(closed), 21600);
  } catch (e) { /* 休市表非必要 */ }
  return closed;
}

function futDates_() {
  const today = tpToday_();
  const until = addDays_(today, 100);
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  const items = [];
  const push = function (d, mkt, kind, t, note) { if (d >= today && d <= until) items.push({ d: d, mkt: mkt, kind: kind, t: t, note: note || '' }); };
  const twClosed = futTwClosed_();
  const twOpen = function (d) { const w = dowOf_(d); return w !== 0 && w !== 6 && !twClosed[d]; };
  const nextTw = function (d) { while (!twOpen(d)) d = addDays_(d, 1); return d; };
  const usClosed = {};
  [y, y + 1].forEach(function (yy) { usHolidays_(yy).forEach(function (h) { usClosed[h[0]] = 1; }); });
  const usOpen = function (d) { const w = dowOf_(d); return w !== 0 && w !== 6 && !usClosed[d]; };
  const prevUs = function (d) { while (!usOpen(d)) d = addDays_(d, -1); return d; };
  const usBack = function (d, k) { while (k > 0) { d = addDays_(d, -1); if (usOpen(d)) k--; } return d; };
  const ymOf = function (k) { const mm = ((m - 1 + k) % 12 + 12) % 12 + 1; return [y + Math.floor((m - 1 + k) / 12), mm]; };

  // 台指期／台指選擇權：月結算為第三個週三，週選擇權每週三結算（遇休市順延）
  const settleTx = [];
  for (let k = 0; k < 5; k++) {
    const a = ymOf(k), d = nextTw(nthDow_(a[0], a[1], 3, 3));
    settleTx.push(d);
    push(d, 'TW', 'settle', '台指期／台指選擇權月結算', '最後交易日 13:30 收盤，以當日 13:00–13:30 加權指數平均價結算');
  }
  for (let d = today, k = 0; k < 15; k++) {
    const w = addDays_(d, (3 - dowOf_(d) + 7) % 7);
    const s = nextTw(w);
    if (settleTx.indexOf(s) < 0) push(s, 'TW', 'weekly', '台指選擇權週結算');
    d = addDays_(w, 1);
  }
  for (let k = 0; k < 5; k++) {
    const a = ymOf(k), mm = a[1];
    // 美股：指數期貨季結算（3／6／9／12 月第三個週五，四巫日）
    if ([3, 6, 9, 12].indexOf(mm) >= 0) push(prevUs(nthDow_(a[0], mm, 5, 3)), 'US', 'settle', '美股指數期貨季結算（四巫日）', 'ES、NQ、YM、RTY 到期，主力合約前一週換月');
    // VIX 期貨／選擇權：下個月第三個週五往前 30 天的週三
    const b = ymOf(k + 1);
    const vixD = addDays_(prevUs(nthDow_(b[0], b[1], 5, 3)), -30);
    push(usOpen(vixD) ? vixD : prevUs(vixD), 'US', 'settle', 'VIX 期貨／選擇權結算');
    // WTI 原油：交割月前一個月 25 日（非營業日往前）之前第 3 個營業日為最後交易日
    let d25 = ymdUtc_(a[0], mm, 25);
    if (!usOpen(d25)) d25 = prevUs(d25);
    const nb = ymOf(k + 1);
    push(usBack(d25, 3), 'US', 'roll', 'WTI 原油 ' + nb[1] + ' 月合約最後交易日', '主力合約換月，近月價格可能劇烈波動');
    // 美債期貨首次通知日：交割月（3／6／9／12）前一個月最後營業日
    if ([2, 5, 8, 11].indexOf(mm) >= 0) push(prevUs(ymdUtc_(a[0], mm + 1, 0)), 'US', 'roll', '美債期貨首次通知日（換月）', 'ZT、ZF、ZN、ZB 多數部位在此之前轉倉');
  }
  // CFTC 持倉報告：每週五美東 15:30 公布（資料為當週二），台北週六清晨；遇美國假日延後
  for (let d = today, k = 0; k < 14; k++) {
    const f = addDays_(d, (5 - dowOf_(d) + 7) % 7);
    let pub = f;
    if (!usOpen(pub)) pub = addDays_(pub, 3);
    push(pub, 'US', 'report', 'CFTC 持倉報告公布', '美東 15:30（台北隔日 03:30），資料截至當週二');
    d = addDays_(f, 1);
  }
  items.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : a.mkt < b.mkt ? -1 : 1; });
  return { today: today, until: until, twHolidays: Object.keys(twClosed).length > 0, nextTx: settleTx.filter(function (d) { return d >= today; })[0] || '', items: items };
}
