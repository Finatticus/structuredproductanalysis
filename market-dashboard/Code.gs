/**
 * 金融市場監控儀表板 — Google Apps Script 後端
 * ------------------------------------------------------------
 * 部署方式：見 README.md
 *  - 試算表「Account」工作頁：A 欄帳號、B 欄密碼（加鹽 SHA-256 雜湊）、C 欄建立時間
 *  - 每個帳號有一張同名工作頁，存放該使用者的監控清單與日後所有資料
 *
 * 報價來源（後端代抓，前端每 N 秒輪詢）：
 *  - 台股上市/上櫃：證交所 MIS 即時行情 (mis.twse.com.tw)
 *  - 台股興櫃、匯率、國外股票、指數/期貨：Yahoo Finance
 *  - 虛擬貨幣：由前端直接連 Binance WebSocket（GAS 主機在美國，無法連 Binance）
 */

/* ======================== 設定 ======================== */
const SPREADSHEET_ID = '';            // 若腳本是從試算表「擴充功能 → Apps Script」建立，留空即可
const ACCOUNT_SHEET = 'Account';
const TOKEN_TTL_SEC = 21600;          // 登入有效 6 小時（CacheService 上限）
const QUOTE_CACHE_SEC = 8;            // 報價快取秒數，多人/多分頁共用以節省 UrlFetch 配額
const WATCH_HEADERS = ['類別', '代碼', '顯示名稱', '資料來源', '新增時間'];
const CATEGORIES = ['fx', 'tw', 'global', 'index', 'crypto'];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

/** 新帳號預設監控清單：[類別, 代碼, 顯示名稱, 資料來源] */
const DEFAULT_WATCHLIST = [
  ['fx', 'USD/TWD', '美元/台幣', 'yahoo:USDTWD=X'],
  ['fx', 'JPY/TWD', '日圓/台幣', 'yahoo:JPYTWD=X'],
  ['fx', 'USD/JPY', '美元/日圓', 'yahoo:USDJPY=X'],
  ['fx', 'USD/HKD', '美元/港幣', 'yahoo:USDHKD=X'],
  ['fx', 'USD/KRW', '美元/韓元', 'yahoo:USDKRW=X'],
  ['fx', 'USD/EUR', '美元/歐元', 'yahoo:USDEUR=X'],
  ['fx', 'USD/GBP', '美元/英鎊', 'yahoo:USDGBP=X'],

  ['tw', '2330', '台積電', 'mis:tse_2330.tw'],
  ['tw', '2308', '台達電', 'mis:tse_2308.tw'],
  ['tw', '2454', '聯發科', 'mis:tse_2454.tw'],
  ['tw', '3595', '山太士', 'yahoo:3595.TWO'],

  ['global', 'TSM', '台積電 ADR', 'yahoo:TSM'],
  ['global', 'NVDA', '輝達', 'yahoo:NVDA'],
  ['global', 'AMD', '超微', 'yahoo:AMD'],
  ['global', 'MU', '美光', 'yahoo:MU'],
  ['global', '7011 JP', '三菱重工', 'yahoo:7011.T'],
  ['global', '7012 JP', '川崎重工', 'yahoo:7012.T'],
  ['global', '7013 JP', 'IHI', 'yahoo:7013.T'],

  ['index', 'SPX', 'S&P 500', 'yahoo:^GSPC'],
  ['index', 'GOLD', '黃金期貨', 'yahoo:GC=F'],
  ['index', 'WTI', 'WTI 原油', 'yahoo:CL=F'],

  ['crypto', 'BTCUSDT', 'BTC', 'binance:BTCUSDT'],
  ['crypto', 'ETHUSDT', 'ETH', 'binance:ETHUSDT'],
  ['crypto', 'SOLUSDT', 'SOL', 'binance:SOLUSDT'],
  ['crypto', 'TSMUSDT', 'TSM 永續', 'binancef:TSMUSDT'],
  ['crypto', 'NVDAUSDT', 'NVDA 永續', 'binancef:NVDAUSDT'],
];

/** 國外股票「代號 + 空格 + 市場」的市場代碼 → Yahoo 後綴 */
const MARKET_SUFFIX = {
  US: '', JP: '.T', HK: '.HK', KS: '.KS', KQ: '.KQ', CH: '.SS', SZ: '.SZ',
  LN: '.L', GR: '.DE', FP: '.PA', NA: '.AS', SW: '.SW', AU: '.AX',
  CN: '.TO', SP: '.SI', IN: '.NS', TT: '.TW',
};

/** 指數別名 → Yahoo 代碼 */
const INDEX_ALIAS = {
  SPX: ['^GSPC', 'S&P 500'], GSPC: ['^GSPC', 'S&P 500'],
  NDX: ['^NDX', 'Nasdaq 100'], IXIC: ['^IXIC', 'Nasdaq 綜合'], NASDAQ: ['^IXIC', 'Nasdaq 綜合'],
  DJI: ['^DJI', '道瓊工業'], DOW: ['^DJI', '道瓊工業'],
  SOX: ['^SOX', '費城半導體'], VIX: ['^VIX', 'VIX 恐慌指數'], RUT: ['^RUT', '羅素 2000'],
  TWII: ['^TWII', '台灣加權'], TAIEX: ['^TWII', '台灣加權'], '加權': ['^TWII', '台灣加權'],
  N225: ['^N225', '日經 225'], NIKKEI: ['^N225', '日經 225'], '日經': ['^N225', '日經 225'],
  HSI: ['^HSI', '恆生指數'], KOSPI: ['^KS11', '韓國綜合'], SSE: ['000001.SS', '上證指數'],
  DAX: ['^GDAXI', '德國 DAX'], FTSE: ['^FTSE', '英國富時 100'],
  DXY: ['DX-Y.NYB', '美元指數'], US10Y: ['^TNX', '美債 10 年殖利率'],
  GOLD: ['GC=F', '黃金期貨'], XAU: ['GC=F', '黃金期貨'], '黃金': ['GC=F', '黃金期貨'],
  SILVER: ['SI=F', '白銀期貨'], '白銀': ['SI=F', '白銀期貨'],
  WTI: ['CL=F', 'WTI 原油'], '原油': ['CL=F', 'WTI 原油'], BRENT: ['BZ=F', '布蘭特原油'],
  NG: ['NG=F', '天然氣'], COPPER: ['HG=F', '銅期貨'], '銅': ['HG=F', '銅期貨'],
};

/* ======================== 進入點 ======================== */
function doGet() {
  return json_({ ok: true, msg: 'Market Dashboard API is running.' });
}

function doPost(e) {
  let res;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    res = route_(req);
  } catch (err) {
    res = { ok: false, error: String((err && err.message) || err), code: (err && err.code) || '' };
  }
  return json_(res);
}

function route_(req) {
  switch (req.action) {
    case 'register': return register_(req.account, req.password);
    case 'login':    return login_(req.account, req.password);
    case 'logout':
      if (req.token) CacheService.getScriptCache().remove('tok_' + req.token);
      return { ok: true };
    case 'watchlist': {
      const acc = auth_(req.token);
      return { ok: true, account: acc, items: getWatchlist_(acc), settings: getSettings_(acc) };
    }
    case 'reorder': {
      const acc = auth_(req.token);
      reorderWatchlist_(acc, req.keys || []);
      return { ok: true };
    }
    case 'saveSetting': {
      const acc = auth_(req.token);
      saveSetting_(acc, String(req.key || ''), String(req.value == null ? '' : req.value));
      return { ok: true };
    }
    case 'intraday': {
      auth_(req.token);
      const sources = (req.sources || []).filter(function (s) { return /^(yahoo|mis):/.test(s); });
      const data = getIntraday_(sources);
      return { ok: true, data: data, usage: getUsage_() };
    }
    case 'macro': {
      const acc = auth_(req.token);
      const data = macro_(String(req.part || ''), !!req.force, acc); // 定義於 Macro.gs
      return { ok: true, data: data, usage: getUsage_() };
    }
    case 'research': {
      auth_(req.token);
      return { ok: true, data: research_(req.symbol), usage: getUsage_() }; // 定義於 Research.gs
    }
    case 'screener': {
      auth_(req.token);
      return { ok: true, data: screenerTable_() }; // 定義於 Screener.gs
    }
    case 'history': {
      auth_(req.token);
      const data = getHistory_(String(req.source || ''), String(req.interval || '1d'));
      return { ok: true, data: data, usage: getUsage_() };
    }
    case 'add': {
      const acc = auth_(req.token);
      return { ok: true, item: addSymbol_(acc, req.category, req.symbol, req.name, req.source) };
    }
    case 'remove': {
      const acc = auth_(req.token);
      removeSymbol_(acc, req.category, req.symbol);
      return { ok: true };
    }
    case 'quotes': {
      auth_(req.token);
      const sources = (req.sources || []).filter(function (s) { return /^(yahoo|mis):/.test(s); });
      const quotes = getQuotes_(sources);
      return { ok: true, quotes: quotes, serverTime: Date.now(), usage: getUsage_() };
    }
    default:
      throw new Error('未知的 action：' + req.action);
  }
}

/* ======================== 帳號 ======================== */
function register_(account, password) {
  account = String(account || '').trim();
  password = String(password || '');
  if (!/^[A-Za-z0-9_.\-]{3,30}$/.test(account)) throw new Error('帳號需為 3–30 個英文、數字或 _ . -');
  if (account.toLowerCase() === ACCOUNT_SHEET.toLowerCase()) throw new Error('此帳號名稱不可使用');
  if (password.length < 6) throw new Error('密碼至少 6 個字元');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = ss_();
    const sh = accountSheet_();
    if (findAccountRow_(sh, account)) throw new Error('此帳號已被註冊');
    if (ss.getSheetByName(account)) throw new Error('此帳號名稱已被使用');

    const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    sh.appendRow([account, salt + '$' + sha256_(salt + password), new Date()]);
    createUserSheet_(account);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

function login_(account, password) {
  account = String(account || '').trim();
  const sh = accountSheet_();
  const row = findAccountRow_(sh, account);
  if (!row) throw new Error('帳號或密碼錯誤');
  const stored = String(sh.getRange(row, 2).getValue());
  const parts = stored.split('$');
  const ok = parts.length === 2 && sha256_(parts[0] + String(password || '')) === parts[1];
  if (!ok) throw new Error('帳號或密碼錯誤');

  const realName = String(sh.getRange(row, 1).getValue());
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('tok_' + token, realName, TOKEN_TTL_SEC);
  return { ok: true, token: token, account: realName };
}

function auth_(token) {
  const cache = CacheService.getScriptCache();
  const acc = token ? cache.get('tok_' + token) : null;
  if (!acc) {
    const err = new Error('登入已逾時，請重新登入');
    err.code = 'AUTH';
    throw err;
  }
  cache.put('tok_' + token, acc, TOKEN_TTL_SEC); // 滑動續期
  return acc;
}

function findAccountRow_(sh, account) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const vals = sh.getRange(2, 1, last - 1, 1).getValues();
  const key = account.toLowerCase();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim().toLowerCase() === key) return i + 2;
  }
  return 0;
}

function accountSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(ACCOUNT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ACCOUNT_SHEET, 0);
    sh.getRange('A:B').setNumberFormat('@');
    sh.getRange(1, 1, 1, 3).setValues([['帳號', '密碼', '建立時間']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function createUserSheet_(account) {
  const sh = ss_().insertSheet(account);
  sh.getRange('B:D').setNumberFormat('@'); // 代碼保持文字（避免 0050 變 50）
  sh.getRange(1, 1, 1, WATCH_HEADERS.length).setValues([WATCH_HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  const now = new Date();
  const rows = DEFAULT_WATCHLIST.map(function (r) { return r.concat([now]); });
  sh.getRange(2, 1, rows.length, WATCH_HEADERS.length).setValues(rows);
  return sh;
}

function userSheet_(account) {
  return ss_().getSheetByName(account) || createUserSheet_(account);
}

/* ======================== 監控清單 ======================== */
// 使用者工作頁：A:E 為監控清單；G:H 為設定（鍵/值），兩區互不影響，所以刪除時不用 deleteRow
const SETTING_COL = 7; // G

function lastWatchRow_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return 1;
  const vals = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i][0] !== '') return i + 2;
  return 1;
}

function readWatchRows_(sh) {
  const last = lastWatchRow_(sh);
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 5).getValues().filter(function (r) { return r[0] && r[1]; });
}

function writeWatchRows_(sh, rows) {
  const last = lastWatchRow_(sh);
  if (last >= 2) sh.getRange(2, 1, last - 1, 5).clearContent();
  if (!rows.length) return;
  sh.getRange(2, 2, rows.length, 3).setNumberFormat('@');
  sh.getRange(2, 1, rows.length, 5).setValues(rows);
}

function getWatchlist_(account) {
  return readWatchRows_(userSheet_(account)).map(function (r) {
    return { category: String(r[0]), symbol: String(r[1]), name: String(r[2] || r[1]), source: String(r[3]) };
  });
}

function addSymbol_(account, category, symbol, name, sourceHint) {
  if (CATEGORIES.indexOf(category) < 0) throw new Error('未知的類別');
  const r = resolveSymbol_(category, symbol, sourceHint);
  const list = getWatchlist_(account);
  const dup = list.some(function (it) {
    return it.category === category && (it.symbol === r.symbol || it.source === r.source);
  });
  if (dup) throw new Error(r.symbol + ' 已在清單中');

  let quote = null;
  if (/^(yahoo|mis):/.test(r.source)) {
    quote = getQuotes_([r.source])[r.source];
    if (!quote || quote.price == null) throw new Error('查無報價：' + r.symbol + '，請確認代碼格式');
  }
  const display = String(name || '').trim() || r.name || (quote && quote.name) || r.symbol;
  const sh = userSheet_(account);
  const row = lastWatchRow_(sh) + 1;
  sh.getRange(row, 2, 1, 3).setNumberFormat('@');
  sh.getRange(row, 1, 1, 5).setValues([[category, r.symbol, display, r.source, new Date()]]);
  return { category: category, symbol: r.symbol, name: display, source: r.source, quote: quote };
}

function removeSymbol_(account, category, symbol) {
  const sh = userSheet_(account);
  const rows = readWatchRows_(sh);
  const kept = rows.filter(function (r) { return !(String(r[0]) === category && String(r[1]) === String(symbol)); });
  if (kept.length !== rows.length) writeWatchRows_(sh, kept);
}

/** keys：依新順序排列的 "類別|代碼" 陣列；未列到的列保留在最後 */
function reorderWatchlist_(account, keys) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = userSheet_(account);
    const rows = readWatchRows_(sh);
    const map = {};
    rows.forEach(function (r) { map[r[0] + '|' + r[1]] = r; });
    const out = [];
    keys.forEach(function (k) { if (map[k]) { out.push(map[k]); delete map[k]; } });
    rows.forEach(function (r) { if (map[r[0] + '|' + r[1]]) out.push(r); });
    writeWatchRows_(sh, out);
  } finally {
    lock.releaseLock();
  }
}

function getSettings_(account) {
  const sh = userSheet_(account);
  const last = sh.getLastRow();
  const out = {};
  if (last < 2) return out;
  sh.getRange(2, SETTING_COL, last - 1, 2).getValues().forEach(function (r) {
    if (r[0] !== '') out[String(r[0])] = String(r[1]);
  });
  return out;
}

function saveSetting_(account, key, value) {
  if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) throw new Error('設定名稱不合法');
  const sh = userSheet_(account);
  if (sh.getRange(1, SETTING_COL).getValue() === '') {
    sh.getRange(1, SETTING_COL, 1, 2).setValues([['設定項目', '值']]).setFontWeight('bold');
  }
  const last = Math.max(sh.getLastRow(), 1);
  const keys = last >= 2 ? sh.getRange(2, SETTING_COL, last - 1, 1).getValues() : [];
  let row = 0;
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === key) { row = i + 2; break; }
  }
  if (!row) {
    row = 2;
    while (row - 2 < keys.length && keys[row - 2][0] !== '') row++;
  }
  sh.getRange(row, SETTING_COL + 1).setNumberFormat('@');
  sh.getRange(row, SETTING_COL, 1, 2).setValues([[key, value]]);
}

/** 使用者輸入 → { symbol(顯示代碼), source(資料來源), name } */
function resolveSymbol_(category, raw, hint) {
  const input = String(raw || '').trim();
  const s = input.toUpperCase().replace(/\s+/g, ' ');
  if (!s) throw new Error('請輸入代碼');

  if (category === 'fx') {
    const m = s.replace(/\s/g, '').match(/^([A-Z]{3})[\/\-]?([A-Z]{3})$/);
    if (!m) throw new Error('匯率格式：基準幣/報價幣，例如 USD/TWD、EUR/USD');
    return { symbol: m[1] + '/' + m[2], source: 'yahoo:' + m[1] + m[2] + '=X', name: m[1] + '/' + m[2] };
  }

  if (category === 'tw') {
    const code = s.replace(/\.(TW|TWO)$/, '');
    if (!/^[0-9]{4,6}[A-Z]?$/.test(code)) throw new Error('台股格式：4–6 碼股票代號，例如 2330、0050、00878');
    const lc = code.toLowerCase();
    const mis = fetchQuotesRaw_(['mis:tse_' + lc + '.tw', 'mis:otc_' + lc + '.tw']);
    for (const k in mis) {
      if (mis[k] && mis[k].price != null) return { symbol: code, source: k, name: mis[k].name };
    }
    // 興櫃或 MIS 未涵蓋者 → Yahoo
    const y = fetchQuotesRaw_(['yahoo:' + code + '.TWO', 'yahoo:' + code + '.TW']);
    for (const k in y) {
      if (y[k] && y[k].price != null) return { symbol: code, source: k, name: '' };
    }
    throw new Error('查無此台股代號：' + code);
  }

  if (category === 'global') {
    const m = s.match(/^([A-Z0-9.\-]+) ([A-Z]{2})$/);
    if (m) {
      if (!(m[2] in MARKET_SUFFIX)) throw new Error('不支援的市場代碼：' + m[2] + '（可用：' + Object.keys(MARKET_SUFFIX).join(', ') + '）');
      return { symbol: m[1] + ' ' + m[2], source: 'yahoo:' + m[1] + MARKET_SUFFIX[m[2]], name: '' };
    }
    if (/^[A-Z0-9.\-]{1,20}$/.test(s)) return { symbol: s, source: 'yahoo:' + s, name: '' };
    throw new Error('國外股票格式：美股直接輸入代號（NVDA）；其他市場「代號 空格 市場」，例如 7011 JP、0700 HK');
  }

  if (category === 'index') {
    const alias = INDEX_ALIAS[s] || INDEX_ALIAS[input];
    if (alias) return { symbol: s, source: 'yahoo:' + alias[0], name: alias[1] };
    if (/^[\^A-Z0-9.\-=]{1,20}$/.test(s)) return { symbol: s, source: 'yahoo:' + s, name: '' };
    throw new Error('指數格式：輸入別名（SPX、SOX、GOLD…）或 Yahoo 代碼（^GSPC、GC=F）');
  }

  if (category === 'crypto') {
    const sym = s.replace(/[\/\-\s]/g, '');
    if (!/^[A-Z0-9]{5,20}$/.test(sym)) throw new Error('虛擬貨幣格式：Binance 交易對，例如 BTCUSDT');
    const market = /^binancef:/.test(String(hint || '')) ? 'binancef' : 'binance';
    return { symbol: sym, source: market + ':' + sym, name: sym };
  }
  throw new Error('未知的類別');
}

/* ======================== 報價 ======================== */
/** 帶快取的報價：回傳 { source: {price, prev, chg, pct, name, time} } */
function getQuotes_(sources) {
  sources = sources.filter(function (s, i) { return sources.indexOf(s) === i; });
  if (!sources.length) return {};
  const cache = CacheService.getScriptCache();
  const keys = sources.map(function (s) { return 'q_' + s; });
  const hit = cache.getAll(keys);
  const out = {};
  const miss = [];
  sources.forEach(function (s) {
    const v = hit['q_' + s];
    if (v) out[s] = JSON.parse(v); else miss.push(s);
  });
  if (miss.length) {
    const fresh = fetchQuotesRaw_(miss);
    const toCache = {};
    for (const k in fresh) {
      out[k] = fresh[k];
      toCache['q_' + k] = JSON.stringify(fresh[k]);
    }
    if (Object.keys(toCache).length) cache.putAll(toCache, QUOTE_CACHE_SEC);
  }
  return out;
}

/** 不經快取，直接向來源抓報價（一次 fetchAll 平行請求） */
function fetchQuotesRaw_(sources) {
  const mis = [], yh = [];
  sources.forEach(function (s) {
    if (s.indexOf('mis:') === 0) mis.push(s.slice(4));
    else if (s.indexOf('yahoo:') === 0) yh.push(s.slice(6));
  });

  const reqs = [], parsers = [];
  chunk_(mis, 40).forEach(function (c) {
    reqs.push({
      url: 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&_=' + Date.now() +
           '&ex_ch=' + encodeURIComponent(c.join('|')),
      muteHttpExceptions: true,
      headers: { 'User-Agent': UA, 'Referer': 'https://mis.twse.com.tw/stock/index.jsp' },
    });
    parsers.push(parseMis_);
  });
  chunk_(yh, 20).forEach(function (c) {
    reqs.push({
      url: 'https://query1.finance.yahoo.com/v7/finance/spark?range=1d&interval=1d&symbols=' +
           c.map(encodeURIComponent).join(','),
      muteHttpExceptions: true,
      headers: { 'User-Agent': UA },
    });
    parsers.push(parseSpark_);
  });
  if (!reqs.length) return {};

  const out = {};
  const resps = fetchAll_(reqs);
  resps.forEach(function (r, i) {
    if (r.getResponseCode() !== 200) return;
    try { Object.assign(out, parsers[i](r.getContentText())); } catch (e) { /* 單一來源失敗不影響其他 */ }
  });

  // Yahoo spark 失敗時，對缺漏的代碼改用 v8 chart (query2) 逐檔補抓
  const missing = yh.filter(function (y) { return !out['yahoo:' + y]; });
  if (missing.length && missing.length <= 30) {
    const fb = fetchAll_(missing.map(function (y) {
      return {
        url: 'https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(y) + '?range=1d&interval=1d',
        muteHttpExceptions: true, headers: { 'User-Agent': UA },
      };
    }));
    fb.forEach(function (r, i) {
      if (r.getResponseCode() !== 200) return;
      try {
        const res = JSON.parse(r.getContentText()).chart.result[0];
        const q = yahooMeta_(res.meta);
        if (q) out['yahoo:' + missing[i]] = q; // 以請求代碼為 key（Yahoo 可能回傳別名，如 USDTWD=X → TWD=X）
      } catch (e) { /* ignore */ }
    });
  }
  return out;
}

function parseMis_(text) {
  const data = JSON.parse(text);
  const out = {};
  (data.msgArray || []).forEach(function (x) {
    if (!x.c || !x.ex || !x.ch) return;
    const prev = num_(x.y);
    const bid = num_(String(x.b || '').split('_')[0]);
    const ask = num_(String(x.a || '').split('_')[0]);
    let price = num_(x.z);                                  // 最近成交價（無成交時為 "-"）
    if (price == null) price = num_(x.pz);                  // 前一筆成交價
    if (price == null && bid != null && ask != null) price = (bid + ask) / 2;
    if (price == null) price = bid != null ? bid : (ask != null ? ask : prev);
    out['mis:' + x.ex + '_' + x.ch] = quote_(price, prev, x.n || x.c, Number(x.tlong) || Date.now());
  });
  return out;
}

function parseSpark_(text) {
  const data = JSON.parse(text);
  const out = {};
  ((data.spark && data.spark.result) || []).forEach(function (r) {
    const meta = r.response && r.response[0] && r.response[0].meta;
    const q = meta && yahooMeta_(meta);
    if (q) out['yahoo:' + r.symbol] = q;
  });
  return out;
}

function yahooMeta_(meta) {
  if (meta.regularMarketPrice == null) return null;
  const prev = meta.previousClose != null ? meta.previousClose : meta.chartPreviousClose;
  return quote_(meta.regularMarketPrice, prev, meta.shortName || meta.longName || meta.symbol,
                (meta.regularMarketTime || 0) * 1000);
}

function quote_(price, prev, name, time) {
  if (price == null) return { price: null };
  const chg = prev ? price - prev : null;
  return {
    price: price,
    prev: prev != null ? prev : null,
    chg: chg,
    pct: prev ? (chg / prev) * 100 : null,
    name: name,
    time: time,
  };
}

/* ======================== 走勢 / 歷史 ======================== */
const INTRADAY_CACHE_SEC = 120;
const HISTORY_CACHE_SEC = 600;
// 預設顯示近 3 年；多抓一些歷史讓 SMA120 等指標一開始就有值，也可往左拖看更早
const HISTORY_RANGE = { '1d': '5y', '1wk': '10y', '1mo': 'max' };

/** 資料來源 → Yahoo 代碼（台股 MIS 對應 .TW / .TWO） */
function toYahoo_(source) {
  if (source.indexOf('yahoo:') === 0) return source.slice(6);
  const m = source.match(/^mis:(tse|otc)_(.+)\.tw$/);
  if (m) return m[2].toUpperCase() + (m[1] === 'tse' ? '.TW' : '.TWO');
  return null;
}

/** 當日走勢（5 分線收盤價），回傳 { source: { c: [...], prev } } */
function getIntraday_(sources) {
  sources = sources.filter(function (s, i) { return sources.indexOf(s) === i && toYahoo_(s); });
  if (!sources.length) return {};
  const cache = CacheService.getScriptCache();
  const hit = cache.getAll(sources.map(function (s) { return 'i_' + s; }));
  const out = {}, miss = [];
  sources.forEach(function (s) {
    const v = hit['i_' + s];
    if (v) out[s] = JSON.parse(v); else miss.push(s);
  });
  if (!miss.length) return out;

  const bySym = {};
  miss.forEach(function (s) { bySym[toYahoo_(s)] = s; });
  const reqs = chunk_(Object.keys(bySym), 20).map(function (c) {
    return {
      url: 'https://query1.finance.yahoo.com/v7/finance/spark?range=1d&interval=5m&symbols=' +
           c.map(encodeURIComponent).join(','),
      muteHttpExceptions: true, headers: { 'User-Agent': UA },
    };
  });
  const toCache = {};
  fetchAll_(reqs).forEach(function (r) {
    if (r.getResponseCode() !== 200) return;
    try {
      (JSON.parse(r.getContentText()).spark.result || []).forEach(function (x) {
        const src = bySym[x.symbol];
        const resp = x.response && x.response[0];
        if (!src || !resp) return;
        const closes = ((resp.indicators.quote[0] || {}).close || [])
          .filter(function (v) { return v != null; })
          .map(function (v) { return round_(v); });
        const d = { c: closes, prev: resp.meta.chartPreviousClose != null ? resp.meta.chartPreviousClose : resp.meta.previousClose };
        out[src] = d;
        toCache['i_' + src] = JSON.stringify(d);
      });
    } catch (e) { /* ignore */ }
  });
  if (Object.keys(toCache).length) cache.putAll(toCache, INTRADAY_CACHE_SEC);
  return out;
}

/** 歷史 K 線：{ t:['YYYY-MM-DD'], o, h, l, c, v } */
function getHistory_(source, interval) {
  if (!HISTORY_RANGE[interval]) throw new Error('週期參數錯誤');
  const sym = toYahoo_(source);
  if (!sym) throw new Error('此來源不支援歷史資料');
  const cache = CacheService.getScriptCache();
  const key = 'h_' + interval + '_' + sym;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const url = 'https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) +
              '?range=' + HISTORY_RANGE[interval] + '&interval=' + interval + '&includePrePost=false';
  let res = fetch_(url, { muteHttpExceptions: true, headers: { 'User-Agent': UA } });
  if (res.getResponseCode() !== 200) {
    res = fetch_(url.replace('query2', 'query1'), { muteHttpExceptions: true, headers: { 'User-Agent': UA } });
  }
  if (res.getResponseCode() !== 200) throw new Error('歷史資料取得失敗（HTTP ' + res.getResponseCode() + '）');
  const r = JSON.parse(res.getContentText()).chart.result[0];
  const q = r.indicators.quote[0];
  const off = r.meta.gmtoffset || 0;
  const rows = {};
  (r.timestamp || []).forEach(function (ts, i) {
    if (q.close[i] == null || q.open[i] == null) return;
    const day = Utilities.formatDate(new Date((ts + off) * 1000), 'UTC', 'yyyy-MM-dd');
    rows[day] = [round_(q.open[i]), round_(q.high[i]), round_(q.low[i]), round_(q.close[i]), q.volume[i] || 0];
  });
  const days = Object.keys(rows).sort();
  const out = { t: days, o: [], h: [], l: [], c: [], v: [] };
  days.forEach(function (d) {
    const x = rows[d];
    out.o.push(x[0]); out.h.push(x[1]); out.l.push(x[2]); out.c.push(x[3]); out.v.push(x[4]);
  });
  try { cache.put(key, JSON.stringify(out), HISTORY_CACHE_SEC); } catch (e) { /* 超過 100KB 不快取 */ }
  return out;
}

function round_(v) {
  if (v == null) return null;
  const a = Math.abs(v);
  const p = a >= 1000 ? 100 : a >= 1 ? 10000 : 1000000;
  return Math.round(v * p) / p;
}

/* ======================== 外部請求計數 ======================== */
// 免費 Google 帳號 UrlFetch 每日上限 20,000 次（Workspace 帳號 100,000 次）
const URLFETCH_DAILY_LIMIT = 20000;
const USAGE_TZ = 'Asia/Taipei';
let usageNow_ = null; // 本次執行已知的最新計數，避免重複讀取

function fetch_(url, opt) {
  countFetch_(1);
  return UrlFetchApp.fetch(url, opt);
}

function fetchAll_(reqs) {
  if (!reqs.length) return [];
  countFetch_(reqs.length); // fetchAll 內每個請求各算 1 次
  return UrlFetchApp.fetchAll(reqs);
}

function countFetch_(n) {
  const lock = LockService.getScriptLock();
  const locked = lock.tryLock(3000);
  try {
    const props = PropertiesService.getScriptProperties();
    const today = Utilities.formatDate(new Date(), USAGE_TZ, 'yyyy-MM-dd');
    let u = {};
    try { u = JSON.parse(props.getProperty('fetchUsage') || '{}'); } catch (e) {}
    if (u.d !== today) u = { d: today, n: 0, prev: u.d ? { d: u.d, n: u.n } : null };
    u.n += n;
    props.setProperty('fetchUsage', JSON.stringify(u));
    usageNow_ = u;
  } finally {
    if (locked) lock.releaseLock();
  }
}

function getUsage_() {
  let u = usageNow_;
  if (!u) {
    try { u = JSON.parse(PropertiesService.getScriptProperties().getProperty('fetchUsage') || '{}'); } catch (e) { u = {}; }
  }
  const today = Utilities.formatDate(new Date(), USAGE_TZ, 'yyyy-MM-dd');
  return { date: today, count: u.d === today ? u.n : 0, limit: URLFETCH_DAILY_LIMIT };
}

/* ======================== 工具 ======================== */
function ss_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sha256_(str) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function num_(v) {
  const n = parseFloat(v);
  return isFinite(n) && n !== 0 ? n : null;
}

function chunk_(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** 在編輯器手動執行，可測試報價抓取並完成授權 */
function testQuotes() {
  const srcs = DEFAULT_WATCHLIST.map(function (r) { return r[3]; })
    .filter(function (s) { return /^(yahoo|mis):/.test(s); });
  Logger.log(JSON.stringify(fetchQuotesRaw_(srcs), null, 2));
}
