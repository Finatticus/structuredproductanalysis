/**
 * 投資組合 — 後端（在 Apps Script 新增指令碼檔「Portfolio」貼上）
 * 依賴 Code.gs（fetch_、fetchAll_、ss_、UA、round_、resolveSymbol_、toYahoo_、cacheGetBig_、cachePutBig_）
 *
 * 儲存：隱藏工作頁 _pf，每列一筆：A 帳號｜B 編號｜C 內容(JSON)
 *  - 交易紀錄：編號為亂數；設定（現金、目標配置、成本法…）：編號 _meta
 * 損益、股利、匯率影響、績效等都在前端計算；後端只負責存取與提供歷史價格／配息／匯率
 */
const PF_SHEET = '_pf';
const PF_TYPES = ['buy', 'sell', 'div', 'stock'];
const PF_HIST_TTL = 1800;   // 歷史價格快取 30 分鐘
const PF_MAX_TXNS = 3000;

function portfolio_(acc, req) {
  switch (String(req.op || '')) {
    case 'load': return pfLoad_(acc);
    case 'save': return pfSave_(acc, req.txn || {});
    case 'delete': pfDelete_(acc, [].concat(req.ids || req.id || [])); return pfLoad_(acc);
    case 'meta': pfSetMeta_(acc, req.meta || {}); return { ok: true };
    case 'import': return pfImport_(acc, req.txns || [], !!req.replace);
    case 'resolve': return pfResolve_(req.cat, req.sym);
    case 'market': return pfMarket_(req);
    default: throw new Error('未知的投資組合操作：' + req.op);
  }
}

/* ======================== 儲存 ======================== */
function pfSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(PF_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PF_SHEET);
    sh.getRange('A:C').setNumberFormat('@');
    sh.hideSheet();
  }
  return sh;
}

function pfRows_(acc) {
  const sh = pfSheet_();
  const n = sh.getLastRow();
  const rows = [];
  if (n) {
    sh.getRange(1, 1, n, 3).getValues().forEach(function (r, i) {
      if (String(r[0]) === acc && r[1] !== '') rows.push({ row: i + 1, id: String(r[1]), v: String(r[2]) });
    });
  }
  return { sh: sh, rows: rows };
}

function pfLoad_(acc) {
  const all = pfRows_(acc).rows;
  let meta = {};
  const txns = [];
  all.forEach(function (r) {
    try {
      const o = JSON.parse(r.v);
      if (r.id === '_meta') meta = o; else { o.id = r.id; txns.push(o); }
    } catch (e) { /* 壞掉的列略過 */ }
  });
  txns.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return { txns: txns, meta: meta };
}

function pfLock_(fn) {
  const lock = writeLock_();
  const locked = lock.tryLock(15000);
  try { return fn(); } finally { if (locked) lock.releaseLock(); }
}

/** 寫入或更新一列（同帳號同編號視為同一筆） */
function pfPut_(acc, id, obj) {
  pfLock_(function () {
    const x = pfRows_(acc);
    const hit = x.rows.filter(function (r) { return r.id === id; })[0];
    const text = JSON.stringify(obj);
    if (hit) x.sh.getRange(hit.row, 3).setValue(text);
    else x.sh.appendRow([acc, id, text]);
  });
}

function pfDelete_(acc, ids) {
  pfLock_(function () {
    const x = pfRows_(acc);
    x.rows.filter(function (r) { return ids.indexOf(r.id) >= 0; }).map(function (r) { return r.row; })
      .sort(function (a, b) { return b - a; }).forEach(function (row) { x.sh.deleteRow(row); });
  });
}

function pfSetMeta_(acc, meta) {
  const text = JSON.stringify(meta);
  if (text.length > 40000) throw new Error('設定內容過大');
  pfPut_(acc, '_meta', meta);
}

function pfNum_(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

/** 檢查並整理一筆交易（缺資料來源時解析代號） */
function pfClean_(t, resolved) {
  const type = String(t.type || '');
  if (PF_TYPES.indexOf(type) < 0) throw new Error('交易類型錯誤：' + type);
  const date = String(t.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式錯誤：' + t.date);
  const cat = t.cat === 'tw' ? 'tw' : 'global';
  let info = t.source && t.ccy ? { cat: cat, sym: t.sym, source: t.source, name: t.name, ccy: t.ccy, itype: t.itype || '' } : null;
  if (!info) {
    const k = cat + '|' + String(t.sym || '').trim().toUpperCase();
    info = resolved[k] || (resolved[k] = pfResolve_(cat, t.sym));
  }
  const qty = pfNum_(t.qty), price = pfNum_(t.price);
  if (type !== 'div' && !(qty > 0)) throw new Error('股數必須大於 0');
  if ((type === 'buy' || type === 'sell') && !(price >= 0)) throw new Error('請輸入成交價');
  if (type === 'div' && !(pfNum_(t.amount) > 0)) throw new Error('請輸入股利金額');
  return {
    date: date, type: type, cat: info.cat, sym: info.sym, source: info.source, name: String(t.name || info.name || info.sym).slice(0, 40),
    ccy: info.ccy, itype: info.itype || '', qty: qty, price: price, amount: pfNum_(t.amount),
    fee: pfNum_(t.fee) || 0, tax: pfNum_(t.tax) || 0, fx: pfNum_(t.fx), acct: String(t.acct || '').slice(0, 20), note: String(t.note || '').slice(0, 100),
  };
}

function pfSave_(acc, t) {
  const clean = pfClean_(t, {});
  const id = t.id && t.id !== '_meta' ? String(t.id) : Utilities.getUuid().slice(0, 12);
  pfPut_(acc, id, clean);
  clean.id = id;
  return { txn: clean };
}

/** CSV 匯入：一次寫入多筆（replace = 先清除原有交易） */
function pfImport_(acc, list, replace) {
  if (list.length > PF_MAX_TXNS) throw new Error('一次最多匯入 ' + PF_MAX_TXNS + ' 筆');
  const resolved = {}, errors = [], ok = [];
  list.forEach(function (t, i) {
    try { ok.push(pfClean_(t, resolved)); } catch (e) { errors.push('第 ' + (i + 1) + ' 筆：' + e.message); }
  });
  if (errors.length && !ok.length) throw new Error(errors.slice(0, 5).join('；'));
  pfLock_(function () {
    const x = pfRows_(acc);
    if (replace) {
      x.rows.filter(function (r) { return r.id !== '_meta'; }).map(function (r) { return r.row; })
        .sort(function (a, b) { return b - a; }).forEach(function (row) { x.sh.deleteRow(row); });
    }
    if (ok.length) {
      const sh = pfSheet_();
      const start = sh.getLastRow() + 1;
      sh.getRange(start, 1, ok.length, 3).setNumberFormat('@').setValues(ok.map(function (o) {
        return [acc, Utilities.getUuid().slice(0, 12), JSON.stringify(o)];
      }));
    }
  });
  const out = pfLoad_(acc);
  out.imported = ok.length;
  out.errors = errors.slice(0, 20);
  return out;
}

/* ======================== 代號解析 ======================== */
/** 代號 → 資料來源、名稱、計價幣別、商品類型（ETF／股票） */
function pfResolve_(cat, sym) {
  cat = cat === 'tw' ? 'tw' : 'global';
  const key = 'pfr_' + cat + '_' + String(sym || '').trim().toUpperCase();
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const r = resolveSymbol_(cat, sym);
  const ysym = toYahoo_(r.source);
  let meta = {};
  try {
    const j = JSON.parse(fetch_('https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ysym) + '?range=5d&interval=1d',
      { muteHttpExceptions: true, headers: { 'User-Agent': UA } }).getContentText());
    meta = j.chart.result[0].meta || {};
  } catch (e) { /* 只是補名稱與幣別 */ }
  if (cat === 'global' && !meta.currency) throw new Error('查無此代號：' + sym);
  const out = {
    cat: cat, sym: r.symbol, source: r.source, name: r.name || meta.shortName || meta.longName || r.symbol,
    ccy: cat === 'tw' ? 'TWD' : meta.currency, itype: meta.instrumentType || (cat === 'tw' && /^00/.test(r.symbol) ? 'ETF' : ''),
  };
  cache.put(key, JSON.stringify(out), 21600);
  return out;
}

/* ======================== 歷史價格／配息／匯率 ======================== */
function pfRange_(from) {
  const days = (Date.now() - Date.parse(from || '2000-01-01')) / 86400000;
  return days <= 330 ? '2y' : days <= 1400 ? '5y' : days <= 3300 ? '10y' : 'max';
}

/** 解析 Yahoo 日線：收盤、配息、分割（只保留 from 之後；至少保留近 400 天給相關係數／β 用） */
function pfParseChart_(text, from) {
  const r = JSON.parse(text).chart.result[0];
  const q = r.indicators.quote[0], off = r.meta.gmtoffset || 0;
  const day = function (ts) { return Utilities.formatDate(new Date((ts + off) * 1000), 'UTC', 'yyyy-MM-dd'); };
  const keep = from < day(Date.now() / 1000 - 400 * 86400) ? from : day(Date.now() / 1000 - 400 * 86400);
  const t = [], c = [], seen = {};
  (r.timestamp || []).forEach(function (ts, i) {
    if (q.close[i] == null) return;
    const d = day(ts);
    if (d < keep) return;
    if (seen[d] != null) { c[seen[d]] = round_(q.close[i]); return; }
    seen[d] = t.length;
    t.push(d); c.push(round_(q.close[i]));
  });
  const ev = r.events || {};
  const divs = Object.keys(ev.dividends || {}).map(function (k) { return [day(ev.dividends[k].date), round_(ev.dividends[k].amount)]; })
    .sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
  const splits = Object.keys(ev.splits || {}).map(function (k) { const s = ev.splits[k]; return [day(s.date), s.numerator / s.denominator]; })
    .filter(function (s) { return isFinite(s[1]) && s[1] > 0 && s[1] !== 1; })
    .sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
  return {
    t: t, c: c, divs: divs, splits: splits, ccy: r.meta.currency || null, itype: r.meta.instrumentType || '',
    name: r.meta.shortName || r.meta.longName || '', price: r.meta.regularMarketPrice || null,
  };
}

/**
 * 回傳 { series: {ysym: {...}}, stale: [ysym...] }
 *  req.syms：持股的 Yahoo 代碼；req.ccys：要換算成台幣的幣別；req.bench：比較基準（Yahoo 代碼）
 *  單一代號失敗時改用 6 小時內的備援副本
 */
function pfMarket_(req) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.from || '')) ? req.from : '2015-01-01';
  const range = pfRange_(from);
  const syms = [].concat(req.syms || []).map(String).filter(function (s) { return /^[\^A-Z0-9.\-=]{1,20}$/i.test(s); });
  [].concat(req.ccys || []).forEach(function (c) {
    const k = String(c).toUpperCase() === 'GBP' || c === 'GBp' ? 'GBP' : String(c).toUpperCase();
    if (/^[A-Z]{3}$/.test(k) && k !== 'TWD') syms.push(k + 'TWD=X');
  });
  [].concat(req.bench || []).forEach(function (b) { if (/^[\^A-Z0-9.\-=]{1,20}$/i.test(b)) syms.push(String(b)); });
  const uniq = syms.filter(function (s, i) { return syms.indexOf(s) === i; }).slice(0, 60);
  const out = { series: {}, stale: [], from: from };
  const miss = [];
  uniq.forEach(function (s) {
    const hit = cacheGetBig_('pfh_' + range + '_' + s);
    if (hit) out.series[s] = JSON.parse(hit); else miss.push(s);
  });
  const reqs = miss.map(function (s) {
    return { url: 'https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(s) + '?range=' + range + '&interval=1d&events=div,split',
      muteHttpExceptions: true, headers: { 'User-Agent': UA } };
  });
  fetchAll_(reqs).forEach(function (res, i) {
    const s = miss[i];
    let d = null;
    try { if (res.getResponseCode() === 200) d = pfParseChart_(res.getContentText(), from); } catch (e) { d = null; }
    if (!d) {
      // 換 query1 再試一次
      try {
        const r2 = fetch_(reqs[i].url.replace('query2', 'query1'), { muteHttpExceptions: true, headers: { 'User-Agent': UA } });
        if (r2.getResponseCode() === 200) d = pfParseChart_(r2.getContentText(), from);
      } catch (e) { d = null; }
    }
    if (d) {
      const text = JSON.stringify(d);
      cachePutBig_('pfh_' + range + '_' + s, text, PF_HIST_TTL);
      cachePutBig_('pfbk_' + s, text, 21600);
      out.series[s] = d;
    } else {
      const bk = cacheGetBig_('pfbk_' + s);
      if (bk) { out.series[s] = JSON.parse(bk); out.stale.push(s); } else out.stale.push(s);
    }
  });
  out.updated = Date.now();
  return out;
}
