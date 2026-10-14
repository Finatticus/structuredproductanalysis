/* =========================================================
 * 回測與策略 — 前端（回測全部在瀏覽器計算，只有載入價格時呼叫後端一次）
 * 依賴 app.js（$, $$, api, esc, store, toast, sma, ema, macd, kd）、research.js（rsi）
 *      macro.js（isNum, pctTxt, signTxt, numTxt, dirCls, seg, cssVar）
 * ========================================================= */
const bt = { bars: null, results: null, sel: 0, charts: [], cfg: null };
const BT_COLORS = ['#7f8c8d', '#1f4e8c', '#e67e22', '#16a085', '#8e44ad', '#c0392b', '#2c6bc4', '#d4a017', '#6d4bc4'];

/** 策略定義：params = [鍵, 標籤, 預設值] */
const BT_STRATS = {
  maCross: { label: '均線交叉', params: [['fast', '短均線（日）', 20], ['slow', '長均線（日）', 60]], desc: '短均線向上穿越長均線買進，向下穿越賣出（黃金／死亡交叉）。', scan: true },
  maTrend: { label: '站上均線', params: [['n', '均線（日）', 60]], desc: '收盤站上均線買進，跌破均線賣出（趨勢追蹤）。' },
  kd: { label: 'KD 交叉', params: [['buyBelow', '買進需 K 低於（0＝不限）', 30], ['sellAbove', '賣出需 K 高於（0＝不限）', 0]], desc: 'K 向上穿越 D 買進、向下穿越 D 賣出；可限制只在低檔買進。' },
  macd: { label: 'MACD 柱翻正', params: [], desc: 'MACD 柱狀體由負翻正買進，由正翻負賣出。' },
  rsi: { label: 'RSI 超賣反彈', params: [['n', 'RSI 天數', 14], ['low', '買進：向上突破', 30], ['high', '賣出：高於', 70]], desc: 'RSI 從超賣區向上突破買進，進入超買區賣出（逆勢）。' },
  breakout: { label: '突破新高', params: [['n', '買進：突破 N 日高點', 20], ['m', '賣出：跌破 M 日低點', 10]], desc: '收盤突破前 N 日最高價買進，跌破前 M 日最低價賣出（海龜通道）。', scan: true },
  boll: { label: '布林通道回歸', params: [['n', '天數', 20], ['k', '標準差倍數', 2]], desc: '收盤跌破下軌買進，回到中軌賣出（均值回歸）。' },
  dca: { label: '定期定額', params: [['amount', '每月投入金額', 10000], ['day', '每月扣款日', 6]], desc: '每月固定日期（遇假日順延）投入固定金額，不賣出。', noRisk: true },
};

const BT_DEFAULT = {
  symbol: '0050', start: '', end: '', capital: 1000000, feeDisc: 0.6, slip: 0.1, fill: 'open', adj: true, lot: false, rf: 1.5,
  strats: [{ type: 'maCross', p: { fast: 20, slow: 60 }, sl: 0, tp: 0, trail: 0 }, { type: 'breakout', p: { n: 20, m: 10 }, sl: 0, tp: 0, trail: 0 },
    { type: 'kd', p: { buyBelow: 30, sellAbove: 0 }, sl: 8, tp: 0, trail: 0 }, { type: 'dca', p: { amount: 10000, day: 6 } }],
};

function initBacktest() {
  try { bt.cfg = Object.assign({}, BT_DEFAULT, JSON.parse(store.get('mw_bt') || '{}')); } catch { bt.cfg = Object.assign({}, BT_DEFAULT); }
  btRenderForm();
  $('#btLoad').addEventListener('click', () => btLoadBars());
  $('#btRun').addEventListener('click', btRunAll);
  $('#btAdd').addEventListener('change', e => {
    if (!e.target.value) return;
    const type = e.target.value;
    bt.cfg.strats.push({ type, p: Object.fromEntries(BT_STRATS[type].params.map(([k, , v]) => [k, v])), sl: 0, tp: 0, trail: 0 });
    e.target.value = '';
    btRenderStrats();
  });
  $('#btPreset').addEventListener('click', () => { bt.cfg.strats = JSON.parse(JSON.stringify(BT_DEFAULT.strats)); btRenderStrats(); });
  $('#btSymbol').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); btLoadBars(); } });
}

/* ---------- 設定表單 ---------- */
function btRenderForm() {
  const c = bt.cfg;
  $('#btSymbol').value = c.symbol;
  $('#btCapital').value = c.capital;
  $('#btFeeDisc').value = c.feeDisc;
  $('#btSlip').value = c.slip;
  $('#btFill').value = c.fill;
  $('#btAdj').checked = c.adj;
  $('#btLot').checked = c.lot;
  $('#btRf').value = c.rf;
  $('#btAdd').innerHTML = '<option value="">＋ 新增策略…</option>' + Object.entries(BT_STRATS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('');
  btRenderStrats();
}

function btRenderStrats() {
  $('#btStrats').innerHTML = bt.cfg.strats.map((s, i) => {
    const def = BT_STRATS[s.type];
    return `<div class="bt-strat" style="--c:${BT_COLORS[(i + 1) % BT_COLORS.length]}">
      <div class="bt-strat-h"><b>${i + 1}. ${def.label}</b>
        ${def.scan ? `<button class="btn btn-ghost btn-sm" data-scan="${i}" title="掃描不同參數組合的績效">參數掃描</button>` : ''}
        <button class="icon-btn" data-del="${i}" title="移除">×</button></div>
      <div class="muted bt-desc">${def.desc}</div>
      <div class="bt-params">
        ${def.params.map(([k, l]) => `<label>${l}<input type="number" step="any" data-i="${i}" data-k="${k}" value="${s.p[k]}"></label>`).join('')}
        ${def.noRisk ? '' : `
          <label>停損 %（0＝不用）<input type="number" step="any" data-i="${i}" data-r="sl" value="${s.sl || 0}"></label>
          <label>停利 %<input type="number" step="any" data-i="${i}" data-r="tp" value="${s.tp || 0}"></label>
          <label>移動停損 %<input type="number" step="any" data-i="${i}" data-r="trail" value="${s.trail || 0}"></label>`}
      </div></div>`;
  }).join('') || '<div class="muted">尚未加入策略（買進持有會自動作為比較基準）</div>';
  $$('#btStrats input').forEach(inp => inp.addEventListener('change', () => {
    const s = bt.cfg.strats[+inp.dataset.i];
    if (inp.dataset.k) s.p[inp.dataset.k] = +inp.value; else s[inp.dataset.r] = +inp.value;
  }));
  $$('#btStrats [data-del]').forEach(b => b.addEventListener('click', () => { bt.cfg.strats.splice(+b.dataset.del, 1); btRenderStrats(); }));
  $$('#btStrats [data-scan]').forEach(b => b.addEventListener('click', () => btScan(+b.dataset.scan)));
}

function btReadForm() {
  const c = bt.cfg;
  c.symbol = $('#btSymbol').value.trim().toUpperCase();
  c.start = $('#btStart').value;
  c.end = $('#btEnd').value;
  c.capital = +$('#btCapital').value || 1000000;
  c.feeDisc = +$('#btFeeDisc').value;
  c.slip = +$('#btSlip').value || 0;
  c.fill = $('#btFill').value;
  c.adj = $('#btAdj').checked;
  c.lot = $('#btLot').checked;
  c.rf = +$('#btRf').value || 0;
  store.set('mw_bt', JSON.stringify(c));
}

/* ---------- 載入價格 ---------- */
async function btLoadBars() {
  btReadForm();
  if (!bt.cfg.symbol) return;
  btStatus('載入 ' + bt.cfg.symbol + ' 歷史價格…');
  try {
    const b = (await api('bars', { symbol: bt.cfg.symbol, years: 10 })).data;
    bt.bars = b;
    const t = b.t;
    $('#btStart').min = t[0]; $('#btStart').max = t[t.length - 1];
    $('#btEnd').min = t[0]; $('#btEnd').max = t[t.length - 1];
    if (!$('#btStart').value || $('#btStart').value < t[0]) {
      const d = new Date(t[t.length - 1]); d.setFullYear(d.getFullYear() - 5);
      $('#btStart').value = d.toISOString().slice(0, 10) < t[0] ? t[0] : d.toISOString().slice(0, 10);
    }
    if (!$('#btEnd').value || $('#btEnd').value > t[t.length - 1]) $('#btEnd').value = t[t.length - 1];
    const tw = b.cat === 'tw';
    $('#btTaxNote').textContent = tw ? `交易稅 ${b.etf ? '0.1%（ETF）' : '0.3%（股票）'}，賣出時課徵；手續費 0.1425% × 折扣` : '美股／海外：手續費與交易稅以 0 計（可用滑價模擬成本）';
    $('#btLot').disabled = !tw;
    $('#btInfo').innerHTML = `<b>${esc(b.name)}</b> <span class="muted">${esc(b.code)} · ${t[0]} ～ ${t[t.length - 1]} · ${t.length} 個交易日 · 配息 ${b.divs.length} 次</span>`;
    btStatus('已載入，可執行回測', 'live');
    btRunAll();
  } catch (err) {
    btStatus('載入失敗：' + err.message, 'err');
  }
}

function btStatus(text, cls = '') {
  const el = $('#btStatus');
  el.className = 'status ' + cls;
  el.innerHTML = '<span class="dot"></span>' + esc(text);
}

/* =========================================================
 * 回測引擎
 * ========================================================= */
/** 依設定準備價格（含息時以還原權息比例調整開高低收） */
function btData() {
  const b = bt.bars, c = bt.cfg;
  const i0 = Math.max(0, b.t.findIndex(t => t >= (c.start || b.t[0])));
  let i1 = b.t.length - 1;
  while (i1 > 0 && c.end && b.t[i1] > c.end) i1--;
  const f = i => (c.adj && b.c[i] ? b.a[i] / b.c[i] : 1);
  const D = { t: b.t, o: [], h: [], l: [], c: [], i0, i1 };
  for (let i = 0; i < b.t.length; i++) {
    const k = f(i);
    D.o.push(b.o[i] * k); D.h.push(b.h[i] * k); D.l.push(b.l[i] * k); D.c.push(b.c[i] * k);
  }
  const tw = b.cat === 'tw';
  D.fee = tw ? 0.001425 * (isNum(c.feeDisc) ? c.feeDisc : 1) : 0;
  D.tax = tw ? (b.etf ? 0.001 : 0.003) : 0;
  D.slip = (c.slip || 0) / 100;
  D.lot = tw && c.lot ? 1000 : 0;
  return D;
}

/** 各策略的進出場訊號（以第 i 日收盤判斷） */
function btSignals(D, s) {
  const n = D.c.length, c = D.c, p = s.p || {};
  const entry = new Array(n).fill(false), exit = new Array(n).fill(false);
  const cross = (a, b, i) => isNum(a[i]) && isNum(b[i]) && isNum(a[i - 1]) && isNum(b[i - 1]) && a[i] > b[i] && a[i - 1] <= b[i - 1];
  if (s.type === 'maCross') {
    const f = sma(c, Math.max(1, p.fast | 0)), sl = sma(c, Math.max(2, p.slow | 0));
    for (let i = 1; i < n; i++) { entry[i] = cross(f, sl, i); exit[i] = cross(sl, f, i); }
  } else if (s.type === 'maTrend') {
    const m = sma(c, Math.max(2, p.n | 0));
    for (let i = 1; i < n; i++) { entry[i] = cross(c, m, i); exit[i] = cross(m, c, i); }
  } else if (s.type === 'kd') {
    const K = kd(c.map((x, i) => ({ high: D.h[i], low: D.l[i], close: x })));
    for (let i = 1; i < n; i++) {
      entry[i] = cross(K.K, K.D, i) && (!p.buyBelow || K.K[i] < p.buyBelow);
      exit[i] = cross(K.D, K.K, i) && (!p.sellAbove || K.K[i] > p.sellAbove);
    }
  } else if (s.type === 'macd') {
    const M = macd(c);
    for (let i = 1; i < n; i++) {
      entry[i] = isNum(M.OSC[i]) && isNum(M.OSC[i - 1]) && M.OSC[i] > 0 && M.OSC[i - 1] <= 0;
      exit[i] = isNum(M.OSC[i]) && isNum(M.OSC[i - 1]) && M.OSC[i] < 0 && M.OSC[i - 1] >= 0;
    }
  } else if (s.type === 'rsi') {
    const R = rsi(c, Math.max(2, p.n | 0));
    for (let i = 1; i < n; i++) { entry[i] = isNum(R[i - 1]) && R[i - 1] < p.low && R[i] >= p.low; exit[i] = isNum(R[i]) && R[i] >= p.high; }
  } else if (s.type === 'breakout') {
    const N = Math.max(2, p.n | 0), M = Math.max(2, p.m | 0);
    for (let i = Math.max(N, M); i < n; i++) {
      let hh = -Infinity, ll = Infinity;
      for (let j = i - N; j < i; j++) hh = Math.max(hh, D.h[j]);
      for (let j = i - M; j < i; j++) ll = Math.min(ll, D.l[j]);
      entry[i] = c[i] > hh; exit[i] = c[i] < ll;
    }
  } else if (s.type === 'boll') {
    const N = Math.max(2, p.n | 0), mid = sma(c, N);
    for (let i = N - 1; i < n; i++) {
      let v = 0;
      for (let j = i - N + 1; j <= i; j++) v += (c[j] - mid[i]) ** 2;
      const sd = Math.sqrt(v / N);
      entry[i] = c[i] < mid[i] - p.k * sd; exit[i] = c[i] > mid[i];
    }
  }
  return { entry, exit };
}

/** 執行單一策略：回傳每日資產、交易明細 */
function btSim(D, s) {
  const { i0, i1 } = D;
  const cap = bt.cfg.capital;
  if (s.type === 'dca') return btSimDca(D, s);
  const sig = s.type === 'hold' ? null : btSignals(D, s);
  let cash = cap, sh = 0, basis = 0, entryPx = 0, entryI = 0, peak = 0, pending = null;
  const val = [], flows = [], trades = [], marks = [];
  const buy = (px, i, why) => {
    px *= 1 + D.slip;
    let q = cash / (px * (1 + D.fee));
    if (D.lot) q = Math.floor(q / D.lot) * D.lot;
    if (q <= 0) return;
    const cost = q * px * (1 + D.fee);
    cash -= cost; sh = q; basis = cost; entryPx = px; entryI = i; peak = px;
    marks.push({ time: D.t[i], position: 'belowBar', color: '#1f4e8c', shape: 'arrowUp', text: '買' });
  };
  const sell = (px, i, why) => {
    px *= 1 - D.slip;
    const proceeds = sh * px * (1 - D.fee - D.tax);
    trades.push({ in: D.t[entryI], inPx: entryPx, out: D.t[i], outPx: px, ret: proceeds / basis - 1, pnl: proceeds - basis, days: Math.round((Date.parse(D.t[i]) - Date.parse(D.t[entryI])) / 86400000), why });
    cash += proceeds; sh = 0;
    marks.push({ time: D.t[i], position: 'aboveBar', color: why === '訊號' ? '#e67e22' : '#c0392b', shape: 'arrowDown', text: why === '訊號' ? '賣' : why });
  };
  if (s.type === 'hold') pending = 'buy';
  for (let i = i0; i <= i1; i++) {
    // 1) 前一日收盤的訊號，今日開盤執行
    if (pending === 'buy' && sh === 0) buy(bt.cfg.fill === 'close' && s.type === 'hold' ? D.c[i] : D.o[i], i, '訊號');
    else if (pending === 'sell' && sh > 0) sell(D.o[i], i, '訊號');
    pending = null;
    // 2) 盤中風控：停損 → 移動停損 → 停利（跳空時以開盤價成交）
    if (sh > 0 && s.type !== 'hold') {
      peak = Math.max(peak, D.h[i]);
      const stops = [];
      if (s.sl > 0) stops.push([entryPx * (1 - s.sl / 100), '停損']);
      if (s.trail > 0) stops.push([peak * (1 - s.trail / 100), '移停']);
      const stop = stops.sort((a, b) => b[0] - a[0])[0];
      if (stop && D.l[i] <= stop[0]) sell(Math.min(D.o[i], stop[0]), i, stop[1]);
      else if (s.tp > 0 && D.h[i] >= entryPx * (1 + s.tp / 100)) sell(Math.max(D.o[i], entryPx * (1 + s.tp / 100)), i, '停利');
    }
    // 3) 收盤判斷訊號
    if (sig && i < i1) {
      if (sh === 0 && sig.entry[i]) { if (bt.cfg.fill === 'close') buy(D.c[i], i, '訊號'); else pending = 'buy'; }
      else if (sh > 0 && sig.exit[i]) { if (bt.cfg.fill === 'close') sell(D.c[i], i, '訊號'); else pending = 'sell'; }
    }
    val.push(cash + sh * D.c[i]);
    flows.push(0);
  }
  return { val, flows, trades, marks, open: sh > 0 ? { in: D.t[entryI], inPx: entryPx, ret: (sh * D.c[i1] * (1 - D.fee - D.tax)) / basis - 1 } : null, invested: cap };
}

/** 定期定額：每月第一個 ≥ 扣款日的交易日投入固定金額 */
function btSimDca(D, s) {
  const { i0, i1 } = D;
  let sh = 0, invested = 0, lastMonth = '';
  const val = [], flows = [], marks = [];
  for (let i = i0; i <= i1; i++) {
    const ym = D.t[i].slice(0, 7), day = +D.t[i].slice(8);
    let flow = 0;
    if (ym !== lastMonth && day >= (s.p.day || 1)) {
      const px = (bt.cfg.fill === 'close' ? D.c[i] : D.o[i]) * (1 + D.slip);
      const amt = s.p.amount || 10000;
      sh += amt / (px * (1 + D.fee));
      invested += amt; flow = amt; lastMonth = ym;
      marks.push({ time: D.t[i], position: 'belowBar', color: '#16a085', shape: 'circle', text: '' });
    }
    val.push(sh * D.c[i]);
    flows.push(flow);
  }
  return { val, flows, trades: [], marks, open: null, invested, dca: true };
}

/** 績效指標（時間加權報酬，定期定額也適用） */
function btStats(D, r) {
  const n = r.val.length, rf = bt.cfg.rf / 100;
  const nav = [1], daily = [];
  for (let i = 1; i < n; i++) {
    const prev = r.val[i - 1];
    const rt = prev > 0 ? (r.val[i] - r.flows[i]) / prev - 1 : 0;
    daily.push(rt);
    nav.push(nav[i - 1] * (1 + rt));
  }
  let peak = -Infinity, mdd = 0;
  const dd = nav.map(x => { peak = Math.max(peak, x); const d = x / peak - 1; mdd = Math.min(mdd, d); return d; });
  const years = (Date.parse(D.t[D.i1]) - Date.parse(D.t[D.i0])) / (365.25 * 86400000) || 1 / 252;
  const final = r.val[n - 1];
  const total = final / r.invested - 1;
  const cagr = r.dca ? btXirr(D, r) : Math.pow(final / r.invested, 1 / years) - 1;
  const mean = daily.reduce((a, b) => a + b, 0) / (daily.length || 1);
  const vol = Math.sqrt(daily.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, daily.length - 1)) * Math.sqrt(252);
  const sharpe = vol ? (mean * 252 - rf) / vol : null;
  const tr = r.trades, wins = tr.filter(x => x.pnl > 0), loss = tr.filter(x => x.pnl <= 0);
  const gw = wins.reduce((a, b) => a + b.pnl, 0), gl = -loss.reduce((a, b) => a + b.pnl, 0);
  let inMkt = 0;
  if (!r.dca) {
    const held = new Set();
    tr.concat(r.open ? [{ in: r.open.in, out: D.t[D.i1] }] : []).forEach(x => { for (let i = D.i0; i <= D.i1; i++) if (D.t[i] >= x.in && D.t[i] <= x.out) held.add(i); });
    inMkt = held.size / n;
  }
  // 年度報酬
  const yearly = {};
  for (let i = 1; i < n; i++) { const y = D.t[D.i0 + i].slice(0, 4); yearly[y] = (yearly[y] || 1) * (1 + daily[i - 1]); }
  return {
    final, invested: r.invested, total, cagr, mdd, vol, sharpe, nav, dd, yearly,
    trades: tr.length, winRate: tr.length ? wins.length / tr.length : null,
    avgWin: wins.length ? wins.reduce((a, b) => a + b.ret, 0) / wins.length : null,
    avgLoss: loss.length ? loss.reduce((a, b) => a + b.ret, 0) / loss.length : null,
    pf: gl > 0 ? gw / gl : wins.length ? Infinity : null,
    avgDays: tr.length ? tr.reduce((a, b) => a + b.days, 0) / tr.length : null,
    exposure: r.dca ? 1 : inMkt, calmar: mdd < 0 ? cagr / -mdd : null,
  };
}

/** 定期定額年化報酬：XIRR（牛頓法） */
function btXirr(D, r) {
  const cfs = [];
  r.flows.forEach((f, i) => { if (f) cfs.push([Date.parse(D.t[D.i0 + i]), -f]); });
  cfs.push([Date.parse(D.t[D.i1]), r.val[r.val.length - 1]]);
  const t0 = cfs[0][0];
  const f = x => cfs.reduce((s, [t, v]) => s + v / Math.pow(1 + x, (t - t0) / (365.25 * 86400000)), 0);
  let x = 0.1;
  for (let k = 0; k < 60; k++) {
    const y = f(x), dy = (f(x + 1e-6) - y) / 1e-6;
    if (!dy) break;
    const nx = x - y / dy;
    if (!isFinite(nx) || nx <= -0.99) break;
    if (Math.abs(nx - x) < 1e-8) { x = nx; break; }
    x = nx;
  }
  return x;
}

function btLabel(s) {
  const d = BT_STRATS[s.type];
  if (s.type === 'hold') return '買進持有';
  const ps = d.params.map(([k]) => s.p[k]).join('／');
  const risk = [s.sl ? `停損${s.sl}%` : '', s.tp ? `停利${s.tp}%` : '', s.trail ? `移停${s.trail}%` : ''].filter(Boolean).join(' ');
  return `${d.label}${ps ? ' ' + ps : ''}${risk ? '（' + risk + '）' : ''}`;
}

/* =========================================================
 * 執行與呈現
 * ========================================================= */
function btRunAll() {
  btReadForm();
  if (!bt.bars) return btLoadBars();
  const D = btData();
  if (D.i1 - D.i0 < 30) return btStatus('回測期間太短（至少 30 個交易日）', 'err');
  const list = [{ type: 'hold', p: {} }].concat(bt.cfg.strats);
  bt.results = list.map((s, k) => {
    const r = btSim(D, s);
    return { s, label: btLabel(s), color: BT_COLORS[k % BT_COLORS.length], r, st: btStats(D, r) };
  });
  bt.D = D;
  if (bt.sel >= bt.results.length) bt.sel = 0;
  btRender();
  btStatus(`回測完成：${D.t[D.i0]} ～ ${D.t[D.i1]}（${D.i1 - D.i0 + 1} 個交易日）`, 'live');
}

function btRender() {
  bt.charts.forEach(c => c.remove());
  bt.charts = [];
  const R = bt.results, D = bt.D;
  const best = (k, dir = 1) => { const v = R.map(x => x.st[k]).filter(isNum); return v.length ? (dir > 0 ? Math.max(...v) : Math.min(...v)) : null; };
  const b = (x, k, dir = 1) => (isNum(x.st[k]) && x.st[k] === best(k, dir) ? ' best' : '');
  const pf = v => (v === Infinity ? '∞' : numTxt(v, 2));
  const pct = (v, d = 1) => (isNum(v) ? signTxt(v * 100, d, '%') : '—');
  const years = Object.keys(R[0].st.yearly).sort();
  const sel = R[bt.sel];
  $('#btResult').innerHTML = `
    <section class="panel"><div class="panel-head"><h2 class="panel-title">策略比較</h2><span class="muted">點列查看交易明細；藍底為該欄最佳</span></div>
      <div class="panel-body"><div class="tbl-wrap"><table class="mtbl bt-tbl">
        <thead><tr><th>策略</th><th class="num">總報酬</th><th class="num">年化報酬</th><th class="num">最大回撤</th><th class="num">夏普值</th><th class="num">卡瑪比</th>
          <th class="num">波動度</th><th class="num">交易次數</th><th class="num">勝率</th><th class="num">平均獲利</th><th class="num">平均虧損</th><th class="num">獲利因子</th><th class="num">平均持有</th><th class="num">在場時間</th><th class="num">最終資產</th></tr></thead>
        <tbody>${R.map((x, k) => `<tr class="${k === bt.sel ? 'sel' : ''}" data-k="${k}">
          <td class="nm"><i class="dotc" style="background:${x.color}"></i>${esc(x.label)}</td>
          <td class="num strong ${dirCls(x.st.total)}${b(x, 'total')}">${pct(x.st.total)}</td><td class="num ${dirCls(x.st.cagr)}${b(x, 'cagr')}">${pct(x.st.cagr, 2)}</td>
          <td class="num${b(x, 'mdd')}">${pct(x.st.mdd)}</td><td class="num${b(x, 'sharpe')}">${numTxt(x.st.sharpe, 2)}</td><td class="num${b(x, 'calmar')}">${numTxt(x.st.calmar, 2)}</td>
          <td class="num">${pct(x.st.vol)}</td><td class="num">${x.r.dca ? '每月' : x.st.trades}</td><td class="num">${isNum(x.st.winRate) ? numTxt(x.st.winRate * 100, 0) + '%' : '—'}</td>
          <td class="num up">${pct(x.st.avgWin)}</td><td class="num down">${pct(x.st.avgLoss)}</td><td class="num">${pf(x.st.pf)}</td>
          <td class="num">${isNum(x.st.avgDays) ? numTxt(x.st.avgDays, 0) + ' 天' : '—'}</td><td class="num">${numTxt(x.st.exposure * 100, 0)}%</td>
          <td class="num">${numTxt(x.st.final, 0)}${x.r.dca ? `<br><span class="muted">投入 ${numTxt(x.st.invested, 0)}</span>` : ''}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="foot-note">報酬已扣手續費、交易稅與滑價；${bt.cfg.adj ? '採還原權息價（配息視為再投入）' : '僅價格報酬（不含配息）'}；${bt.cfg.fill === 'open' ? '訊號於收盤產生、隔日開盤成交' : '訊號於收盤產生並以收盤價成交（較理想化）'}。
        定期定額的年化報酬為 XIRR，最大回撤、夏普值以時間加權報酬計算。夏普值無風險利率 ${bt.cfg.rf}%。卡瑪比 = 年化報酬 ÷ |最大回撤|。</div></div></section>

    <section class="panel"><div class="panel-head"><h2 class="panel-title">累積報酬走勢</h2></div>
      <div class="panel-body"><div class="chart-legend">${R.map(x => `<span style="--c:${x.color}">${esc(x.label)}</span>`).join('')}</div>
        <div class="mini-chart tall" id="btEq"></div>
        <div class="chart-legend"><span style="--c:${sel.color}">回撤：${esc(sel.label)}</span><span style="--c:#7f8c8d">回撤：買進持有</span></div>
        <div class="mini-chart short" id="btDd"></div></div></section>

    <section class="panel"><div class="panel-head"><h2 class="panel-title">年度報酬</h2></div>
      <div class="panel-body"><div class="tbl-wrap"><table class="mtbl"><thead><tr><th>策略</th>${years.map(y => `<th class="num">${y}</th>`).join('')}</tr></thead>
        <tbody>${R.map(x => `<tr><td class="nm"><i class="dotc" style="background:${x.color}"></i>${esc(x.label)}</td>${years.map(y => { const v = x.st.yearly[y] - 1; return `<td class="num ${dirCls(v)}">${pct(v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="foot-note">第一年與最後一年為部分年度。</div></div></section>

    <section class="panel"><div class="panel-head"><h2 class="panel-title">${esc(sel.label)}：進出場與交易明細</h2></div>
      <div class="panel-body"><div class="mini-chart tall" id="btPx"></div>
        ${sel.r.trades.length || sel.r.open ? `<div class="tbl-wrap"><table class="mtbl"><thead><tr><th>#</th><th>買進日</th><th class="num">買價</th><th>賣出日</th><th class="num">賣價</th><th>出場原因</th><th class="num">持有天數</th><th class="num">報酬</th></tr></thead>
          <tbody>${sel.r.trades.map((t, i) => `<tr><td class="muted">${i + 1}</td><td>${t.in}</td><td class="num">${numTxt(t.inPx)}</td><td>${t.out}</td><td class="num">${numTxt(t.outPx)}</td>
            <td>${t.why}</td><td class="num">${t.days}</td><td class="num strong ${dirCls(t.ret)}">${pct(t.ret, 2)}</td></tr>`).reverse().join('')}
          ${sel.r.open ? `<tr class="sum"><td></td><td>${sel.r.open.in}</td><td class="num">${numTxt(sel.r.open.inPx)}</td><td colspan="4">持有中（未實現）</td><td class="num ${dirCls(sel.r.open.ret)}">${pct(sel.r.open.ret, 2)}</td></tr>` : ''}</tbody></table></div>`
          : `<div class="muted">${sel.r.dca ? '定期定額：圓點為每月扣款日' : '此期間沒有交易'}</div>`}
        <div class="foot-note">${bt.cfg.adj ? '圖表與成交價為還原權息價，與當時實際成交價格不同。' : ''}箭頭：藍＝買進、橘＝訊號賣出、紅＝停損／停利／移動停損。</div></div></section>`;
  $$('#btResult tr[data-k]').forEach(tr => tr.addEventListener('click', () => { bt.sel = +tr.dataset.k; btRender(); }));
  btCharts();
}

function btCharts() {
  const LWC = window.LightweightCharts, R = bt.results, D = bt.D;
  const mk = el => { const ch = LWC.createChart(el, { autoSize: true, layout: { background: { type: 'solid', color: '#fff' }, textColor: '#5b6778', fontSize: 11 }, grid: { vertLines: { color: '#f2f4f7' }, horzLines: { color: '#f2f4f7' } }, rightPriceScale: { borderColor: '#e3e8ef' }, timeScale: { borderColor: '#e3e8ef' }, localization: { locale: 'zh-TW', dateFormat: 'yyyy-MM-dd' }, handleScale: { mouseWheel: false } }); bt.charts.push(ch); return ch; };
  const times = D.t.slice(D.i0, D.i1 + 1);
  const pctF = { type: 'custom', formatter: v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%' };
  const eq = mk($('#btEq'));
  R.forEach((x, k) => eq.addSeries(LWC.LineSeries, { color: x.color, lineWidth: k === bt.sel ? 3 : k ? 1.5 : 2, priceLineVisible: false, lastValueVisible: true, priceFormat: pctF, lineStyle: k ? 0 : 2 })
    .setData(times.map((t, i) => ({ time: t, value: (x.st.nav[i] - 1) * 100 }))));
  eq.timeScale().fitContent();
  const dd = mk($('#btDd'));
  [R[0], R[bt.sel]].forEach((x, k) => dd.addSeries(k ? LWC.AreaSeries : LWC.LineSeries, k
    ? { lineColor: x.color, topColor: 'rgba(192,57,43,.05)', bottomColor: 'rgba(192,57,43,.25)', lineWidth: 1.5, priceLineVisible: false, priceFormat: pctF }
    : { color: x.color, lineWidth: 1, priceLineVisible: false, priceFormat: pctF, lineStyle: 2 }).setData(times.map((t, i) => ({ time: t, value: x.st.dd[i] * 100 }))));
  dd.timeScale().fitContent();
  const up = cssVar('--up'), down = cssVar('--down');
  const px = mk($('#btPx'));
  const k = px.addSeries(LWC.CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
  k.setData(times.map((t, i) => ({ time: t, open: D.o[D.i0 + i], high: D.h[D.i0 + i], low: D.l[D.i0 + i], close: D.c[D.i0 + i] })));
  const sel = R[bt.sel];
  if (LWC.createSeriesMarkers && sel.r.marks.length) LWC.createSeriesMarkers(k, sel.r.marks);
  px.timeScale().fitContent();
}

/* ---------- 參數掃描 ---------- */
function btScan(idx) {
  btReadForm();
  if (!bt.bars) return toast('請先載入標的');
  const s = bt.cfg.strats[idx], D = btData();
  const grid = s.type === 'maCross'
    ? { a: ['fast', [5, 10, 20, 30, 60]], b: ['slow', [20, 40, 60, 120, 240]], ok: (x, y) => x < y }
    : { a: ['n', [10, 20, 40, 55, 120]], b: ['m', [5, 10, 20, 40, 55]], ok: () => true };
  const hold = btStats(D, btSim(D, { type: 'hold', p: {} }));
  const cells = grid.a[1].map(x => grid.b[1].map(y => {
    if (!grid.ok(x, y)) return null;
    const ss = Object.assign({}, s, { p: Object.assign({}, s.p, { [grid.a[0]]: x, [grid.b[0]]: y }) });
    return btStats(D, btSim(D, ss));
  }));
  const all = cells.flat().filter(Boolean).map(c => c.cagr);
  const mx = Math.max(...all, hold.cagr), mn = Math.min(...all, hold.cagr);
  const heat = v => `background:color-mix(in srgb, var(${v >= hold.cagr ? '--up' : '--down'}) ${Math.round(10 + 60 * Math.min(1, Math.abs(v - hold.cagr) / Math.max(1e-9, v >= hold.cagr ? mx - hold.cagr : hold.cagr - mn)))}%, #fff)`;
  const lab = BT_STRATS[s.type].params;
  $('#btScanOut').innerHTML = `<section class="panel"><div class="panel-head"><h2 class="panel-title">參數掃描：${BT_STRATS[s.type].label}</h2>
      <button class="icon-btn" id="btScanClose" title="關閉">×</button></div><div class="panel-body">
    <div class="tbl-wrap"><table class="mtbl bt-scan"><thead><tr><th>${lab[0][1]} ＼ ${lab[1][1]}</th>${grid.b[1].map(y => `<th class="num">${y}</th>`).join('')}</tr></thead>
      <tbody>${grid.a[1].map((x, i) => `<tr><th>${x}</th>${cells[i].map((c, j) => c ? `<td class="num heat" style="${heat(c.cagr)}" data-x="${x}" data-y="${grid.b[1][j]}" title="點擊套用">
        <b>${signTxt(c.cagr * 100, 1, '%')}</b><br><span class="muted">回撤 ${numTxt(c.mdd * 100, 0)}%・${c.trades} 筆</span></td>` : '<td class="muted">—</td>').join('')}</tr>`).join('')}</tbody></table></div>
    <div class="foot-note">格內為年化報酬（紅色高於、綠色低於買進持有的 ${signTxt(hold.cagr * 100, 1, '%')}，顏色依漲跌色設定），下方為最大回撤與交易筆數。點格子可套用參數。
      <b>注意過度最佳化</b>：歷史上最好的參數不代表未來最好，建議選擇「周圍格子也不差」的穩定區域，並用不同期間交叉驗證。</div></div></section>`;
  $('#btScanClose').addEventListener('click', () => { $('#btScanOut').innerHTML = ''; });
  $$('#btScanOut td[data-x]').forEach(td => td.addEventListener('click', () => {
    s.p[grid.a[0]] = +td.dataset.x; s.p[grid.b[0]] = +td.dataset.y;
    btRenderStrats(); btRunAll();
    toast(`已套用 ${td.dataset.x}／${td.dataset.y}`);
  }));
  $('#btScanOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

initBacktest();
