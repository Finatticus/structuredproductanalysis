/* =========================================================
 * 投資組合 — 前端
 * 分頁：總覽、配置與再平衡、已實現損益、股利現金流、匯率影響、績效與風險、交易紀錄
 * 交易紀錄與設定存在後端（試算表 _pf）；損益、股利、績效都在瀏覽器計算
 * 依賴 app.js（$, $$, api, esc, store, state, toast, openChart）、macro.js（isNum, pctTxt, signTxt, numTxt, dirCls, heatStyle）
 *      research.js（openResearch）
 * ========================================================= */
const PF_TABS = [['overview', '總覽'], ['alloc', '配置與再平衡'], ['pnl', '已實現損益'], ['div', '股利現金流'], ['fx', '匯率影響'], ['perf', '績效與風險'], ['txns', '交易紀錄']];
const PF_BENCH = [['0050.TW', '0050'], ['^TWII', '加權指數'], ['^GSPC', 'S&P 500'], ['VT', '全球股市 VT']];
const PF_TYPE_ZH = { buy: '買進', sell: '賣出', div: '現金股利', stock: '配股／分割' };
const PF_DEF_META = { cash: {}, method: 'avg', autoDiv: true, autoSplit: true, usTax: 30, nhi: true, bench: '0050.TW', targets: {}, feeDisc: 1 };
const PF_QUOTE_SEC = 60;
const PF_COLORS = ['#1f4e8c', '#e67e22', '#16a085', '#8e44ad', '#c0392b', '#2c6bc4', '#7f8c8d', '#d4a017', '#27ae60', '#a0522d'];

const pf = {
  loaded: false, loading: false, tab: 'overview', txns: [], meta: { ...PF_DEF_META }, mkt: null, quotes: {}, quoteAt: 0,
  calc: null, series: null, charts: [], timer: null, editId: null, pnlYear: '', txFilter: '',
  sort: ['valTwd', -1],
};

/* ---------- 小工具 ---------- */
const pfToday = () => new Date().toLocaleDateString('sv-SE');
const pfDays = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
const twd = (v, d = 0) => (isNum(v) ? numTxt(v, d) : '—');
const twdS = (v, d = 0) => (isNum(v) ? signTxt(v, d) : '—');
const pfPct = v => (isNum(v) ? pctTxt(v) : '—');

function pfYsym(source) {
  if (!source) return null;
  if (source.startsWith('yahoo:')) return source.slice(6);
  const m = source.match(/^mis:(tse|otc)_(.+)\.tw$/);
  return m ? m[2].toUpperCase() + (m[1] === 'tse' ? '.TW' : '.TWO') : null;
}

/** 升冪日期陣列中最後一個 <= d 的位置 */
function pfIdx(t, d) {
  let lo = 0, hi = t.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (t[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

function pfSeriesOf(ysym) { return (pf.mkt && pf.mkt.series && pf.mkt.series[ysym]) || null; }

function pfFxSym(ccy) { return (ccy === 'GBp' ? 'GBP' : ccy) + 'TWD=X'; }

/** 匯率（1 單位外幣 = ? 台幣）：即時報價優先，其次歷史最後一筆 */
function pfFxNow(ccy) {
  if (!ccy || ccy === 'TWD') return 1;
  const div = ccy === 'GBp' ? 100 : 1;
  const q = pf.quotes['yahoo:' + pfFxSym(ccy)];
  if (q && q.price) return q.price / div;
  const s = pfSeriesOf(pfFxSym(ccy));
  return s && s.c.length ? s.c[s.c.length - 1] / div : null;
}

function pfFxAt(ccy, d) {
  if (!ccy || ccy === 'TWD') return 1;
  const div = ccy === 'GBp' ? 100 : 1;
  const s = pfSeriesOf(pfFxSym(ccy));
  if (s && s.t.length) { const i = pfIdx(s.t, d); return (i >= 0 ? s.c[i] : s.c[0]) / div; }
  return pfFxNow(ccy);
}

/**
 * 分割係數：日期 d 之後所有分割比例相乘。Yahoo 的歷史收盤與配息都已依分割調整，
 * 實際價格 = Yahoo 價格 × 係數。splits 包含 Yahoo 的分割事件，以及使用者輸入的「配股／分割」
 * （Yahoo 常常調整了價格卻沒有分割事件，例如 0050 在 2025 年的 1 拆 4）。
 */
function pfFactor(splits, d) {
  return (splits || []).reduce((f, x) => (x[0] > d ? f * x[1] : f), 1);
}
const pfNear = (a, b, days) => Math.abs(pfDays(a, b)) <= days;

function pfMarketOf(p) {
  if (p.cat === 'tw') return '台股';
  const y = p.ysym || '';
  if (/\.T$/.test(y)) return '日股';
  if (/\.HK$/.test(y)) return '港股';
  if (/\.(KS|KQ)$/.test(y)) return '韓股';
  if (/\.(SS|SZ)$/.test(y)) return '陸股';
  if (/\.(L|DE|PA|AS|SW)$/.test(y)) return '歐股';
  if (!/\./.test(y)) return '美股';
  return '其他';
}

function pfTypeOf(p) {
  if (p.cat === 'tw') return /^00\d*B$/.test(p.sym) ? '債券 ETF' : /^00/.test(p.sym) ? 'ETF' : '股票';
  return /ETF/i.test(p.itype || '') ? 'ETF' : /CRYPTO/i.test(p.itype || '') ? '加密貨幣' : '股票';
}

/* ---------- 初始化 ---------- */
function initPortfolio() {
  $('#pfTabs').innerHTML = PF_TABS.map(([k, l]) => `<button data-t="${k}">${l}</button>`).join('');
  $('#pfTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) pfShow(b.dataset.t); });
  $('#pfRefresh').addEventListener('click', () => pfRefreshAll(true));
  $('.nav-btn[data-section="portfolio"]').addEventListener('click', pfEnter);
  document.addEventListener('visibilitychange', () => { if (pfActive() && Date.now() - pf.quoteAt > PF_QUOTE_SEC * 1000) pfRefreshQuotes(); });
}

function pfActive() { return !document.hidden && !$('#section-portfolio').classList.contains('hidden'); }

async function pfEnter() {
  if (!state.token) return;
  if (!pf.timer) pf.timer = setInterval(() => { if (pfActive() && pf.calc && pf.calc.open.length) pfRefreshQuotes(); }, PF_QUOTE_SEC * 1000);
  if (pf.loaded) { pfShow(pf.tab); if (Date.now() - pf.quoteAt > PF_QUOTE_SEC * 1000) pfRefreshQuotes(); return; }
  if (pf.loading) return;
  pf.loading = true;
  pfStatus('載入交易紀錄…');
  try {
    // 先顯示瀏覽器裡的上次市場資料，畫面不用等
    try { pf.mkt = JSON.parse(store.get(pfMktKey()) || 'null'); } catch { pf.mkt = null; }
    const r = (await api('portfolio', { op: 'load' })).data;
    pf.txns = r.txns || [];
    pf.meta = { ...PF_DEF_META, ...(r.meta || {}) };
    pf.loaded = true;
    pfRecalc();
    pfShow(pf.tab);
    await pfRefreshAll(false);
  } catch (err) {
    $('#pfBody').innerHTML = `<div class="panel-msg err">載入失敗：${esc(err.message)}<br><button class="btn btn-ghost btn-sm" id="pfRetry">重試</button></div>`;
    $('#pfRetry').addEventListener('click', pfEnter);
    pfStatus('載入失敗：' + err.message, 'err');
  } finally {
    pf.loading = false;
  }
}

function pfMktKey() { return 'mw_pf_mkt_' + (state.account || ''); }

function pfStatus(text, cls = '') {
  const el = $('#pfStatus');
  el.className = 'status ' + cls;
  el.innerHTML = '<span class="dot"></span>' + esc(text);
}

/** 需要的歷史資料：持股（含已出清，算已實現與績效用）、匯率、比較基準 */
function pfNeeds() {
  const syms = [...new Set(pf.txns.map(t => pfYsym(t.source)).filter(Boolean))];
  const ccys = [...new Set(pf.txns.map(t => t.ccy).concat(Object.keys(pf.meta.cash || {})).filter(c => c && c !== 'TWD'))];
  const from = pf.txns.length ? pf.txns.reduce((m, t) => (t.date < m ? t.date : m), pfToday()) : pfToday();
  return { syms, ccys, from, bench: [pf.meta.bench] };
}

async function pfRefreshAll(force) {
  if (!pf.txns.length && !Object.keys(pf.meta.cash || {}).length) { pfRecalc(); pfShow(pf.tab); pfStatus('尚無交易紀錄', 'live'); return; }
  pfStatus('更新市場資料…');
  const need = pfNeeds();
  const have = pf.mkt && pf.mkt.series ? pf.mkt.series : {};
  const missing = need.syms.concat(need.ccys.map(pfFxSym), need.bench).some(s => !have[s]);
  const fresh = pf.mkt && Date.now() - (pf.mkt.updated || 0) < 30 * 60000 && pf.mkt.from <= need.from;
  try {
    if (force || missing || !fresh) {
      // 有資料中繼站：瀏覽器直接抓（不經 Google）；全部失敗才走後端
      let m = null;
      if (proxyOn()) { try { m = await pfMarketDirect(need); } catch { m = null; } }
      if (!m || !Object.keys(m.series).length) m = (await apiBg('portfolio', { op: 'market', ...need })).data;
      pf.mkt = m;
      try { localStorage.setItem(pfMktKey(), JSON.stringify(m)); } catch { /* 空間不足就不存 */ }
    }
    await pfRefreshQuotes(true);
    const stale = (pf.mkt.stale || []).length;
    pfStatus(stale ? `${stale} 檔歷史資料暫時無法取得（${pf.mkt.stale.join('、')}），已用備援或略過` : '已更新 · ' + new Date().toLocaleTimeString('zh-TW', { hour12: false }), stale ? 'err' : 'live');
  } catch (err) {
    pfRecalc();
    pfShow(pf.tab);
    pfStatus('市場資料更新失敗：' + err.message + (pf.mkt ? '（先顯示上次資料）' : ''), 'err');
  }
}

/* ---------- 歷史價格／配息／分割：經中繼站直接抓（格式與後端 Portfolio.gs 的 pfMarket_ 相同） ---------- */
function pfRound(v) {
  if (v == null) return null;
  const a = Math.abs(v), p = a >= 1000 ? 100 : a >= 1 ? 10000 : 1000000;
  return Math.round(v * p) / p;
}

function pfRangeOf(from) {
  const days = (Date.now() - Date.parse(from || '2000-01-01')) / 86400000;
  return days <= 330 ? '2y' : days <= 1400 ? '5y' : days <= 3300 ? '10y' : 'max';
}

/** Yahoo 日線 → { t, c, divs, splits, ccy, itype, name, price }；保留 from 之後，至少近 400 天（相關係數、β 用） */
function pfParseChart(text, from) {
  const r = JSON.parse(text).chart.result[0];
  const q = r.indicators.quote[0], off = r.meta.gmtoffset || 0;
  const day = ts => new Date((ts + off) * 1000).toISOString().slice(0, 10);
  const minKeep = day(Date.now() / 1000 - 400 * 86400);
  const keep = from < minKeep ? from : minKeep;
  const t = [], c = [], seen = {};
  (r.timestamp || []).forEach((ts, i) => {
    if (q.close[i] == null) return;
    const d = day(ts);
    if (d < keep) return;
    if (seen[d] != null) { c[seen[d]] = pfRound(q.close[i]); return; }
    seen[d] = t.length;
    t.push(d); c.push(pfRound(q.close[i]));
  });
  const ev = r.events || {};
  const divs = Object.values(ev.dividends || {}).map(x => [day(x.date), pfRound(x.amount)]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const splits = Object.values(ev.splits || {}).map(x => [day(x.date), x.numerator / x.denominator])
    .filter(x => isFinite(x[1]) && x[1] > 0 && x[1] !== 1).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { t, c, divs, splits, ccy: r.meta.currency || null, itype: r.meta.instrumentType || '', name: r.meta.shortName || r.meta.longName || '', price: r.meta.regularMarketPrice || null };
}

async function pfMarketDirect(need) {
  const range = pfRangeOf(need.from);
  const syms = [...new Set(need.syms.concat(need.ccys.map(pfFxSym), need.bench))].filter(s => /^[\^A-Z0-9.\-=]{1,20}$/i.test(s));
  const out = { series: {}, stale: [], from: need.from, updated: Date.now(), direct: true };
  const prev = (pf.mkt && pf.mkt.series) || {};
  const queue = syms.slice();
  const one = async () => {
    while (queue.length) {
      const s = queue.shift();
      try {
        out.series[s] = pfParseChart(await pget('https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(s) + '?range=' + range + '&interval=1d&events=div,split', 20000), need.from);
      } catch {
        if (prev[s]) out.series[s] = prev[s]; // 沿用上次的資料
        out.stale.push(s);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, syms.length) }, one)); // 同時最多 6 檔
  return out;
}

async function pfRefreshQuotes(silent) {
  const c = pf.calc;
  const src = new Set();
  (c ? c.open : []).forEach(p => { if (/^(yahoo|mis):/.test(p.key)) src.add(p.key); });
  pfNeeds().ccys.forEach(ccy => src.add('yahoo:' + pfFxSym(ccy)));
  if (!c) pf.txns.forEach(t => { if (/^(yahoo|mis):/.test(t.source)) src.add(t.source); });
  if (src.size) {
    try {
      const r = await fetchQuotes([...src]);
      Object.entries(r.quotes || {}).forEach(([k, q]) => { if (q && q.price != null) pf.quotes[k] = q; });
      pf.quoteAt = Date.now();
      if (!silent) pfStatus('報價已更新 · ' + new Date().toLocaleTimeString('zh-TW', { hour12: false }), 'live');
    } catch (err) {
      if (!silent) pfStatus('報價更新失敗：' + err.message, 'err');
    }
  }
  pfRecalc();
  pfShow(pf.tab, true);
}

/* =========================================================
 * 計算核心
 * ========================================================= */
const PF_ORDER = { split: 0, stock: 1, buy: 2, sell: 3, div: 4 };

function pfRecalc() {
  pf.calc = pfCompute();
  pf.series = null; // 績效序列較重，用到時才算
}

function pfCompute() {
  const M = pf.meta;
  const groups = new Map();
  pf.txns.forEach(t => {
    if (!groups.has(t.source)) groups.set(t.source, { key: t.source, sym: t.sym, name: t.name, cat: t.cat, ccy: t.ccy, itype: t.itype, ysym: pfYsym(t.source), txns: [] });
    const g = groups.get(t.source);
    g.txns.push(t);
    if (t.name) g.name = t.name;
  });
  const positions = [], realized = [], divs = [], flows = [], autoSplits = [];
  const today = pfToday();
  for (const g of groups.values()) {
    const s = pfSeriesOf(g.ysym);
    const ev = g.txns.map(t => ({ ...t, kind: t.type }));
    const first = ev.reduce((m, e) => (e.date < m ? e.date : m), '9999');
    const ySplits = s ? s.splits : [];
    const manualStock = g.txns.filter(t => t.type === 'stock').map(t => t.date);
    // 使用者已手動輸入同一次分割（前後 10 天）就不再自動套用，避免股數重複增加
    if (M.autoSplit) ySplits.forEach(([d, r]) => {
      if (d > first && !manualStock.some(md => pfNear(md, d, 10))) { ev.push({ date: d, kind: 'split', ratio: r, auto: true }); autoSplits.push({ date: d, sym: g.sym, name: g.name, ratio: r }); }
    });
    const pxSplits = ySplits.slice();
    ev.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : PF_ORDER[a.kind] - PF_ORDER[b.kind]));
    let qty = 0, cost = 0, costTwd = 0, lots = [], realTwd = 0, divTwd = 0, divCcy = 0, bought = 0;
    const steps = []; // [日期, 當日收盤後股數]
    const manualDiv = [];
    for (const e of ev) {
      const fx = e.fx || pfFxAt(g.ccy, e.date);
      if (e.kind === 'buy') {
        const amt = e.qty * e.price + (e.fee || 0);
        qty += e.qty; cost += amt; costTwd += amt * fx; bought += amt * fx;
        lots.push({ q: e.qty, c: amt / e.qty, fx, d: e.date });
        flows.push({ d: e.date, v: -amt * fx, key: g.key });
      } else if (e.kind === 'sell') {
        const q = Math.min(e.qty, qty);
        if (q <= 0) continue;
        const proceeds = q * e.price - (e.fee || 0) - (e.tax || 0);
        let basis = 0, basisTwd = 0, firstD = null;
        if (M.method === 'fifo') {
          let left = q;
          while (left > 1e-9 && lots.length) {
            const l = lots[0], take = Math.min(l.q, left);
            basis += take * l.c; basisTwd += take * l.c * l.fx;
            firstD = firstD || l.d;
            l.q -= take; left -= take;
            if (l.q <= 1e-9) lots.shift();
          }
        } else {
          basis = cost * q / qty; basisTwd = costTwd * q / qty;
          lots.forEach(l => { l.q *= (qty - q) / qty; });
          firstD = lots.length ? lots[0].d : null;
        }
        cost -= basis; costTwd -= basisTwd; qty -= q;
        if (qty < 1e-9) { qty = 0; cost = 0; costTwd = 0; lots = []; }
        const pnlTwd = proceeds * fx - basisTwd;
        realTwd += pnlTwd;
        realized.push({ date: e.date, key: g.key, sym: g.sym, name: g.name, ccy: g.ccy, qty: q, price: e.price, proceeds, basis, pnl: proceeds - basis, pnlTwd,
          fxPart: basis ? proceeds * fx - proceeds * (basisTwd / basis) : 0, ret: basis ? (proceeds / basis - 1) * 100 : null, days: firstD ? Math.round(pfDays(firstD, e.date)) : null });
        flows.push({ d: e.date, v: proceeds * fx, key: g.key });
      } else if (e.kind === 'stock') {
        // 配股／分割：若 Yahoo 沒有這次分割事件，依當時持股推算比例，供價格基準換算
        if (qty > 0 && !ySplits.some(x => pfNear(x[0], e.date, 10))) pxSplits.push([e.date, (qty + e.qty) / qty]);
        qty += e.qty;
        lots.push({ q: e.qty, c: 0, fx, d: e.date });
      } else if (e.kind === 'split') {
        if (qty > 0) { qty *= e.ratio; lots.forEach(l => { l.q *= e.ratio; l.c /= e.ratio; }); }
      } else if (e.kind === 'div') {
        const net = (e.amount || 0) - (e.tax || 0);
        manualDiv.push(e.date);
        divTwd += net * fx; divCcy += net;
        divs.push({ date: e.date, key: g.key, sym: g.sym, name: g.name, ccy: g.ccy, per: e.qty ? e.amount / e.qty : null, qty: e.qty || null, gross: e.amount, tax: e.tax || 0, net, netTwd: net * fx, manual: true });
        flows.push({ d: e.date, v: net * fx, key: g.key, div: true });
      }
      steps.push([e.date, qty]);
    }
    const qtyBefore = d => { let q = 0; for (const st of steps) { if (st[0] < d) q = st[1]; else break; } return q; };
    // 自動股利：除息日前一天收盤持有的股數 × 每股配息（Yahoo 配息已依分割調整，要乘回分割係數）
    if (M.autoDiv && s) {
      s.divs.forEach(([d, amt]) => {
        if (d <= first || d > today) return;
        const q = qtyBefore(d);
        if (q <= 0) return;
        if (manualDiv.some(md => pfDays(d, md) >= -5 && pfDays(d, md) <= 75)) return; // 已手動輸入同一次股利
        const per = amt * pfFactor(pxSplits, d); // 換回除息當時的每股金額
        const gross = q * per;
        const tax = (g.ccy === 'USD' ? gross * (M.usTax || 0) / 100 : 0) + (g.cat === 'tw' && M.nhi && gross >= 20000 ? gross * 0.0211 : 0);
        const fx = pfFxAt(g.ccy, d);
        const net = gross - tax;
        divTwd += net * fx; divCcy += net;
        divs.push({ date: d, key: g.key, sym: g.sym, name: g.name, ccy: g.ccy, per, qty: q, gross, tax, net, netTwd: net * fx, manual: false });
        flows.push({ d, v: net * fx, key: g.key, div: true });
      });
    }
    // 檢查：成交價與 Yahoo 當日收盤（換算回實際價格）差距過大，代表可能有未輸入的分割／配股
    let pxWarn = '';
    if (s && s.t.length) {
      g.txns.filter(t => (t.type === 'buy' || t.type === 'sell') && t.price > 0 && t.date >= s.t[0]).some(t => {
        const i = pfIdx(s.t, t.date);
        const ref = i >= 0 ? s.c[i] * pfFactor(pxSplits, t.date) : null;
        if (ref && Math.abs(Math.log(t.price / ref)) > Math.log(1.4)) { pxWarn = `${t.date} 成交價 ${numTxt(t.price, 2)} 與當日收盤約 ${numTxt(ref, 2)} 差距過大`; return true; }
        return false;
      });
    }
    const q = pf.quotes[g.key];
    const last = s && s.c.length ? s.c[s.c.length - 1] : null;
    const price = q && q.price != null ? q.price : last;
    const prev = q && q.prev != null ? q.prev : s && s.c.length > 1 ? s.c[s.c.length - 2] : null;
    const fxN = pfFxNow(g.ccy) || 1;
    const value = isNum(price) ? qty * price : null;
    const valTwd = isNum(value) ? value * fxN : null;
    const avgFx = cost ? costTwd / cost : fxN;
    const unrealTwd = isNum(valTwd) ? valTwd - costTwd : null;
    positions.push({
      ...g, qty, cost, costTwd, avg: qty ? cost / qty : null, avgFx, price, prev, fxN, value, valTwd,
      pct: q && isNum(q.pct) ? q.pct : prev && price ? (price / prev - 1) * 100 : null,
      unreal: isNum(value) ? value - cost : null, unrealTwd, unrealPct: cost && isNum(value) ? (value / cost - 1) * 100 : null,
      todayTwd: isNum(price) && isNum(prev) ? qty * (price - prev) * fxN : null,
      priceEff: isNum(value) ? (value - cost) * avgFx : null, fxEff: isNum(value) ? value * (fxN - avgFx) : null,
      realTwd, divTwd, divCcy, bought, first, steps, pxSplits, pxWarn, market: pfMarketOf(g), type: pfTypeOf(g), live: !!(q && q.price != null),
      totalTwd: (unrealTwd || 0) + realTwd + divTwd,
    });
  }
  // 現金
  const cash = Object.entries(M.cash || {}).filter(([, v]) => isNum(+v) && +v !== 0).map(([ccy, v]) => ({ ccy, amt: +v, twd: +v * (pfFxNow(ccy) || 0) }));
  const cashTwd = cash.reduce((s, c) => s + c.twd, 0);
  const open = positions.filter(p => p.qty > 1e-9);
  const sum = (arr, k) => arr.reduce((s, x) => s + (isNum(x[k]) ? x[k] : 0), 0);
  const mv = sum(open, 'valTwd');
  open.forEach(p => { p.w = mv + cashTwd ? (p.valTwd || 0) / (mv + cashTwd) * 100 : 0; });
  const totalBought = sum(positions, 'bought');
  const tot = {
    mv, cashTwd, assets: mv + cashTwd, cost: sum(open, 'costTwd'), unreal: sum(open, 'unrealTwd'), today: sum(open, 'todayTwd'),
    real: sum(realized, 'pnlTwd'), div: sum(divs, 'netTwd'), bought: totalBought,
  };
  tot.total = tot.unreal + tot.real + tot.div;
  tot.totalPct = totalBought ? tot.total / totalBought * 100 : null;
  tot.unrealPct = tot.cost ? tot.unreal / tot.cost * 100 : null;
  tot.prevMv = mv - tot.today;
  tot.todayPct = tot.prevMv ? tot.today / tot.prevMv * 100 : null;
  tot.xirr = pfXirr(flows.concat(mv ? [{ d: pfToday(), v: mv }] : []));
  realized.sort((a, b) => (a.date < b.date ? 1 : -1));
  divs.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { positions, open, closed: positions.filter(p => p.qty <= 1e-9), realized, divs, flows, cash, tot, autoSplits };
}

/** 資金加權報酬（XIRR）：投入為負、取回與期末市值為正 */
function pfXirr(flows) {
  const fl = flows.filter(f => isNum(f.v) && f.v !== 0);
  if (fl.length < 2 || !fl.some(f => f.v < 0) || !fl.some(f => f.v > 0)) return null;
  const t0 = fl.reduce((m, f) => (f.d < m ? f.d : m), fl[0].d);
  if (pfDays(t0, pfToday()) < 30) return null; // 太短的期間年化沒有意義
  const f = r => fl.reduce((s, x) => s + x.v / Math.pow(1 + r, pfDays(t0, x.d) / 365), 0);
  let lo = -0.99, hi = 10;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2 * 100;
}

/** 每日市值、投入資金、時間加權報酬指數（績效頁用） */
function pfBuildSeries() {
  const C = pf.calc;
  if (!C || !C.positions.length || !pf.mkt) return null;
  const start = C.positions.reduce((m, p) => (p.first < m ? p.first : m), '9999');
  const dset = new Set();
  C.positions.forEach(p => { const s = pfSeriesOf(p.ysym); if (s) s.t.forEach(d => { if (d >= start) dset.add(d); }); });
  const dates = [...dset].sort();
  if (dates.length < 2) return null;
  // 每日外部資金流（買進為正、賣出為負）與股利
  const flowBy = {}, divBy = {};
  const nextTrading = d => { const i = pfIdx(dates, d); return dates[i] === d ? d : dates[Math.min(i + 1, dates.length - 1)]; };
  C.flows.forEach(f => {
    const d = nextTrading(f.d);
    if (f.div) divBy[d] = (divBy[d] || 0) + f.v; else flowBy[d] = (flowBy[d] || 0) - f.v;
  });
  const val = new Array(dates.length).fill(0);
  C.positions.forEach(p => {
    const s = pfSeriesOf(p.ysym);
    if (!s || !s.t.length) return;
    const fxS = p.ccy && p.ccy !== 'TWD' ? pfSeriesOf(pfFxSym(p.ccy)) : null;
    const fxDiv = p.ccy === 'GBp' ? 100 : 1;
    let si = -1, k = 0, q = 0;
    dates.forEach((d, i) => {
      while (si + 1 < s.t.length && s.t[si + 1] <= d) si++;
      while (k < p.steps.length && p.steps[k][0] <= d) { q = p.steps[k][1]; k++; }
      if (q <= 0 || si < 0) return;
      // Yahoo 收盤已依日後的分割調整：實際股數 × 之後的分割係數 = 今天基準的股數
      const adjQ = q * pfFactor(p.pxSplits, d);
      const fx = fxS && fxS.t.length ? (fxS.c[Math.max(0, pfIdx(fxS.t, d))] / fxDiv) : 1;
      val[i] += adjQ * s.c[si] * fx;
    });
  });
  const idx = [], invested = [], rets = [];
  let I = 1, inv = 0;
  dates.forEach((d, i) => {
    const F = flowBy[d] || 0, D = divBy[d] || 0;
    inv += F;
    let r = 0;
    const prevV = i ? val[i - 1] : 0;
    if (prevV > 0) r = (val[i] + D - F) / prevV - 1;
    else if (F > 0) r = (val[i] + D) / F - 1;
    if (!isFinite(r) || Math.abs(r) > 0.5) r = 0; // 資料缺漏造成的異常跳動
    I *= 1 + r;
    idx.push(I); invested.push(inv); rets.push(r);
  });
  // 比較基準
  const b = pfSeriesOf(pf.meta.bench);
  let bench = null;
  if (b && b.t.length) {
    const b0i = Math.max(0, pfIdx(b.t, dates[0]));
    const b0 = b.c[b0i];
    bench = dates.map(d => { const i = pfIdx(b.t, d); return i >= 0 ? b.c[i] / b0 : 1; });
  }
  return { dates, val, idx, invested, rets, bench };
}


function pfStats(S) {
  if (!S) return null;
  const n = S.dates.length;
  const years = pfDays(S.dates[0], S.dates[n - 1]) / 365;
  const twr = (S.idx[n - 1] - 1) * 100;
  const cagr = years > 0.5 ? (Math.pow(S.idx[n - 1], 1 / years) - 1) * 100 : null;
  const r = S.rets.slice(1);
  const mean = r.reduce((a, b) => a + b, 0) / (r.length || 1);
  const vol = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, r.length - 1)) * Math.sqrt(252) * 100;
  let peak = 0, mdd = 0, mddAt = null;
  const dd = S.idx.map((v, i) => { peak = Math.max(peak, v); const x = (v / peak - 1) * 100; if (x < mdd) { mdd = x; mddAt = S.dates[i]; } return x; });
  let beta = null, bTwr = null, corr = null;
  if (S.bench) {
    bTwr = (S.bench[n - 1] - 1) * 100;
    const k0 = Math.max(1, n - 250);
    const pr = [], br = [];
    for (let i = k0; i < n; i++) { if (S.bench[i - 1]) { pr.push(S.rets[i]); br.push(S.bench[i] / S.bench[i - 1] - 1); } }
    const m1 = pr.reduce((a, b) => a + b, 0) / (pr.length || 1), m2 = br.reduce((a, b) => a + b, 0) / (br.length || 1);
    let cov = 0, v1 = 0, v2 = 0;
    pr.forEach((x, i) => { cov += (x - m1) * (br[i] - m2); v1 += (x - m1) ** 2; v2 += (br[i] - m2) ** 2; });
    if (v2 > 0 && pr.length > 20) { beta = cov / v2; corr = v1 > 0 ? cov / Math.sqrt(v1 * v2) : null; }
  }
  // 月報酬
  const monthly = {};
  let lastI = 0, lastM = S.dates[0].slice(0, 7);
  S.dates.forEach((d, i) => {
    const m = d.slice(0, 7);
    if (m !== lastM) { monthly[lastM] = (S.idx[i - 1] / (lastI ? S.idx[lastI] : 1) - 1) * 100; lastI = i - 1; lastM = m; }
  });
  monthly[lastM] = (S.idx[n - 1] / (lastI ? S.idx[lastI] : 1) - 1) * 100;
  return { twr, cagr, vol, mdd, mddAt, dd, beta, corr, bTwr, years, monthly, sharpe: vol && cagr != null ? (cagr - 1.5) / vol : null };
}

/* =========================================================
 * 畫面
 * ========================================================= */
function pfShow(tab, quiet) {
  pf.tab = tab;
  $$('#pfTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
  if (!pf.loaded) return;
  // 交易表單正在輸入時，背景更新報價不要重畫（避免輸入被清掉）
  if (quiet && tab === 'txns' && document.activeElement && document.activeElement.closest('#pfForm')) return;
  pf.charts.forEach(c => c.remove());
  pf.charts = [];
  const body = $('#pfBody');
  if (!pf.txns.length && tab !== 'txns') {
    body.innerHTML = `<div class="pf-empty">
      <h3>還沒有任何部位</h3>
      <p>到「交易紀錄」新增買進紀錄（台股輸入代號與股數，例如 2330 買 1000 股），或用 CSV 一次匯入。<br>
      新增後這裡會自動計算即時損益、資產配置、股利現金流、匯率影響與績效。</p>
      <button class="btn btn-primary" id="pfGoTx">＋ 新增第一筆交易</button></div>`;
    $('#pfGoTx').addEventListener('click', () => pfShow('txns'));
    return;
  }
  try {
    ({ overview: pfRenderOverview, alloc: pfRenderAlloc, pnl: pfRenderPnl, div: pfRenderDiv, fx: pfRenderFx, perf: pfRenderPerf, txns: pfRenderTxns })[tab]();
  } catch (err) {
    console.error(err);
    body.innerHTML = `<div class="panel-msg err">顯示失敗：${esc(err.message)}</div>`;
  }
}

function pfChart(el, opts = {}) {
  const LWC = window.LightweightCharts;
  if (!LWC || !el) return null;
  const ch = LWC.createChart(el, Object.assign({
    autoSize: true, layout: { background: { type: 'solid', color: '#fff' }, textColor: '#5b6778', fontSize: 11 },
    grid: { vertLines: { color: '#f2f4f7' }, horzLines: { color: '#f2f4f7' } }, rightPriceScale: { borderColor: '#e3e8ef' },
    timeScale: { borderColor: '#e3e8ef' }, localization: { locale: 'zh-TW', dateFormat: 'yyyy-MM-dd' }, handleScale: { mouseWheel: false },
  }, opts));
  pf.charts.push(ch);
  return ch;
}

function pfKpi(label, value, sub = '', cls = '') {
  return `<div class="kpi"><div class="kpi-l">${label}</div><div class="kpi-v ${cls}">${value}</div>${sub ? `<div class="kpi-s">${sub}</div>` : ''}</div>`;
}

function pfBars(items, fmt = v => numTxt(v, 1) + '%', color) {
  const max = Math.max(...items.map(x => Math.abs(x[1])), 0.0001);
  return `<div class="hbars">${items.map((x, i) => `<div class="hbar"><span class="hbar-n">${x[0]}</span>
    <span class="hbar-t"><i style="width:${Math.abs(x[1]) / max * 100}%;background:${color || PF_COLORS[i % PF_COLORS.length]}"></i></span><b>${fmt(x[1], x)}</b></div>`).join('')}</div>`;
}

function pfSortTh(key, label, num = true) {
  const on = pf.sort[0] === key;
  return `<th class="${num ? 'num ' : ''}click ${on ? 'sel' : ''}" data-psort="${key}">${label}${on ? (pf.sort[1] > 0 ? ' ▲' : ' ▼') : ''}</th>`;
}

function pfStaleNote() {
  const st = pf.mkt && pf.mkt.stale && pf.mkt.stale.length ? pf.mkt.stale : [];
  const noQuote = pf.calc.open.filter(p => !p.live).map(p => p.sym);
  const pxw = pf.calc.positions.filter(p => p.pxWarn);
  return (st.length ? `<div class="pf-warn">⚠ ${esc(st.join('、'))} 的歷史資料暫時無法取得，相關的股利與績效可能不完整。</div>` : '') +
    (noQuote.length && pf.quoteAt ? `<div class="pf-warn">⚠ ${esc(noQuote.join('、'))} 沒有即時報價，以最近收盤價計算。</div>` : '') +
    pxw.map(p => `<div class="pf-warn">⚠ ${esc(p.name)}：${esc(p.pxWarn)}。如果期間有股票分割或配股，請在交易紀錄新增「配股／分割」（填增加的股數），否則股數、股利與績效會失真。</div>`).join('');
}

/* ---------- 總覽 ---------- */
function pfRenderOverview() {
  const C = pf.calc, T = C.tot;
  const rows = C.open.slice().sort((a, b) => {
    const [k, dir] = pf.sort;
    const x = a[k], y = b[k];
    if (typeof x === 'string' || typeof y === 'string') return String(x || '').localeCompare(String(y || '')) * dir;
    return dir * ((isNum(x) ? x : -Infinity) - (isNum(y) ? y : -Infinity));
  });
  const S = pf.series || (pf.series = pfBuildSeries());
  $('#pfBody').innerHTML = `
    ${pfStaleNote()}
    <div class="kpis pf-kpis">
      ${pfKpi('總資產（台幣）', twd(T.assets), T.cashTwd ? `股票 ${twd(T.mv)}・現金 ${twd(T.cashTwd)}` : '')}
      ${pfKpi('今日損益', twdS(T.today), pfPct(T.todayPct), dirCls(T.today))}
      ${pfKpi('未實現損益', twdS(T.unreal), '報酬率 ' + pfPct(T.unrealPct), dirCls(T.unreal))}
      ${pfKpi('已實現損益', twdS(T.real), `${C.realized.length} 筆賣出`, dirCls(T.real))}
      ${pfKpi('累計股利', twd(T.div), `${C.divs.length} 次配息（稅後）`)}
      ${pfKpi('含息總報酬', twdS(T.total), '對累計投入 ' + pfPct(T.totalPct), dirCls(T.total))}
      ${pfKpi('年化報酬（XIRR）', isNum(T.xirr) ? pfPct(T.xirr) : '—', '資金加權，考慮投入時點', dirCls(T.xirr))}
    </div>
    <div class="pf-grid">
      <section class="panel" style="--span:12"><div class="panel-head"><h2 class="panel-title">持股明細</h2><span class="muted">${C.open.length} 檔・點名稱開啟個股研究、點代號看走勢</span></div>
        <div class="panel-body"><div class="tbl-wrap"><table class="mtbl pf-tbl">
          <thead><tr>${pfSortTh('name', '名稱', false)}${pfSortTh('qty', '股數')}${pfSortTh('avg', '成本均價')}${pfSortTh('price', '現價')}${pfSortTh('pct', '漲跌%')}
            ${pfSortTh('valTwd', '市值(台幣)')}${pfSortTh('unrealTwd', '未實現損益')}${pfSortTh('unrealPct', '報酬%')}${pfSortTh('divTwd', '已領股利')}${pfSortTh('totalTwd', '含息總損益')}${pfSortTh('w', '權重')}${pfSortTh('todayTwd', '今日損益')}</tr></thead>
          <tbody>${rows.map(p => `<tr>
            <td class="nm"><a href="#" data-rs="${esc(p.sym)}">${esc(p.name)}</a> <a href="#" class="muted pf-sym" data-ch="${esc(p.key)}">${esc(p.sym)}</a>${p.ccy !== 'TWD' ? ` <span class="tag">${esc(p.ccy)}</span>` : ''}</td>
            <td class="num">${numTxt(p.qty, p.qty % 1 ? 2 : 0)}</td><td class="num">${numTxt(p.avg, 2)}</td>
            <td class="num strong">${numTxt(p.price, 2)}${p.live ? '' : '<span class="muted" title="無即時報價，使用最近收盤">*</span>'}</td>
            <td class="num ${dirCls(p.pct)}">${pfPct(p.pct)}</td><td class="num strong">${twd(p.valTwd)}</td>
            <td class="num ${dirCls(p.unrealTwd)}">${twdS(p.unrealTwd)}</td><td class="num ${dirCls(p.unrealPct)}">${pfPct(p.unrealPct)}</td>
            <td class="num">${p.divTwd ? twd(p.divTwd) : '—'}</td><td class="num ${dirCls(p.totalTwd)}">${twdS(p.totalTwd)}</td>
            <td class="num">${numTxt(p.w, 1)}%</td><td class="num ${dirCls(p.todayTwd)}">${twdS(p.todayTwd)}</td></tr>`).join('')}
            ${C.cash.map(c => `<tr class="pf-cash"><td class="nm">現金 <span class="tag">${esc(c.ccy)}</span></td><td class="num">${numTxt(c.amt, 0)}</td><td></td><td></td><td></td>
              <td class="num strong">${twd(c.twd)}</td><td></td><td></td><td></td><td></td><td class="num">${numTxt(T.assets ? c.twd / T.assets * 100 : 0, 1)}%</td><td></td></tr>`).join('')}
            <tr class="sum"><td>合計</td><td></td><td></td><td></td><td class="num ${dirCls(T.todayPct)}">${pfPct(T.todayPct)}</td><td class="num">${twd(T.assets)}</td>
              <td class="num ${dirCls(T.unreal)}">${twdS(T.unreal)}</td><td class="num ${dirCls(T.unrealPct)}">${pfPct(T.unrealPct)}</td><td class="num">${twd(C.open.reduce((s, p) => s + p.divTwd, 0))}</td>
              <td class="num ${dirCls(C.open.reduce((s, p) => s + p.totalTwd, 0))}">${twdS(C.open.reduce((s, p) => s + p.totalTwd, 0))}</td><td class="num">100%</td><td class="num ${dirCls(T.today)}">${twdS(T.today)}</td></tr>
          </tbody></table></div>
          ${C.closed.length ? `<div class="foot-note">已出清：${C.closed.map(p => `${esc(p.name)}（已實現 ${twdS(p.realTwd)}${p.divTwd ? '、股利 ' + twd(p.divTwd) : ''}）`).join('、')}</div>` : ''}
          <div class="foot-note">市值與損益以即時報價（每 ${PF_QUOTE_SEC} 秒更新，只在此頁更新）與即時匯率換算成台幣；成本含手續費。
            未實現損益 = 市值 − 成本（${pf.meta.method === 'fifo' ? '先進先出' : '平均成本法'}）。含息總損益 = 未實現 + 已實現 + 已領股利。</div></div></section>
      <section class="panel" style="--span:12"><div class="panel-head"><h2 class="panel-title">資產走勢</h2><span class="muted">股票市值與累計投入資金（台幣）</span></div>
        <div class="panel-body">${S ? `<div class="chart-legend"><span style="--c:#1f4e8c">市值</span><span style="--c:#e67e22">累計投入（買進 − 賣出）</span></div><div class="mini-chart tall" id="pfValChart"></div>`
          : '<div class="panel-msg">市場資料載入後顯示</div>'}</div></section>
    </div>`;
  $$('#pfBody [data-psort]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.psort;
    pf.sort = [k, pf.sort[0] === k ? -pf.sort[1] : -1];
    pfRenderOverview();
  }));
  $$('#pfBody [data-rs]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); openResearch(a.dataset.rs); }));
  $$('#pfBody [data-ch]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const p = C.open.find(x => x.key === a.dataset.ch);
    if (p) openChart({ category: p.cat, symbol: p.sym, name: p.name, source: p.key });
  }));
  if (S) {
    const ch = pfChart($('#pfValChart'));
    if (ch) {
      const LWC = window.LightweightCharts;
      const pfm = { type: 'custom', formatter: v => numTxt(v, 0) };
      ch.addSeries(LWC.AreaSeries, { lineColor: '#1f4e8c', topColor: 'rgba(31,78,140,.25)', bottomColor: 'rgba(31,78,140,.02)', lineWidth: 2, priceFormat: pfm, priceLineVisible: false })
        .setData(S.dates.map((d, i) => ({ time: d, value: S.val[i] })));
      ch.addSeries(LWC.LineSeries, { color: '#e67e22', lineWidth: 2, lineType: 1, priceFormat: pfm, priceLineVisible: false })
        .setData(S.dates.map((d, i) => ({ time: d, value: S.invested[i] })));
      ch.timeScale().fitContent();
    }
  }
}

/* ---------- 配置與再平衡 ---------- */
function pfGroupBy(open, cash, keyFn) {
  const m = new Map();
  open.forEach(p => m.set(keyFn(p), (m.get(keyFn(p)) || 0) + (p.valTwd || 0)));
  cash.forEach(c => m.set(keyFn({ cash: true, ccy: c.ccy }), (m.get(keyFn({ cash: true, ccy: c.ccy })) || 0) + c.twd));
  const tot = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()].map(([k, v]) => [k, tot ? v / tot * 100 : 0, v]).sort((a, b) => b[1] - a[1]);
}

function pfRenderAlloc() {
  const C = pf.calc, T = C.tot;
  const open = C.open.slice().sort((a, b) => (b.valTwd || 0) - (a.valTwd || 0));
  const ws = open.map(p => p.w);
  const top1 = ws[0] || 0, top5 = ws.slice(0, 5).reduce((a, b) => a + b, 0);
  const hhi = ws.concat(C.cash.map(c => (T.assets ? c.twd / T.assets * 100 : 0))).reduce((s, w) => s + (w / 100) ** 2, 0);
  const effN = hhi ? 1 / hhi : 0;
  const warn = [];
  if (top1 > 25) warn.push(`單一持股「${esc(open[0].name)}」占 ${numTxt(top1, 1)}%，超過 25%`);
  if (top5 > 70 && open.length > 5) warn.push(`前 5 大持股合計 ${numTxt(top5, 1)}%`);
  const byCcy = pfGroupBy(open, C.cash, p => p.ccy === 'GBp' ? 'GBP' : p.ccy);
  const fxShare = byCcy.filter(x => x[0] !== 'TWD').reduce((s, x) => s + x[1], 0);
  if (fxShare > 60) warn.push(`外幣資產占 ${numTxt(fxShare, 1)}%，台幣升值時影響較大`);
  const tg = pf.meta.targets || {};
  const tgSum = Object.values(tg).reduce((s, v) => s + (+v || 0), 0);
  const items = open.map(p => ({ key: p.key, name: p.name, sym: p.sym, val: p.valTwd || 0, w: p.w, price: p.price, fx: p.fxN, tw: p.cat === 'tw' }))
    .concat(C.cash.length ? [{ key: '_cash', name: '現金（合計）', sym: '', val: T.cashTwd, w: T.assets ? T.cashTwd / T.assets * 100 : 0 }] : []);
  $('#pfBody').innerHTML = `
    <div class="kpis pf-kpis">
      ${pfKpi('持股檔數', C.open.length, C.cash.length ? `另有 ${C.cash.length} 種現金` : '')}
      ${pfKpi('最大持股', numTxt(top1, 1) + '%', open[0] ? esc(open[0].name) : '')}
      ${pfKpi('前 5 大合計', numTxt(top5, 1) + '%')}
      ${pfKpi('有效分散檔數', numTxt(effN, 1), '1 ÷ Σ權重²；越大越分散')}
      ${pfKpi('外幣資產', numTxt(fxShare, 1) + '%')}
    </div>
    ${warn.length ? `<div class="pf-warn">⚠ ${warn.join('；')}</div>` : ''}
    <div class="pf-grid">
      <section class="panel" style="--span:6"><div class="panel-head"><h2 class="panel-title">依持股</h2></div><div class="panel-body">
        ${pfBars(open.map(p => [esc(p.name), p.w]).concat(C.cash.map(c => ['現金 ' + c.ccy, T.assets ? c.twd / T.assets * 100 : 0])))}</div></section>
      <section class="panel" style="--span:6"><div class="panel-head"><h2 class="panel-title">依市場／類型／幣別</h2></div><div class="panel-body">
        <div class="sub-h">市場</div>${pfBars(pfGroupBy(open, C.cash, p => (p.cash ? '現金' : p.market)))}
        <div class="sub-h">類型</div>${pfBars(pfGroupBy(open, C.cash, p => (p.cash ? '現金' : p.type)))}
        <div class="sub-h">幣別</div>${pfBars(byCcy)}</div></section>
      <section class="panel" style="--span:12"><div class="panel-head"><h2 class="panel-title">目標配置與再平衡試算</h2>
        <div class="panel-tools"><button class="btn btn-ghost btn-sm" id="pfTgFill">以目前權重填入</button><button class="btn btn-ghost btn-sm" id="pfTgClear">清除目標</button></div></div>
        <div class="panel-body"><div class="tbl-wrap"><table class="mtbl pf-tbl">
          <thead><tr><th>標的</th><th class="num">市值(台幣)</th><th class="num">目前權重</th><th class="num">目標 %</th><th class="num">差距</th><th class="num">需調整金額</th><th class="num">約當股數</th></tr></thead>
          <tbody>${items.map(x => {
            const t = tg[x.key];
            const has = t !== undefined && t !== '';
            const diffAmt = has ? (+t / 100) * T.assets - x.val : null;
            const sh = has && x.price && x.fx ? diffAmt / (x.price * x.fx) : null;
            return `<tr><td class="nm">${esc(x.name)} <span class="muted">${esc(x.sym)}</span></td><td class="num">${twd(x.val)}</td><td class="num">${numTxt(x.w, 1)}%</td>
              <td class="num"><input class="pf-tg" type="number" step="0.5" min="0" max="100" data-k="${esc(x.key)}" value="${has ? esc(t) : ''}" placeholder="—"></td>
              <td class="num ${has ? dirCls(+t - x.w) : ''}">${has ? signTxt(+t - x.w, 1) + '%' : '—'}</td>
              <td class="num ${dirCls(diffAmt)}">${has ? (diffAmt > 0 ? '買進 ' : '賣出 ') + twd(Math.abs(diffAmt)) : '—'}</td>
              <td class="num">${isNum(sh) ? numTxt(Math.abs(sh), x.tw ? 0 : 2) + ' 股' + (x.tw && Math.abs(sh) >= 1000 ? `（${numTxt(Math.abs(sh) / 1000, 1)} 張）` : '') : '—'}</td></tr>`;
          }).join('')}
          <tr class="sum"><td>合計</td><td class="num">${twd(T.assets)}</td><td class="num">100%</td><td class="num ${Math.abs(tgSum - 100) > 0.01 && tgSum ? 'down' : ''}">${tgSum ? numTxt(tgSum, 1) + '%' : '—'}</td><td></td><td></td><td></td></tr></tbody></table></div>
          <div class="foot-note">輸入各標的目標比例（合計應為 100%），會試算要買賣多少才能回到目標配置；目標存在帳號設定，換電腦也一樣。試算不含手續費與稅，零股與整張請自行取捨。</div></div></section>
    </div>`;
  let t;
  $$('#pfBody .pf-tg').forEach(inp => inp.addEventListener('change', () => {
    const tgt = { ...(pf.meta.targets || {}) };
    if (inp.value === '') delete tgt[inp.dataset.k]; else tgt[inp.dataset.k] = Math.max(0, Math.min(100, +inp.value));
    pf.meta.targets = tgt;
    clearTimeout(t);
    t = setTimeout(pfSaveMeta, 800);
    pfRenderAlloc();
  }));
  $('#pfTgFill').addEventListener('click', () => {
    const tgt = {};
    items.forEach(x => { tgt[x.key] = Math.round(x.w * 2) / 2; });
    pf.meta.targets = tgt; pfSaveMeta(); pfRenderAlloc();
  });
  $('#pfTgClear').addEventListener('click', () => { pf.meta.targets = {}; pfSaveMeta(); pfRenderAlloc(); });
}

async function pfSaveMeta() {
  try { await api('portfolio', { op: 'meta', meta: pf.meta }); }
  catch (err) { toast('設定儲存失敗：' + err.message); }
}

/* ---------- 已實現損益 ---------- */
function pfRenderPnl() {
  const C = pf.calc;
  const years = [...new Set(C.realized.map(r => r.date.slice(0, 4)))].sort().reverse();
  const list = C.realized.filter(r => !pf.pnlYear || r.date.startsWith(pf.pnlYear));
  const wins = list.filter(r => r.pnlTwd > 0), losses = list.filter(r => r.pnlTwd < 0);
  const sum = arr => arr.reduce((s, r) => s + r.pnlTwd, 0);
  const byYear = years.map(y => { const a = C.realized.filter(r => r.date.startsWith(y)); return [y, sum(a), a.length]; });
  const bySym = new Map();
  list.forEach(r => bySym.set(r.name, (bySym.get(r.name) || 0) + r.pnlTwd));
  const symRows = [...bySym.entries()].sort((a, b) => b[1] - a[1]);
  const unreal = C.open.filter(p => isNum(p.unrealTwd)).sort((a, b) => b.unrealTwd - a.unrealTwd);
  $('#pfBody').innerHTML = `
    <div class="etf-filter"><div class="seg seg-sm" id="pfYear">${[['', '全部']].concat(years.map(y => [y, y])).map(([v, l]) => `<button data-v="${v}" class="${v === pf.pnlYear ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="muted">成本計算：${pf.meta.method === 'fifo' ? '先進先出（FIFO）' : '平均成本法'}（可在「交易紀錄 → 設定」切換）</span></div>
    <div class="kpis pf-kpis">
      ${pfKpi('已實現損益', twdS(sum(list)), `${list.length} 筆賣出`, dirCls(sum(list)))}
      ${pfKpi('勝率', list.length ? numTxt(wins.length / list.length * 100, 0) + '%' : '—', `賺 ${wins.length}・賠 ${losses.length}`)}
      ${pfKpi('平均獲利', wins.length ? twdS(sum(wins) / wins.length) : '—', '', 'up')}
      ${pfKpi('平均虧損', losses.length ? twdS(sum(losses) / losses.length) : '—', '', 'down')}
      ${pfKpi('獲利因子', losses.length && wins.length ? numTxt(sum(wins) / Math.abs(sum(losses)), 2) : '—', '總獲利 ÷ 總虧損')}
    </div>
    <div class="pf-grid">
      <section class="panel" style="--span:4"><div class="panel-head"><h2 class="panel-title">年度已實現</h2></div><div class="panel-body">
        ${byYear.length ? pfBars(byYear.map(([y, v, n]) => [`${y} <span class="muted">${n} 筆</span>`, v]), v => twdS(v), null) : '<div class="muted">尚無賣出紀錄</div>'}</div></section>
      <section class="panel" style="--span:4"><div class="panel-head"><h2 class="panel-title">依標的</h2></div><div class="panel-body">
        ${symRows.length ? pfBars(symRows.map(([n, v]) => [esc(n), v]), v => twdS(v)) : '<div class="muted">—</div>'}</div></section>
      <section class="panel" style="--span:4"><div class="panel-head"><h2 class="panel-title">未實現損益排行</h2></div><div class="panel-body">
        ${unreal.length ? pfBars(unreal.map(p => [esc(p.name), p.unrealTwd]), v => twdS(v)) : '<div class="muted">—</div>'}</div></section>
      <section class="panel" style="--span:12"><div class="panel-head"><h2 class="panel-title">賣出明細</h2></div><div class="panel-body"><div class="tbl-wrap"><table class="mtbl pf-tbl">
        <thead><tr><th>日期</th><th>標的</th><th class="num">股數</th><th class="num">賣價</th><th class="num">每股成本</th><th class="num">淨收入</th><th class="num">損益(原幣)</th><th class="num">損益(台幣)</th><th class="num">報酬%</th><th class="num">持有天數</th></tr></thead>
        <tbody>${list.length ? list.map(r => `<tr><td>${r.date}</td><td class="nm">${esc(r.name)} <span class="muted">${esc(r.sym)}</span></td><td class="num">${numTxt(r.qty, r.qty % 1 ? 2 : 0)}</td>
          <td class="num">${numTxt(r.price, 2)}</td><td class="num">${numTxt(r.basis / r.qty, 2)}</td><td class="num">${numTxt(r.proceeds, 0)}${r.ccy !== 'TWD' ? ' ' + esc(r.ccy) : ''}</td>
          <td class="num ${dirCls(r.pnl)}">${twdS(r.pnl, r.ccy === 'TWD' ? 0 : 2)}</td><td class="num strong ${dirCls(r.pnlTwd)}">${twdS(r.pnlTwd)}</td>
          <td class="num ${dirCls(r.ret)}">${pfPct(r.ret)}</td><td class="num">${isNum(r.days) ? r.days : '—'}</td></tr>`).join('') : '<tr><td colspan="10" class="muted">此期間沒有賣出紀錄</td></tr>'}</tbody></table></div>
        <div class="foot-note">淨收入 = 股數 × 賣價 − 手續費 − 交易稅。外幣標的的台幣損益以買進與賣出當時的匯率計算（含匯差）。${pf.meta.method === 'fifo' ? '' : '平均成本法的持有天數以最早一筆仍持有的買進日估算。'}</div></div></section>
    </div>`;
  $$('#pfYear button').forEach(b => b.addEventListener('click', () => { pf.pnlYear = b.dataset.v; pfRenderPnl(); }));
}

/* ---------- 股利現金流 ---------- */
function pfRenderDiv() {
  const C = pf.calc, M = pf.meta;
  const today = pfToday();
  const yAgo = new Date(Date.now() - 365 * 86400000).toLocaleDateString('sv-SE');
  const ym = d => d.slice(0, 7);
  // 過去 12 個月實收（依月份）
  const months = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(d.toLocaleDateString('sv-SE').slice(0, 7)); }
  const past = Object.fromEntries(months.map(m => [m, 0]));
  C.divs.forEach(d => { if (past[ym(d.date)] != null) past[ym(d.date)] += d.netTwd; });
  // 未來 12 個月預估：近 12 個月的每股配息 × 目前股數，月份照去年
  const fut = {};
  const fMonths = [];
  for (let i = 1; i <= 12; i++) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i - 1); fMonths.push(d.toLocaleDateString('sv-SE').slice(0, 7)); }
  fMonths.forEach(m => { fut[m] = 0; });
  const perPos = C.open.map(p => {
    const s = pfSeriesOf(p.ysym);
    const ev = s ? s.divs.filter(d => d[0] > yAgo && d[0] <= today) : [];
    const perShare = ev.reduce((a, d) => a + d[1], 0); // 已依分割調整成今天的股數基準
    const taxRate = (p.ccy === 'USD' ? (M.usTax || 0) / 100 : 0);
    let annual = 0;
    ev.forEach(([d, amt]) => {
      const gross = amt * p.qty;
      const net = gross * (1 - taxRate) - (p.cat === 'tw' && M.nhi && gross >= 20000 ? gross * 0.0211 : 0);
      const netTwd = net * p.fxN;
      annual += netTwd;
      const mm = String(+d.slice(5, 7)).padStart(2, '0');
      const target = fMonths.find(m => m.slice(5) === mm);
      if (target) fut[target] += netTwd;
    });
    return { p, n: ev.length, perShare, annual, yoc: p.costTwd ? annual / p.costTwd * 100 : null, yld: p.valTwd ? annual / p.valTwd * 100 : null };
  }).filter(x => x.n).sort((a, b) => b.annual - a.annual);
  const last12 = C.divs.filter(d => d.date > yAgo).reduce((s, d) => s + d.netTwd, 0);
  const fwd = perPos.reduce((s, x) => s + x.annual, 0);
  const maxBar = Math.max(...Object.values(past), ...Object.values(fut), 1);
  const bar = (m, v, proj) => `<div class="pf-mbar${proj ? ' proj' : ''}" title="${m}：${twd(v)}"><i style="height:${v / maxBar * 100}%"></i><span>${+m.slice(5)}月</span></div>`;
  $('#pfBody').innerHTML = `
    <div class="kpis pf-kpis">
      ${pfKpi('累計股利（稅後）', twd(C.tot.div), `${C.divs.length} 次`)}
      ${pfKpi('近 12 個月', twd(last12), '每月平均 ' + twd(last12 / 12))}
      ${pfKpi('預估未來 12 個月', twd(fwd), '每月平均 ' + twd(fwd / 12))}
      ${pfKpi('成本殖利率', C.tot.cost ? numTxt(fwd / C.tot.cost * 100, 2) + '%' : '—', '預估年股利 ÷ 持股成本')}
      ${pfKpi('市值殖利率', C.tot.mv ? numTxt(fwd / C.tot.mv * 100, 2) + '%' : '—', '預估年股利 ÷ 目前市值')}
    </div>
    <div class="pf-grid">
      <section class="panel" style="--span:12"><div class="panel-head"><h2 class="panel-title">每月股利現金流</h2><span class="muted">左：過去 12 個月實收・右：未來 12 個月預估（台幣）</span></div>
        <div class="panel-body"><div class="pf-mbars">${months.map(m => bar(m, past[m], false)).join('')}<div class="pf-mbar-sep"></div>${fMonths.map(m => bar(m, fut[m], true)).join('')}</div>
        <div class="foot-note">預估 = 近 12 個月每股配息 × 目前股數，月份比照去年同期；實際配息以公司公告為準。</div></div></section>
      <section class="panel" style="--span:12"><div class="panel-head"><h2 class="panel-title">各持股股利</h2></div><div class="panel-body"><div class="tbl-wrap"><table class="mtbl pf-tbl">
        <thead><tr><th>標的</th><th class="num">近 12 月配息次數</th><th class="num">近 12 月每股</th><th class="num">預估年股利(台幣)</th><th class="num">成本殖利率</th><th class="num">市值殖利率</th><th class="num">累計已領</th></tr></thead>
        <tbody>${perPos.length ? perPos.map(x => `<tr><td class="nm">${esc(x.p.name)} <span class="muted">${esc(x.p.sym)}</span></td><td class="num">${x.n}</td>
          <td class="num">${numTxt(x.perShare, 3)} ${x.p.ccy !== 'TWD' ? esc(x.p.ccy) : ''}</td><td class="num strong">${twd(x.annual)}</td>
          <td class="num">${isNum(x.yoc) ? numTxt(x.yoc, 2) + '%' : '—'}</td><td class="num">${isNum(x.yld) ? numTxt(x.yld, 2) + '%' : '—'}</td><td class="num">${twd(x.p.divTwd)}</td></tr>`).join('')
          : '<tr><td colspan="7" class="muted">目前持股近 12 個月沒有配息</td></tr>'}</tbody></table></div></div></section>
      <section class="panel" style="--span:12"><div class="panel-head"><h2 class="panel-title">配息紀錄</h2></div><div class="panel-body"><div class="tbl-wrap pf-scroll"><table class="mtbl pf-tbl">
        <thead><tr><th>${'除息／入帳日'}</th><th>標的</th><th class="num">持有股數</th><th class="num">每股</th><th class="num">稅前</th><th class="num">扣稅／健保</th><th class="num">稅後</th><th class="num">台幣</th><th>來源</th></tr></thead>
        <tbody>${C.divs.length ? C.divs.map(d => `<tr><td>${d.date}</td><td class="nm">${esc(d.name)} <span class="muted">${esc(d.sym)}</span></td>
          <td class="num">${isNum(d.qty) ? numTxt(d.qty, d.qty % 1 ? 2 : 0) : '—'}</td><td class="num">${isNum(d.per) ? numTxt(d.per, 4) : '—'}</td>
          <td class="num">${numTxt(d.gross, d.ccy === 'TWD' ? 0 : 2)}</td><td class="num">${d.tax ? numTxt(d.tax, d.ccy === 'TWD' ? 0 : 2) : '—'}</td>
          <td class="num">${numTxt(d.net, d.ccy === 'TWD' ? 0 : 2)} ${d.ccy !== 'TWD' ? esc(d.ccy) : ''}</td><td class="num strong">${twd(d.netTwd)}</td>
          <td>${d.manual ? '<span class="tag">手動</span>' : '<span class="tag ok">自動</span>'}</td></tr>`).join('') : '<tr><td colspan="9" class="muted">尚無配息</td></tr>'}</tbody></table></div>
        <div class="foot-note">「自動」依 Yahoo 的除息紀錄計算：除息日前一天持有的股數 × 每股配息（日期為除息日，實際入帳通常晚 3–6 週）。
          美股預扣 ${M.usTax}% 股利稅${M.nhi ? '、台股單筆 ≥ 2 萬元扣 2.11% 二代健保' : ''}，可在「交易紀錄 → 設定」調整。
          若自動金額不正確（例如股票股利、特別股利），請手動新增「現金股利」紀錄，前後 2 個月內的自動紀錄會被取代。</div></div></section>
    </div>`;
}

/* ---------- 匯率影響 ---------- */
function pfRenderFx() {
  const C = pf.calc;
  const fxPos = C.open.filter(p => p.ccy && p.ccy !== 'TWD');
  const byCcy = new Map();
  fxPos.forEach(p => {
    const k = p.ccy === 'GBp' ? 'GBP' : p.ccy;
    const x = byCcy.get(k) || { ccy: k, val: 0, cost: 0, costTwd: 0, valTwd: 0, price: 0, fx: 0, n: 0 };
    const div = p.ccy === 'GBp' ? 100 : 1;
    x.val += (p.value || 0) / div; x.cost += p.cost / div; x.costTwd += p.costTwd; x.valTwd += p.valTwd || 0;
    x.price += p.priceEff || 0; x.fx += p.fxEff || 0; x.n++;
    byCcy.set(k, x);
  });
  C.cash.filter(c => c.ccy !== 'TWD').forEach(c => {
    const x = byCcy.get(c.ccy) || { ccy: c.ccy, val: 0, cost: 0, costTwd: 0, valTwd: 0, price: 0, fx: 0, n: 0 };
    x.cashTwd = (x.cashTwd || 0) + c.twd;
    byCcy.set(c.ccy, x);
  });
  const ccys = [...byCcy.values()];
  const exposure = ccys.reduce((s, x) => s + x.valTwd + (x.cashTwd || 0), 0);
  const fxTot = fxPos.reduce((s, p) => s + (p.fxEff || 0), 0), pxTot = fxPos.reduce((s, p) => s + (p.priceEff || 0), 0);
  const realFx = C.realized.filter(r => r.ccy !== 'TWD').reduce((s, r) => s + r.fxPart, 0);
  $('#pfBody').innerHTML = !fxPos.length && !ccys.length ? '<div class="panel-msg">目前沒有外幣資產。持有美股、日股等或外幣現金時，這裡會拆解匯率對損益的影響。</div>' : `
    <div class="kpis pf-kpis">
      ${pfKpi('外幣資產（台幣）', twd(exposure), C.tot.assets ? `占總資產 ${numTxt(exposure / C.tot.assets * 100, 1)}%` : '')}
      ${pfKpi('未實現：股價貢獻', twdS(pxTot), '以買進時匯率計算的漲跌', dirCls(pxTot))}
      ${pfKpi('未實現：匯率貢獻', twdS(fxTot), '外幣升貶造成的台幣損益', dirCls(fxTot))}
      ${pfKpi('已實現匯差', twdS(realFx), '賣出部位的匯率影響', dirCls(realFx))}
      ${pfKpi('台幣升值 1% 的影響', twdS(-exposure * 0.01), '外幣資產換回台幣變少', 'down')}
    </div>
    <div class="pf-grid">
      <section class="panel" style="--span:12"><div class="panel-head"><h2 class="panel-title">依幣別</h2></div><div class="panel-body"><div class="tbl-wrap"><table class="mtbl pf-tbl">
        <thead><tr><th>幣別</th><th class="num">持股市值(原幣)</th><th class="num">外幣現金(台幣)</th><th class="num">平均買進匯率</th><th class="num">目前匯率</th><th class="num">匯率變化</th><th class="num">股價貢獻</th><th class="num">匯率貢獻</th></tr></thead>
        <tbody>${ccys.map(x => {
          const avg = x.cost ? x.costTwd / x.cost : null, now = pfFxNow(x.ccy);
          return `<tr><td class="nm">${esc(x.ccy)}</td><td class="num">${x.val ? numTxt(x.val, 0) : '—'}</td><td class="num">${x.cashTwd ? twd(x.cashTwd) : '—'}</td>
            <td class="num">${isNum(avg) ? numTxt(avg, 4) : '—'}</td><td class="num strong">${numTxt(now, 4)}</td><td class="num ${dirCls(avg && now - avg)}">${avg ? pfPct((now / avg - 1) * 100) : '—'}</td>
            <td class="num ${dirCls(x.price)}">${x.n ? twdS(x.price) : '—'}</td><td class="num ${dirCls(x.fx)}">${x.n ? twdS(x.fx) : '—'}</td></tr>`;
        }).join('')}</tbody></table></div></div></section>
      <section class="panel" style="--span:12"><div class="panel-head"><h2 class="panel-title">各持股拆解</h2></div><div class="panel-body"><div class="tbl-wrap"><table class="mtbl pf-tbl">
        <thead><tr><th>標的</th><th class="num">成本(原幣)</th><th class="num">市值(原幣)</th><th class="num">原幣報酬</th><th class="num">買進匯率</th><th class="num">目前匯率</th><th class="num">股價貢獻</th><th class="num">匯率貢獻</th><th class="num">台幣損益</th><th class="num">台幣報酬</th></tr></thead>
        <tbody>${fxPos.map(p => `<tr><td class="nm">${esc(p.name)} <span class="muted">${esc(p.sym)}</span></td><td class="num">${numTxt(p.cost, 2)}</td><td class="num">${numTxt(p.value, 2)}</td>
          <td class="num ${dirCls(p.unrealPct)}">${pfPct(p.unrealPct)}</td><td class="num">${numTxt(p.avgFx, 4)}</td><td class="num">${numTxt(p.fxN, 4)}</td>
          <td class="num ${dirCls(p.priceEff)}">${twdS(p.priceEff)}</td><td class="num ${dirCls(p.fxEff)}">${twdS(p.fxEff)}</td>
          <td class="num strong ${dirCls(p.unrealTwd)}">${twdS(p.unrealTwd)}</td><td class="num ${dirCls(p.unrealTwd)}">${p.costTwd ? pfPct(p.unrealTwd / p.costTwd * 100) : '—'}</td></tr>`).join('')}</tbody></table></div>
        <div class="foot-note">股價貢獻 = (市值 − 成本) × 平均買進匯率；匯率貢獻 = 市值 × (目前匯率 − 平均買進匯率)；兩者相加 = 台幣未實現損益。
          買進匯率取交易紀錄中填寫的匯率，沒填則用當天收盤匯率（Yahoo）。</div></div></section>
    </div>`;
}

/* ---------- 績效與風險 ---------- */
function pfRenderPerf() {
  const S = pf.series || (pf.series = pfBuildSeries());
  if (!S) { $('#pfBody').innerHTML = '<div class="panel-msg">市場資料載入中，或持股期間太短（至少需要 2 個交易日）</div>'; return; }
  const st = pfStats(S);
  const bName = (PF_BENCH.find(b => b[0] === pf.meta.bench) || [0, pf.meta.bench])[1];
  const years = [...new Set(Object.keys(st.monthly).map(m => m.slice(0, 4)))].sort().reverse();
  // 相關係數（目前持股前 8 大，近 250 個交易日）
  const top = pf.calc.open.slice().sort((a, b) => (b.valTwd || 0) - (a.valTwd || 0)).slice(0, 8);
  const retsOf = p => {
    const s = pfSeriesOf(p.ysym);
    if (!s) return null;
    const m = {};
    for (let i = Math.max(1, s.t.length - 250); i < s.t.length; i++) m[s.t[i]] = s.c[i] / s.c[i - 1] - 1;
    return m;
  };
  const R = top.map(retsOf);
  const corr = (a, b) => {
    if (!a || !b) return null;
    const ks = Object.keys(a).filter(k => k in b);
    if (ks.length < 30) return null;
    const x = ks.map(k => a[k]), y = ks.map(k => b[k]);
    const mx = x.reduce((s, v) => s + v, 0) / x.length, my = y.reduce((s, v) => s + v, 0) / y.length;
    let c = 0, vx = 0, vy = 0;
    x.forEach((v, i) => { c += (v - mx) * (y[i] - my); vx += (v - mx) ** 2; vy += (y[i] - my) ** 2; });
    return vx && vy ? c / Math.sqrt(vx * vy) : null;
  };
  const corrCell = v => (isNum(v) ? `<td class="num heat" style="background:color-mix(in srgb, #1f4e8c ${Math.round(Math.max(0, v) * 70)}%, #fff);color:${v > 0.6 ? '#fff' : 'var(--text)'}">${numTxt(v, 2)}</td>` : '<td class="num muted">—</td>');
  $('#pfBody').innerHTML = `
    <div class="etf-filter"><span class="muted">比較基準</span><div class="seg seg-sm" id="pfBench">${PF_BENCH.map(([v, l]) => `<button data-v="${v}" class="${v === pf.meta.bench ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="muted">期間 ${S.dates[0]} ～ ${S.dates[S.dates.length - 1]}（${numTxt(st.years, 1)} 年）</span></div>
    <div class="kpis pf-kpis">
      ${pfKpi('累計報酬（時間加權）', pfPct(st.twr), `${bName} ${pfPct(st.bTwr)}`, dirCls(st.twr))}
      ${pfKpi('年化報酬', isNum(st.cagr) ? pfPct(st.cagr) : '—', st.years < 0.5 ? '期間不足半年' : '', dirCls(st.cagr))}
      ${pfKpi('資金加權（XIRR）', pfPct(pf.calc.tot.xirr), '考慮投入時點與金額', dirCls(pf.calc.tot.xirr))}
      ${pfKpi('年化波動度', numTxt(st.vol, 1) + '%')}
      ${pfKpi('最大回撤', numTxt(st.mdd, 1) + '%', st.mddAt || '', 'down')}
      ${pfKpi(`β（對 ${esc(bName)}）`, isNum(st.beta) ? numTxt(st.beta, 2) : '—', isNum(st.corr) ? '相關係數 ' + numTxt(st.corr, 2) : '近 1 年日報酬')}
      ${pfKpi('夏普值（約）', isNum(st.sharpe) ? numTxt(st.sharpe, 2) : '—', '(年化報酬 − 1.5%) ÷ 波動度')}
    </div>
    <div class="pf-grid">
      <section class="panel" style="--span:12"><div class="panel-head"><h2 class="panel-title">累計報酬 vs ${esc(bName)}</h2></div><div class="panel-body">
        <div class="chart-legend"><span style="--c:#1f4e8c">投資組合（時間加權，含息）</span>${S.bench ? `<span style="--c:#a3abb8">${esc(bName)}（價格）</span>` : ''}</div>
        <div class="mini-chart tall" id="pfPerfChart"></div></div></section>
      <section class="panel" style="--span:12"><div class="panel-head"><h2 class="panel-title">回撤</h2></div><div class="panel-body"><div class="mini-chart short" id="pfDdChart"></div></div></section>
      <section class="panel" style="--span:7"><div class="panel-head"><h2 class="panel-title">月報酬（%）</h2></div><div class="panel-body"><div class="tbl-wrap"><table class="mtbl pf-mtbl">
        <thead><tr><th>年</th>${Array.from({ length: 12 }, (_, i) => `<th class="num">${i + 1}</th>`).join('')}<th class="num">全年</th></tr></thead>
        <tbody>${years.map(y => {
          let yr = 1;
          const cells = Array.from({ length: 12 }, (_, i) => {
            const v = st.monthly[`${y}-${String(i + 1).padStart(2, '0')}`];
            if (isNum(v)) yr *= 1 + v / 100;
            return isNum(v) ? `<td class="num heat" style="${heatStyle(v, 8)}">${numTxt(v, 1)}</td>` : '<td></td>';
          }).join('');
          return `<tr><td class="nm">${y}</td>${cells}<td class="num strong ${dirCls(yr - 1)}">${numTxt((yr - 1) * 100, 1)}</td></tr>`;
        }).join('')}</tbody></table></div></div></section>
      <section class="panel" style="--span:5"><div class="panel-head"><h2 class="panel-title">持股相關係數</h2><span class="muted">近 1 年日報酬</span></div><div class="panel-body">
        ${top.length >= 2 ? `<div class="tbl-wrap"><table class="mtbl pf-mtbl"><thead><tr><th></th>${top.map(p => `<th class="num" title="${esc(p.name)}">${esc(p.sym)}</th>`).join('')}</tr></thead>
          <tbody>${top.map((p, i) => `<tr><td class="nm" title="${esc(p.name)}">${esc(p.sym)}</td>${top.map((q, j) => (i === j ? '<td class="num muted">1</td>' : corrCell(corr(R[i], R[j])))).join('')}</tr>`).join('')}</tbody></table></div>
          <div class="foot-note">越接近 1 代表走勢越同步、分散效果越小；低於 0.3 較能互相分散風險。不同市場的交易日只比較共同日期。</div>` : '<div class="panel-msg">至少需要 2 檔持股</div>'}</div></section>
    </div>
    <div class="foot-note">時間加權報酬（TWR）排除資金進出的影響，適合和大盤比較；資金加權（XIRR）反映你實際投入時點的報酬。股利以除息日計入；比較基準為價格指數（不含息），長期比較會略為低估基準。</div>`;
  $$('#pfBench button').forEach(b => b.addEventListener('click', async () => {
    pf.meta.bench = b.dataset.v;
    pfSaveMeta();
    if (!pfSeriesOf(pf.meta.bench)) await pfRefreshAll(true);
    pf.series = pfBuildSeries();
    pfRenderPerf();
  }));
  const LWC = window.LightweightCharts;
  const pfm = { type: 'custom', formatter: v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%' };
  const ch = pfChart($('#pfPerfChart'));
  if (ch) {
    ch.addSeries(LWC.LineSeries, { color: '#1f4e8c', lineWidth: 2, priceFormat: pfm, priceLineVisible: false }).setData(S.dates.map((d, i) => ({ time: d, value: (S.idx[i] - 1) * 100 })));
    if (S.bench) ch.addSeries(LWC.LineSeries, { color: '#a3abb8', lineWidth: 2, priceFormat: pfm, priceLineVisible: false }).setData(S.dates.map((d, i) => ({ time: d, value: (S.bench[i] - 1) * 100 })));
    ch.timeScale().fitContent();
  }
  const dc = pfChart($('#pfDdChart'));
  if (dc) {
    dc.addSeries(LWC.AreaSeries, { lineColor: '#c0392b', topColor: 'rgba(192,57,43,.05)', bottomColor: 'rgba(192,57,43,.3)', lineWidth: 1, priceFormat: pfm, priceLineVisible: false, invertFilledArea: true })
      .setData(S.dates.map((d, i) => ({ time: d, value: st.dd[i] })));
    dc.timeScale().fitContent();
  }
}

/* ---------- 交易紀錄 ---------- */
function pfFeeCalc(f) {
  const cat = f.cat.value, type = f.type.value, qty = +f.qty.value, price = +f.price.value, disc = +pf.meta.feeDisc || 1;
  if (cat !== 'tw' || !(qty > 0) || !(price > 0) || (type !== 'buy' && type !== 'sell')) return;
  const amt = qty * price;
  const fee = Math.max(qty < 1000 ? 1 : 20, Math.floor(amt * 0.001425 * disc));
  const code = f.sym.value.trim().toUpperCase();
  const taxRate = /^00\d*B$/.test(code) ? 0 : /^00/.test(code) ? 0.001 : 0.003;
  if (!f.fee.dataset.manual) f.fee.value = fee;
  if (!f.tax.dataset.manual) f.tax.value = type === 'sell' ? Math.floor(amt * taxRate) : 0;
}

function pfRenderTxns() {
  const M = pf.meta;
  const e = pf.editId ? pf.txns.find(t => t.id === pf.editId) : null;
  const q = pf.txFilter.toUpperCase();
  const list = pf.txns.filter(t => !q || t.sym.toUpperCase().includes(q) || (t.name || '').toUpperCase().includes(q) || (t.note || '').toUpperCase().includes(q))
    .slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const splits = (pf.calc && pf.calc.autoSplits) || [];
  const cash = M.cash || {};
  $('#pfBody').innerHTML = `
    <div class="pf-grid">
      <section class="panel" style="--span:5"><div class="panel-head"><h2 class="panel-title">${e ? '編輯交易' : '新增交易'}</h2></div><div class="panel-body">
        <form id="pfForm" class="pf-form" autocomplete="off">
          <label>日期<input type="date" name="date" required value="${esc(e ? e.date : pfToday())}"></label>
          <label>類型<select name="type">${Object.entries(PF_TYPE_ZH).map(([k, l]) => `<option value="${k}" ${e && e.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>市場<select name="cat"><option value="tw" ${!e || e.cat === 'tw' ? 'selected' : ''}>台股（上市櫃、興櫃）</option><option value="global" ${e && e.cat === 'global' ? 'selected' : ''}>國外（美股、日股…）</option></select></label>
          <label>代號<input name="sym" required placeholder="2330、0050、NVDA、7011 JP" value="${esc(e ? e.sym : '')}"></label>
          <label class="pf-f-qty">股數<input type="number" name="qty" step="any" min="0" placeholder="台股以「股」計，1 張 = 1000" value="${e && isNum(e.qty) ? e.qty : ''}"></label>
          <label class="pf-f-price">成交價<input type="number" name="price" step="any" min="0" value="${e && isNum(e.price) ? e.price : ''}"></label>
          <label class="pf-f-amt">股利總額（原幣）<input type="number" name="amount" step="any" min="0" value="${e && isNum(e.amount) ? e.amount : ''}"></label>
          <label class="pf-f-fee">手續費<input type="number" name="fee" step="any" min="0" value="${e ? e.fee || 0 : ''}"></label>
          <label class="pf-f-tax">交易稅／扣繳稅<input type="number" name="tax" step="any" min="0" value="${e ? e.tax || 0 : ''}"></label>
          <label class="pf-f-fx">匯率（1 外幣 = ? 台幣）<input type="number" name="fx" step="any" min="0" placeholder="空白 = 用當天收盤匯率" value="${e && isNum(e.fx) ? e.fx : ''}"></label>
          <label>帳戶<input name="acct" placeholder="選填，例如 永豐、複委託" value="${esc(e ? e.acct || '' : '')}"></label>
          <label class="pf-f-wide">備註<input name="note" value="${esc(e ? e.note || '' : '')}"></label>
          <div class="pf-f-wide pf-f-btns"><button class="btn btn-primary" type="submit">${e ? '儲存修改' : '新增'}</button>
            ${e ? '<button class="btn btn-ghost" type="button" id="pfCancel">取消</button><button class="btn btn-ghost pf-del" type="button" id="pfDelOne">刪除這筆</button>' : ''}
            <span class="muted" id="pfFormMsg"></span></div>
        </form>
        <div class="foot-note">台股手續費依 0.1425% × 折扣（最低 20 元，零股 1 元）、交易稅 0.3%（ETF 0.1%、債券 ETF 免）自動帶入，可直接修改。
          「配股／分割」只增加股數不增加成本；Yahoo 有紀錄的分割會自動套用，不用手動輸入。</div></div></section>
      <section class="panel" style="--span:7"><div class="panel-head"><h2 class="panel-title">設定</h2></div><div class="panel-body">
        <div class="pf-set">
          <label>成本計算<select id="pfMethod"><option value="avg" ${M.method !== 'fifo' ? 'selected' : ''}>平均成本法</option><option value="fifo" ${M.method === 'fifo' ? 'selected' : ''}>先進先出（FIFO）</option></select></label>
          <label>台股手續費折扣<input type="number" id="pfDisc" step="0.05" min="0.1" max="1" value="${esc(M.feeDisc)}" title="0.6 = 6 折"></label>
          <label>美股股利預扣稅 %<input type="number" id="pfUsTax" step="1" min="0" max="50" value="${esc(M.usTax)}"></label>
          <label class="chk"><input type="checkbox" id="pfAutoDiv" ${M.autoDiv ? 'checked' : ''}> 自動計算股利（Yahoo 除息紀錄）</label>
          <label class="chk"><input type="checkbox" id="pfNhi" ${M.nhi ? 'checked' : ''}> 台股單筆股利 ≥ 2 萬扣二代健保 2.11%</label>
          <label class="chk"><input type="checkbox" id="pfAutoSplit" ${M.autoSplit ? 'checked' : ''}> 自動套用股票分割</label>
        </div>
        <div class="sub-h">現金部位（計入總資產與配置）</div>
        <div class="pf-cash-set" id="pfCashSet">${Object.entries(cash).concat([['', '']]).map(([c, v]) => `<div class="pf-cash-row">
          <input class="pf-ccy" maxlength="3" placeholder="幣別 TWD" value="${esc(c)}"><input class="pf-amt" type="number" step="any" placeholder="金額" value="${esc(v)}"></div>`).join('')}</div>
        <button class="btn btn-ghost btn-sm" id="pfCashSave">儲存現金</button>
        <div class="sub-h">匯入／匯出</div>
        <div class="pf-io"><button class="btn btn-ghost btn-sm" id="pfExport">⬇ 匯出 CSV</button>
          <label class="btn btn-ghost btn-sm">⬆ 匯入 CSV<input type="file" id="pfImport" accept=".csv,text/csv" hidden></label>
          <label class="chk"><input type="checkbox" id="pfReplace"> 匯入時取代全部紀錄</label></div>
        <div class="foot-note">CSV 欄位：日期, 類型(買進/賣出/現金股利/配股), 市場(台股/國外), 代號, 股數, 價格, 股利總額, 手續費, 稅, 匯率, 帳戶, 備註。可先匯出一份當範本。</div>
        ${splits.length ? `<div class="sub-h">自動套用的分割</div><div class="muted">${splits.map(s => `${s.date} ${esc(s.name)} 1→${numTxt(s.ratio, s.ratio % 1 ? 3 : 0)}`).join('、')}</div>` : ''}
      </div></section>
      <section class="panel" style="--span:12"><div class="panel-head"><h2 class="panel-title">交易紀錄</h2><span class="muted">${pf.txns.length} 筆</span>
        <div class="panel-tools"><input id="pfTxQ" class="pf-q" placeholder="搜尋代號、名稱、備註" value="${esc(pf.txFilter)}"></div></div>
        <div class="panel-body"><div class="tbl-wrap pf-scroll"><table class="mtbl pf-tbl">
          <thead><tr><th>日期</th><th>類型</th><th>標的</th><th class="num">股數</th><th class="num">價格</th><th class="num">金額(原幣)</th><th class="num">手續費</th><th class="num">稅</th><th class="num">匯率</th><th>帳戶</th><th>備註</th><th></th></tr></thead>
          <tbody>${list.length ? list.map(t => {
            const amt = t.type === 'div' ? t.amount : t.type === 'stock' ? null : t.qty * t.price;
            return `<tr class="${t.id === pf.editId ? 'sel' : ''}"><td>${t.date}</td><td><span class="tag ${t.type === 'buy' ? 'bad' : t.type === 'sell' ? 'ok' : ''}">${PF_TYPE_ZH[t.type]}</span></td>
              <td class="nm">${esc(t.name)} <span class="muted">${esc(t.sym)}</span></td><td class="num">${isNum(t.qty) ? numTxt(t.qty, t.qty % 1 ? 2 : 0) : '—'}</td>
              <td class="num">${isNum(t.price) ? numTxt(t.price, 2) : '—'}</td><td class="num">${isNum(amt) ? numTxt(amt, t.ccy === 'TWD' ? 0 : 2) + (t.ccy !== 'TWD' ? ' ' + esc(t.ccy) : '') : '—'}</td>
              <td class="num">${t.fee ? numTxt(t.fee, t.ccy === 'TWD' ? 0 : 2) : '—'}</td><td class="num">${t.tax ? numTxt(t.tax, t.ccy === 'TWD' ? 0 : 2) : '—'}</td>
              <td class="num">${t.ccy === 'TWD' ? '—' : isNum(t.fx) ? numTxt(t.fx, 4) : '<span class="muted">自動</span>'}</td><td>${esc(t.acct || '')}</td><td class="muted">${esc(t.note || '')}</td>
              <td><button class="icon-btn" data-edit="${esc(t.id)}" title="編輯">✎</button></td></tr>`;
          }).join('') : '<tr><td colspan="12" class="muted">尚無交易紀錄</td></tr>'}</tbody></table></div></div></section>
    </div>`;
  const f = $('#pfForm');
  const syncForm = () => {
    const ty = f.type.value;
    f.classList.toggle('is-div', ty === 'div');
    f.classList.toggle('is-stock', ty === 'stock');
    f.classList.toggle('is-tw', f.cat.value === 'tw');
    pfFeeCalc(f);
  };
  ['fee', 'tax'].forEach(n => f[n].addEventListener('input', () => { f[n].dataset.manual = '1'; }));
  if (e) { f.fee.dataset.manual = '1'; f.tax.dataset.manual = '1'; }
  ['type', 'cat', 'qty', 'price', 'sym'].forEach(n => f[n].addEventListener(n === 'type' || n === 'cat' ? 'change' : 'input', syncForm));
  syncForm();
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = f.querySelector('[type=submit]');
    const txn = Object.fromEntries(['date', 'type', 'cat', 'sym', 'qty', 'price', 'amount', 'fee', 'tax', 'fx', 'acct', 'note'].map(k => [k, f[k].value.trim()]));
    if (txn.type === 'div' && !txn.qty) delete txn.qty;
    if (e) { txn.id = e.id; if (e.sym === txn.sym.toUpperCase() && e.cat === txn.cat) Object.assign(txn, { source: e.source, ccy: e.ccy, name: e.name, itype: e.itype }); }
    btn.disabled = true;
    $('#pfFormMsg').textContent = '儲存中…（新代號需查詢約 2–5 秒）';
    try {
      const r = (await apiRetry('portfolio', { op: 'save', txn })).data;
      const i = pf.txns.findIndex(x => x.id === r.txn.id);
      if (i >= 0) pf.txns[i] = r.txn; else pf.txns.push(r.txn);
      pf.editId = null;
      toast((e ? '已更新：' : '已新增：') + r.txn.name);
      pfRecalc();
      pfRenderTxns();
      pfRefreshAll(false);
    } catch (err) {
      $('#pfFormMsg').textContent = '儲存失敗：' + err.message;
      btn.disabled = false;
    }
  });
  if (e) {
    $('#pfCancel').addEventListener('click', () => { pf.editId = null; pfRenderTxns(); });
    $('#pfDelOne').addEventListener('click', async () => {
      if (!confirm(`確定刪除這筆交易？\n${e.date} ${PF_TYPE_ZH[e.type]} ${e.name}`)) return;
      try {
        const r = (await api('portfolio', { op: 'delete', ids: [e.id] })).data;
        pf.txns = r.txns; pf.editId = null;
        pfRecalc(); pfRenderTxns();
      } catch (err) { toast('刪除失敗：' + err.message); }
    });
  }
  $$('#pfBody [data-edit]').forEach(b => b.addEventListener('click', () => { pf.editId = b.dataset.edit; pfRenderTxns(); window.scrollTo({ top: $('#pfForm').getBoundingClientRect().top + scrollY - 120, behavior: 'smooth' }); }));
  const qi = $('#pfTxQ');
  qi.addEventListener('input', () => { pf.txFilter = qi.value.trim(); clearTimeout(qi._t); qi._t = setTimeout(() => { pfRenderTxns(); const n = $('#pfTxQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
  // 設定
  const setMeta = (k, v) => { pf.meta[k] = v; pfSaveMeta(); pfRecalc(); };
  $('#pfMethod').addEventListener('change', ev => setMeta('method', ev.target.value));
  $('#pfDisc').addEventListener('change', ev => setMeta('feeDisc', Math.min(1, Math.max(0.1, +ev.target.value || 1))));
  $('#pfUsTax').addEventListener('change', ev => setMeta('usTax', Math.min(50, Math.max(0, +ev.target.value || 0))));
  $('#pfAutoDiv').addEventListener('change', ev => setMeta('autoDiv', ev.target.checked));
  $('#pfNhi').addEventListener('change', ev => setMeta('nhi', ev.target.checked));
  $('#pfAutoSplit').addEventListener('change', ev => setMeta('autoSplit', ev.target.checked));
  $('#pfCashSave').addEventListener('click', () => {
    const c = {};
    $$('#pfCashSet .pf-cash-row').forEach(r => {
      const ccy = $('.pf-ccy', r).value.trim().toUpperCase(), amt = parseFloat($('.pf-amt', r).value);
      if (/^[A-Z]{3}$/.test(ccy) && isFinite(amt) && amt !== 0) c[ccy] = amt;
    });
    pf.meta.cash = c;
    pfSaveMeta();
    toast('現金部位已儲存');
    pfRefreshAll(false);
  });
  $('#pfExport').addEventListener('click', pfExportCsv);
  $('#pfImport').addEventListener('change', ev => { const file = ev.target.files[0]; if (file) pfImportCsv(file, $('#pfReplace').checked); ev.target.value = ''; });
}

/* ---------- CSV ---------- */
const PF_CSV_HEAD = ['日期', '類型', '市場', '代號', '股數', '價格', '股利總額', '手續費', '稅', '匯率', '帳戶', '備註'];

function pfExportCsv() {
  const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = pf.txns.map(t => [t.date, PF_TYPE_ZH[t.type], t.cat === 'tw' ? '台股' : '國外', t.sym, t.qty, t.price, t.amount, t.fee, t.tax, t.fx, t.acct, t.note]);
  const csv = '﻿' + [PF_CSV_HEAD].concat(rows).map(r => r.map(q).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `portfolio_${pfToday()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function pfParseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

async function pfImportCsv(file, replace) {
  const rows = pfParseCsv(await file.text());
  if (rows.length < 2) return toast('CSV 沒有資料');
  const typeMap = { 買進: 'buy', 買: 'buy', buy: 'buy', 賣出: 'sell', 賣: 'sell', sell: 'sell', 現金股利: 'div', 股利: 'div', div: 'div', 配股: 'stock', '配股／分割': 'stock', 分割: 'stock', stock: 'stock' };
  const txns = rows.slice(1).map(r => {
    const g = i => (r[i] || '').trim();
    const d = g(0).replace(/\//g, '-').replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (_, y, m, dd) => `${y}-${m.padStart(2, '0')}-${dd.padStart(2, '0')}`);
    return { date: d, type: typeMap[g(1)] || typeMap[g(1).toLowerCase()] || g(1), cat: /台|tw/i.test(g(2)) ? 'tw' : 'global', sym: g(3),
      qty: g(4), price: g(5), amount: g(6), fee: g(7), tax: g(8), fx: g(9), acct: g(10), note: g(11) };
  });
  if (replace && !confirm(`確定用 CSV 的 ${txns.length} 筆取代目前全部 ${pf.txns.length} 筆交易紀錄？`)) return;
  pfStatus(`匯入 ${txns.length} 筆中…（新代號需逐一查詢）`);
  try {
    const r = (await api('portfolio', { op: 'import', txns, replace })).data;
    pf.txns = r.txns;
    pfRecalc();
    pfRenderTxns();
    toast(`已匯入 ${r.imported} 筆${r.errors.length ? `，${r.errors.length} 筆失敗` : ''}`);
    if (r.errors.length) alert('以下資料未匯入：\n' + r.errors.join('\n'));
    pfRefreshAll(false);
  } catch (err) {
    pfStatus('匯入失敗：' + err.message, 'err');
  }
}

initPortfolio();
