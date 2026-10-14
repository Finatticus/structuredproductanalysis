/* =========================================================
 * 個股研究 — 前端
 * 依賴 app.js（$, $$, api, esc, store, state, toast, sma, ema, macd, kd, fmtVol, addToWatchlist, inWatchlist）
 *      macro.js（isNum, pctTxt, signTxt, numTxt, dirCls, seg, cssVar）
 * 各區塊的多空判斷皆為統計規則，判斷依據寫在每張字卡下方，僅供參考。
 * ========================================================= */
const research = { data: null, calc: null, charts: [], range: '1y', loading: false };
const RS_RECENT_KEY = 'mw_rs_recent';

function initResearch() {
  $('#rsForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#rsInput').value.trim();
    if (v) loadResearch(v);
  });
  $('.nav-btn[data-section="research"]').addEventListener('click', renderRsChips);
}

/** 其他頁面（選股篩選器、自選清單）呼叫：切到個股研究並查詢 */
function openResearch(sym) {
  $('.nav-btn[data-section="research"]').click();
  $('#rsInput').value = sym;
  loadResearch(sym);
  window.scrollTo(0, 0);
}

function renderRsChips() {
  let recent = [];
  try { recent = JSON.parse(store.get(RS_RECENT_KEY) || '[]'); } catch { recent = []; }
  const mine = state.items.filter(i => i.category === 'tw' || i.category === 'global');
  const chip = (sym, label) => `<button type="button" class="rs-chip" data-s="${esc(sym)}">${esc(label)}</button>`;
  $('#rsChips').innerHTML =
    (recent.length ? `<span class="muted">最近：</span>${recent.map(r => chip(r.s, r.n ? `${r.n} ${r.s}` : r.s)).join('')}` : '') +
    (mine.length ? `<span class="muted">自選：</span>${mine.map(i => chip(i.symbol, i.name)).join('')}` : '');
  $$('.rs-chip', $('#rsChips')).forEach(b => b.addEventListener('click', () => { $('#rsInput').value = b.dataset.s; loadResearch(b.dataset.s); }));
}

async function loadResearch(sym) {
  if (research.loading) return;
  research.loading = true;
  const st = $('#rsStatus');
  st.className = 'status';
  st.innerHTML = '<span class="dot"></span>查詢中…（約 3–10 秒）';
  $('#rsBody').classList.add('dim');
  try {
    const r = await api('research', { symbol: sym });
    research.data = r.data;
    research.calc = rsCompute(r.data);
    renderResearch();
    let recent = [];
    try { recent = JSON.parse(store.get(RS_RECENT_KEY) || '[]'); } catch { recent = []; }
    recent = [{ s: r.data.code, n: r.data.name }].concat(recent.filter(x => x.s !== r.data.code)).slice(0, 8);
    store.set(RS_RECENT_KEY, JSON.stringify(recent));
    renderRsChips();
    const d = r.data, hm = ts => new Date(ts).toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
    if (d.stale) {
      // 後端來源失敗：整份沿用最後成功資料，或只有 Yahoo 欄位（估值、分析師…）沿用
      st.className = 'status err';
      st.innerHTML = '<span class="dot"></span>' + esc(d.filled ? `${d.stale}，部分欄位沿用 ${hm(d.filledAt)} 的資料` : `${d.stale}，顯示 ${hm(d.updated)} 的資料`);
    } else {
      st.className = 'status live';
      st.innerHTML = '<span class="dot"></span>資料時間 ' + hm(d.updated || Date.now());
    }
  } catch (err) {
    st.className = 'status err';
    st.innerHTML = '<span class="dot"></span>' + esc(err.message);
  } finally {
    research.loading = false;
    $('#rsBody').classList.remove('dim');
  }
}

/* =========================================================
 * 計算：技術指標、波動度、估值、成長、籌碼、相對強弱，以及各區塊判斷
 * ========================================================= */
function rsi(c, n = 14) {
  const out = new Array(c.length).fill(null);
  if (c.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

/** 年化歷史波動度（對數報酬標準差 × √252） */
function hv(c, n) {
  const out = new Array(c.length).fill(null);
  for (let i = n; i < c.length; i++) {
    const r = [];
    for (let j = i - n + 1; j <= i; j++) r.push(Math.log(c[j] / c[j - 1]));
    const m = r.reduce((a, b) => a + b, 0) / n;
    out[i] = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) * Math.sqrt(252) * 100;
  }
  return out;
}

/** v 在 arr 中的百分位（0–100） */
function pctRank(arr, v) {
  const a = arr.filter(isNum);
  if (!a.length || !isNum(v)) return null;
  return (a.filter(x => x <= v).length / a.length) * 100;
}

function quantile(arr, q) {
  const a = arr.filter(isNum).sort((x, y) => x - y);
  if (!a.length) return null;
  const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

const V = (label, tone, reasons, basis) => ({ label, tone, reasons: reasons.filter(Boolean), basis });

function rsCompute(d) {
  const P = d.price, n = P.c.length, c = P.c;
  const bars = P.t.map((t, i) => ({ time: t, open: P.o[i], high: P.h[i], low: P.l[i], close: c[i], volume: P.v[i] || 0 }));
  const last = c[n - 1], prev = c[n - 2];
  const ma = {};
  [5, 20, 60, 120, 240].forEach(k => { ma[k] = sma(c, k); });
  const at = (arr, i = n - 1) => (i >= 0 ? arr[i] : null);
  const out = { bars, last, prev, chg: prev ? (last / prev - 1) * 100 : null, ma, verdict: {} };
  const y1 = c.slice(-250), h1 = P.h.slice(-250), l1 = P.l.slice(-250);
  out.hi52 = Math.max(...h1); out.lo52 = Math.min(...l1);

  // ---- 1. 趨勢 ----
  {
    const m20 = at(ma[20]), m60 = at(ma[60]), mLong = at(ma[240]) || at(ma[120]), m60p = at(ma[60], n - 21);
    let s = 0;
    const r = [];
    if (isNum(m20)) { s += last > m20 ? 1 : -1; r.push(`股價${last > m20 ? '在' : '跌破'} 20 日線（${numTxt(m20)}）${last > m20 ? '之上' : ''}`); }
    if (isNum(m60)) { s += last > m60 ? 1 : -1; r.push(`股價${last > m60 ? '站上' : '跌破'}季線（${numTxt(m60)}）`); }
    if (isNum(mLong)) { s += last > mLong ? 1 : -1; r.push(`股價${last > mLong ? '在' : '在'}${at(ma[240]) ? '年線' : '半年線'}（${numTxt(mLong)}）${last > mLong ? '之上' : '之下'}`); }
    if (isNum(m20) && isNum(m60)) { s += m20 > m60 ? 1 : -1; r.push(`20 日線${m20 > m60 ? '高於' : '低於'}季線`); }
    if (isNum(m60) && isNum(m60p)) { s += m60 > m60p ? 1 : -1; r.push(`季線${m60 > m60p ? '上揚' : '下彎'}（近 20 日 ${signTxt((m60 / m60p - 1) * 100, 1, '%')}）`); }
    out.verdict.trend = V(s >= 3 ? '多頭' : s <= -3 ? '空頭' : s > 0 ? '盤整偏多' : s < 0 ? '盤整偏空' : '盤整',
      s >= 3 ? 'bull' : s <= -3 ? 'bear' : 'neutral', r,
      '五項：股價對 20 日線、季線、年線（不足時用半年線），20 日線對季線，季線 20 日斜率；各 ±1 分，≥3 多頭、≤−3 空頭。');
  }

  // ---- 2. 動能（技術指標）----
  {
    const R = rsi(c), M = macd(c), K = kd(bars);
    const rr = at(R), dif = at(M.DIF), osc = at(M.OSC), k = at(K.K), dd = at(K.D);
    out.tech = { R, M, K, rsi: rr, dif, dea: at(M.DEA), osc, k, d: dd, bias20: isNum(at(ma[20])) ? (last / at(ma[20]) - 1) * 100 : null, bias60: isNum(at(ma[60])) ? (last / at(ma[60]) - 1) * 100 : null };
    let s = 0;
    const r = [];
    if (isNum(osc)) { s += osc > 0 ? 1 : -1; r.push(`MACD 柱狀體${osc > 0 ? '為正' : '為負'}${isNum(at(M.OSC, n - 2)) && Math.sign(osc) !== Math.sign(at(M.OSC, n - 2)) ? '（今日翻轉）' : ''}`); }
    if (isNum(dif)) { s += dif > 0 ? 1 : -1; r.push(`DIF ${dif > 0 ? '位於零軸之上' : '位於零軸之下'}`); }
    if (isNum(k) && isNum(dd)) { s += k > dd ? 1 : -1; r.push(`KD ${k > dd ? 'K > D' : 'K < D'}（K ${numTxt(k, 1)}）`); }
    if (isNum(rr)) { s += rr > 55 ? 1 : rr < 45 ? -1 : 0; r.push(`RSI14 ${numTxt(rr, 1)}`); }
    const flag = isNum(rr) && rr >= 70 ? '・超買' : isNum(rr) && rr <= 30 ? '・超賣' : isNum(k) && k >= 80 ? '・高檔' : isNum(k) && k <= 20 ? '・低檔' : '';
    out.verdict.momentum = V((s >= 2 ? '偏多' : s <= -2 ? '偏空' : '中性') + flag, s >= 2 ? 'bull' : s <= -2 ? 'bear' : 'neutral', r,
      'MACD 柱狀體正負、DIF 與零軸、KD 交叉方向、RSI（>55 加分、<45 減分）；≥2 偏多、≤−2 偏空。RSI≥70 標示超買、≤30 超賣。');
  }

  // ---- 3. 波動度 ----
  {
    const H20 = hv(c, 20), H60 = hv(c, 60);
    const cur = at(H20), cur60 = at(H60);
    const pr = pctRank(H20.slice(-250), cur);
    out.hv = { H20, H60, cur, cur60, pr, max: Math.max(...H20.slice(-250).filter(isNum)), min: Math.min(...H20.slice(-250).filter(isNum)) };
    out.verdict.vol = V(pr == null ? '—' : pr >= 80 ? '波動偏高' : pr <= 20 ? '波動偏低' : '波動正常', pr >= 80 ? 'warn' : 'neutral',
      [isNum(cur) && `20 日年化波動度 ${numTxt(cur, 1)}%（近一年百分位 ${numTxt(pr, 0)}）`,
        isNum(cur60) && `60 日 ${numTxt(cur60, 1)}%，短期波動${cur > cur60 * 1.15 ? '擴張中' : cur < cur60 * 0.85 ? '收斂中' : '與中期相近'}`],
      '20 日歷史波動度在近一年的百分位：≥80 偏高、≤20 偏低。波動度本身不代表多空，高波動代表風險與價格區間較大。');
  }

  // ---- 4. 估值 ----
  {
    let peD = [], peV = [], pbV = [], cur = null, curPb = null, yld = null;
    if (d.mkt === 'TW' && d.val && d.val.d.length) {
      peD = d.val.d; peV = d.val.pe; pbV = d.val.pb;
      cur = d.val.pe[d.val.pe.length - 1]; curPb = d.val.pb[d.val.pb.length - 1]; yld = d.val.yld[d.val.yld.length - 1];
    } else if (d.mkt === 'US') {
      // 以「股價 ÷ 近四季 EPS」重建歷史本益比；季資料不足的年份用年度 EPS
      const pts = [];
      (d.a || []).forEach(x => { if (isNum(x.eps)) pts.push([x.p, x.eps]); });
      const q = (d.q || []).filter(x => isNum(x.eps));
      for (let i = 3; i < q.length; i++) pts.push([q[i].p, q[i].eps + q[i - 1].eps + q[i - 2].eps + q[i - 3].eps]);
      pts.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      let j = -1;
      bars.forEach(b => {
        while (j + 1 < pts.length && pts[j + 1][0] <= b.time) j++;
        if (j >= 0 && pts[j][1] > 0) { peD.push(b.time); peV.push(b.close / pts[j][1]); }
      });
      const s = d.stats || {};
      cur = isNum(s.pe) ? s.pe : peV[peV.length - 1]; curPb = s.pb; yld = s.yld;
    }
    const pr = pctRank(peV, cur);
    const prPb = pctRank(pbV, curPb);
    out.val = { peD, peV, cur, curPb, yld, pr, prPb, q: [0.1, 0.25, 0.5, 0.75, 0.9].map(x => quantile(peV, x)), fpe: d.stats && d.stats.fpe };
    const useP = isNum(cur) && cur > 0 && pr != null ? pr : prPb;
    const basisTxt = isNum(cur) && cur > 0 && pr != null ? '本益比' : '股價淨值比';
    out.verdict.valuation = V(useP == null ? '資料不足' : useP <= 25 ? '偏低' : useP >= 75 ? '偏高' : '合理',
      useP == null ? 'neutral' : useP <= 25 ? 'bull' : useP >= 75 ? 'warn' : 'neutral',
      [isNum(cur) && cur > 0 ? `本益比 ${numTxt(cur, 1)} 倍，位於近 ${peD.length > 900 ? '5' : '數'} 年第 ${numTxt(pr, 0)} 百分位（中位數 ${numTxt(out.val.q[2], 1)}）`
        : isNum(curPb) ? '近四季虧損或無本益比，改看股價淨值比' : '資料來源未提供本益比與淨值比（常見於興櫃股票）',
        isNum(curPb) && `股價淨值比 ${numTxt(curPb, 2)}${prPb != null ? `（第 ${numTxt(prPb, 0)} 百分位）` : ''}`,
        isNum(out.val.fpe) && isNum(cur) && `預估本益比 ${numTxt(out.val.fpe, 1)}（${out.val.fpe < cur ? '低於' : '高於'}目前，市場預期獲利${out.val.fpe < cur ? '成長' : '下滑'}）`,
        isNum(yld) && `殖利率 ${numTxt(yld, 2)}%`],
      `以${basisTxt}在自身歷史的百分位判斷：≤25 偏低、≥75 偏高。只和自己過去比，不同產業不宜互比；成長期公司估值偏高未必代表會跌。`);
  }

  // ---- 5. 成長、6. 獲利能力 ----
  {
    const q = (d.q || []).filter(x => isNum(x.rev) || isNum(x.eps));
    const L = q.length - 1;
    const yoy = (k) => (L >= 4 && isNum(q[L][k]) && q[L - 4][k] ? ((q[L][k] - q[L - 4][k]) / Math.abs(q[L - 4][k])) * 100 : null);
    const revY = yoy('rev'), epsY = yoy('eps');
    const mg = x => ({ gm: x.rev && isNum(x.gp) ? (x.gp / x.rev) * 100 : null, om: x.rev && isNum(x.op) ? (x.op / x.rev) * 100 : null, nm: x.rev && isNum(x.ni) ? (x.ni / x.rev) * 100 : null });
    out.fin = q.map(x => Object.assign({}, x, mg(x)));
    // 年度（美股季資料只有 5 季時輔助判斷）
    const A = (d.a || []).filter(x => isNum(x.rev));
    const annY = A.length >= 2 ? (A[A.length - 1].rev / A[A.length - 2].rev - 1) * 100 : null;
    // 台股月營收：近 3 個月平均年增
    const mrev = (d.rev || []).filter(x => isNum(x.yoy));
    const m3 = mrev.length >= 3 ? mrev.slice(-3).reduce((a, b) => a + b.yoy, 0) / 3 : null;
    out.mrev = { list: d.rev || [], m3 };
    const g = [revY, epsY].filter(isNum);
    const up = g.length && g.every(v => v >= 10), dn = g.length && g.every(v => v <= -5);
    out.verdict.growth = V(!g.length ? '資料不足' : up ? '成長' : dn ? '衰退' : '持平／分歧', up ? 'bull' : dn ? 'bear' : 'neutral',
      [isNum(revY) && `最新一季營收年增 ${signTxt(revY, 1, '%')}`, isNum(epsY) && `EPS 年增 ${signTxt(epsY, 1, '%')}`,
        isNum(m3) && `近 3 個月營收平均年增 ${signTxt(m3, 1, '%')}`, isNum(annY) && `最新年度營收年增 ${signTxt(annY, 1, '%')}`],
      '最新一季營收與 EPS 對去年同季：兩者都 ≥10% 為成長、都 ≤−5% 為衰退，其餘持平／分歧。');

    const cur = out.fin[L] || {}, base = out.fin.slice(Math.max(0, L - 4), L);
    const avg = k => { const a = base.map(x => x[k]).filter(isNum); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; };
    const dg = isNum(cur.gm) && isNum(avg('gm')) ? cur.gm - avg('gm') : null;
    const dop = isNum(cur.om) && isNum(avg('om')) ? cur.om - avg('om') : null;
    const ds = [dg, dop].filter(isNum);
    const better = ds.length && ds.every(v => v >= 1), worse = ds.length && ds.every(v => v <= -1);
    out.verdict.profit = V(!ds.length ? '資料不足' : better ? '改善' : worse ? '惡化' : '持穩', better ? 'bull' : worse ? 'bear' : 'neutral',
      [isNum(cur.gm) && `毛利率 ${numTxt(cur.gm, 1)}%（較前 4 季平均 ${signTxt(dg, 1, ' 個百分點')}）`,
        isNum(cur.om) && `營業利益率 ${numTxt(cur.om, 1)}%（${signTxt(dop, 1, ' 個百分點')}）`,
        isNum(cur.nm) && `淨利率 ${numTxt(cur.nm, 1)}%`],
      '最新一季毛利率、營業利益率對前 4 季平均：兩者都提高 ≥1 個百分點為改善、都下降 ≥1 為惡化。');
  }

  // ---- 7. 籌碼 ----
  {
    if (d.mkt === 'TW') {
      const I = d.inst || [];
      const sum = (k, m) => I.slice(-m).reduce((a, b) => a + (b[k] || 0), 0);
      const streak = k => { let s = 0; for (let i = I.length - 1; i >= 0; i--) { const v = I[i][k]; if (v > 0 && s >= 0) s++; else if (v < 0 && s <= 0) s--; else break; } return s; };
      const avgVol = P.v.slice(-20).reduce((a, b) => a + b, 0) / 20 / 1000; // 張
      const net20 = sum('f', 20) + sum('it', 20);
      const ratio = avgVol ? (net20 / (avgVol * 20)) * 100 : null;
      const F = d.foreign || [], Mg = d.margin || [];
      const fr = F.length > 20 ? F[F.length - 1].r - F[F.length - 21].r : null;
      const mg20 = Mg.length > 20 && Mg[Mg.length - 21].mb ? (Mg[Mg.length - 1].mb / Mg[Mg.length - 21].mb - 1) * 100 : null;
      const px20 = n > 20 ? (last / c[n - 21] - 1) * 100 : null;
      out.chips = { f5: sum('f', 5), f20: sum('f', 20), it5: sum('it', 5), it20: sum('it', 20), dl20: sum('dl', 20), fS: streak('f'), itS: streak('it'), ratio, fr, mg20, avgVol };
      let s = 0;
      if (isNum(ratio)) s += ratio > 3 ? 1 : ratio < -3 ? -1 : 0;
      if (isNum(fr)) s += fr > 0.3 ? 1 : fr < -0.3 ? -1 : 0;
      const marginRisk = isNum(mg20) && isNum(px20) && mg20 > 5 && px20 < 0;
      if (marginRisk) s -= 1;
      out.verdict.chips = V(s >= 1 ? '偏多' : s <= -1 ? '偏空' : '中性', s >= 1 ? 'bull' : s <= -1 ? 'bear' : 'neutral',
        [`外資＋投信 20 日合計 ${signTxt(net20, 0, ' 張')}${isNum(ratio) ? `（占同期成交量 ${signTxt(ratio, 1, '%')}）` : ''}`,
          out.chips.fS && `外資連${out.chips.fS > 0 ? '買' : '賣'} ${Math.abs(out.chips.fS)} 天`,
          out.chips.itS && `投信連${out.chips.itS > 0 ? '買' : '賣'} ${Math.abs(out.chips.itS)} 天`,
          isNum(fr) && `外資持股比例 20 日 ${signTxt(fr, 2, ' 個百分點')}`,
          isNum(mg20) && `融資餘額 20 日 ${signTxt(mg20, 1, '%')}${marginRisk ? '（融資增、股價跌，籌碼轉弱）' : ''}`],
        '法人 20 日淨買賣占成交量 >3% 加分、<−3% 減分；外資持股比例 20 日增減 >0.3 個百分點加／減分；融資 20 日增 >5% 但股價下跌減分。');
    } else {
      const s = d.stats || {};
      const chg = isNum(s.shortNow) && s.shortPrev ? (s.shortNow / s.shortPrev - 1) * 100 : null;
      out.chips = { inst: s.inst, insider: s.insider, shortPct: s.shortPct, shortRatio: s.shortRatio, shortChg: chg };
      const high = isNum(s.shortPct) && s.shortPct >= 0.1;
      const tone = isNum(chg) ? (chg <= -10 ? 'bull' : chg >= 10 ? 'bear' : 'neutral') : 'neutral';
      out.verdict.chips = V(high ? '空單偏高' : tone === 'bull' ? '空單減少' : tone === 'bear' ? '空單增加' : '中性', high ? 'warn' : tone,
        [isNum(s.inst) && `機構持股 ${numTxt(s.inst * 100, 1)}%`, isNum(s.insider) && `內部人持股 ${numTxt(s.insider * 100, 2)}%`,
          isNum(s.shortPct) && `放空比例（占流通股）${numTxt(s.shortPct * 100, 2)}%`, isNum(chg) && `空單較上月 ${signTxt(chg, 1, '%')}`,
          isNum(s.shortRatio) && `空單回補天數 ${numTxt(s.shortRatio, 1)} 天`],
        '放空比例 ≥10% 標示空單偏高；空單月減 ≥10% 視為偏多、月增 ≥10% 視為偏空。');
    }
  }

  // ---- 8. 相對強弱 ----
  {
    const B = d.bench;
    out.rs = null;
    if (B && B.t.length) {
      const bmap = new Map(B.t.map((t, i) => [t, B.c[i]]));
      const bAt = t => { if (bmap.has(t)) return bmap.get(t); let v = null; for (let i = 0; i < B.t.length && B.t[i] <= t; i++) v = B.c[i]; return v; };
      const per = [[21, '1 個月'], [63, '3 個月'], [126, '6 個月'], [250, '1 年']].map(([k, label]) => {
        if (n <= k) return { label };
        const s0 = c[n - 1 - k], b0 = bAt(P.t[n - 1 - k]), b1 = B.c[B.c.length - 1];
        const sr = (last / s0 - 1) * 100, br = b0 ? (b1 / b0 - 1) * 100 : null;
        return { label, sr, br, ex: isNum(br) ? sr - br : null };
      });
      const start = Math.max(0, n - 250), b0 = bAt(P.t[start]);
      const line = P.t.slice(start).map((t, i) => { const b = bAt(t); return b && b0 ? { time: t, value: (c[start + i] / c[start]) / (b / b0) * 100 } : { time: t }; });
      out.rs = { per, line, sym: B.sym };
      const e3 = per[1].ex, e6 = per[2].ex;
      const strong = isNum(e3) && isNum(e6) && e3 > 3 && e6 > 3, weak = isNum(e3) && isNum(e6) && e3 < -3 && e6 < -3;
      out.verdict.rs = V(strong ? '強於大盤' : weak ? '弱於大盤' : '與大盤相近', strong ? 'bull' : weak ? 'bear' : 'neutral',
        per.filter(p => isNum(p.ex)).map(p => `${p.label}超額報酬 ${signTxt(p.ex, 1, '%')}`),
        '近 3 個月與 6 個月相對大盤的超額報酬：都 >3% 為強於大盤、都 <−3% 為弱於大盤。');
    }
  }

  // ---- 9. 分析師 ----
  {
    const A = d.analyst;
    if (A && (A.mean || A.trend)) {
      const up = A.mean ? (A.mean / last - 1) * 100 : null;
      const opt = isNum(up) && up >= 15 && (!isNum(A.rec) || A.rec <= 2.2), cons = (isNum(up) && up < 0) || (isNum(A.rec) && A.rec >= 3);
      out.verdict.analyst = V((A.n && A.n < 3 ? '樣本少・' : '') + (opt ? '樂觀' : cons ? '保守' : '中性'), opt ? 'bull' : cons ? 'bear' : 'neutral',
        [isNum(up) && `平均目標價 ${numTxt(A.mean)}，距現價 ${signTxt(up, 1, '%')}`, isNum(A.rec) && `平均評等 ${numTxt(A.rec, 2)}（1 強力買進～5 賣出）`, A.n && `${A.n} 位分析師`],
        '平均目標價較現價高 ≥15% 且平均評等 ≤2.2 為樂觀；目標價低於現價或評等 ≥3 為保守。分析師普遍偏樂觀，宜搭配其他面向判讀。');
    }
  }
  return out;
}

/* =========================================================
 * 畫面
 * ========================================================= */
const RS_BLOCKS = [
  ['trend', '趨勢'], ['momentum', '動能'], ['valuation', '估值'], ['growth', '成長'], ['profit', '獲利能力'],
  ['chips', '籌碼'], ['rs', '相對強弱'], ['analyst', '分析師'], ['vol', '波動度'],
];

function vChip(v) {
  if (!v) return '';
  return `<span class="vchip ${v.tone}">${esc(v.label)}</span>`;
}

function vNote(v) {
  if (!v) return '';
  return `<ul class="vreasons">${v.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul><div class="foot-note">判斷依據：${esc(v.basis)}</div>`;
}

function rsPanel(id, title, span, verdictKey, inner) {
  const v = verdictKey ? research.calc.verdict[verdictKey] : null;
  return `<section class="panel rs-panel" id="rs-${id}" style="--span:${span}">
    <div class="panel-head"><h2 class="panel-title">${title}</h2>${v ? vChip(v) : ''}<div class="panel-tools" data-tools="${id}"></div></div>
    <div class="panel-body">${inner}${v ? vNote(v) : ''}</div></section>`;
}

function fmtBig(v, cur) {
  if (!isNum(v)) return '—';
  const a = Math.abs(v);
  if (cur === 'TWD') return a >= 1e12 ? numTxt(v / 1e12, 2) + ' 兆' : a >= 1e8 ? numTxt(v / 1e8, 1) + ' 億' : numTxt(v, 0);
  return a >= 1e12 ? numTxt(v / 1e12, 2) + 'T' : a >= 1e9 ? numTxt(v / 1e9, 2) + 'B' : a >= 1e6 ? numTxt(v / 1e6, 1) + 'M' : numTxt(v, 0);
}

function renderResearch() {
  research.charts.forEach(ch => ch.remove());
  research.charts = [];
  const d = research.data, C = research.calc, cur = d.currency || '';
  const isTW = d.mkt === 'TW';
  const mcap = isTW ? (d.shares ? d.shares * C.last : null) : d.stats && d.stats.mcap;
  const pos = C.hi52 > C.lo52 ? ((C.last - C.lo52) / (C.hi52 - C.lo52)) * 100 : 50;
  const cat = isTW ? 'tw' : 'global';
  const inList = inWatchlist(cat, d.code);
  const verdicts = RS_BLOCKS.map(([k, label]) => [k, label, C.verdict[k]]).filter(x => x[2]);
  const cnt = t => verdicts.filter(x => x[2].tone === t).length;

  let html = `
    <section class="panel rs-head" style="--span:12">
      <div class="rs-title">
        <div>
          <div class="rs-name">${esc(d.name)} <span class="muted">${esc(d.code)}${d.board ? ' · ' + esc(d.board) : ''}${d.industry ? ' · ' + esc(d.industry) : ''}</span></div>
          <div class="rs-price"><b class="${dirCls(C.chg)}">${numTxt(C.last)}</b> <span class="pct ${dirCls(C.chg)}">${pctTxt(C.chg)}</span>
            <span class="muted">${esc(cur)} · ${esc(d.price.t[d.price.t.length - 1])}</span></div>
        </div>
        <div class="rs-actions">
          <button class="btn btn-ghost btn-sm" id="rsAdd" ${inList ? 'disabled' : ''}>${inList ? '✓ 已在自選' : '＋ 加入自選'}</button>
        </div>
      </div>
      <div class="kpis rs-kpis">
        <div class="kpi"><div class="kpi-l">市值</div><div class="kpi-v">${fmtBig(mcap, cur)}</div></div>
        <div class="kpi"><div class="kpi-l">本益比</div><div class="kpi-v">${isNum(C.val.cur) && C.val.cur > 0 ? numTxt(C.val.cur, 1) : '—'}</div></div>
        <div class="kpi"><div class="kpi-l">股價淨值比</div><div class="kpi-v">${numTxt(C.val.curPb, 2)}</div></div>
        <div class="kpi"><div class="kpi-l">殖利率</div><div class="kpi-v">${isNum(C.val.yld) ? numTxt(C.val.yld, 2) + '%' : '—'}</div></div>
        <div class="kpi"><div class="kpi-l">下次財報／法說</div><div class="kpi-v">${d.nextEarnings ? tpDate(d.nextEarnings) : '—'}</div></div>
        ${d.stats && isNum(d.stats.beta) ? `<div class="kpi"><div class="kpi-l">Beta</div><div class="kpi-v">${numTxt(d.stats.beta, 2)}</div></div>` : ''}
      </div>
      <div class="range52">
        <span>52 週低 ${numTxt(C.lo52)}</span>
        <div class="range52-bar"><i style="left:${Math.min(100, Math.max(0, pos))}%"></i></div>
        <span>52 週高 ${numTxt(C.hi52)}</span>
      </div>
    </section>

    <section class="panel" style="--span:12">
      <div class="panel-head"><h2 class="panel-title">各面向判斷總覽</h2>
        <span class="muted">多方 ${cnt('bull')}・空方 ${cnt('bear')}・中性／留意 ${cnt('neutral') + cnt('warn')}</span></div>
      <div class="panel-body">
        <div class="vgrid">${verdicts.map(([k, label, v]) => `
          <a class="vcard ${v.tone}" href="#rs-${k === 'momentum' ? 'tech' : k === 'growth' || k === 'profit' ? 'fin' : k}">
            <div class="vcard-l">${label}</div><div class="vcard-v">${esc(v.label)}</div></a>`).join('')}</div>
        <div class="foot-note">各面向依固定統計規則判斷（依據寫在每張字卡下方），彼此獨立、不加總成買賣建議；僅供研究參考，不構成投資建議。</div>
      </div>
    </section>`;

  // 走勢圖
  html += rsPanel('trend', '價格走勢與成交量', 12, 'trend', `
    <div class="chart-legend"><span style="--c:#e67e22">MA20</span><span style="--c:#2c6bc4">MA60</span><span style="--c:#8e44ad">MA120</span><span style="--c:#7f8c8d">MA240</span></div>
    <div class="mini-chart rs-main" id="rsMain"></div>`);

  // 技術指標
  const T = C.tech;
  html += rsPanel('tech', '技術分析', 6, 'momentum', `
    <div class="tbl-wrap"><table class="mtbl">
      <tr><td class="nm">RSI(14)</td><td class="num strong">${numTxt(T.rsi, 1)}</td><td class="muted">${T.rsi >= 70 ? '超買區' : T.rsi <= 30 ? '超賣區' : T.rsi >= 50 ? '強勢區' : '弱勢區'}</td></tr>
      <tr><td class="nm">KD(9,3,3)</td><td class="num strong">K ${numTxt(T.k, 1)} / D ${numTxt(T.d, 1)}</td><td class="muted">${T.k > T.d ? 'K 在 D 之上' : 'K 在 D 之下'}</td></tr>
      <tr><td class="nm">MACD(12,26,9)</td><td class="num strong">DIF ${numTxt(T.dif, 2)} / MACD ${numTxt(T.dea, 2)}</td><td class="muted ${dirCls(T.osc)}">柱 ${signTxt(T.osc, 2)}</td></tr>
      <tr><td class="nm">乖離率</td><td class="num strong">20 日 ${signTxt(T.bias20, 1, '%')} / 60 日 ${signTxt(T.bias60, 1, '%')}</td><td class="muted">${Math.abs(T.bias20) > 10 ? '短線乖離偏大' : ''}</td></tr>
      ${[5, 20, 60, 120, 240].map(k => { const m = C.ma[k][C.ma[k].length - 1]; return `<tr><td class="nm">MA${k}</td><td class="num">${numTxt(m)}</td><td class="muted ${dirCls(C.last - m)}">${isNum(m) ? (C.last >= m ? '股價在上' : '股價在下') : '資料不足'}</td></tr>`; }).join('')}
    </table></div>
    <div class="mini-chart" id="rsTech"></div>`);

  // 波動度
  const H = C.hv;
  html += rsPanel('vol', '歷史波動度', 6, 'vol', `
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">20 日年化</div><div class="kpi-v">${numTxt(H.cur, 1)}%</div></div>
      <div class="kpi"><div class="kpi-l">60 日年化</div><div class="kpi-v">${numTxt(H.cur60, 1)}%</div></div>
      <div class="kpi"><div class="kpi-l">近一年區間</div><div class="kpi-v">${numTxt(H.min, 0)}–${numTxt(H.max, 0)}%</div></div>
      <div class="kpi"><div class="kpi-l">一個月約 1σ 波動</div><div class="kpi-v">±${numTxt((H.cur / Math.sqrt(12)), 1)}%</div></div>
    </div>
    <div class="chart-legend"><span style="--c:#c0392b">HV20</span><span style="--c:#1f4e8c">HV60</span></div>
    <div class="mini-chart" id="rsHv"></div>`);

  // 估值
  const VA = C.val;
  html += rsPanel('valuation', '估值', 6, 'valuation', VA.peV.length ? `
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">本益比</div><div class="kpi-v">${isNum(VA.cur) && VA.cur > 0 ? numTxt(VA.cur, 1) : '—'}</div><div class="kpi-s">百分位 ${numTxt(VA.pr, 0)}</div></div>
      <div class="kpi"><div class="kpi-l">歷史中位數</div><div class="kpi-v">${numTxt(VA.q[2], 1)}</div><div class="kpi-s">25–75%：${numTxt(VA.q[1], 1)}–${numTxt(VA.q[3], 1)}</div></div>
      <div class="kpi"><div class="kpi-l">股價淨值比</div><div class="kpi-v">${numTxt(VA.curPb, 2)}</div><div class="kpi-s">${VA.prPb != null ? '百分位 ' + numTxt(VA.prPb, 0) : ''}</div></div>
      <div class="kpi"><div class="kpi-l">${isNum(VA.fpe) ? '預估本益比' : '殖利率'}</div><div class="kpi-v">${isNum(VA.fpe) ? numTxt(VA.fpe, 1) : isNum(VA.yld) ? numTxt(VA.yld, 2) + '%' : '—'}</div></div>
    </div>
    <div class="chart-legend"><span style="--c:#1f4e8c">本益比</span><span style="--c:#a3abb8">10／25／50／75／90 百分位</span></div>
    <div class="mini-chart" id="rsPe"></div>` : '<div class="panel-msg">此標的沒有本益比資料（興櫃、虧損或資料不足）</div>');

  // 成長與獲利
  const fin = C.fin.slice(-12);
  html += rsPanel('fin', '成長與獲利（單季）', 6, 'growth', fin.length ? `
    <div class="vchip-row">${vChip(C.verdict.profit)} <span class="muted">獲利能力</span></div>
    <div class="bars-wrap">${barsSvg(fin.map(x => x.eps), fin.map(x => qLabel(x.p)), 'EPS')}</div>
    <div class="chart-legend"><span style="--c:#1f4e8c">毛利率</span><span style="--c:#e67e22">營業利益率</span><span style="--c:#16a085">淨利率</span></div>
    <div class="mini-chart short" id="rsMargin"></div>
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>季度</th><th class="num">營收</th><th class="num">年增</th><th class="num">毛利率</th><th class="num">營益率</th><th class="num">EPS</th></tr></thead>
      <tbody>${C.fin.slice(-8).reverse().map((x, i, arr) => {
        const j = C.fin.indexOf(x), ly = C.fin[j - 4];
        const g = ly && ly.rev ? (x.rev / ly.rev - 1) * 100 : null;
        return `<tr><td class="nm">${qLabel(x.p)}</td><td class="num">${fmtBig(x.rev, cur)}</td><td class="num ${dirCls(g)}">${signTxt(g, 1, '%')}</td>
          <td class="num">${numTxt(x.gm, 1)}%</td><td class="num">${numTxt(x.om, 1)}%</td><td class="num strong">${numTxt(x.eps, 2)}</td></tr>`;
      }).join('')}</tbody></table></div>
    ${vNote(C.verdict.profit)}` : '<div class="panel-msg">查無財報資料</div>');

  // 月營收（台股）
  if (isTW && C.mrev.list.length) {
    const L = C.mrev.list.slice(-13);
    html += rsPanel('rev', '月營收', 6, null, `
      <div class="kpis">
        <div class="kpi"><div class="kpi-l">${L[L.length - 1].ym.replace('-', '/')} 營收</div><div class="kpi-v">${fmtBig(L[L.length - 1].rev, 'TWD')}</div></div>
        <div class="kpi"><div class="kpi-l">年增率</div><div class="kpi-v ${dirCls(L[L.length - 1].yoy)}">${signTxt(L[L.length - 1].yoy, 1, '%')}</div></div>
        <div class="kpi"><div class="kpi-l">月增率</div><div class="kpi-v ${dirCls(L[L.length - 1].mom)}">${signTxt(L[L.length - 1].mom, 1, '%')}</div></div>
        <div class="kpi"><div class="kpi-l">近 3 月平均年增</div><div class="kpi-v ${dirCls(C.mrev.m3)}">${signTxt(C.mrev.m3, 1, '%')}</div></div>
      </div>
      <div class="bars-wrap">${barsSvg(L.map(x => x.rev / 1e8), L.map(x => x.ym.slice(2).replace('-', '/')), '營收（億）', L.map(x => x.yoy))}</div>
      <div class="foot-note">長條為月營收（億元），折線為年增率（%）。月營收約每月 10 日前公布，是台股最即時的基本面指標。</div>`);
  }

  // 籌碼
  const CH = C.chips || {};
  html += rsPanel('chips', '籌碼', 6, 'chips', isTW ? `
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">外資 5／20 日</div><div class="kpi-v ${dirCls(CH.f20)}">${signTxt(CH.f20, 0)}<small> 張</small></div><div class="kpi-s ${dirCls(CH.f5)}">5 日 ${signTxt(CH.f5, 0)}</div></div>
      <div class="kpi"><div class="kpi-l">投信 5／20 日</div><div class="kpi-v ${dirCls(CH.it20)}">${signTxt(CH.it20, 0)}<small> 張</small></div><div class="kpi-s ${dirCls(CH.it5)}">5 日 ${signTxt(CH.it5, 0)}</div></div>
      <div class="kpi"><div class="kpi-l">外資持股</div><div class="kpi-v">${numTxt((d.foreign || []).slice(-1)[0] && d.foreign.slice(-1)[0].r, 2)}%</div><div class="kpi-s">20 日 ${signTxt(CH.fr, 2)}</div></div>
      <div class="kpi"><div class="kpi-l">融資餘額</div><div class="kpi-v">${numTxt((d.margin || []).slice(-1)[0] && d.margin.slice(-1)[0].mb, 0)}<small> 張</small></div><div class="kpi-s">20 日 ${signTxt(CH.mg20, 1, '%')}</div></div>
    </div>
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>日期</th><th class="num">外資</th><th class="num">投信</th><th class="num">自營商</th><th class="num">融資餘額</th></tr></thead>
      <tbody>${(d.inst || []).slice(-10).reverse().map(r => {
        const m = (d.margin || []).find(x => x.d === r.d);
        return `<tr><td class="nm">${mdTxt(r.d)}</td><td class="num ${dirCls(r.f)}">${signTxt(r.f, 0)}</td><td class="num ${dirCls(r.it)}">${signTxt(r.it, 0)}</td><td class="num ${dirCls(r.dl)}">${signTxt(r.dl, 0)}</td><td class="num">${m ? numTxt(m.mb, 0) : '—'}</td></tr>`;
      }).join('')}</tbody></table></div>` : `
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">機構持股</div><div class="kpi-v">${isNum(CH.inst) ? numTxt(CH.inst * 100, 1) + '%' : '—'}</div></div>
      <div class="kpi"><div class="kpi-l">內部人持股</div><div class="kpi-v">${isNum(CH.insider) ? numTxt(CH.insider * 100, 2) + '%' : '—'}</div></div>
      <div class="kpi"><div class="kpi-l">放空比例</div><div class="kpi-v">${isNum(CH.shortPct) ? numTxt(CH.shortPct * 100, 2) + '%' : '—'}</div><div class="kpi-s">較上月 ${signTxt(CH.shortChg, 1, '%')}</div></div>
      <div class="kpi"><div class="kpi-l">回補天數</div><div class="kpi-v">${numTxt(CH.shortRatio, 1)}</div></div>
    </div>`);

  // 相對強弱
  if (C.rs) {
    html += rsPanel('rs', `相對強弱（vs ${C.rs.sym === '^TWII' ? '加權指數' : C.rs.sym === '^GSPC' ? 'S&P 500' : C.rs.sym}）`, 6, 'rs', `
      <div class="tbl-wrap"><table class="mtbl">
        <thead><tr><th>期間</th><th class="num">個股</th><th class="num">大盤</th><th class="num">超額報酬</th></tr></thead>
        <tbody>${C.rs.per.map(p => `<tr><td class="nm">${p.label}</td><td class="num ${dirCls(p.sr)}">${pctTxt(p.sr)}</td><td class="num ${dirCls(p.br)}">${pctTxt(p.br)}</td><td class="num strong ${dirCls(p.ex)}">${signTxt(p.ex, 1, '%')}</td></tr>`).join('')}</tbody>
      </table></div>
      <div class="chart-legend"><span style="--c:#6d4bc4">相對強弱線（一年前 = 100，向上代表跑贏大盤）</span></div>
      <div class="mini-chart short" id="rsRs"></div>`);
  }

  // 分析師
  const A = d.analyst;
  if (A) {
    const tr = A.trend, tot = tr ? tr.sb + tr.b + tr.h + tr.s + tr.ss : 0;
    const lo = Math.min(A.low || C.last, C.last), hi = Math.max(A.high || C.last, C.last), pos = v => ((v - lo) / (hi - lo || 1)) * 100;
    html += rsPanel('analyst', '分析師觀點', 6, 'analyst', `
      ${A.mean ? `<div class="tgt">
        <div class="tgt-bar"><i class="tgt-range" style="left:${pos(A.low || lo)}%;right:${100 - pos(A.high || hi)}%"></i>
          <i class="tgt-mean" style="left:${pos(A.mean)}%" title="平均目標價"></i><i class="tgt-now" style="left:${pos(C.last)}%" title="現價"></i></div>
        <div class="tgt-lbl"><span>最低 ${numTxt(A.low)}</span><span>平均 <b>${numTxt(A.mean)}</b>・現價 ${numTxt(C.last)}</span><span>最高 ${numTxt(A.high)}</span></div></div>` : ''}
      ${tot ? `<div class="rec-bar">${[['sb', '強力買進', '#137a48'], ['b', '買進', '#5bb98b'], ['h', '持有', '#c3cad5'], ['s', '賣出', '#e88a8a'], ['ss', '強力賣出', '#c62828']]
        .map(([k, l, col]) => tr[k] ? `<i style="flex:${tr[k]};background:${col}" title="${l} ${tr[k]}">${tr[k]}</i>` : '').join('')}</div>
        <div class="foot-note" style="margin-top:4px">本月評等分布：強力買進 ${tr.sb}・買進 ${tr.b}・持有 ${tr.h}・賣出 ${tr.s}・強力賣出 ${tr.ss}</div>` : ''}
      ${A.hist && A.hist.length ? `<div class="tbl-wrap"><table class="mtbl">
        <thead><tr><th>日期</th><th>機構</th><th>評等</th><th class="num">目標價</th></tr></thead>
        <tbody>${A.hist.map(h => `<tr><td class="nm">${tpDate(h.t)}</td><td>${esc(h.firm)}</td><td>${esc(h.from && h.from !== h.to ? h.from + ' → ' : '')}${esc(h.to)}</td><td class="num">${numTxt(h.pt)}</td></tr>`).join('')}</tbody></table></div>` : ''}`);
  }

  // 股利
  const D = d.div || [];
  if (D.length) {
    html += rsPanel('div', '股利紀錄', 6, null, `
      <div class="tbl-wrap"><table class="mtbl">
        <thead><tr>${isTW ? '<th>期別</th><th class="num">現金股利</th><th class="num">股票股利</th><th>除息日</th>' : '<th>除息日</th><th class="num">每股現金股利</th>'}</tr></thead>
        <tbody>${D.slice(0, 10).map(x => isTW
          ? `<tr><td class="nm">${esc(x.y)}</td><td class="num">${numTxt(x.cash, 2)}</td><td class="num">${numTxt(x.stock, 2)}</td><td>${esc(x.ex || '—')}</td></tr>`
          : `<tr><td class="nm">${tpDate(x.t)}</td><td class="num">${numTxt(x.cash, 4)}</td></tr>`).join('')}</tbody></table></div>`);
  }

  // 公司簡介
  const pf = d.profile || {};
  html += rsPanel('profile', '公司簡介', 12, null, `
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">產業</div><div class="kpi-v sm">${esc(d.industry || pf.industry || '—')}</div><div class="kpi-s">${esc(pf.sector || '')}</div></div>
      <div class="kpi"><div class="kpi-l">員工數</div><div class="kpi-v sm">${pf.employees ? numTxt(pf.employees, 0) : '—'}</div></div>
      <div class="kpi"><div class="kpi-l">國家</div><div class="kpi-v sm">${esc(pf.country || (isTW ? 'Taiwan' : '—'))}</div></div>
      <div class="kpi"><div class="kpi-l">網站</div><div class="kpi-v sm">${pf.website ? `<a href="${esc(pf.website)}" target="_blank" rel="noopener noreferrer">${esc(pf.website.replace(/^https?:\/\//, ''))}</a>` : '—'}</div></div>
    </div>
    ${pf.summary ? `<p class="rs-summary">${esc(pf.summary)}</p><div class="foot-note">簡介來源 Yahoo Finance（英文）。</div>` : ''}`);

  $('#rsBody').innerHTML = `<div class="macro-grid rs-grid">${html}</div>`;
  const addBtn = $('#rsAdd');
  if (addBtn) addBtn.addEventListener('click', async () => {
    addBtn.disabled = true;
    try { await addToWatchlist(cat, d.code); addBtn.textContent = '✓ 已在自選'; }
    catch (err) { addBtn.disabled = false; toast('加入失敗：' + err.message); }
  });
  rsCharts();
}

function qLabel(p) {
  const y = p.slice(0, 4), m = +p.slice(5, 7);
  return `${y.slice(2)}Q${Math.ceil(m / 3)}`;
}

/** 簡單長條圖（可加一條折線，例如年增率） */
function barsSvg(vals, labels, title, line) {
  const W = 560, H = 170, L = 8, R = 8, T = 18, B = 22;
  const v = vals.map(x => (isNum(x) ? x : 0));
  const max = Math.max(0, ...v), min = Math.min(0, ...v);
  const span = max - min || 1;
  const bw = (W - L - R) / v.length;
  const y = x => T + (H - T - B) * (1 - (x - min) / span);
  const up = cssVar('--up'), down = cssVar('--down');
  let g = `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="#d6dbe3"/>`;
  v.forEach((x, i) => {
    const x0 = L + i * bw + bw * 0.18, h = Math.abs(y(x) - y(0));
    const col = line ? '#9db4d3' : x >= 0 ? '#1f4e8c' : down;
    g += `<rect x="${x0.toFixed(1)}" y="${Math.min(y(x), y(0)).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${Math.max(h, 0.5).toFixed(1)}" rx="2" fill="${col}"><title>${labels[i]}：${numTxt(vals[i], 2)}</title></rect>`;
    if (!line) g += `<text x="${(x0 + bw * 0.32).toFixed(1)}" y="${(x >= 0 ? y(x) - 4 : y(x) + 11).toFixed(1)}" class="bv" text-anchor="middle">${numTxt(vals[i], Math.abs(vals[i]) >= 100 ? 0 : 2)}</text>`;
    g += `<text x="${(x0 + bw * 0.32).toFixed(1)}" y="${H - 6}" class="ax" text-anchor="middle">${labels[i]}</text>`;
  });
  if (line) {
    const lv = line.filter(isNum);
    if (lv.length) {
      const lmax = Math.max(...lv), lmin = Math.min(...lv), ls = lmax - lmin || 1;
      const ly = x => T + 4 + (H - T - B - 8) * (1 - (x - lmin) / ls);
      const pts = line.map((x, i) => (isNum(x) ? `${(L + i * bw + bw / 2).toFixed(1)},${ly(x).toFixed(1)}` : null)).filter(Boolean).join(' ');
      g += `<polyline points="${pts}" fill="none" stroke="#e67e22" stroke-width="2"/>`;
      line.forEach((x, i) => { if (isNum(x)) g += `<circle cx="${(L + i * bw + bw / 2).toFixed(1)}" cy="${ly(x).toFixed(1)}" r="2.5" fill="#e67e22"><title>${labels[i]} 年增 ${numTxt(x, 1)}%</title></circle>`; });
    }
  }
  return `<div class="bars-title">${esc(title)}${line ? '<span class="muted">　折線：年增率</span>' : ''}</div><svg viewBox="0 0 ${W} ${H}" class="curve bars">${g}</svg>`;
}

function rsChart(el, opts) {
  const LWC = window.LightweightCharts;
  const ch = LWC.createChart(el, Object.assign({
    autoSize: true,
    layout: { background: { type: 'solid', color: '#ffffff' }, textColor: '#5b6778', fontSize: 11, fontFamily: 'Inter, "Noto Sans TC", sans-serif', panes: { separatorColor: '#e3e8ef' } },
    grid: { vertLines: { color: '#f2f4f7' }, horzLines: { color: '#f2f4f7' } },
    rightPriceScale: { borderColor: '#e3e8ef' }, timeScale: { borderColor: '#e3e8ef' },
    localization: { locale: 'zh-TW', dateFormat: 'yyyy-MM-dd' }, handleScale: { mouseWheel: false },
  }, opts || {}));
  research.charts.push(ch);
  return ch;
}

function rsCharts() {
  const LWC = window.LightweightCharts, C = research.calc, bars = C.bars, n = bars.length;
  if (!LWC) return;
  const up = cssVar('--up'), down = cssVar('--down');
  const plain = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
  const line = (arr, start = 0) => bars.slice(start).map((b, i) => (isNum(arr[start + i]) ? { time: b.time, value: arr[start + i] } : { time: b.time }));

  // 主圖：K 線＋均線＋成交量，預設近一年，可拖曳看 5 年
  const el = $('#rsMain');
  if (el) {
    const ch = rsChart(el);
    const k = ch.addSeries(LWC.CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
    k.setData(bars.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
    [[20, '#e67e22'], [60, '#2c6bc4'], [120, '#8e44ad'], [240, '#7f8c8d']].forEach(([p, col]) => {
      ch.addSeries(LWC.LineSeries, { ...plain, color: col, lineWidth: 1 }).setData(line(C.ma[p]));
    });
    const vs = ch.addSeries(LWC.HistogramSeries, { ...plain, priceScaleId: 'vol', priceFormat: { type: 'volume' } });
    vs.setData(bars.map((b, i) => ({ time: b.time, value: b.volume, color: (b.close >= (i ? bars[i - 1].close : b.open) ? up : down) + '55' })));
    ch.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    k.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.22 } });
    const setR = () => ch.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 250), to: n + 3 });
    setR();
    requestAnimationFrame(() => requestAnimationFrame(setR));
    const tools = $('[data-tools="trend"]');
    seg(tools, [['63', '3月'], ['126', '6月'], ['250', '1年'], ['750', '3年'], ['0', '全部']], '250', v => {
      if (+v) ch.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - +v), to: n + 3 }); else ch.timeScale().fitContent();
      $$('button', tools).forEach(b => b.classList.toggle('on', b.dataset.v === v));
    });
  }

  // 技術：RSI 與 MACD（近一年）
  const te = $('#rsTech');
  if (te) {
    const ch = rsChart(te);
    const T = C.tech, s = Math.max(0, n - 250);
    const r = ch.addSeries(LWC.LineSeries, { ...plain, lastValueVisible: true, color: '#8e44ad', lineWidth: 1.5, title: 'RSI' });
    r.setData(line(T.R, s));
    [70, 30].forEach(p => r.createPriceLine({ price: p, color: '#c3cad5', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false }));
    const h = ch.addSeries(LWC.HistogramSeries, { ...plain }, 1);
    h.setData(bars.slice(s).map((b, i) => (isNum(T.M.OSC[s + i]) ? { time: b.time, value: T.M.OSC[s + i], color: (T.M.OSC[s + i] >= 0 ? up : down) + '99' } : { time: b.time })));
    ch.addSeries(LWC.LineSeries, { ...plain, color: '#2c6bc4', lineWidth: 1.5, title: 'DIF' }, 1).setData(line(T.M.DIF, s));
    ch.addSeries(LWC.LineSeries, { ...plain, color: '#e67e22', lineWidth: 1.5, title: 'MACD' }, 1).setData(line(T.M.DEA, s));
    ch.timeScale().fitContent();
  }

  // 波動度（近兩年）
  const he = $('#rsHv');
  if (he) {
    const ch = rsChart(he), s = Math.max(0, n - 500);
    ch.addSeries(LWC.LineSeries, { ...plain, lastValueVisible: true, color: '#c0392b', lineWidth: 1.5 }).setData(line(C.hv.H20, s));
    ch.addSeries(LWC.LineSeries, { ...plain, lastValueVisible: true, color: '#1f4e8c', lineWidth: 1.5 }).setData(line(C.hv.H60, s));
    ch.timeScale().fitContent();
  }

  // 本益比歷史與百分位帶
  const pe = $('#rsPe');
  if (pe && C.val.peV.length) {
    const ch = rsChart(pe);
    const s = ch.addSeries(LWC.LineSeries, { ...plain, lastValueVisible: true, color: '#1f4e8c', lineWidth: 1.5 });
    s.setData(C.val.peD.map((t, i) => (isNum(C.val.peV[i]) ? { time: t, value: C.val.peV[i] } : { time: t })));
    C.val.q.forEach((v, i) => { if (isNum(v)) s.createPriceLine({ price: v, color: i === 2 ? '#7f8c8d' : '#c3cad5', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: ['P10', 'P25', '中位', 'P75', 'P90'][i] }); });
    ch.timeScale().fitContent();
  }

  // 毛利率／營益率／淨利率
  const me = $('#rsMargin');
  if (me) {
    const ch = rsChart(me), F = C.fin.slice(-12);
    [['gm', '#1f4e8c'], ['om', '#e67e22'], ['nm', '#16a085']].forEach(([k, col]) => {
      ch.addSeries(LWC.LineSeries, { ...plain, color: col, lineWidth: 2, priceFormat: { type: 'custom', formatter: v => v.toFixed(1) + '%' } })
        .setData(F.map(x => (isNum(x[k]) ? { time: x.p, value: x[k] } : { time: x.p })));
    });
    ch.timeScale().fitContent();
  }

  // 相對強弱線
  const re = $('#rsRs');
  if (re && C.rs) {
    const ch = rsChart(re);
    const s = ch.addSeries(LWC.LineSeries, { ...plain, lastValueVisible: true, color: '#6d4bc4', lineWidth: 2 });
    s.setData(C.rs.line);
    s.createPriceLine({ price: 100, color: '#c3cad5', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false });
    ch.timeScale().fitContent();
  }
}

initResearch();
