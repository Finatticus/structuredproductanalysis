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
const ADMIN_ACCOUNT = 'michael';   // 管理員帳號：不需審核，可在「設定」審核其他人
// 資料中繼站（Cloudflare Worker，見 worker.js 與 README「十五」）。填了之後：
//  - 瀏覽器直接經中繼站抓報價、走勢（不經 Google、不吃 Google 每日額度）
//  - 後端對 Yahoo、證交所等網站的請求也經中繼站轉送（不會因 Google 主機被擋而失敗）
// 也可以改在「專案設定 → 指令碼屬性」新增 PROXY_URL、PROXY_KEY（優先使用）
const PROXY_URL = '';  // 例如 https://mw-proxy.你的帳號.workers.dev
const PROXY_KEY = '';  // 與 Worker 的 KEY 相同
// Account 工作頁 D 欄（審核狀態）：空白＝待審核、通過、拒絕、停用；只有「通過」與管理員可以登入
const ST_APPROVED = '通過', ST_REJECTED = '拒絕', ST_DISABLED = '停用';
const STATUS_CACHE_SEC = 300;     // 審核狀態快取，停用後最慢 5 分鐘生效
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
  const t0 = Date.now();
  let res;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    res = route_(req);
  } catch (err) {
    res = { ok: false, error: String((err && err.message) || err), code: (err && err.code) || '' };
  }
  // 回報本次後端耗時與各來源耗時（前端「連線診斷」用來判斷是後端排隊、還是外部來源慢）
  const hosts = {};
  HOST_LOG_.forEach(function (x) {
    const h = hosts[x[0]] = hosts[x[0]] || [0, 0, 0];
    h[0]++; h[1] = Math.max(h[1], x[1]);
    if (x[2] === 'err' || x[2] === 'skip' || x[2] >= 500 || x[2] === 429) h[2]++;
  });
  flushUsage_();
  res.ms = Date.now() - t0;
  res.hosts = hosts;
  if (QUOTA_HIT_) res.quota = true;
  return json_(res);
}

function route_(req) {
  switch (req.action) {
    case 'register': return register_(req.account, req.password);
    case 'login':    return login_(req.account, req.password);
    case 'adminUsers': {
      requireAdmin_(req.token);
      return { ok: true, users: listUsers_() };
    }
    case 'adminReview': {
      requireAdmin_(req.token);
      reviewUser_(String(req.account || ''), String(req.decision || ''));
      return { ok: true, users: listUsers_() };
    }
    case 'logout':
      if (req.token) CacheService.getScriptCache().remove('tok_' + req.token);
      return { ok: true };
    case 'watchlist': {
      const acc = auth_(req.token);
      const px = proxyCfg_();
      return { ok: true, account: acc, admin: isAdmin_(acc), items: getWatchlist_(acc), settings: getSettings_(acc),
        proxy: px.url ? { url: px.url, key: px.key } : null, fredKey: px.url ? fredKey_() : '' }; // 瀏覽器引擎抓 FRED 用
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
      return { ok: true, data: research_(req.symbol, !!req.force), usage: getUsage_() }; // 定義於 Research.gs
    }
    case 'relay': {
      auth_(req.token);
      return { ok: true, data: relay_(String(req.url || '')) };
    }
    case 'diag': {
      auth_(req.token);
      return { ok: true, data: diag_(!!req.probe) };
    }
    case 'cal': {
      const acc = auth_(req.token);
      return { ok: true, data: cal_(String(req.part || ''), !!req.force, acc), usage: getUsage_() }; // 定義於 Calendar.gs
    }
    case 'portfolio': {
      const acc = auth_(req.token);
      return { ok: true, data: portfolio_(acc, req), usage: getUsage_() }; // 定義於 Portfolio.gs
    }
    case 'etf': {
      auth_(req.token);
      return { ok: true, data: etf_(String(req.part || ''), req.code, !!req.force), usage: getUsage_() }; // 定義於 Etf.gs
    }
    case 'bars': {
      auth_(req.token);
      return { ok: true, data: bars_(req.symbol, req.years), usage: getUsage_() }; // 定義於 Etf.gs（回測用）
    }
    case 'screener': {
      auth_(req.token);
      return { ok: true, data: screenerTable_(req) }; // 定義於 Screener.gs
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
      const failed = sources.filter(function (s) { return !quotes[s] || quotes[s].price == null; });
      return { ok: true, quotes: quotes, failed: failed, serverTime: Date.now(), usage: getUsage_() };
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

  const lock = writeLock_();
  lock.waitLock(15000);
  try {
    const ss = ss_();
    const sh = accountSheet_();
    if (findAccountRow_(sh, account)) throw new Error('此帳號已被註冊');
    if (ss.getSheetByName(account)) throw new Error('此帳號名稱已被使用');

    const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    sh.appendRow([account, salt + '$' + sha256_(salt + password), new Date(), '']);
    if (isAdmin_(account)) createUserSheet_(account); // 一般帳號的工作頁在審核通過、第一次登入時才建立
  } finally {
    lock.releaseLock();
  }
  return { ok: true, pending: !isAdmin_(account) };
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
  const status = String(sh.getRange(row, 4).getValue() || '').trim();
  if (!isAdmin_(realName) && status !== ST_APPROVED) throw new Error(statusMessage_(status));
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('tok_' + token, realName, TOKEN_TTL_SEC);
  return { ok: true, token: token, account: realName, admin: isAdmin_(realName) };
}

function isAdmin_(account) {
  return String(account || '').trim().toLowerCase() === ADMIN_ACCOUNT.toLowerCase();
}

function statusMessage_(status) {
  if (status === ST_REJECTED) return '此帳號未通過審核，請聯絡管理員';
  if (status === ST_DISABLED) return '此帳號已被停用，請聯絡管理員';
  return '帳號審核中，請等待管理員審核通過後再登入';
}

/** 帳號目前是否可使用（快取 5 分鐘） */
function accountAllowed_(account) {
  if (isAdmin_(account)) return true;
  const cache = CacheService.getScriptCache();
  const key = 'st_' + account.toLowerCase();
  let st = cache.get(key);
  if (st == null) {
    const sh = accountSheet_();
    const row = findAccountRow_(sh, account);
    st = row ? String(sh.getRange(row, 4).getValue() || '').trim() || 'pending' : 'none';
    cache.put(key, st, STATUS_CACHE_SEC);
  }
  return st === ST_APPROVED;
}

function requireAdmin_(token) {
  const acc = auth_(token);
  if (!isAdmin_(acc)) throw new Error('需要管理員權限');
  return acc;
}

function listUsers_() {
  const sh = accountSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues().filter(function (r) { return r[0] !== ''; }).map(function (r) {
    const created = r[2] instanceof Date ? r[2].getTime() : (Date.parse(r[2]) || null);
    return {
      account: String(r[0]), created: created, admin: isAdmin_(r[0]),
      status: isAdmin_(r[0]) ? 'admin' : (String(r[3] || '').trim() || 'pending'),
    };
  });
}

/** decision：approve 通過、reject 拒絕、disable 停用、delete 刪除（只限未通過的帳號） */
function reviewUser_(account, decision) {
  const lock = writeLock_();
  lock.waitLock(15000);
  try {
    const sh = accountSheet_();
    const row = findAccountRow_(sh, account);
    if (!row) throw new Error('查無此帳號：' + account);
    if (isAdmin_(account)) throw new Error('不能變更管理員帳號');
    const cur = String(sh.getRange(row, 4).getValue() || '').trim();
    if (decision === 'delete') {
      if (cur === ST_APPROVED) throw new Error('已通過的帳號請先停用再刪除');
      const realName = String(sh.getRange(row, 1).getValue());
      sh.deleteRow(row);
      const us = ss_().getSheetByName(realName);
      if (us && realName !== ACCOUNT_SHEET) ss_().deleteSheet(us);
    } else {
      const v = { approve: ST_APPROVED, reject: ST_REJECTED, disable: ST_DISABLED }[decision];
      if (!v) throw new Error('未知的審核動作');
      sh.getRange(row, 4).setValue(v);
    }
    CacheService.getScriptCache().remove('st_' + account.toLowerCase());
  } finally {
    lock.releaseLock();
  }
}

function auth_(token) {
  const cache = CacheService.getScriptCache();
  const acc = token ? cache.get('tok_' + token) : null;
  if (!acc) {
    const err = new Error('登入已逾時，請重新登入');
    err.code = 'AUTH';
    throw err;
  }
  if (!accountAllowed_(acc)) { // 被停用或拒絕的帳號，既有登入也會失效
    cache.remove('tok_' + token);
    const err = new Error('此帳號目前無法使用，請聯絡管理員');
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
  if (sh.getRange(1, 4).getValue() === '') sh.getRange(1, 4).setValue('審核狀態').setFontWeight('bold');
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

  let quote = r.quote || null; // 台股解析代號時已抓過報價，不再重抓
  if (!quote && /^(yahoo|mis):/.test(r.source)) {
    quote = getQuotes_([r.source])[r.source];
    if ((!quote || quote.price == null) && FETCH_FAILS_) throw retryErr_('資料來源暫時連線失敗');
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
  const lock = writeLock_();
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
    const f0 = FETCH_FAILS_;
    const mis = fetchQuotesRaw_(['mis:tse_' + lc + '.tw', 'mis:otc_' + lc + '.tw']);
    for (const k in mis) {
      if (mis[k] && mis[k].price != null) return { symbol: code, source: k, name: mis[k].name, quote: mis[k] };
    }
    // 證交所連不上時不要改用 Yahoo（會把上市櫃股票存成較慢的來源），請前端稍後重試
    if (FETCH_FAILS_ > f0) throw retryErr_('證交所暫時連線失敗');
    // 興櫃或 MIS 未涵蓋者 → Yahoo
    const y = fetchQuotesRaw_(['yahoo:' + code + '.TWO', 'yahoo:' + code + '.TW']);
    for (const k in y) {
      if (y[k] && y[k].price != null) return { symbol: code, source: k, name: '', quote: y[k] };
    }
    if (FETCH_FAILS_) throw retryErr_('證交所／Yahoo 暫時連線失敗');
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

const MIS_HOST = 'mis.twse.com.tw';

/** mis:tse_2330.tw → 2330.TW、mis:otc_xxxx.tw → xxxx.TWO（證交所暫停時改抓 Yahoo 用） */
function misToYahoo_(m) {
  const x = m.match(/^(tse|otc)_(.+)\.tw$/);
  return x ? x[2].toUpperCase() + (x[1] === 'tse' ? '.TW' : '.TWO') : null;
}

/** 用 Yahoo spark 補抓台股報價（以 mis: 為 key 回傳，標記 alt） */
function misViaYahoo_(misList) {
  const map = {};
  misList.forEach(function (m) { const y = misToYahoo_(m); if (y) map[y] = m; });
  const syms = Object.keys(map);
  const out = {};
  if (!syms.length) return out;
  fetchAll_(chunk_(syms, 20).map(function (c) {
    return { url: 'https://query1.finance.yahoo.com/v7/finance/spark?range=1d&interval=1d&symbols=' + c.map(encodeURIComponent).join(','),
      muteHttpExceptions: true, headers: { 'User-Agent': UA } };
  })).forEach(function (r) {
    if (r.getResponseCode() !== 200) return;
    try {
      const q = parseSpark_(r.getContentText());
      Object.keys(q).forEach(function (k) {
        const m = map[k.slice(6)];
        if (m && q[k].price != null) { q[k].alt = 'Yahoo'; out['mis:' + m] = q[k]; }
      });
    } catch (e) { /* ignore */ }
  });
  return out;
}

/**
 * 不經快取，直接向來源抓報價（一次 fetchAll 平行請求）。
 * 證交所 MIS 暫停（斷路器）時台股改抓 Yahoo；MIS 這次失敗或回傳空資料的代號也用 Yahoo 補上。
 * MIS 與 Yahoo 同一批送出，批次時間過長時視為 MIS 卡住（Yahoo spark 通常 1 秒內），暫停 MIS，下次直接走 Yahoo。
 */
function fetchQuotesRaw_(sources) {
  let mis = [];
  const yh = [];
  sources.forEach(function (s) {
    if (s.indexOf('mis:') === 0) mis.push(s.slice(4));
    else if (s.indexOf('yahoo:') === 0) yh.push(s.slice(6));
  });
  let misAlt = [];
  if (mis.length && isHostDown_(MIS_HOST)) { misAlt = mis; mis = []; }

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
  const out = {};
  if (reqs.length) {
    const t = Date.now();
    const resps = fetchAll_(reqs);
    const ms = Date.now() - t;
    resps.forEach(function (r, i) {
      if (r.getResponseCode() !== 200) return;
      try { Object.assign(out, parsers[i](r.getContentText())); } catch (e) { /* 單一來源失敗不影響其他 */ }
    });
    if (mis.length) {
      const got = mis.filter(function (m) { return out['mis:' + m]; }).length;
      if (ms > 8000) markHostDown_(MIS_HOST, '即時報價回應過慢（' + Math.round(ms / 1000) + ' 秒）');
      else if (!got && mis.length >= 1) markHostDown_(MIS_HOST, '即時報價沒有回傳資料');
      misAlt = misAlt.concat(mis.filter(function (m) { return !out['mis:' + m]; }));
    }
  }
  if (misAlt.length) Object.assign(out, misViaYahoo_(misAlt));

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

// 本次執行中外部來源失敗的次數（連線錯誤、5xx、429），用來判斷是否值得讓前端重試
let FETCH_FAILS_ = 0;

/** 連線失敗時的替代回應：狀態碼 599、內容空白，呼叫端照一般失敗處理即可 */
function failRes_() {
  FETCH_FAILS_++;
  return { getResponseCode: function () { return 599; }, getContentText: function () { return ''; }, getAllHeaders: function () { return {}; }, getBlob: function () { return null; } };
}

function noteRes_(r) {
  const code = r.getResponseCode();
  if (code >= 500 || code === 429) FETCH_FAILS_++;
  return r;
}

/* ======================== 資料中繼站與每日額度 ======================== */
// 經中繼站轉送的網站（與 worker.js 的白名單一致）
const PROXY_HOSTS = [
  'query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'fc.yahoo.com', 'finance.yahoo.com', 'login.yahoo.com',
  'mis.twse.com.tw', 'www.twse.com.tw', 'openapi.twse.com.tw', 'www.tpex.org.tw',
  'fred.stlouisfed.org', 'api.finmindtrade.com', 'api.nasdaq.com', 'api.cnyes.com', 'news.cnyes.com',
  'www.moneydj.com', 'www.federalreserve.gov', 'www.cnbc.com', 'www.cbc.gov.tw', 'ws.ndc.gov.tw', 'data.gov.tw',
  'markets.newyorkfed.org', 'api.alternative.me', 'home.treasury.gov', 'api.stlouisfed.org',
  // nfs.faireconomy.media 不經中繼站：它擋 Cloudflare 主機，Google 直連反而可以
];
let PROXY_CFG_ = null;
let QUOTA_HIT_ = false; // 本次執行碰到 Google 每日對外請求上限

function proxyCfg_() {
  if (!PROXY_CFG_) {
    let url = PROXY_URL, key = PROXY_KEY;
    try {
      const p = PropertiesService.getScriptProperties();
      url = p.getProperty('PROXY_URL') || url;
      key = p.getProperty('PROXY_KEY') || key;
    } catch (e) { /* ignore */ }
    PROXY_CFG_ = { url: String(url || '').trim().replace(/\/+$/, ''), key: String(key || '').trim() };
  }
  return PROXY_CFG_;
}

/** 白名單內的網址改經中繼站 */
function viaProxy_(url) {
  const p = proxyCfg_();
  if (!p.url || PROXY_HOSTS.indexOf(hostOf_(url)) < 0) return url;
  return p.url + '/?key=' + encodeURIComponent(p.key) + '&url=' + encodeURIComponent(url);
}

/**
 * 代抓：少數網站擋 Cloudflare 主機但不擋 Google（例如 Forex Factory），瀏覽器引擎抓不到時請後端直連代抓。
 * 只限白名單、結果快取 30 分鐘（多人共用），幾乎不耗額度。
 */
const RELAY_ALLOW = ['nfs.faireconomy.media'];
function relay_(url) {
  if (RELAY_ALLOW.indexOf(hostOf_(url)) < 0) throw new Error('不允許代抓此網站');
  const key = 'relay_' + url;
  const hit = cacheGetBig_(key);
  if (hit) return JSON.parse(hit);
  countFetch_(1);
  let r;
  try { r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': UA } }); } catch (e) {
    if (isQuotaError_(e)) noteQuota_();
    throw new Error('代抓失敗：' + hostOf_(url));
  }
  const out = { status: r.getResponseCode(), text: r.getContentText() };
  if (out.status === 200) cachePutBig_(key, JSON.stringify(out), 1800);
  return out;
}

/** 經中繼站時被對方拒絕或中繼站出錯的狀態碼：改由 Google 直連再試一次（有些網站擋 Cloudflare 但不擋 Google） */
function proxyRejected_(code) { return code === 403 || code === 429 || code === 401 || code >= 500; }

/** Google 每日 UrlFetch 上限（一般帳號 20,000 次）用完時的錯誤 */
function isQuotaError_(e) {
  return /Service invoked too many times|too many times for one day|呼叫服務的次數過多|服務呼叫次數過多|Bandwidth quota exceeded|頻寬配額/i.test(String((e && e.message) || e));
}

function noteQuota_() {
  QUOTA_HIT_ = true;
  try { CacheService.getScriptCache().put('quota_out', String(Date.now()), 1800); } catch (e) { /* ignore */ }
}

/* ======================== 外部來源斷路器 ========================
 * 某個來源（例如證交所擋 Google 主機）連不上或回應很慢時，UrlFetch 會等到逾時才放棄。
 * 以前每個請求、每次重試都會再等一次，後端越積越多執行中的請求 → 全站變慢。
 * 現在：連線失敗或單次超過 HOST_SLOW_MS 的來源標記為「暫停」HOST_DOWN_SEC 秒，期間直接回傳失敗（呼叫端改用備援或舊資料），
 * 時間到再自動恢復嘗試。各來源的耗時記在快取，「設定 → 連線診斷」可以看到。 */
const HOST_SLOW_MS = 12000;
const HOST_DOWN_SEC = 180;
let HOST_LOG_ = [];     // 本次執行：[來源, 毫秒, 狀態碼或 err／skip]
let HOST_DOWN_ = null;  // 暫停中的來源（本次執行的快取）

function hostOf_(url) {
  const m = String(url || '').match(/^https?:\/\/([^\/?#:]+)/i);
  return m ? m[1].toLowerCase() : '';
}

function hostsDown_() {
  if (!HOST_DOWN_) {
    try { HOST_DOWN_ = JSON.parse(CacheService.getScriptCache().get('hosts_down') || '{}'); } catch (e) { HOST_DOWN_ = {}; }
  }
  const now = Date.now();
  Object.keys(HOST_DOWN_).forEach(function (h) { if (HOST_DOWN_[h].until < now) delete HOST_DOWN_[h]; });
  return HOST_DOWN_;
}

function isHostDown_(host) { return !!hostsDown_()[host]; }

function markHostDown_(host, why) {
  if (!host) return;
  const cache = CacheService.getScriptCache();
  let cur = {};
  try { cur = JSON.parse(cache.get('hosts_down') || '{}'); } catch (e) { cur = {}; }
  cur[host] = { until: Date.now() + HOST_DOWN_SEC * 1000, why: String(why || '').slice(0, 100), at: Date.now() };
  cache.put('hosts_down', JSON.stringify(cur), HOST_DOWN_SEC + 60);
  HOST_DOWN_ = cur;
}

/** 參數錯誤（例如網址含不合法字元）或額度用完不是來源的問題，不暫停該來源 */
function isArgError_(e) { return /Invalid argument|無效的引數|引數無效|Bad request/i.test(String((e && e.message) || e)) || isQuotaError_(e); }

function fetch_(url, opt) {
  const host = hostOf_(url);
  if (isHostDown_(host)) { HOST_LOG_.push([host, 0, 'skip']); return failRes_(); }
  countFetch_(1);
  const t = Date.now();
  const target = viaProxy_(url);
  try {
    let r;
    try {
      r = UrlFetchApp.fetch(target, opt);
    } catch (e) {
      if (target === url || isQuotaError_(e)) throw e;
      r = UrlFetchApp.fetch(url, opt); // 中繼站連不上：改直接連線
    }
    if (target !== url && proxyRejected_(r.getResponseCode())) {
      try { r = UrlFetchApp.fetch(url, opt); countFetch_(1); } catch (e2) { /* 保留中繼站的回應 */ }
    }
    r = noteRes_(r);
    const ms = Date.now() - t;
    HOST_LOG_.push([host, ms, r.getResponseCode()]);
    if (ms > HOST_SLOW_MS) markHostDown_(host, '回應過慢（' + Math.round(ms / 1000) + ' 秒）');
    return r;
  } catch (e) {
    HOST_LOG_.push([host, Date.now() - t, 'err']);
    if (isQuotaError_(e)) noteQuota_();
    else if (!isArgError_(e)) markHostDown_(host, String((e && e.message) || e).replace(/https?:\/\/\S+/g, '').trim());
    return failRes_();
  }
}

/**
 * 平行請求。暫停中的來源直接回傳 599；整批失敗（某個網址連不上）時，從錯誤訊息找出該來源並暫停它，
 * 其餘改用 fetch_ 逐一補抓（fetch_ 也有斷路器：同一個卡住的來源只會等一次，不會每個網址各等一次）。
 */
function fetchAll_(reqs) {
  if (!reqs.length) return [];
  const out = new Array(reqs.length);
  const idx = [];
  reqs.forEach(function (r, i) {
    const host = hostOf_(r.url);
    if (isHostDown_(host)) { out[i] = failRes_(); HOST_LOG_.push([host, 0, 'skip']); } else idx.push(i);
  });
  if (!idx.length) return out;
  countFetch_(idx.length); // fetchAll 內每個請求各算 1 次
  const t = Date.now();
  try {
    const res = UrlFetchApp.fetchAll(idx.map(function (i) { return Object.assign({}, reqs[i], { url: viaProxy_(reqs[i].url) }); }));
    // 經中繼站被拒（403／429／5xx）的請求：改由 Google 直連再送一批
    const again = [];
    res.forEach(function (r, k) { if (viaProxy_(reqs[idx[k]].url) !== reqs[idx[k]].url && proxyRejected_(r.getResponseCode())) again.push(k); });
    if (again.length) {
      countFetch_(again.length);
      try {
        UrlFetchApp.fetchAll(again.map(function (k) { return reqs[idx[k]]; })).forEach(function (r2, j) { res[again[j]] = r2; });
      } catch (e2) { /* 保留中繼站的回應 */ }
    }
    const ms = Date.now() - t; // 整批的時間（無法區分個別請求）
    res.forEach(function (r, k) {
      out[idx[k]] = noteRes_(r);
      HOST_LOG_.push([hostOf_(reqs[idx[k]].url), ms, r.getResponseCode(), 'batch']);
    });
    return out;
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (isQuotaError_(e)) { noteQuota_(); idx.forEach(function (i) { out[i] = failRes_(); }); return out; }
    // 錯誤訊息裡的網址可能是中繼站網址：取出 url= 參數還原成原始網站
    // 若是中繼站本身連不上，不暫停目標網站：下面逐一補抓時 fetch_ 會自動改直接連線
    const badUrl = (msg.match(/https?:\/\/[^\s"'）)]+/) || [''])[0];
    const px = proxyCfg_().url;
    const bad = px && badUrl.indexOf(px) === 0 ? '' : hostOf_(badUrl);
    if (bad && !isArgError_(e)) markHostDown_(bad, msg.replace(/https?:\/\/\S+/g, '').trim());
    idx.forEach(function (i) {
      const r = reqs[i];
      const o = Object.assign({}, r);
      delete o.url;
      out[i] = fetch_(r.url, o);
    });
    return out;
  }
}

/** 暫時性錯誤（資料來源連線失敗）：前端收到 code=RETRY 會自動重試 */
function retryErr_(msg) {
  const e = new Error(msg || '資料來源暫時連線失敗');
  e.code = 'RETRY';
  return e;
}

// 以前每次對外請求都要拿全域鎖、讀寫一次指令碼屬性；選股排程佔用鎖的 4–5 分鐘內，
// 使用者的每個請求都會多等 3 秒。現在只在記憶體累計，每次執行結束（或累積 50 次）才寫入一次、不上鎖
// （多個執行同時寫入時可能少算幾次，只影響畫面上的用量顯示）。
let FETCH_PENDING_ = 0;

function countFetch_(n) {
  FETCH_PENDING_ += n;
  if (FETCH_PENDING_ >= 50) flushUsage_();
}

/** 把本次執行的來源耗時併入近期紀錄（快取 1 小時，最多 400 筆），供連線診斷使用 */
function flushHostLog_() {
  if (!HOST_LOG_.length) return;
  const log = HOST_LOG_;
  HOST_LOG_ = [];
  try {
    const cache = CacheService.getScriptCache();
    let cur = [];
    try { cur = JSON.parse(cache.get('host_log') || '[]'); } catch (e) { cur = []; }
    const now = Date.now();
    cur = cur.concat(log.map(function (x) { return [now].concat(x); })).slice(-400);
    cache.put('host_log', JSON.stringify(cur), 3600);
  } catch (e) { /* 診斷紀錄非必要 */ }
}

function flushUsage_() {
  flushHostLog_();
  if (!FETCH_PENDING_) return;
  const n = FETCH_PENDING_;
  FETCH_PENDING_ = 0;
  try {
    const props = PropertiesService.getScriptProperties();
    const today = Utilities.formatDate(new Date(), USAGE_TZ, 'yyyy-MM-dd');
    let u = {};
    try { u = JSON.parse(props.getProperty('fetchUsage') || '{}'); } catch (e) {}
    if (u.d !== today) u = { d: today, n: 0, prev: u.d ? { d: u.d, n: u.n } : null };
    u.n += n;
    props.setProperty('fetchUsage', JSON.stringify(u));
    usageNow_ = u;
  } catch (e) { /* 計數失敗不影響主流程 */ }
}

function getUsage_() {
  flushUsage_();
  let u = usageNow_;
  if (!u) {
    try { u = JSON.parse(PropertiesService.getScriptProperties().getProperty('fetchUsage') || '{}'); } catch (e) { u = {}; }
  }
  const today = Utilities.formatDate(new Date(), USAGE_TZ, 'yyyy-MM-dd');
  return { date: today, count: u.d === today ? u.n : 0, limit: URLFETCH_DAILY_LIMIT };
}

/**
 * 寫入試算表用的鎖。選股排程長時間佔用 script lock，使用者操作改用試算表的 document lock，彼此不互相卡住；
 * 若腳本不是從試算表建立（沒有 document lock）才退回 script lock。
 */
function writeLock_() {
  return LockService.getDocumentLock() || LockService.getScriptLock();
}

/* ======================== 大型快取與備援 ======================== */
// CacheService 單筆上限 100KB：超過時切成多段存（以字元數切，中文 3 位元組也不會超過）
const BIG_CHUNK = 30000;

function cacheGetBig_(key) {
  const cache = CacheService.getScriptCache();
  const head = cache.get(key);
  if (!head || head.indexOf('~chunks:') !== 0) return head;
  const n = +head.slice(8);
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + '~' + i);
  const parts = cache.getAll(keys);
  let s = '';
  for (let i = 0; i < n; i++) {
    if (parts[keys[i]] == null) return null;
    s += parts[keys[i]];
  }
  return s;
}

function cachePutBig_(key, text, ttl) {
  const cache = CacheService.getScriptCache();
  try {
    if (text.length <= BIG_CHUNK) { cache.put(key, text, ttl); return; }
    const n = Math.ceil(text.length / BIG_CHUNK);
    if (n > 30) return; // 約 900KB 以上不快取
    const obj = {};
    for (let i = 0; i < n; i++) obj[key + '~' + i] = text.substr(i * BIG_CHUNK, BIG_CHUNK);
    cache.putAll(obj, ttl);
    cache.put(key, '~chunks:' + n, ttl);
  } catch (e) { /* 快取失敗不影響主流程 */ }
}

// 本次執行中 Yahoo 認證或 quoteSummary 是否失敗（資料可能缺欄位）
let YAHOO_DEGRADED_ = '';

function isEmptyVal_(v) {
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).every(function (k) { return v[k] == null; });
  return false;
}

/**
 * 執行 fn 並保存一份「最後成功資料」（6 小時）：
 *  - fn 失敗 → 回傳備援並標記 stale（錯誤訊息）
 *  - fn 成功但 Yahoo 認證失敗造成部分欄位空白 → 用備援補上這些欄位，標記 filled
 */
function withBackup_(key, fn) {
  const bk = 'bk_' + key;
  YAHOO_DEGRADED_ = '';
  let data;
  try {
    data = fn();
  } catch (err) {
    const b = cacheGetBig_(bk);
    if (!b) throw err;
    const old = JSON.parse(b);
    old.stale = String((err && err.message) || err).slice(0, 160);
    return old;
  }
  if (!data || typeof data !== 'object') return data;
  if (!data.updated) data.updated = Date.now();
  if (YAHOO_DEGRADED_) {
    const b = cacheGetBig_(bk);
    if (b) {
      const old = JSON.parse(b);
      const filled = Object.keys(old).filter(function (k) { return k !== 'updated' && isEmptyVal_(data[k]) && !isEmptyVal_(old[k]); });
      filled.forEach(function (k) { data[k] = old[k]; });
      if (filled.length) { data.filled = filled; data.filledAt = old.updated; data.stale = YAHOO_DEGRADED_; }
    }
    return data; // 不完整的資料不覆蓋備援
  }
  if (!data.stale) cachePutBig_(bk, JSON.stringify(data), 21600);
  return data;
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

/* ======================== 連線診斷 ======================== */
const DIAG_PROBES = [
  ['證交所即時報價（MIS）', 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&ex_ch=tse_2330.tw'],
  ['證交所（法人、信用、類股）', 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&type=IND'],
  ['櫃買中心', 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes'],
  ['Yahoo（報價、走勢）', 'https://query1.finance.yahoo.com/v8/finance/chart/2330.TW?range=1d&interval=1d'],
  ['Yahoo（歷史、備援）', 'https://query2.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=1d&interval=1d'],
  ['FinMind', 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo&data_id=2330'],
  ['美國財政部（殖利率）', 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv'],
  ['FRED 網站（無金鑰時用）', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=2026-01-01'],
  ['鉅亨網新聞', 'https://api.cnyes.com/media/api/v1/newslist/category/headline?limit=1'],
  ['Nasdaq（日曆）', 'https://api.nasdaq.com/api/calendar/economicevents?date=2026-01-05'],
];

/**
 * probe = true：逐一實測各來源（不經斷路器，每個最多一次），回傳耗時與狀態碼
 * 一律回傳：暫停中的來源、近 1 小時各來源的請求次數／平均與最長耗時／失敗次數
 */
function diag_(probe) {
  const out = { down: hostsDown_(), at: Date.now(), proxy: !!proxyCfg_().url, fredKey: !!fredKey_() };
  try { const q = CacheService.getScriptCache().get('quota_out'); out.quotaOut = q ? +q : null; } catch (e) { out.quotaOut = null; }
  try { out.triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }); } catch (e) { out.triggers = null; }
  let log = [];
  try { log = JSON.parse(CacheService.getScriptCache().get('host_log') || '[]'); } catch (e) { log = []; }
  const stat = {};
  log.forEach(function (x) {
    const s = stat[x[1]] = stat[x[1]] || { n: 0, sum: 0, max: 0, fail: 0, skip: 0, batch: 0, last: 0 };
    s.n++; s.last = Math.max(s.last, x[0]);
    if (x[3] === 'skip') { s.skip++; return; }
    if (x[4] === 'batch') s.batch++;
    s.sum += x[2]; s.max = Math.max(s.max, x[2]);
    if (x[3] === 'err' || x[3] >= 500 || x[3] === 429) s.fail++;
  });
  out.stats = stat;
  if (probe) {
    // 有 FRED_KEY 時另外實測 FRED 官方 API（網址含金鑰，只回傳主機與狀態碼，不回傳網址）
    const fk = fredKey_();
    const probes = DIAG_PROBES.concat(fk ? [['FRED 官方 API（美國經濟數據）', 'https://api.stlouisfed.org/fred/series/observations?series_id=UNRATE&limit=1&file_type=json&api_key=' + encodeURIComponent(fk)]] : []);
    out.probe = probes.map(function (p) {
      const t = Date.now();
      let code = '', err = '', size = 0;
      try {
        const r = UrlFetchApp.fetch(viaProxy_(p[1]), { muteHttpExceptions: true, headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Referer: 'https://mis.twse.com.tw/stock/index.jsp' } });
        code = r.getResponseCode();
        size = r.getContentText().length;
      } catch (e) { if (isQuotaError_(e)) noteQuota_(); err = String((e && e.message) || e).replace(/https?:\/\/\S+/g, '').replace(/[：:]\s*$/, '').trim().slice(0, 100); }
      countFetch_(1);
      return { name: p[0], host: hostOf_(p[1]), ms: Date.now() - t, code: code, size: size, err: err };
    });
  }
  return out;
}

/** 在編輯器執行：清除所有來源的暫停狀態（例如確認來源已恢復時） */
function resetHosts() {
  CacheService.getScriptCache().remove('hosts_down');
}

/** 在編輯器手動執行，可測試報價抓取並完成授權 */
function testQuotes() {
  const srcs = DEFAULT_WATCHLIST.map(function (r) { return r[3]; })
    .filter(function (s) { return /^(yahoo|mis):/.test(s); });
  Logger.log(JSON.stringify(fetchQuotesRaw_(srcs), null, 2));
}
