/* =========================================================
 * 個股研究 — 延伸內容
 *  1. 由現有價格資料計算：風險指標、長期報酬、季節性、支撐與壓力、合理價區間、月營收亮點、填息
 *  2. 延伸資料（主要資料顯示後在背景分組平行載入，見 Research.gs researchX_）：
 *     台股 fin 財務體質｜chips 股權分散、借券、當沖、ETF 持有｜events 新聞、注意／處置、除權息結果｜peers 同業
 *     美股 fin 財務體質、10 年財報｜est 分析師預估、財報驚喜｜own 內部人、機構、選擇權｜events 新聞、SEC 申報｜peers 同業
 * 依賴 research.js（research, rsPanel, vChip, vNote, fmtBig, barsSvg, qLabel, rsChart, pctRank, quantile, V, RS_BLOCKS）、
 *      macro.js（isNum, numTxt, signTxt, pctTxt, dirCls, seg, sparkSvg, cssVar, mdTxt, tpDate, relTime）、
 *      futures.js（optDistSvg）、app.js（$, $$, esc, apiBg, api, toast）
 * ========================================================= */
const RSX_PARTS = { TW: ['fin', 'chips', 'events', 'peers'], US: ['fin', 'est', 'own', 'events', 'peers'] };
const RSX_WAIT = {
  fin: [['財務體質', 12]], est: [['分析師預估與財報驚喜', 12]], chips: [['股權分散、借券與當沖', 12]], own: [['內部人、機構與選擇權', 12]],
  events: [['新聞與事件', 12]], divfill: [['填息紀錄', 6]], peers: [['同業比較', 12]],
};

/* ---------- 小工具 ---------- */
const rxDiv = (v, cur) => (isNum(v) ? v / (cur === 'TWD' ? 1e8 : 1e9) : null); // 圖表單位：台幣億、美元十億
const rxUnit = cur => (cur === 'TWD' ? '億' : cur === 'USD' ? '十億美元' : '十億');
const rxPct = (a, b) => (isNum(a) && isNum(b) && b ? (a / b) * 100 : null);
const rxAvg = a => { const v = a.filter(isNum); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const rxMed = a => quantile(a, 0.5);
const rxKpi = (l, v, s, cls) => `<div class="kpi"><div class="kpi-l">${l}</div><div class="kpi-v ${cls || ''}">${v}</div>${s ? `<div class="kpi-s">${s}</div>` : ''}</div>`;
const rxMsg = (title, span, msg, cls) => `<section class="panel rs-panel" style="--span:${span}"><div class="panel-head"><h2 class="panel-title">${title}</h2></div><div class="panel-body"><div class="panel-msg ${cls || ''}">${msg}</div></div></section>`;

/** 等待中的佔位字卡（display:contents 讓裡面的字卡直接參與外層格線） */
function rsxBox(part) {
  return `<div class="rsx" id="rsx-${part}">${(RSX_WAIT[part] || [['延伸資料', 12]]).map(([t, s]) =>
    `<section class="panel rs-panel rsx-wait" style="--span:${s}"><div class="panel-head"><h2 class="panel-title">${t}</h2></div><div class="panel-body"><div class="panel-msg"><span class="spin"></span>背景載入中…</div></div></section>`).join('')}</div>`;
}

/* =========================================================
 * 一、由價格資料計算
 * ========================================================= */
/** 風險指標（近 1 年與 5 年） */
function rsxRiskCalc() {
  const d = research.data, P = d.price, c = P.c, n = c.length, B = d.bench;
  const rets = [];
  for (let i = Math.max(1, n - 250); i < n; i++) if (c[i - 1]) rets.push(c[i] / c[i - 1] - 1);
  const mean = rxAvg(rets), sd = Math.sqrt(rxAvg(rets.map(r => (r - mean) ** 2)) || 0);
  const dn = rets.filter(r => r < 0), dsd = Math.sqrt(rxAvg(dn.map(r => r * r)) || 0);
  const rf = d.mkt === 'TW' ? 0.015 : 0.04;
  const annRet = n > 250 ? c[n - 1] / c[n - 251] - 1 : null;
  // 最大回撤（全部資料，約 5 年）與恢復
  let peak = c[0], pi = 0, mdd = 0, from = 0, to = 0;
  for (let i = 1; i < n; i++) {
    if (c[i] > peak) { peak = c[i]; pi = i; }
    const dd = c[i] / peak - 1;
    if (dd < mdd) { mdd = dd; from = pi; to = i; }
  }
  let rec = null;
  for (let i = to + 1; i < n; i++) if (c[i] >= c[from]) { rec = i; break; }
  let mdd1 = 0, pk1 = c[Math.max(0, n - 250)];
  for (let i = Math.max(0, n - 250); i < n; i++) { pk1 = Math.max(pk1, c[i]); mdd1 = Math.min(mdd1, c[i] / pk1 - 1); }
  // Beta（近 1 年日報酬 vs 大盤）
  let beta = null;
  if (B && B.t.length) {
    const bm = new Map(B.t.map((t, i) => [t, B.c[i]]));
    const xs = [], ys = [];
    for (let i = Math.max(1, n - 250); i < n; i++) {
      const b0 = bm.get(P.t[i - 1]), b1 = bm.get(P.t[i]);
      if (b0 && b1 && c[i - 1]) { xs.push(b1 / b0 - 1); ys.push(c[i] / c[i - 1] - 1); }
    }
    if (xs.length > 120) {
      const mx = rxAvg(xs), my = rxAvg(ys);
      let cov = 0, vx = 0;
      xs.forEach((x, i) => { cov += (x - mx) * (ys[i] - my); vx += (x - mx) ** 2; });
      beta = vx ? cov / vx : null;
    }
  }
  const curDD = c[n - 1] / Math.max(...c) - 1;
  return {
    vol: sd * Math.sqrt(252) * 100, annRet: annRet != null ? annRet * 100 : null,
    sharpe: sd && annRet != null ? (annRet - rf) / (sd * Math.sqrt(252)) : null, sortino: dsd && annRet != null ? (annRet - rf) / (dsd * Math.sqrt(252)) : null,
    mdd: mdd * 100, mddFrom: P.t[from], mddTo: P.t[to], recDays: rec != null ? rec - to : null, recDate: rec != null ? P.t[rec] : null,
    mdd1: mdd1 * 100, curDD: curDD * 100, best: rets.length ? Math.max(...rets) * 100 : null, worst: rets.length ? Math.min(...rets) * 100 : null,
    upDays: rets.length ? (rets.filter(r => r > 0).length / rets.length) * 100 : null, beta, rf, years: (n / 250).toFixed(1),
  };
}

/** 長期報酬（股價與含息），1 年以上用月線、以下用日線 */
function rsxReturnsCalc() {
  const d = research.data, c = d.price.c, n = c.length, mo = d.mo;
  const out = [];
  const daily = (k, label) => out.push({ label, p: n > k ? (c[n - 1] / c[n - 1 - k] - 1) * 100 : null });
  daily(21, '1 個月'); daily(63, '3 個月'); daily(126, '6 個月');
  const ty = new Date().getFullYear();
  const yIdx = d.price.t.findIndex(t => t >= ty + '-01-01');
  out.push({ label: '今年以來', p: yIdx > 0 ? (c[n - 1] / c[yIdx - 1] - 1) * 100 : null });
  if (mo && mo.t.length > 13) {
    const m = mo.t.length;
    [[12, '1 年'], [36, '3 年'], [60, '5 年'], [120, '10 年']].forEach(([k, label]) => {
      if (m <= k) { out.push({ label, p: null, t: null }); return; }
      const p = (mo.c[m - 1] / mo.c[m - 1 - k] - 1) * 100, t = (mo.a[m - 1] / mo.a[m - 1 - k] - 1) * 100;
      out.push({ label, p, t, ann: k > 12 ? (Math.pow(1 + t / 100, 12 / k) - 1) * 100 : null });
    });
  }
  return out;
}

/** 季節性：近 10 年各月份的平均報酬與上漲機率 */
function rsxSeasonCalc() {
  const mo = research.data.mo;
  if (!mo || mo.t.length < 25) return null;
  const by = Array.from({ length: 12 }, () => []);
  const nowYm = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
  for (let i = 1; i < mo.t.length; i++) {
    if (mo.t[i] >= nowYm) continue; // 本月尚未結束，不計入
    if (!mo.a[i - 1]) continue;
    by[+mo.t[i].slice(5, 7) - 1].push((mo.a[i] / mo.a[i - 1] - 1) * 100);
  }
  return by.map((a, i) => ({ m: i + 1, avg: rxAvg(a), win: a.length ? (a.filter(x => x > 0).length / a.length) * 100 : null, n: a.length, med: rxMed(a) }));
}

/** 支撐與壓力：近一年成交量分布（依收盤價分 24 區）＋近期高低點 */
function rsxLevelsCalc() {
  const P = research.data.price, n = P.c.length, s = Math.max(0, n - 250);
  const cs = P.c.slice(s), vs = P.v.slice(s), last = P.c[n - 1];
  const lo = Math.min(...P.l.slice(s)), hi = Math.max(...P.h.slice(s));
  const bins = 24, step = (hi - lo) / bins || 1;
  const vol = new Array(bins).fill(0);
  cs.forEach((x, i) => { vol[Math.min(bins - 1, Math.floor((x - lo) / step))] += vs[i] || 0; });
  const nodes = vol.map((v, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, mid: lo + (i + 0.5) * step, v }));
  const max = Math.max(...vol) || 1;
  const sorted = nodes.slice().sort((a, b) => b.v - a.v);
  const sup = sorted.filter(x => x.hi < last).slice(0, 2).sort((a, b) => b.mid - a.mid);
  const res = sorted.filter(x => x.lo > last).slice(0, 2).sort((a, b) => a.mid - b.mid);
  const rng = k => ({ hi: Math.max(...P.h.slice(-k)), lo: Math.min(...P.l.slice(-k)) });
  return { nodes, max, last, sup, res, r20: rng(20), r60: rng(60), r250: rng(Math.min(250, n)) };
}

/** 合理價區間：本益比歷史 25／50／75 百分位 × 近四季 EPS（美股另用預估 EPS） */
function rsxFairCalc() {
  const d = research.data, C = research.calc, VA = C.val;
  const q = (C.fin || []).filter(x => isNum(x.eps));
  const ttm = q.length >= 4 ? q.slice(-4).reduce((s, x) => s + x.eps, 0) : (isNum(VA.cur) && VA.cur > 0 ? C.last / VA.cur : null);
  const est = research.x && research.x.est;
  const fwd = est && est.yf && est.yf[0] && isNum(est.yf[0].avg) ? est.yf[0] : null;
  if (!VA.peV.length || !isNum(ttm) || ttm <= 0) return { ok: false, ttm };
  const [p10, p25, p50, p75, p90] = VA.q;
  const fair = ttm * p50;
  return {
    ok: true, ttm, p10, p25, p50, p75, p90, cheap: ttm * p25, fair, rich: ttm * p75,
    // 合理價與現價差距過大：多半是高成長或景氣循環股，過去獲利基期不同，本益比區間參考性低
    warn: fair / C.last > 1.6 || fair / C.last < 0.6 || p75 / p25 > 2.2,
    fwd: fwd ? { p: fwd.p, eps: fwd.avg, fair: fwd.avg * p50, cheap: fwd.avg * p25, rich: fwd.avg * p75 } : null,
  };
}

/** 月營收亮點（台股） */
function rsxRevHighlights() {
  const L = (research.calc.mrev && research.calc.mrev.list) || [];
  if (L.length < 3) return [];
  const last = L[L.length - 1], out = [];
  const before = L.slice(0, -1).map(x => x.rev);
  const higher = before.filter(v => v >= last.rev).length;
  if (!higher) out.push(`<b>${last.ym.replace('-', '/')} 營收創近 ${L.length} 個月新高</b>`);
  else {
    let k = 0;
    for (let i = L.length - 2; i >= 0 && L[i].rev < last.rev; i--) k++;
    if (k >= 3) out.push(`營收為近 ${k + 1} 個月新高`);
  }
  const same = L.filter(x => x.ym.slice(5) === last.ym.slice(5) && x !== last);
  if (same.length && same.every(x => x.rev < last.rev)) out.push(`創歷年同月新高（比較 ${same.length + 1} 年）`);
  let streak = 0;
  for (let i = L.length - 1; i >= 0 && isNum(L[i].yoy) && L[i].yoy > 0; i--) streak++;
  let neg = 0;
  for (let i = L.length - 1; i >= 0 && isNum(L[i].yoy) && L[i].yoy < 0; i--) neg++;
  if (streak >= 3) out.push(`連續 ${streak} 個月年增`);
  if (neg >= 3) out.push(`連續 ${neg} 個月年減`);
  const y = last.ym.slice(0, 4), m = +last.ym.slice(5);
  const cy = L.filter(x => x.ym.slice(0, 4) === y && +x.ym.slice(5) <= m), py = L.filter(x => x.ym.slice(0, 4) === String(+y - 1) && +x.ym.slice(5) <= m);
  if (cy.length === m && py.length === m) {
    const g = (cy.reduce((s, x) => s + x.rev, 0) / py.reduce((s, x) => s + x.rev, 0) - 1) * 100;
    out.push(`今年累計營收年增 <b class="${dirCls(g)}">${signTxt(g, 1, '%')}</b>`);
  }
  return out;
}

/* ---------- 由價格計算的字卡 ---------- */
function rsxBasePanels() { // 回傳 { risk, returns, season, levels }，由 research.js 依版面排列
  const d = research.data, isTW = d.mkt === 'TW', R = rsxRiskCalc(), RT = rsxReturnsCalc(), S = rsxSeasonCalc(), LV = rsxLevelsCalc();
  research.calc.risk = R; research.calc.rets = RT; research.calc.season = S; research.calc.levels = LV;
  const benchName = d.bench ? (d.bench.sym === '^TWII' ? '加權指數' : d.bench.sym === '^GSPC' ? 'S&P 500' : d.bench.sym) : '大盤';
  const out = {};
  out.risk = rsPanel('risk', '風險指標', 6, null, `
    <div class="kpis">
      ${rxKpi('最大回撤（近 ' + R.years + ' 年）', signTxt(R.mdd, 1, '%'), `${mdTxt(R.mddFrom)} → ${mdTxt(R.mddTo)}${R.recDays != null ? `・${R.recDays} 個交易日收復` : '・尚未回到前高'}`, 'down')}
      ${rxKpi('近 1 年最大回撤', signTxt(R.mdd1, 1, '%'), `目前距高點 ${signTxt(R.curDD, 1, '%')}`, 'down')}
      ${rxKpi('年化波動度', numTxt(R.vol, 1) + '%', '近 1 年日報酬')}
      ${rxKpi('Beta', numTxt(R.beta, 2), `對${benchName}，>1 波動大於大盤`)}
    </div>
    <div class="tbl-wrap"><table class="mtbl">
      <tr><td class="nm">夏普值（近 1 年）</td><td class="num strong">${numTxt(R.sharpe, 2)}</td><td class="muted">每承擔 1 單位波動的超額報酬，&gt;1 佳</td></tr>
      <tr><td class="nm">索提諾值</td><td class="num strong">${numTxt(R.sortino, 2)}</td><td class="muted">只計下跌波動</td></tr>
      <tr><td class="nm">近 1 年報酬</td><td class="num strong ${dirCls(R.annRet)}">${signTxt(R.annRet, 1, '%')}</td><td class="muted">上漲日比例 ${numTxt(R.upDays, 0)}%</td></tr>
      <tr><td class="nm">單日最大漲／跌</td><td class="num"><span class="up">${signTxt(R.best, 1, '%')}</span>／<span class="down">${signTxt(R.worst, 1, '%')}</span></td><td class="muted">近 1 年</td></tr>
    </table></div>
    <div class="foot-note">夏普值、索提諾值以無風險利率 ${numTxt(R.rf * 100, 1)}% 計算。最大回撤 = 從前一個高點到最低點的跌幅；Beta 為近 1 年日報酬對大盤的迴歸係數。</div>`);
  out.returns = rsPanel('returns', '長期報酬', 6, null, `
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>期間</th><th class="num">股價報酬</th><th class="num">含息報酬</th><th class="num">年化（含息）</th></tr></thead>
      <tbody>${RT.map(r => `<tr><td class="nm">${r.label}</td><td class="num ${dirCls(r.p)}">${signTxt(r.p, 1, '%')}</td>
        <td class="num strong ${dirCls(r.t)}">${'t' in r ? signTxt(r.t, 1, '%') : '<span class="muted">—</span>'}</td><td class="num ${dirCls(r.ann)}">${isNum(r.ann) ? signTxt(r.ann, 1, '%') : '—'}</td></tr>`).join('')}</tbody></table></div>
    <div class="foot-note">1 年以內用日收盤價；1 年以上用月線，含息報酬以還原權息價計算（配息再投入）。</div>`);
  if (S) {
    const nowM = new Date().getMonth() + 1, nextM = nowM % 12 + 1;
    out.season = rsPanel('season', '季節性（各月份表現）', 6, null, `
      <div class="bars-wrap">${barsSvg(S.map(x => x.avg), S.map(x => x.m + '月'), '平均月報酬（%，含息）', S.map(x => x.win), '上漲機率（%）')}</div>
      <div class="tbl-wrap"><table class="mtbl sm">
        <thead><tr><th>月份</th><th class="num">平均</th><th class="num">中位數</th><th class="num">上漲機率</th><th class="num">年數</th></tr></thead>
        <tbody>${S.map(x => `<tr class="${x.m === nowM || x.m === nextM ? 'mine' : ''}"><td class="nm">${x.m} 月${x.m === nowM ? '（本月）' : x.m === nextM ? '（下月）' : ''}</td>
          <td class="num ${dirCls(x.avg)}">${signTxt(x.avg, 1, '%')}</td><td class="num ${dirCls(x.med)}">${signTxt(x.med, 1, '%')}</td><td class="num">${numTxt(x.win, 0)}%</td><td class="num muted">${x.n}</td></tr>`).join('')}</tbody></table></div>
      <div class="foot-note">近 ${Math.round(research.data.mo.t.length / 12)} 年月線（含息）統計；樣本只有 10 年左右，僅反映過去的傾向，不代表今年一定如此。</div>`);
  }
  const vp = LV.nodes.map(x => {
    const w = (x.v / LV.max) * 100, cur = LV.last >= x.lo && LV.last < x.hi;
    return `<div class="vp-row ${cur ? 'cur' : x.mid < LV.last ? 'below' : 'above'}"><span class="vp-p">${numTxt(x.mid, x.mid >= 100 ? 0 : 2)}</span><span class="vp-bar"><i style="width:${w.toFixed(1)}%"></i></span></div>`;
  }).reverse().join('');
  out.levels = rsPanel('levels', '支撐與壓力（成交量分布）', 12, null, `
    <div class="vp-wrap"><div class="vp">${vp}</div>
      <div class="vp-side">
        <div class="sub-h">壓力（上方成交密集區）</div>${LV.res.length ? LV.res.map(x => `<div class="lv up">${numTxt(x.lo, 1)}–${numTxt(x.hi, 1)} <span class="muted">距 ${signTxt((x.mid / LV.last - 1) * 100, 1, '%')}</span></div>`).join('') : '<div class="muted">上方無明顯密集區</div>'}
        <div class="sub-h">支撐（下方成交密集區）</div>${LV.sup.length ? LV.sup.map(x => `<div class="lv down">${numTxt(x.lo, 1)}–${numTxt(x.hi, 1)} <span class="muted">距 ${signTxt((x.mid / LV.last - 1) * 100, 1, '%')}</span></div>`).join('') : '<div class="muted">下方無明顯密集區</div>'}
        <div class="sub-h">區間高低點</div>
        <div class="lv">20 日 ${numTxt(LV.r20.lo)}–${numTxt(LV.r20.hi)}</div><div class="lv">60 日 ${numTxt(LV.r60.lo)}–${numTxt(LV.r60.hi)}</div><div class="lv">52 週 ${numTxt(LV.r250.lo)}–${numTxt(LV.r250.hi)}</div>
      </div></div>
    <div class="foot-note">近一年依收盤價把成交量分成 24 個價格區，越長代表在該價位成交越多（籌碼密集），常成為支撐或壓力；深色為目前價位所在區。</div>`);
  return out;
}

function rsxFairPanel() {
  const F = rsxFairCalc(), C = research.calc;
  if (!F.ok) return rsPanel('fair', '合理價區間', 6, null, `<div class="panel-msg">${isNum(F.ttm) && F.ttm <= 0 ? '近四季 EPS 為負，無法用本益比估算' : '本益比歷史資料不足，無法估算'}</div>`);
  const lo = Math.min(F.ttm * F.p10, C.last) * 0.97, hi = Math.max(F.ttm * F.p90, C.last) * 1.03, pos = v => ((v - lo) / (hi - lo)) * 100;
  const zone = C.last <= F.cheap ? ['便宜價以下', 'bull'] : C.last <= F.fair ? ['便宜～合理之間', 'neutral'] : C.last <= F.rich ? ['合理～昂貴之間', 'neutral'] : ['昂貴價以上', 'warn'];
  return rsPanel('fair', '合理價區間', 6, null, `
    <div class="vchip-row"><span class="vchip ${zone[1]}">${zone[0]}</span><span class="muted">現價 ${numTxt(C.last)}，距合理價 ${signTxt((F.fair / C.last - 1) * 100, 1, '%')}</span></div>
    <div class="fair-bar">
      <i class="z z1" style="left:0;width:${pos(F.cheap)}%"></i><i class="z z2" style="left:${pos(F.cheap)}%;width:${pos(F.fair) - pos(F.cheap)}%"></i>
      <i class="z z3" style="left:${pos(F.fair)}%;width:${pos(F.rich) - pos(F.fair)}%"></i><i class="z z4" style="left:${pos(F.rich)}%;right:0"></i>
      <b class="now" style="left:${pos(C.last)}%"></b>
    </div>
    <div class="fair-lbl"><span>便宜 ${numTxt(F.cheap)}</span><span>合理 <b>${numTxt(F.fair)}</b></span><span>昂貴 ${numTxt(F.rich)}</span></div>
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>依據</th><th class="num">EPS</th><th class="num">便宜（P25）</th><th class="num">合理（中位）</th><th class="num">昂貴（P75）</th></tr></thead>
      <tbody><tr><td class="nm">近四季 EPS</td><td class="num">${numTxt(F.ttm, 2)}</td><td class="num">${numTxt(F.cheap)}</td><td class="num strong">${numTxt(F.fair)}</td><td class="num">${numTxt(F.rich)}</td></tr>
        ${F.fwd ? `<tr><td class="nm">預估 EPS（${esc(F.fwd.p)}）</td><td class="num">${numTxt(F.fwd.eps, 2)}</td><td class="num">${numTxt(F.fwd.cheap)}</td><td class="num strong">${numTxt(F.fwd.fair)}</td><td class="num">${numTxt(F.fwd.rich)}</td></tr>` : ''}</tbody></table></div>
    ${F.warn ? `<div class="earn-alert">⚠ 歷史本益比區間很寬（${numTxt(F.p25, 1)}–${numTxt(F.p75, 1)} 倍）或與現價差距很大：這檔過去的獲利基期變化大（高成長或景氣循環），用歷史本益比推算的合理價參考性低，建議搭配預估本益比、同業比較判斷。</div>` : ''}
    <div class="foot-note">本益比用自身歷史的 25／50／75 百分位（${numTxt(F.p25, 1)}／${numTxt(F.p50, 1)}／${numTxt(F.p75, 1)} 倍）乘以 EPS。只適合獲利穩定的公司；景氣循環股在獲利高峰時本益比偏低，容易高估合理價。</div>`);
}

/* =========================================================
 * 二、財務體質
 * ========================================================= */
/** 依季資料計算近四季（TTM）與比率；i 為季索引 */
function rsxFinRatios(q, i) {
  const at = (k, j) => (j >= 0 && j < q.length && isNum(q[j][k]) ? q[j][k] : null);
  const sum4 = k => { let s = 0; for (let j = i - 3; j <= i; j++) { const v = at(k, j); if (v == null) return null; s += v; } return s; };
  const avg2 = k => { const a = at(k, i), b = at(k, i - 4); return isNum(a) && isNum(b) ? (a + b) / 2 : a; };
  const t = { rev: sum4('rev'), gp: sum4('gp'), op: sum4('op'), ni: sum4('ni'), ocf: sum4('ocf'), capex: sum4('capex'), fcf: sum4('fcf'), cogs: sum4('cogs'), div: sum4('div'), buyback: sum4('buyback') };
  const ta = avg2('ta'), eq = avg2('eq');
  return {
    p: q[i].p, t, ta: at('ta', i), tl: at('tl', i), eq: at('eq', i), ca: at('ca', i), cl: at('cl', i), cash: at('cash', i), re: at('re', i), sh: at('sh', i), debt: at('debt', i), inv: at('inv', i),
    roe: rxPct(t.ni, eq), roa: rxPct(t.ni, ta), nm: rxPct(t.ni, t.rev), gm: rxPct(t.gp, t.rev), om: rxPct(t.op, t.rev),
    turn: t.rev != null && ta ? t.rev / ta : null, lev: ta && eq ? ta / eq : null,
    debtR: rxPct(at('tl', i), at('ta', i)), curR: at('ca', i) && at('cl', i) ? at('ca', i) / at('cl', i) : null,
    quick: at('ca', i) != null && at('cl', i) ? (at('ca', i) - (at('inv', i) || 0)) / at('cl', i) : null,
    invDays: t.cogs ? (avg2('inv') / t.cogs) * 365 : null, arDays: t.rev ? (avg2('ar') / t.rev) * 365 : null,
    ocfNi: t.ocf != null && t.ni ? t.ocf / t.ni : null,
  };
}

/** 年度資料（美股 Yahoo 年報）轉成和 rsxFinRatios 相同的欄位 */
function rsxAnnRatios(a, i) {
  const r = a[i], p = a[i - 1] || {};
  const avg = k => (isNum(r[k]) && isNum(p[k]) ? (r[k] + p[k]) / 2 : r[k]);
  return {
    p: r.p, t: { rev: r.rev, gp: r.gp, op: r.op, ni: r.ni, ocf: r.ocf, capex: r.capex, fcf: r.fcf, cogs: r.cogs, div: r.div, buyback: r.buyback },
    ta: r.ta, tl: r.tl, eq: r.eq, ca: r.ca, cl: r.cl, cash: r.cash, re: r.re, sh: r.sh, debt: r.debt, inv: r.inv,
    roe: rxPct(r.ni, avg('eq')), roa: rxPct(r.ni, avg('ta')), nm: rxPct(r.ni, r.rev), gm: rxPct(r.gp, r.rev), om: rxPct(r.op, r.rev),
    turn: r.rev != null && avg('ta') ? r.rev / avg('ta') : null, lev: avg('ta') && avg('eq') ? avg('ta') / avg('eq') : null,
    debtR: rxPct(r.tl, r.ta), curR: r.ca && r.cl ? r.ca / r.cl : null, quick: r.ca != null && r.cl ? (r.ca - (r.inv || 0)) / r.cl : null,
    invDays: r.cogs ? (avg('inv') / r.cogs) * 365 : null, arDays: r.rev ? (avg('ar') / r.rev) * 365 : null, ocfNi: r.ocf != null && r.ni ? r.ocf / r.ni : null,
  };
}

/** Piotroski F-Score：9 項，每項 1 分 */
function rsxFScore(cur, prev) {
  if (!cur || !prev) return null;
  const b = (ok, cond) => (ok ? !!cond : null);
  const roaC = rxPct(cur.t.ni, cur.ta), roaP = rxPct(prev.t.ni, prev.ta);
  const levC = rxPct(cur.debt, cur.ta), levP = rxPct(prev.debt, prev.ta);
  const items = [
    ['獲利為正（ROA > 0）', b(isNum(cur.t.ni), cur.t.ni > 0)],
    ['營業現金流為正', b(isNum(cur.t.ocf), cur.t.ocf > 0)],
    ['ROA 較去年提高', b(isNum(roaC) && isNum(roaP), roaC > roaP)],
    ['營業現金流 > 淨利（獲利品質）', b(isNum(cur.t.ocf) && isNum(cur.t.ni), cur.t.ocf > cur.t.ni)],
    ['負債／資產比下降', b(isNum(levC) && isNum(levP), levC <= levP)],
    ['流動比率提高', b(isNum(cur.curR) && isNum(prev.curR), cur.curR > prev.curR)],
    ['沒有增發股票', b(isNum(cur.sh) && isNum(prev.sh), cur.sh <= prev.sh * 1.005)],
    ['毛利率提高', b(isNum(cur.gm) && isNum(prev.gm), cur.gm > prev.gm)],
    ['資產週轉率提高', b(isNum(cur.turn) && isNum(prev.turn), cur.turn > prev.turn)],
  ];
  const valid = items.filter(x => x[1] !== null);
  return { items, score: valid.filter(x => x[1]).length, of: valid.length };
}

/** Altman Z-Score（上市製造業模型） */
function rsxZScore(cur, mcap) {
  const { ta, tl, ca, cl, re } = cur;
  if (![ta, tl, ca, cl, re, cur.t.op, cur.t.rev, mcap].every(isNum) || !ta || !tl) return null;
  const z = 1.2 * ((ca - cl) / ta) + 1.4 * (re / ta) + 3.3 * (cur.t.op / ta) + 0.6 * (mcap / tl) + 1.0 * (cur.t.rev / ta);
  return { z, zone: z > 2.99 ? ['安全區', 'bull'] : z >= 1.81 ? ['灰色區', 'warn'] : ['危險區', 'bear'] };
}

function rsxFin() {
  const X = research.x.fin, d = research.data, isTW = d.mkt === 'TW', C = research.calc, cur = X.cur || d.currency || '';
  const q = (X.q || []).filter(r => r.p);
  const nq = q.length;
  // 最新一期比率：台股用季資料近四季；美股季資料只有 5 季，比率用近四季、年度比較用年報
  const now = nq >= 4 ? rsxFinRatios(q, nq - 1) : X.a && X.a.length ? rsxAnnRatios(X.a, X.a.length - 1) : null;
  if (!now) return rxMsg('財務體質', 12, '財報資料不足', 'muted');
  let prev = null;
  if (isTW && nq >= 8) prev = rsxFinRatios(q, nq - 5);
  else if (!isTW && X.a && X.a.length >= 2) prev = rsxAnnRatios(X.a, X.a.length - 2);
  const curY = !isTW && X.a && X.a.length >= 2 ? rsxAnnRatios(X.a, X.a.length - 1) : now;
  const F = rsxFScore(curY, prev);
  const mcap = isTW ? (d.shares ? d.shares * C.last : (now.sh ? now.sh * C.last : null)) : d.stats && d.stats.mcap;
  const fin = /金融|銀行|保險|證券/.test(d.industry || '') || /Bank|Insurance|Financial/i.test(d.industry || '');
  const Z = fin ? null : rsxZScore(now, mcap);
  if (F) C.verdict.health = V(F.score >= 7 ? '體質穩健' : F.score <= 3 ? '體質偏弱' : '體質普通', F.score >= 7 ? 'bull' : F.score <= 3 ? 'bear' : 'neutral',
    [`F-Score ${F.score}／${F.of}`, Z && `Z-Score ${numTxt(Z.z, 2)}（${Z.zone[0]}）`, isNum(now.roe) && `ROE ${numTxt(now.roe, 1)}%`, isNum(now.debtR) && `負債比 ${numTxt(now.debtR, 1)}%`],
    'Piotroski F-Score 9 項（獲利、現金流、槓桿、效率）：≥7 穩健、≤3 偏弱；Altman Z-Score >2.99 安全、<1.81 有財務壓力（不適用金融業）。');
  const per = isTW ? '近四季' : 'TTM';
  // 1. 資產負債與現金流
  const rows = q.slice(-8).reverse().map(r => {
    const R = q.indexOf(r) >= 3 ? rsxFinRatios(q, q.indexOf(r)) : null;
    return `<tr><td class="nm">${qLabel(r.p)}</td><td class="num">${fmtBig(r.rev, cur)}</td><td class="num">${fmtBig(r.ni, cur)}</td><td class="num">${fmtBig(r.ocf, cur)}</td>
      <td class="num">${fmtBig(r.capex, cur)}</td><td class="num strong ${dirCls(r.fcf)}">${fmtBig(r.fcf, cur)}</td><td class="num">${numTxt(rxPct(r.tl, r.ta), 1)}%</td>
      <td class="num">${numTxt(r.ca && r.cl ? r.ca / r.cl : null, 2)}</td><td class="num">${R ? numTxt(R.roe, 1) + '%' : '—'}</td></tr>`;
  }).join('');
  const fcfQ = q.slice(-12);
  let h = rsPanel('xbal', '資產負債與現金流', 12, 'health', `
    <div class="kpis">
      ${rxKpi('負債比', numTxt(now.debtR, 1) + '%', '負債 ÷ 資產')}
      ${rxKpi('流動比／速動比', `${numTxt(now.curR, 2)}／${numTxt(now.quick, 2)}`, '>1.5／>1 較安全')}
      ${rxKpi('現金及約當現金', fmtBig(now.cash, cur), isNum(now.debt) ? '有息負債 ' + fmtBig(now.debt, cur) : '')}
      ${rxKpi(`自由現金流（${per}）`, fmtBig(now.t.fcf, cur), `營業現金流 ${fmtBig(now.t.ocf, cur)}`, dirCls(now.t.fcf))}
      ${rxKpi('現金流／淨利', numTxt(now.ocfNi, 2) + ' 倍', '>1 代表獲利有現金支撐')}
      ${rxKpi(`ROE（${per}）`, numTxt(now.roe, 1) + '%', `ROA ${numTxt(now.roa, 1)}%`)}
    </div>
    ${fcfQ.length > 2 ? `<div class="bars-wrap">${barsSvg(fcfQ.map(r => rxDiv(r.fcf, cur)), fcfQ.map(r => qLabel(r.p)), `單季自由現金流（${rxUnit(cur)}）`, fcfQ.map(r => rxDiv(r.ocf, cur)), '營業現金流')}</div>` : ''}
    ${rows ? `<div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>季度</th><th class="num">營收</th><th class="num">淨利</th><th class="num">營業現金流</th><th class="num">資本支出</th><th class="num">自由現金流</th><th class="num">負債比</th><th class="num">流動比</th><th class="num">ROE(TTM)</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : ''}
    ${vNote(C.verdict.health)}
    <div class="foot-note">來源：${esc(X.src || '')}。自由現金流 = 營業現金流 − 資本支出；${isTW ? '台股現金流量表為當年累計，已換算成單季。' : ''}ROE 以近四季淨利 ÷ 平均股東權益計算。</div>`);
  // 2. 杜邦分析與經營效率
  const pts = [];
  if (isTW) for (let i = nq - 1; i >= 3 && pts.length < 5; i -= 4) pts.push(rsxFinRatios(q, i));
  else (X.a || []).slice().reverse().forEach((r, k, arr) => { if (pts.length < 5) pts.push(rsxAnnRatios(X.a, X.a.length - 1 - k)); });
  h += rsPanel('xdupont', '杜邦分析與經營效率', 6, null, `
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>${isTW ? '期間（近四季）' : '年度'}</th><th class="num">ROE</th><th class="num">淨利率</th><th class="num">資產週轉</th><th class="num">權益乘數</th></tr></thead>
      <tbody>${pts.map(r => `<tr><td class="nm">${isTW ? qLabel(r.p) : r.p.slice(0, 4)}</td><td class="num strong">${numTxt(r.roe, 1)}%</td><td class="num">${numTxt(r.nm, 1)}%</td><td class="num">${numTxt(r.turn, 2)}</td><td class="num">${numTxt(r.lev, 2)}</td></tr>`).join('')}</tbody></table></div>
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>經營效率</th><th class="num">${pts[0] ? (isTW ? qLabel(pts[0].p) : pts[0].p.slice(0, 4)) : ''}</th><th class="num">${pts[1] ? (isTW ? qLabel(pts[1].p) : pts[1].p.slice(0, 4)) : ''}</th><th>說明</th></tr></thead>
      <tbody>
        <tr><td class="nm">存貨週轉天數</td><td class="num">${numTxt(pts[0] && pts[0].invDays, 0)}</td><td class="num">${numTxt(pts[1] && pts[1].invDays, 0)}</td><td class="muted">越短代表存貨賣得越快</td></tr>
        <tr><td class="nm">應收帳款天數</td><td class="num">${numTxt(pts[0] && pts[0].arDays, 0)}</td><td class="num">${numTxt(pts[1] && pts[1].arDays, 0)}</td><td class="muted">越短代表收款越快</td></tr>
        <tr><td class="nm">毛利率</td><td class="num">${numTxt(pts[0] && pts[0].gm, 1)}%</td><td class="num">${numTxt(pts[1] && pts[1].gm, 1)}%</td><td class="muted">${isTW ? '近四季' : '全年'}</td></tr>
      </tbody></table></div>
    <div class="foot-note">杜邦分析：ROE = 淨利率 × 資產週轉率 × 權益乘數，看出報酬率來自獲利能力、經營效率還是財務槓桿。</div>`);
  // 3. 財務健康評分
  h += rsPanel('xscore', '財務健康評分', 6, null, `
    <div class="kpis">
      ${rxKpi('Piotroski F-Score', F ? `${F.score}<small>／${F.of}</small>` : '—', F ? (F.score >= 7 ? '體質穩健' : F.score <= 3 ? '體質偏弱' : '體質普通') : '資料不足')}
      ${rxKpi('Altman Z-Score', Z ? numTxt(Z.z, 2) : '—', Z ? Z.zone[0] : fin ? '不適用金融業' : '資料不足', Z ? (Z.zone[1] === 'bear' ? 'down' : Z.zone[1] === 'bull' ? 'up' : '') : '')}
    </div>
    ${F ? `<ul class="fscore">${F.items.map(([t, ok]) => `<li class="${ok === null ? 'na' : ok ? 'ok' : 'no'}"><span>${ok === null ? '—' : ok ? '✓' : '✗'}</span>${t}</li>`).join('')}</ul>` : ''}
    <div class="foot-note">${isTW ? '比較近四季與一年前的近四季' : '比較最近兩個會計年度'}。F-Score 每項 1 分，≥7 穩健、≤3 偏弱；Z-Score = 1.2×營運資金/資產 + 1.4×保留盈餘/資產 + 3.3×營業利益/資產 + 0.6×市值/負債 + 1.0×營收/資產，&gt;2.99 安全、1.81–2.99 灰色、&lt;1.81 有財務壓力。</div>`);
  // 4. 美股：10 年財報（SEC）＋股東回饋
  if (!isTW) {
    const S = X.sec;
    if (S && S.rows && S.rows.length) {
      const R = S.rows, scur = S.cur || 'USD';
      const cagr = k => { const a = R.filter(r => isNum(r[k]) && r[k] > 0); return a.length >= 3 ? (Math.pow(a[a.length - 1][k] / a[0][k], 1 / (a[a.length - 1].y - a[0].y)) - 1) * 100 : null; };
      h += rsPanel('xsec', `長期財報（近 ${R.length} 年，SEC）`, 12, null, `
        <div class="kpis">
          ${rxKpi('營收年複合成長', signTxt(cagr('rev'), 1, '%'), `${R[0].y}–${R[R.length - 1].y}`)}
          ${rxKpi('淨利年複合成長', signTxt(cagr('ni'), 1, '%'), '')}
          ${rxKpi('平均淨利率', numTxt(rxAvg(R.map(r => rxPct(r.ni, r.rev))), 1) + '%', `最近一年 ${numTxt(rxPct(R[R.length - 1].ni, R[R.length - 1].rev), 1)}%`)}
          ${rxKpi('平均 ROE', numTxt(rxAvg(R.map(r => rxPct(r.ni, r.eq))), 1) + '%', '')}
        </div>
        <div class="bars-wrap">${barsSvg(R.map(r => rxDiv(r.rev, scur)), R.map(r => String(r.y)), `年營收（${rxUnit(scur)}）`, R.map((r, i) => (i && R[i - 1].rev ? (r.rev / R[i - 1].rev - 1) * 100 : null)))}</div>
        <div class="tbl-wrap"><table class="mtbl">
          <thead><tr><th>年度</th><th class="num">營收</th><th class="num">年增</th><th class="num">毛利率</th><th class="num">營益率</th><th class="num">淨利</th><th class="num">淨利率</th><th class="num">營業現金流</th><th class="num">自由現金流</th><th class="num">ROE</th><th class="num">股利＋買回</th></tr></thead>
          <tbody>${R.slice().reverse().map((r, k, arr) => {
            const p = arr[k + 1];
            const fcf = isNum(r.ocf) && isNum(r.capex) ? r.ocf + r.capex : null, sr = (r.div || 0) + (r.buyback || 0);
            return `<tr><td class="nm">${r.y}</td><td class="num">${fmtBig(r.rev, scur)}</td><td class="num ${dirCls(p && p.rev ? r.rev / p.rev - 1 : null)}">${p && p.rev ? signTxt((r.rev / p.rev - 1) * 100, 1, '%') : '—'}</td>
              <td class="num">${isNum(r.gp) ? numTxt(rxPct(r.gp, r.rev), 1) + '%' : '—'}</td><td class="num">${isNum(r.op) ? numTxt(rxPct(r.op, r.rev), 1) + '%' : '—'}</td>
              <td class="num ${dirCls(r.ni)}">${fmtBig(r.ni, scur)}</td><td class="num">${numTxt(rxPct(r.ni, r.rev), 1)}%</td><td class="num">${fmtBig(r.ocf, scur)}</td>
              <td class="num ${dirCls(fcf)}">${fmtBig(fcf, scur)}</td><td class="num">${isNum(r.eq) ? numTxt(rxPct(r.ni, r.eq), 1) + '%' : '—'}</td><td class="num">${sr ? fmtBig(-sr, scur) : '—'}</td></tr>`;
          }).join('')}</tbody></table></div>
        <div class="foot-note">來源：美國證管會 SEC 結構化財報（${esc(S.name)}${S.ifrs ? '，國際會計準則 IFRS' : ''}，幣別 ${esc(scur)}）。年度依 SEC 的曆年對齊（會計年度不在 12 月結束的公司會有數月落差）；EPS 因原始申報值未依股票分割調整，這裡不列。</div>`);
    } else if (X.secErr) h += rxMsg('長期財報（SEC）', 12, '長期財報暫時無法取得：' + esc(X.secErr), 'muted');
    // 股東回饋
    const A = X.a || [];
    if (A.length) {
      const L = rsxAnnRatios(A, A.length - 1), sh0 = A[0].sh, sh1 = A[A.length - 1].sh;
      const back = -(L.t.buyback || 0), div = -(L.t.div || 0), mc = d.stats && d.stats.mcap;
      h += rsPanel('xcap', '股東回饋與股本', 12, null, `
        <div class="kpis">
          ${rxKpi('庫藏股買回（最近年度）', fmtBig(back || null, cur), mc && back ? '占市值 ' + numTxt((back / mc) * 100, 2) + '%' : '')}
          ${rxKpi('現金股利（最近年度）', fmtBig(div || null, cur), mc && div ? '占市值 ' + numTxt((div / mc) * 100, 2) + '%' : '')}
          ${rxKpi('股東回饋率', mc ? numTxt(((back + div) / mc) * 100, 2) + '%' : '—', '（買回＋股利）÷ 市值')}
          ${rxKpi('流通股數變化', isNum(sh0) && isNum(sh1) ? signTxt((sh1 / sh0 - 1) * 100, 1, '%') : '—', `${A[0].p.slice(0, 4)}→${A[A.length - 1].p.slice(0, 4)}，負值代表股數減少`)}
        </div>
        <div class="tbl-wrap"><table class="mtbl">
          <thead><tr><th>年度</th><th class="num">流通股數</th><th class="num">買回</th><th class="num">股利</th></tr></thead>
          <tbody>${A.slice().reverse().map(r => `<tr><td class="nm">${r.p.slice(0, 4)}</td><td class="num">${isNum(r.sh) ? numTxt(r.sh / 1e6, 0) + 'M' : '—'}</td><td class="num">${fmtBig(isNum(r.buyback) ? -r.buyback : null, cur)}</td><td class="num">${fmtBig(isNum(r.div) ? -r.div : null, cur)}</td></tr>`).join('')}</tbody></table></div>
        <div class="foot-note">庫藏股買回會減少流通股數、提高每股盈餘；股數持續增加則代表股權被稀釋（例如員工認股）。</div>`);
    }
  }
  return h;
}

/* =========================================================
 * 三、美股：分析師預估、財報驚喜
 * ========================================================= */
function rsxEst() {
  const E = research.x.est, d = research.data, C = research.calc, P = d.price;
  const fr = r => `<tr><td class="nm">${esc(r.p)}</td><td class="num strong">${numTxt(r.avg, 2)}</td><td class="num">${numTxt(r.lo, 2)}–${numTxt(r.hi, 2)}</td><td class="num">${numTxt(r.n, 0)}</td>
    <td class="num"><span class="up">${r.up ? '▲' + r.up : ''}</span> <span class="down">${r.dn ? '▼' + r.dn : ''}</span>${!r.up && !r.dn ? '—' : ''}</td></tr>`;
  const y = E.yf || [];
  const g = y.length >= 2 && y[0].avg ? (y[1].avg / y[0].avg - 1) * 100 : null;
  let h = rsPanel('xest', '分析師 EPS 預估', 6, null, `
    <div class="kpis">
      ${rxKpi(`本年度預估 EPS（${esc((y[0] || {}).p || '')}）`, numTxt(y[0] && y[0].avg, 2), y[0] ? `${numTxt(y[0].n, 0)} 位分析師` : '')}
      ${rxKpi('預估本益比', y[0] && y[0].avg > 0 ? numTxt(C.last / y[0].avg, 1) : '—', '現價 ÷ 本年度預估 EPS')}
      ${rxKpi('下一年度 EPS 成長', signTxt(g, 1, '%'), y[1] ? `${esc(y[1].p)} 預估 ${numTxt(y[1].avg, 2)}` : '')}
    </div>
    <div class="sub-h">季度預估</div>
    <div class="tbl-wrap"><table class="mtbl"><thead><tr><th>季度</th><th class="num">平均</th><th class="num">區間</th><th class="num">家數</th><th class="num">近 4 週調整</th></tr></thead><tbody>${(E.qf || []).map(fr).join('')}</tbody></table></div>
    <div class="sub-h">年度預估</div>
    <div class="tbl-wrap"><table class="mtbl"><thead><tr><th>會計年度</th><th class="num">平均</th><th class="num">區間</th><th class="num">家數</th><th class="num">近 4 週調整</th></tr></thead><tbody>${y.map(fr).join('')}</tbody></table></div>
    <div class="foot-note">來源 Nasdaq（Zacks 彙整的分析師共識）。▲／▼ 為近 4 週上修／下修的分析師人數，持續上修通常是正面訊號。</div>`);
  // 財報驚喜與股價反應（財報日前一天收盤到後一天收盤，涵蓋盤前或盤後公布）
  const idx = ds => P.t.findIndex(t => t >= ds);
  const S = (E.surprise || []).map(r => {
    const k = r.d ? idx(r.d) : -1;
    const rx = k > 0 && k + 1 < P.c.length ? (P.c[k + 1] / P.c[k - 1] - 1) * 100 : null;
    return Object.assign({}, r, { rx });
  });
  const beats = S.filter(r => isNum(r.sp) && r.sp > 0).length;
  const avgAbs = rxAvg(S.map(r => (isNum(r.rx) ? Math.abs(r.rx) : null)));
  h += rsPanel('xsurp', '財報驚喜與股價反應', 12, null, `
    <div class="kpis">
      ${rxKpi('優於預期', `${beats}／${S.length} 季`, '實際 EPS 高於分析師共識')}
      ${rxKpi('平均驚喜幅度', signTxt(rxAvg(S.map(r => r.sp)), 1, '%'), '')}
      ${rxKpi('財報前後平均波動', isNum(avgAbs) ? '±' + numTxt(avgAbs, 1) + '%' : '—', '財報日前一天 → 後一天')}
    </div>
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>季度</th><th>公布日</th><th class="num">實際 EPS</th><th class="num">預估</th><th class="num">驚喜</th><th class="num">股價反應</th></tr></thead>
      <tbody>${S.map(r => `<tr><td class="nm">${esc(r.p)}</td><td>${esc(r.d)}</td><td class="num strong">${numTxt(r.eps, 2)}</td><td class="num">${numTxt(r.est, 2)}</td>
        <td class="num ${dirCls(r.sp)}">${signTxt(r.sp, 1, '%')}</td><td class="num strong ${dirCls(r.rx)}">${signTxt(r.rx, 1, '%')}</td></tr>`).join('')}</tbody></table></div>
    <div class="foot-note">股價反應 = 財報公布日前一個交易日收盤到隔一個交易日收盤的漲跌（不論盤前或盤後公布都涵蓋）。財報前後平均波動可用來估計下次財報可能的震幅。</div>`);
  return h;
}

/* =========================================================
 * 四、台股：股權分散、借券與當沖、ETF 持有
 * ========================================================= */
const TDCC_GRP = [[[1], '1 張以下'], [[2], '1–5 張'], [[3], '5–10 張'], [[4, 5, 6, 7, 8], '10–50 張'], [[9], '50–100 張'], [[10], '100–200 張'], [[11], '200–400 張'], [[12, 13, 14], '400–1000 張'], [[15], '1000 張以上']];

function rsxChips() {
  const X = research.x.chips, d = research.data, P = d.price;
  let h = '';
  // 1. 集保股權分散
  const W = X.tdcc || [];
  if (W.length) {
    const pct = (w, lv) => w.lv.filter(x => lv.includes(x[0])).reduce((s, x) => s + x[3], 0);
    const ppl = (w, lv) => w.lv.filter(x => lv.includes(x[0])).reduce((s, x) => s + x[1], 0);
    const all = Array.from({ length: 15 }, (_, i) => i + 1);
    const L = W[W.length - 1], P1 = W[W.length - 2] || null, P0 = W[0];
    const big = w => pct(w, [15]), big400 = w => pct(w, [12, 13, 14, 15]), small = w => pct(w, [1, 2, 3]), holders = w => ppl(w, all);
    const chg = (f, a, b) => (a && b ? f(a) - f(b) : null);
    const tone = chg(big, L, P0);
    h += rsPanel('xtdcc', '集保股權分散（大戶與散戶）', 6, null, `
      <div class="kpis">
        ${rxKpi('千張大戶持股', numTxt(big(L), 2) + '%', `週 ${signTxt(chg(big, L, P1), 2)}・${W.length} 週 ${signTxt(tone, 2)} 個百分點`, dirCls(tone))}
        ${rxKpi('400 張以上', numTxt(big400(L), 2) + '%', `週 ${signTxt(chg(big400, L, P1), 2)}`)}
        ${rxKpi('10 張以下散戶', numTxt(small(L), 2) + '%', `週 ${signTxt(chg(small, L, P1), 2)}`)}
        ${rxKpi('股東人數', numTxt(holders(L), 0), `週 ${signTxt(chg(holders, L, P1), 0)} 人`)}
      </div>
      <div class="chart-legend"><span style="--c:#c0392b">千張大戶持股 %（左軸）</span><span style="--c:#1f4e8c">股東人數（右軸）</span></div>
      <div class="mini-chart short" id="rsxTdcc"></div>
      <div class="tbl-wrap"><table class="mtbl sm">
        <thead><tr><th>持股級距</th><th class="num">人數</th><th class="num">持股比例</th><th class="num">較 ${W.length} 週前</th></tr></thead>
        <tbody>${TDCC_GRP.map(([lv, name]) => `<tr><td class="nm">${name}</td><td class="num">${numTxt(ppl(L, lv), 0)}</td><td class="num strong">${numTxt(pct(L, lv), 2)}%</td>
          <td class="num ${dirCls(pct(L, lv) - pct(P0, lv))}">${signTxt(pct(L, lv) - pct(P0, lv), 2)}</td></tr>`).join('')}</tbody></table></div>
      <div class="foot-note">來源：集保結算所，每週最後一個交易日的持股分布（資料日 ${esc(L.d)}）。千張大戶比例上升、散戶與股東人數下降，常被視為籌碼集中；反之為籌碼分散。</div>`);
  } else h += rxMsg('集保股權分散', 6, '集保資料暫時無法取得' + (X.tdccErr ? '：' + esc(X.tdccErr) : ''), 'muted');
  // 2. 借券與當沖
  const S = X.sbl || [], DT = X.dt || [];
  const volBy = new Map(P.t.map((t, i) => [t, (P.v[i] || 0) / 1000]));
  const dtR = DT.map(x => ({ d: x.d, v: x.v, r: volBy.get(x.d) ? (x.v / volBy.get(x.d)) * 100 : null }));
  const lastS = S[S.length - 1], s20 = S.length > 20 ? S[S.length - 21] : null;
  const lastDt = dtR[dtR.length - 1], avg20 = rxAvg(dtR.slice(-20).map(x => x.r));
  const dtBy = new Map(dtR.map(x => [x.d, x]));
  h += rsPanel('xsbl', '借券賣出與當沖', 6, null, `
    <div class="kpis">
      ${rxKpi('借券賣出餘額', lastS ? numTxt(lastS.sb, 0) + '<small> 張</small>' : '—', s20 ? `20 日 ${signTxt(lastS.sb - s20.sb, 0)} 張` : '', s20 ? dirCls(-(lastS.sb - s20.sb)) : '')}
      ${rxKpi('今日借券賣出', lastS ? numTxt(lastS.ss, 0) + '<small> 張</small>' : '—', lastS ? `還券 ${numTxt(lastS.sr, 0)} 張` : '')}
      ${rxKpi('融券餘額', lastS ? numTxt(lastS.mb, 0) + '<small> 張</small>' : '—', '')}
      ${rxKpi('當沖比例', lastDt && isNum(lastDt.r) ? numTxt(lastDt.r, 1) + '%' : '—', `20 日平均 ${numTxt(avg20, 1)}%`)}
    </div>
    ${S.length > 10 ? '<div class="chart-legend"><span style="--c:#8e44ad">借券賣出餘額（張，左軸）</span><span style="--c:#7f8c8d">股價（右軸）</span></div><div class="mini-chart short" id="rsxSbl"></div>' : ''}
    <div class="tbl-wrap"><table class="mtbl sm">
      <thead><tr><th>日期</th><th class="num">借券賣出</th><th class="num">借券餘額</th><th class="num">融券餘額</th><th class="num">當沖張數</th><th class="num">當沖比</th></tr></thead>
      <tbody>${S.slice(-10).reverse().map(x => { const t = dtBy.get(x.d); return `<tr><td class="nm">${mdTxt(x.d)}</td><td class="num">${numTxt(x.ss, 0)}</td><td class="num strong">${numTxt(x.sb, 0)}</td><td class="num">${numTxt(x.mb, 0)}</td>
        <td class="num">${t ? numTxt(t.v, 0) : '—'}</td><td class="num">${t && isNum(t.r) ? numTxt(t.r, 1) + '%' : '—'}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="foot-note">借券賣出多為法人放空或避險，餘額持續增加代表空方力道累積（日後回補也可能推升股價）；當沖比例過高（例如 &gt;40%）代表短線投機成分重，股價波動通常較大。來源 FinMind（證交所、櫃買中心）。</div>`);
  // 3. ETF 持有
  const E = X.etfs;
  h += rsPanel('xetf', '哪些 ETF 持有', 6, null, E && E.length ? `
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>ETF</th><th class="num">權重</th><th class="num">持有張數</th><th class="num">較前次</th><th>資料日</th></tr></thead>
      <tbody>${E.map(x => { const c = isNum(x.prev) ? (x.sh - x.prev) / 1000 : null; return `<tr><td class="nm">${esc(x.etf)} <span class="muted">${esc(x.name)}</span></td><td class="num strong">${numTxt(x.w, 2)}%</td>
        <td class="num">${numTxt(x.sh / 1000, 0)}</td><td class="num ${dirCls(c)}">${isNum(c) ? signTxt(c, 0) : '—'}</td><td>${mdTxt(x.d)}</td></tr>`; }).join('')}</tbody></table></div>
    <div class="foot-note">只涵蓋 ETF 專區追蹤中的 ETF（每天記錄完整持股；0050、0056、00878、00919、00929、006208 與最近查過的 ETF）。「較前次」為與上一筆快照相比的張數增減。</div>`
    : `<div class="panel-msg muted">${E ? '追蹤中的 ETF 都沒有持有這檔股票' : 'ETF 持股快照暫時無法讀取'}</div><div class="foot-note">只涵蓋 ETF 專區追蹤中的 ETF；在 ETF 專區查詢過的 ETF 會自動加入追蹤。</div>`);
  return h;
}

/* =========================================================
 * 五、美股：內部人、機構、選擇權
 * ========================================================= */
const INSIDER_ZH = {
  'Automatic Sell': '自動賣出（10b5-1）', Sell: '賣出', Buy: '買進', 'Automatic Buy': '自動買進', 'Option Execute': '執行認股權', Gift: '贈與', Disposition: '處分', Acquisition: '取得', 'Sell Back': '回售',
  'Disposition (Non Open Market)': '非公開市場處分', 'Acquisition (Non Open Market)': '非公開市場取得', 'Buy (Non Open Market)': '非公開市場買進', 'Sell (Non Open Market)': '非公開市場賣出',
};
const POS_ZH = { 'Increased Positions': '加碼', 'Decreased Positions': '減碼', 'Held Positions': '持平', 'Total Institutional Shares': '合計', 'New Positions': '新建倉', 'Sold Out Positions': '全數出清' };

function rsxOwn() {
  const X = research.x.own, cur = research.data.currency || 'USD';
  const sum = k => X.insiderSum.find(x => x.k === k) || {};
  const b3 = sum('Number of Open Market Buys').m3, s3 = sum('Number of Sells').m3, b12 = sum('Number of Open Market Buys').m12, s12 = sum('Number of Sells').m12;
  const sb12 = sum('Number of Shares Bought').m12, ss12 = sum('Number of Shares Sold').m12;
  let h = rsPanel('xinsider', '內部人交易', 6, null, `
    <div class="kpis">
      ${rxKpi('近 3 個月', `買 ${numTxt(b3, 0)}／賣 ${numTxt(s3, 0)} 筆`, '')}
      ${rxKpi('近 12 個月', `買 ${numTxt(b12, 0)}／賣 ${numTxt(s12, 0)} 筆`, isNum(sb12) && isNum(ss12) ? `淨 ${signTxt((sb12 - ss12) / 1e6, 2)}M 股` : '')}
    </div>
    <div class="tbl-wrap"><table class="mtbl sm">
      <thead><tr><th>日期</th><th>內部人</th><th>職務</th><th>類型</th><th class="num">股數</th><th class="num">價格</th></tr></thead>
      <tbody>${(X.insiders || []).slice(0, 12).map(x => `<tr><td class="nm">${esc(x.d)}</td><td>${esc(x.who)}</td><td class="muted">${esc(x.rel)}</td>
        <td class="${/Buy/.test(x.type) ? 'up' : /Sell/.test(x.type) ? 'down' : ''}">${esc(INSIDER_ZH[x.type] || x.type)}</td><td class="num">${numTxt(x.sh, 0)}</td><td class="num">${x.px ? numTxt(x.px, 2) : '—'}</td></tr>`).join('')}</tbody></table></div>
    <div class="foot-note">來源 Nasdaq（SEC Form 4）。高層賣股常是預先排定的計畫（10b5-1）或稅務需求，參考價值低；<b>公開市場自掏腰包買進</b>較有參考意義。</div>`);
  h += rsPanel('xinst', '機構持股', 6, null, `
    <div class="kpis">
      ${rxKpi('機構持股比例', isNum(X.instPct) ? numTxt(X.instPct, 2) + '%' : '—', '')}
      ${rxKpi('機構持股市值', isNum(X.instVal) ? fmtBig(X.instVal * 1e6, cur) : '—', '')}
      ${X.active.filter(a => /Increased|Decreased|New|Sold/.test(a.k)).map(a => rxKpi(POS_ZH[a.k] || a.k, numTxt(a.holders, 0) + ' 家', isNum(a.sh) ? numTxt(a.sh / 1e6, 1) + 'M 股' : '')).join('')}
    </div>
    <div class="tbl-wrap"><table class="mtbl sm">
      <thead><tr><th>前十大機構</th><th class="num">持股</th><th class="num">變動</th><th class="num">市值</th><th>申報日</th></tr></thead>
      <tbody>${(X.holders || []).map(x => `<tr><td class="nm">${esc(x.who)}</td><td class="num">${numTxt(x.sh / 1e6, 1)}M</td><td class="num ${dirCls(x.chgPct)}">${signTxt(x.chgPct, 2, '%')}</td>
        <td class="num">${isNum(x.val) ? fmtBig(x.val * 1e3, cur) : '—'}</td><td class="muted">${esc(x.d)}</td></tr>`).join('')}</tbody></table></div>
    <div class="foot-note">來源 Nasdaq（SEC 13F，每季申報，最多落後 45 天）。加碼家數多於減碼、新建倉多於出清，代表機構資金持續流入。</div>`);
  const O = X.opt;
  if (O) {
    const pcOi = O.callOI ? O.putOI / O.callOI : null, pcV = O.callVol ? O.putVol / O.callVol : null;
    h += rsPanel('xopt', `選擇權（${O.exp} 到期）`, 12, null, `
      <div class="kpis">
        ${rxKpi('Put/Call 比（未平倉）', numTxt(pcOi, 2), pcOi > 1.2 ? '避險／看空部位多' : pcOi < 0.7 ? '看多部位多' : '中性')}
        ${rxKpi('Put/Call 比（成交量）', numTxt(pcV, 2), '當日')}
        ${rxKpi('最大買權未平倉', numTxt(O.maxCall.k, 2), `${numTxt(O.maxCall.oi, 0)} 口・上檔壓力`)}
        ${rxKpi('最大賣權未平倉', numTxt(O.maxPut.k, 2), `${numTxt(O.maxPut.oi, 0)} 口・下檔支撐`)}
        ${rxKpi('最大痛點', numTxt(O.pain, 2), isNum(O.px) ? `距現價 ${signTxt((O.pain / O.px - 1) * 100, 1, '%')}` : '')}
      </div>
      ${typeof optDistSvg === 'function' ? optDistSvg({ strikes: O.strikes, maxCall: O.maxCall, maxPut: O.maxPut, spot: O.px }) : ''}
      <div class="foot-note">來源 Nasdaq（最近一次月選擇權，現價上下 25% 的履約價）。最大痛點 = 到期時讓選擇權買方總價值最小的價格，部分交易人認為到期前股價有向它靠攏的傾向；Put/Call 比極高常被視為過度悲觀的反向訊號。</div>`);
  } else if (X.optErr) h += rxMsg('選擇權', 12, '選擇權資料暫時無法取得', 'muted');
  return h;
}

/* =========================================================
 * 六、新聞與事件、填息
 * ========================================================= */
function rsxEvents() {
  const X = research.x.events, d = research.data, isTW = d.mkt === 'TW';
  let h = rsPanel('xnews', '個股新聞', isTW ? 12 : 6, null, `
    ${(X.notes || []).map(n => `<div class="earn-alert ${n.kind === '處置股票' ? '' : 'cal-ok'}">⚠ <b>${esc(n.kind)}</b>：${esc(n.text)}</div>`).join('')}
    ${(X.news || []).length ? `<ul class="news">${X.news.slice(0, 15).map(n => `<li><a href="${esc(n.u)}" target="_blank" rel="noopener noreferrer"><span class="news-t">${esc(n.t)}</span><span class="news-m">${esc(n.s)} · ${relTime(n.ts)}</span></a></li>`).join('')}</ul>` : '<div class="panel-msg muted">近期沒有相關新聞</div>'}
    <div class="foot-note">來源：${isTW ? '鉅亨網（依股票代號搜尋）；注意／處置股票來自證交所與櫃買中心當日公告' : 'Yahoo Finance'}。</div>`);
  if (!isTW) {
    h += rsPanel('xsec8k', 'SEC 申報文件', 6, null, X.filings && X.filings.length ? `
      <div class="tbl-wrap"><table class="mtbl sm">
        <thead><tr><th>日期</th><th>文件</th><th>內容</th></tr></thead>
        <tbody>${X.filings.map(f => `<tr><td class="nm">${esc(f.d)}</td><td><a href="${esc(f.u)}" target="_blank" rel="noopener noreferrer">${esc(f.form)}</a> <span class="muted">${esc(f.zh)}</span></td><td class="muted">${esc(f.items || '')}</td></tr>`).join('')}</tbody></table></div>
      <div class="foot-note">來源 SEC EDGAR。10-K 年報、10-Q 季報、8-K 重大事件（例如「財報公布」「董事／高層異動」）；點文件代號開啟原文（英文）。</div>`
      : `<div class="panel-msg muted">${X.filingsErr ? 'SEC 資料暫時無法取得' : '非美國上市公司沒有 SEC 申報'}</div>`);
  }
  return h;
}

/** 填息紀錄（台股）：除息後股價回到除息前一天收盤價所需天數 */
function rsxDivFill() {
  const X = research.x.events, P = research.data.price;
  const rows = (X.divs || []).filter(x => x.d >= P.t[0]).slice().reverse().map(x => {
    const k = P.t.findIndex(t => t >= x.d);
    let days = null;
    if (k >= 0) for (let i = k; i < P.c.length; i++) if (P.h[i] >= x.before) { days = i - k + 1; break; }
    const now = P.c[P.c.length - 1];
    const fill = x.before > x.ref ? ((now - x.ref) / (x.before - x.ref)) * 100 : null;
    return { ...x, days, fill };
  });
  if (!rows.length) return rxMsg('填息紀錄', 6, '近 5 年沒有除權息紀錄', 'muted');
  const done = rows.filter(r => r.days != null), avg = rxAvg(done.map(r => r.days));
  return rsPanel('xfill', '填息紀錄', 6, null, `
    <div class="kpis">${rxKpi('填息成功', `${done.length}／${rows.length} 次`, '')}${rxKpi('平均填息天數', isNum(avg) ? numTxt(avg, 0) + ' 天' : '—', '交易日')}</div>
    <div class="tbl-wrap"><table class="mtbl sm">
      <thead><tr><th>除權息日</th><th class="num">配發</th><th class="num">除息前收盤</th><th class="num">參考價</th><th class="num">填息</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td class="nm">${esc(r.d)}</td><td class="num">${numTxt(r.amt, 2)} <span class="muted">${esc(r.kind || '')}</span></td><td class="num">${numTxt(r.before)}</td><td class="num">${numTxt(r.ref)}</td>
        <td class="num strong ${r.days != null ? 'up' : ''}">${r.days != null ? r.days + ' 天' : `未填息${isNum(r.fill) ? `（${numTxt(Math.max(0, r.fill), 0)}%）` : ''}`}</td></tr>`).join('')}</tbody></table></div>
    <div class="foot-note">填息 = 除權息後股價（盤中最高價）回到除權息前一天的收盤價；天數為交易日。來源 FinMind 除權息結果表。</div>`);
}

/* =========================================================
 * 七、同業比較
 * ========================================================= */
function rsxPeers() {
  const X = research.x.peers, d = research.data, isTW = d.mkt === 'TW';
  const R = X.rows || [];
  const med = k => rxMed(R.filter(r => !r.me).map(r => r[k]));
  const cell = (v, dec = 1, unit = '', cls = '') => `<td class="num ${cls}">${isNum(v) ? numTxt(v, dec) + unit : '—'}</td>`;
  const sc = (v, dec = 1) => `<td class="num ${dirCls(v)}">${signTxt(v, dec, '%')}</td>`;
  let head, body, medRow;
  if (isTW) {
    head = '<th>公司</th><th class="num">市值(億)</th><th class="num">股價</th><th class="num">本益比</th><th class="num">淨值比</th><th class="num">殖利率</th><th class="num">月營收年增</th><th class="num">累計年增</th><th class="num">1 月</th><th class="num">3 月</th><th class="num">今年</th>';
    body = R.map(r => `<tr class="${r.me ? 'mine' : ''}"><td class="nm">${r.me ? '★ ' : ''}<a href="#" data-rs="${esc(r.c)}">${esc(r.n)}</a> <span class="muted">${esc(r.c)}${r.mk === 'otc' ? '・櫃' : ''}</span></td>
      ${cell(r.cap, 0)}${cell(r.c0, 2)}${cell(r.pe, 1)}${cell(r.pb, 2)}${cell(r.y, 2, '%')}${sc(r.ry)}${sc(r.cy)}${sc(r.m1)}${sc(r.m3)}${sc(r.ytd)}</tr>`).join('');
    medRow = `<tr class="sum"><td class="nm">同業中位數</td>${cell(med('cap'), 0)}<td></td>${cell(med('pe'), 1)}${cell(med('pb'), 2)}${cell(med('y'), 2, '%')}${sc(med('ry'))}${sc(med('cy'))}${sc(med('m1'))}${sc(med('m3'))}${sc(med('ytd'))}</tr>`;
  } else {
    head = '<th>公司</th><th class="num">市值</th><th class="num">本益比</th><th class="num">預估本益比</th><th class="num">股價營收比</th><th class="num">淨值比</th><th class="num">營收年增</th><th class="num">毛利率</th><th class="num">營益率</th><th class="num">淨利率</th><th class="num">1 月</th><th class="num">今年</th>';
    body = R.map(r => `<tr class="${r.me ? 'mine' : ''}"><td class="nm">${r.me ? '★ ' : ''}<a href="#" data-rs="${esc(r.s)}">${esc(r.s)}</a> <span class="muted">${esc(String(r.n).slice(0, 26))}</span></td>
      <td class="num">${fmtBig(r.cap, 'USD')}</td>${cell(r.pe, 1)}${cell(r.fpe, 1)}${cell(r.ps, 2)}${cell(r.pb, 2)}${sc(r.ry)}${cell(r.gm, 1, '%')}${cell(r.om, 1, '%')}${cell(r.nm, 1, '%')}${sc(r.m1)}${sc(r.ytd)}</tr>`).join('');
    medRow = `<tr class="sum"><td class="nm">其他公司中位數</td><td></td>${cell(med('pe'), 1)}${cell(med('fpe'), 1)}${cell(med('ps'), 2)}${cell(med('pb'), 2)}${sc(med('ry'))}${cell(med('gm'), 1, '%')}${cell(med('om'), 1, '%')}${cell(med('nm'), 1, '%')}${sc(med('m1'))}${sc(med('ytd'))}</tr>`;
  }
  const me = R.find(r => r.me) || {};
  const notes = [];
  if (isNum(me.pe) && isNum(med('pe'))) notes.push(`本益比 ${numTxt(me.pe, 1)} 倍，${me.pe < med('pe') ? '低於' : '高於'}同業中位數 ${numTxt(med('pe'), 1)} 倍`);
  if (isNum(me.ry) && isNum(med('ry'))) notes.push(`營收年增 ${signTxt(me.ry, 1, '%')}，${me.ry > med('ry') ? '優於' : '落後'}同業中位數 ${signTxt(med('ry'), 1, '%')}`);
  if (isNum(me.ytd) && isNum(med('ytd'))) notes.push(`今年以來 ${signTxt(me.ytd, 1, '%')}，同業中位數 ${signTxt(med('ytd'), 1, '%')}`);
  const html = rsPanel('xpeers', isTW ? `同業比較（${esc(X.ind)}，市值前 ${R.length} 大）` : '同業比較（相關個股）', 12, null, `
    ${notes.length ? `<div class="sec-sum">${notes.map(t => `<span>${t}</span>`).join('')}</div>` : ''}
    <div class="tbl-wrap"><table class="mtbl"><thead><tr>${head}</tr></thead><tbody>${body}${medRow}</tbody></table></div>
    <div class="foot-note">${isTW ? `依證交所／櫃買中心產業分類（${esc(X.ind)} 共 ${X.total} 家，本股市值排名第 ${X.rank}）；本益比、淨值比、殖利率為交易所公布值，月營收為最近一期（${esc(String((R[0] || {}).ym || ''))}）。點名稱可開啟該股研究。`
      : 'Yahoo Finance「相關個股」（投資人常一起關注的股票，不一定是同產業）；估值為近四季、營收年增與利潤率為最近一季。點代號可開啟該股研究。'}</div>`);
  return html;
}

/* =========================================================
 * 載入與畫面更新
 * ========================================================= */
const RSX_RENDER = {
  fin: () => [['fin', rsxFin]], est: () => [['est', rsxEst]], chips: () => [['chips', rsxChips]], own: () => [['own', rsxOwn]],
  events: () => [['events', rsxEvents]].concat(research.data.mkt === 'TW' ? [['divfill', rsxDivFill]] : []), peers: () => [['peers', rsxPeers]],
};

function rsLoadExtras() {
  const d = research.data;
  research.x = {}; research.xerr = {};
  const parts = d.mkt === 'TW' ? RSX_PARTS.TW : RSX_PARTS.US;
  parts.forEach(p => rsxFetch(d.code, p, false));
}

function rsxFetch(code, part, force) {
  apiBg('researchx', { symbol: code, part, force }).then(r => {
    if (!research.data || research.data.code !== code) return;
    research.x[part] = r.data;
    delete research.xerr[part];
    rsxRender(part);
  }).catch(err => {
    if (!research.data || research.data.code !== code) return;
    research.xerr[part] = err.message;
    rsxRender(part);
  });
}

function rsxRender(part) {
  RSX_RENDER[part]().forEach(([box, fn]) => {
    const el = $('#rsx-' + box);
    if (!el) return;
    if (research.xerr[part]) {
      const msg = research.xerr[part];
      const soft = /非美國|沒有同業|ETF|興櫃/.test(msg);
      el.innerHTML = (RSX_WAIT[box] || [['延伸資料', 12]]).map(([t, s]) => `<section class="panel rs-panel" style="--span:${s}"><div class="panel-head"><h2 class="panel-title">${t}</h2></div>
        <div class="panel-body"><div class="panel-msg ${soft ? 'muted' : 'err'}">${soft ? esc(msg) : '暫時無法取得：' + esc(msg)}${soft ? '' : `<br><button class="btn btn-ghost btn-sm" data-rsx-retry="${part}">重試</button>`}</div></div></section>`).join('');
      const b = $('[data-rsx-retry]', el);
      if (b) b.addEventListener('click', () => { el.innerHTML = rsxBox(box).replace(/^<div[^>]*>|<\/div>$/g, ''); rsxFetch(research.data.code, part, true); });
      return;
    }
    try {
      el.innerHTML = fn();
    } catch (e) {
      console.error(e);
      el.innerHTML = rxMsg((RSX_WAIT[box] || [['延伸資料']])[0][0], 12, '顯示失敗：' + esc(e.message), 'err');
    }
    $$('[data-rs]', el).forEach(a => a.addEventListener('click', ev => { ev.preventDefault(); openResearch(a.dataset.rs); }));
  });
  rsxCharts(part);
  if (part === 'fin') rsUpdateOverview();
  if (part === 'est') { const f = $('#rs-fair'); if (f) f.outerHTML = rsxFairPanel(); } // 有預估 EPS 後更新合理價
}

/** 延伸資料的圖表 */
function rsxCharts(part) {
  const LWC = window.LightweightCharts;
  if (!LWC) return;
  const plain = { priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false };
  if (part === 'chips') {
    const X = research.x.chips, P = research.data.price;
    const el = $('#rsxTdcc');
    if (el && X.tdcc && X.tdcc.length > 1) {
      const ch = rsChart(el, { leftPriceScale: { visible: true, borderColor: '#e3e8ef' } });
      const big = w => w.lv.filter(x => x[0] === 15).reduce((s, x) => s + x[3], 0), ppl = w => w.lv.reduce((s, x) => s + x[1], 0);
      ch.addSeries(LWC.LineSeries, { ...plain, color: '#c0392b', lineWidth: 2, priceScaleId: 'left', priceFormat: { type: 'custom', formatter: v => v.toFixed(2) + '%' } }).setData(X.tdcc.map(w => ({ time: w.d, value: big(w) })));
      ch.addSeries(LWC.LineSeries, { ...plain, color: '#1f4e8c', lineWidth: 1.5, priceScaleId: 'right', priceFormat: { type: 'custom', formatter: v => Math.round(v).toLocaleString() } }).setData(X.tdcc.map(w => ({ time: w.d, value: ppl(w) })));
      ch.timeScale().fitContent();
    }
    const se = $('#rsxSbl');
    if (se && X.sbl && X.sbl.length > 10) {
      const ch = rsChart(se, { leftPriceScale: { visible: true, borderColor: '#e3e8ef' } });
      ch.addSeries(LWC.AreaSeries, { ...plain, lineColor: '#8e44ad', topColor: 'rgba(142,68,173,.25)', bottomColor: 'rgba(142,68,173,.02)', lineWidth: 2, priceScaleId: 'left' }).setData(X.sbl.map(x => ({ time: x.d, value: x.sb })));
      const pm = new Map(P.t.map((t, i) => [t, P.c[i]]));
      ch.addSeries(LWC.LineSeries, { ...plain, color: '#7f8c8d', lineWidth: 1.2, priceScaleId: 'right' }).setData(X.sbl.filter(x => pm.has(x.d)).map(x => ({ time: x.d, value: pm.get(x.d) })));
      ch.timeScale().fitContent();
    }
  }
}

/** 總覽：加入「財務體質」判斷後重畫 */
function rsUpdateOverview() {
  const el = $('#rsOverview');
  if (el) el.innerHTML = rsOverviewHtml();
}

/** 分組標題與導覽 */
const RS_GROUPS = [['price', '價格與技術'], ['fund', '基本面'], ['health', '財務體質'], ['est', '預估與分析師'], ['chips', '籌碼'], ['div', '股利'], ['news', '新聞與事件'], ['peers', '同業比較'], ['profile', '公司簡介']];
function rsGroup(key, title) { return `<div class="rs-group" id="rsg-${key}"><h3>${title}</h3></div>`; }
function rsNav(keys) {
  return `<nav class="rs-nav" style="--span:12">${RS_GROUPS.filter(g => keys.includes(g[0])).map(([k, t]) => `<button type="button" data-go="${k}">${t}</button>`).join('')}
    <button type="button" class="rs-pdf" id="rsPdf2" title="產出 A4 個股報告，可另存為 PDF">📄 PDF</button></nav>`;
}
function rsBindNav() {
  $$('.rs-nav [data-go]').forEach(b => b.addEventListener('click', () => {
    const t = $('#rsg-' + b.dataset.go);
    if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 118, behavior: 'smooth' });
  }));
}
