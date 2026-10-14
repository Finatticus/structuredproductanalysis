/* =========================================================
 * ETF 專區 — 前端
 * 分頁：台股 ETF 總覽、高股息比較、美股 ETF、個別 ETF、持股重疊
 * 只在第一次打開某個分頁時抓資料，之後按「↻ 更新」
 * 依賴 app.js（$, $$, api, esc, store, state, toast, addToWatchlist, inWatchlist, openChart）
 *      macro.js（isNum, pctTxt, signTxt, numTxt, dirCls, sparkSvg, seg, cssVar, mdTxt）
 * ========================================================= */
const etfS = {
  tab: 'tw', data: {}, loadedAt: {}, detail: {}, charts: [],
  tw: { type: '', q: '', sort: ['aum', -1] }, high: { sort: ['yld', -1] }, us: { sort: ['aum', -1] },
  cur: null, ovA: '0056', ovB: '00878',
  hold: { k: 1, only: true, q: '', sort: ['w', -1] }, // 完整持股表：比較基準、只看有增減、搜尋、排序
};
const ETF_TABS = [['tw', '台股 ETF 總覽'], ['high', '高股息比較'], ['us', '美股 ETF'], ['detail', '個別 ETF'], ['overlap', '持股重疊']];
const ETF_TYPES = ['股票', '債券', '主動式', '槓桿', '反向', '期貨／商品', '國外'];
const SECTOR_ZH = {
  technology: '科技', financial_services: '金融服務', basic_materials: '原物料', consumer_cyclical: '非必需消費', consumer_defensive: '必需消費',
  healthcare: '醫療保健', industrials: '工業', communication_services: '通訊服務', energy: '能源', utilities: '公用事業', realestate: '房地產',
};

function initEtf() {
  $('#etfTabs').innerHTML = ETF_TABS.map(([k, l]) => `<button data-t="${k}">${l}</button>`).join('');
  $('#etfTabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) etfShow(b.dataset.t); });
  $('#etfRefresh').addEventListener('click', () => etfLoad(etfS.tab, true));
  $('.nav-btn[data-section="etf"]').addEventListener('click', () => etfShow(etfS.tab));
}

function etfShow(tab) {
  etfS.tab = tab;
  $$('#etfTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === tab));
  $('#etfRefresh').classList.toggle('hidden', tab === 'overlap');
  if (tab === 'detail') return etfRenderDetailShell();
  if (tab === 'overlap') return etfRenderOverlap();
  if (etfS.data[tab]) etfRender(tab); else etfLoad(tab, false);
}

async function etfLoad(tab, force) {
  if (tab === 'detail') { if (etfS.cur) etfOpen(etfS.cur, true); return; }
  const body = $('#etfBody');
  if (!etfS.data[tab]) body.innerHTML = '<div class="panel-msg">載入中…</div>';
  etfStatus('更新中…');
  try {
    etfS.data[tab] = (await api('etf', { part: tab, force: !!force })).data;
    etfS.loadedAt[tab] = Date.now();
    if (etfS.tab === tab) etfRender(tab);
    etfStatus('已更新 · ' + new Date().toLocaleTimeString('zh-TW', { hour12: false }), 'live');
  } catch (err) {
    if (!etfS.data[tab]) body.innerHTML = `<div class="panel-msg err">載入失敗：${esc(err.message)}</div>`;
    etfStatus('更新失敗：' + err.message, 'err');
  }
}

function etfStatus(text, cls = '') {
  const el = $('#etfStatus');
  el.className = 'status ' + cls;
  el.innerHTML = '<span class="dot"></span>' + esc(text);
}

function etfRender(tab) {
  etfS.charts.forEach(c => c.remove());
  etfS.charts = [];
  ({ tw: etfRenderTw, high: etfRenderHigh, us: etfRenderUs })[tab]();
}

/** 可排序表格的表頭 */
function etfTh(cfg, key, label, num = true) {
  const on = cfg.sort[0] === key;
  return `<th class="${num ? 'num ' : ''}click ${on ? 'sel' : ''}" data-sort="${key}">${label}${on ? (cfg.sort[1] > 0 ? ' ▲' : ' ▼') : ''}</th>`;
}

function etfBindSort(cfg, rerender) {
  $$('#etfBody th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    cfg.sort = [k, cfg.sort[0] === k ? -cfg.sort[1] : -1];
    rerender();
  }));
}

function etfSorted(rows, cfg, get = (r, k) => r[k]) {
  const [k, dir] = cfg.sort;
  return rows.slice().sort((a, b) => {
    const x = get(a, k), y = get(b, k);
    if (!isNum(x) && !isNum(y)) return String(x || '').localeCompare(String(y || '')) * dir;
    if (!isNum(x)) return 1;
    if (!isNum(y)) return -1;
    return dir * (x - y);
  });
}

const premCls = v => (isNum(v) && Math.abs(v) >= 1 ? 'prem-warn' : '');
const yi = v => (isNum(v) ? numTxt(v, Math.abs(v) >= 100 ? 0 : 1) : '—'); // 億元

/* ---------- 台股 ETF 總覽 ---------- */
function etfRenderTw() {
  const d = etfS.data.tw, cfg = etfS.tw;
  const rows = d.rows.map(r => Object.fromEntries(d.fields.map((k, i) => [k, r[i]])));
  const list = rows.filter(r => (!cfg.type || r.type === cfg.type) &&
    (!cfg.q || r.code.includes(cfg.q.toUpperCase()) || r.name.includes(cfg.q)));
  const sum = (arr, k) => arr.reduce((s, r) => s + (isNum(r[k]) ? r[k] : 0), 0);
  const top = (k, dir, n = 5) => rows.filter(r => isNum(r[k]) && dir * r[k] > 0).sort((a, b) => dir * (b[k] - a[k])).slice(0, n);
  const mini = (title, arr, k, fmt) => `<div class="etf-mini"><div class="sub-h">${title}</div>${arr.length ? arr.map(r =>
    `<div class="etf-mini-row" data-open="${r.code}"><span>${esc(r.name)} <span class="muted">${r.code}</span></span><b class="${k === 'prem' ? premCls(r[k]) : dirCls(r[k])}">${fmt(r[k])}</b></div>`).join('') : '<div class="muted">—</div>'}</div>`;
  const shown = etfSorted(list, cfg).slice(0, 200);
  $('#etfBody').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">ETF 檔數</div><div class="kpi-v">${rows.length}</div><div class="kpi-s">資料日 ${esc(d.date)}</div></div>
      <div class="kpi"><div class="kpi-l">總規模</div><div class="kpi-v">${numTxt(sum(rows, 'aum') / 10000, 2)}<small> 兆</small></div></div>
      <div class="kpi"><div class="kpi-l">今日淨申購</div><div class="kpi-v ${dirCls(sum(rows, 'flow1'))}">${signTxt(sum(rows, 'flow1'), 1)}<small> 億</small></div></div>
      <div class="kpi"><div class="kpi-l">溢價 ≥1% 檔數</div><div class="kpi-v">${rows.filter(r => r.prem >= 1).length}</div><div class="kpi-s">折價 ≤−1%：${rows.filter(r => r.prem <= -1).length} 檔</div></div>
    </div>
    <div class="etf-minis">
      ${mini('今日資金流入前 5（億）', top('flow1', 1), 'flow1', v => signTxt(v, 1))}
      ${mini('今日資金流出前 5（億）', top('flow1', -1), 'flow1', v => signTxt(v, 1))}
      ${mini('溢價最高（%）', top('prem', 1), 'prem', v => signTxt(v, 2))}
      ${mini('折價最深（%）', top('prem', -1), 'prem', v => signTxt(v, 2))}
    </div>
    <div class="etf-filter">
      <div class="seg seg-sm" id="etfType">${[['', '全部']].concat(ETF_TYPES.map(t => [t, t])).map(([v, l]) => `<button data-v="${v}" class="${v === cfg.type ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input id="etfQ" placeholder="搜尋代號或名稱" value="${esc(cfg.q)}">
      <span class="muted">${list.length} 檔${list.length > 200 ? '（顯示前 200）' : ''}</span>
    </div>
    <div class="tbl-wrap"><table class="mtbl etf-tbl">
      <thead><tr>${etfTh(cfg, 'code', '代號', false)}${etfTh(cfg, 'name', '名稱', false)}<th>類型</th>${etfTh(cfg, 'price', '成交價')}${etfTh(cfg, 'nav', '預估淨值')}${etfTh(cfg, 'prem', '折溢價%')}
        ${etfTh(cfg, 'aum', '規模(億)')}${etfTh(cfg, 'flow1', '今日申贖(億)')}${etfTh(cfg, 'flow5', '5日(億)')}${etfTh(cfg, 'flow20', '20日(億)')}<th class="num">時間</th></tr></thead>
      <tbody>${shown.map(r => `<tr data-open="${r.code}">
        <td class="nm"><a href="#">${r.code}</a></td><td class="nm">${esc(r.name)}</td><td class="muted">${r.type}</td>
        <td class="num strong">${numTxt(r.price)}</td><td class="num">${numTxt(r.nav)}</td>
        <td class="num ${premCls(r.prem)}">${signTxt(r.prem, 2)}</td><td class="num">${yi(r.aum)}</td>
        <td class="num ${dirCls(r.flow1)}">${signTxt(r.flow1, 1)}</td><td class="num ${dirCls(r.flow5)}">${signTxt(r.flow5, 1)}</td><td class="num ${dirCls(r.flow20)}">${signTxt(r.flow20, 1)}</td>
        <td class="num muted">${esc(r.time || '')}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="foot-note">資料：證交所 ETF 即時淨值（盤中約每 15 秒更新）。折溢價 = 成交價相對投信預估淨值；|折溢價| ≥1% 以黃底標示，溢價買進等於多付成本。
      申贖金額 = 受益權單位數變化 × 淨值（正值為資金流入）。5／20 日需累積每日快照（目前 ${d.snapDays} 天，每次開啟此頁或每日排程時記錄）。點列可開啟個別 ETF。</div>`;
  $$('#etfType button').forEach(b => b.addEventListener('click', () => { cfg.type = b.dataset.v; etfRenderTw(); }));
  const q = $('#etfQ');
  q.addEventListener('input', () => { cfg.q = q.value.trim(); clearTimeout(q._t); q._t = setTimeout(() => { etfRenderTw(); const n = $('#etfQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
  etfBindSort(cfg, etfRenderTw);
  etfBindOpen();
}

function etfBindOpen() {
  $$('#etfBody [data-open]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); etfOpen(el.dataset.open); }));
}

/* ---------- 高股息比較 ---------- */
function freqTxt(n) { return n >= 10 ? '月配' : n >= 4 ? '季配' : n >= 2 ? '半年配' : n === 1 ? '年配' : '—'; }

function etfRenderHigh() {
  const d = etfS.data.high, cfg = etfS.high;
  const rows = etfSorted(d.rows, cfg);
  const best = k => Math.max(...d.rows.map(r => r[k]).filter(isNum));
  const mark = (r, k) => (isNum(r[k]) && r[k] === best(k) ? ' best' : '');
  $('#etfBody').innerHTML = `
    <div class="tbl-wrap"><table class="mtbl etf-tbl">
      <thead><tr>${etfTh(cfg, 'code', 'ETF', false)}${etfTh(cfg, 'price', '價格')}${etfTh(cfg, 'yld', '殖利率%')}${etfTh(cfg, 'div12', '近12月配息')}
        ${etfTh(cfg, 'divN', '頻率')}<th>最近除息</th>${etfTh(cfg, 'r1y', '1年價格%')}${etfTh(cfg, 'tr1y', '1年含息%')}${etfTh(cfg, 'tr3m', '3月含息%')}
        ${etfTh(cfg, 'aum', '規模(億)')}${etfTh(cfg, 'flow1', '今日申贖')}${etfTh(cfg, 'prem', '折溢價%')}${etfTh(cfg, 'fee', '費用率%')}</tr></thead>
      <tbody>${rows.map(r => `<tr data-open="${r.code}">
        <td class="nm"><a href="#">${r.code}</a> ${esc(r.name)}</td><td class="num strong">${numTxt(r.price)}</td>
        <td class="num${mark(r, 'yld')}">${numTxt(r.yld)}</td><td class="num">${numTxt(r.div12, 3)}</td><td>${freqTxt(r.divN)}</td>
        <td>${r.lastDiv ? `${mdTxt(r.lastDiv[0])} <span class="muted">${numTxt(r.lastDiv[1], 3)}</span>` : '—'}</td>
        <td class="num ${dirCls(r.r1y)}">${pctTxt(r.r1y)}</td><td class="num ${dirCls(r.tr1y)}${mark(r, 'tr1y')}">${pctTxt(r.tr1y)}</td><td class="num ${dirCls(r.tr3m)}">${pctTxt(r.tr3m)}</td>
        <td class="num">${yi(r.aum)}</td><td class="num ${dirCls(r.flow1)}">${signTxt(r.flow1, 1)}</td><td class="num ${premCls(r.prem)}">${signTxt(r.prem, 2)}</td>
        <td class="num">${isNum(r.fee) ? numTxt(r.fee * 100, 2) : '—'}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="foot-note">殖利率 = 近 12 個月配息合計 ÷ 目前股價（歷史數字，不代表未來配息）。「含息報酬」以還原權息股價計算，比單看殖利率更能反映實際報酬：
      高配息若伴隨股價下跌（賺息賠價）會顯示在這裡。藍底為該欄最高。費用率取自 Yahoo，部分 ETF 無資料。點列可看成分股與配息明細。</div>`;
  etfBindSort(cfg, etfRenderHigh);
  etfBindOpen();
}

/* ---------- 美股 ETF ---------- */
function etfRenderUs() {
  const d = etfS.data.us, cfg = etfS.us;
  const rows = etfSorted(d.rows, cfg);
  const flowTxt = v => (isNum(v) ? signTxt(v, 0) : '—');
  $('#etfBody').innerHTML = `
    <div class="tbl-wrap"><table class="mtbl etf-tbl">
      <thead><tr>${etfTh(cfg, 'sym', 'ETF', false)}<th>3 個月</th>${etfTh(cfg, 'price', '價格')}${etfTh(cfg, 'd1', '1D%')}${etfTh(cfg, 'm1', '1M%')}${etfTh(cfg, 'ytd', 'YTD%')}
        ${etfTh(cfg, 'aum', '規模($B)')}${etfTh(cfg, 'f1', '1日流向($M)')}${etfTh(cfg, 'f5', '5日')}${etfTh(cfg, 'f20', '20日')}</tr></thead>
      <tbody>${rows.map(r => `<tr data-open="${r.sym}">
        <td class="nm"><a href="#">${r.sym}</a> <span class="muted">${esc(r.name)}</span></td><td class="sp">${sparkSvg(r.spark)}</td>
        <td class="num strong">${numTxt(r.price)}</td><td class="num ${dirCls(r.d1)}">${pctTxt(r.d1)}</td><td class="num ${dirCls(r.m1)}">${pctTxt(r.m1)}</td><td class="num ${dirCls(r.ytd)}">${pctTxt(r.ytd)}</td>
        <td class="num">${isNum(r.aum) ? numTxt(r.aum / 1e9, 1) : '—'}</td>
        <td class="num ${dirCls(r.f1)}">${flowTxt(r.f1)}</td><td class="num ${dirCls(r.f5)}">${flowTxt(r.f5)}</td><td class="num ${dirCls(r.f20)}">${flowTxt(r.f20)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="foot-note">資金流向為估算：流通單位數變化 × 淨值（單位：百萬美元，正值為流入）。需累積每日快照（目前 ${d.snapDays} 天），Yahoo 的單位數不一定每天更新，數字僅供參考；
      專業的 ETF 資金流數據多為付費資料。點列可看成分股、產業權重與配息。</div>`;
  etfBindSort(cfg, etfRenderUs);
  etfBindOpen();
}

/* ---------- 個別 ETF ---------- */
function etfRenderDetailShell() {
  let recent = [];
  try { recent = JSON.parse(store.get('mw_etf_recent') || '[]'); } catch { recent = []; }
  $('#etfBody').innerHTML = `
    <form class="rs-search" id="etfForm" autocomplete="off">
      <input id="etfInput" placeholder="ETF 代號，例如 0050、00878、00679B、SPY、QQQ" value="${esc(etfS.cur || '')}">
      <button class="btn btn-primary" type="submit">查詢</button>
    </form>
    <div class="rs-chips">${['0050', '0056', '00878', '00919', '00929', '006208', 'SPY', 'QQQ', 'SMH'].concat(recent.filter(x => !['0050', '0056', '00878', '00919', '00929', '006208', 'SPY', 'QQQ', 'SMH'].includes(x)))
      .map(c => `<button type="button" class="rs-chip" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div id="etfDetail">${etfS.cur && etfS.detail[etfS.cur] ? '' : '<div class="panel-msg">輸入代號或點上方按鈕查看成分股、產業權重、持股變化、配息與規模</div>'}</div>`;
  $('#etfForm').addEventListener('submit', e => { e.preventDefault(); const v = $('#etfInput').value.trim(); if (v) etfOpen(v); });
  $$('#etfBody .rs-chip').forEach(b => b.addEventListener('click', () => etfOpen(b.dataset.c)));
  if (etfS.cur && etfS.detail[etfS.cur]) etfRenderDetail(etfS.detail[etfS.cur]);
}

async function etfOpen(code, force) {
  code = String(code).trim().toUpperCase();
  if (etfS.tab !== 'detail') { etfS.cur = code; etfShow('detail'); }
  etfS.cur = code;
  $('#etfInput').value = code;
  if (etfS.detail[code] && !force) return etfRenderDetail(etfS.detail[code]);
  $('#etfDetail').innerHTML = '<div class="panel-msg">載入中…</div>';
  etfStatus('查詢 ' + code + '…');
  try {
    const d = (await api('etf', { part: 'detail', code })).data;
    etfS.detail[code] = d;
    let recent = [];
    try { recent = JSON.parse(store.get('mw_etf_recent') || '[]'); } catch { recent = []; }
    store.set('mw_etf_recent', JSON.stringify([code].concat(recent.filter(x => x !== code)).slice(0, 8)));
    if (etfS.cur === code) etfRenderDetail(d);
    etfStatus('已更新 · ' + new Date().toLocaleTimeString('zh-TW', { hour12: false }), 'live');
  } catch (err) {
    $('#etfDetail').innerHTML = `<div class="panel-msg err">${esc(err.message)}</div>`;
    etfStatus(err.message, 'err');
  }
}

/** 成分股代號 → 中文名稱（選股器資料有載入時使用） */
function holdName(sym, fallback) {
  const code = String(sym || '').replace(/\.TWO?$/, '');
  const r = typeof scr !== 'undefined' && scr.rows && scr.rows.find(x => x.code === code);
  return r ? r.name : fallback || sym;
}

function etfRenderDetail(d) {
  etfS.charts.forEach(c => c.remove());
  etfS.charts = [];
  const R = d.ret || {}, m = d.mis || {};
  const cat = d.tw ? 'tw' : 'global';
  const have = inWatchlist(cat, d.code);
  const maxW = Math.max(...d.holdings.map(h => h[2] || 0), 0.01);
  const top10 = d.holdings.reduce((s, h) => s + (h[2] || 0), 0);
  // 持股變化
  let changes = '';
  if (d.holdPrev) {
    const prev = new Map(d.holdPrev.h.map(h => [h[0], h[2]]));
    const cur = new Map(d.holdings.map(h => [h[0], h[2]]));
    const rowsC = [...new Set([...prev.keys(), ...cur.keys()])].map(s => ({ s, n: (d.holdings.find(h => h[0] === s) || d.holdPrev.h.find(h => h[0] === s))[1], a: prev.get(s), b: cur.get(s) }))
      .map(x => Object.assign(x, { dv: (x.b || 0) - (x.a || 0) })).filter(x => Math.abs(x.dv) > 0.0001).sort((x, y) => Math.abs(y.dv) - Math.abs(x.dv));
    changes = `<div class="sub-h">持股變化（${d.holdPrev.d} → ${d.holdCurDate}）</div>
      ${rowsC.length ? `<div class="tbl-wrap"><table class="mtbl"><thead><tr><th>成分股</th><th class="num">原權重</th><th class="num">新權重</th><th class="num">變化</th></tr></thead><tbody>
      ${rowsC.map(x => `<tr><td class="nm">${esc(holdName(x.s, x.n))}${x.a == null ? ' <span class="tag ok">新進</span>' : x.b == null ? ' <span class="tag bad">移出前十</span>' : ''}</td>
        <td class="num">${isNum(x.a) ? numTxt(x.a * 100, 2) + '%' : '—'}</td><td class="num">${isNum(x.b) ? numTxt(x.b * 100, 2) + '%' : '—'}</td>
        <td class="num ${dirCls(x.dv)}">${signTxt(x.dv * 100, 2, ' 個百分點')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted">前十大成分股權重沒有變化</div>'}`;
  } else {
    changes = `<div class="foot-note">持股變化：已記錄 ${d.holdCurDate || '今天'} 的前十大持股，之後成分股或權重改變時，會在這裡顯示與上次的差異。</div>`;
  }
  const uh = d.unitsHist || [];
  $('#etfDetail').innerHTML = `
    <div class="macro-grid etf-detail">
      <section class="panel" style="--span:12"><div class="panel-body">
        <div class="rs-title">
          <div><div class="rs-name">${esc(d.name)} <span class="muted">${esc(d.code)}${d.type ? ' · ' + d.type + '型' : ''}${d.category ? ' · ' + esc(d.category) : ''}${d.family ? ' · ' + esc(d.family) : ''}</span></div>
            <div class="rs-price"><b>${numTxt(m.price || R.price)}</b>${d.tw ? ` <span class="muted">預估淨值 ${numTxt(m.nav)}</span> <span class="tag ${premCls(m.prem) ? 'warn' : ''}">折溢價 ${signTxt(m.prem, 2, '%')}</span>` : ''}</div></div>
          <div class="rs-actions">
            <button class="btn btn-ghost btn-sm" id="etfChartBtn">📈 走勢圖</button>
            <button class="btn btn-ghost btn-sm" id="etfAdd" ${have ? 'disabled' : ''}>${have ? '✓ 已在自選' : '＋ 加入自選'}</button>
          </div>
        </div>
        <div class="kpis rs-kpis">
          <div class="kpi"><div class="kpi-l">規模</div><div class="kpi-v">${d.tw && m.units && (m.nav || m.prevNav) ? numTxt(m.units * (m.nav || m.prevNav) / 1e8, 0) + '<small> 億</small>' : isNum(d.aum) ? numTxt(d.aum / 1e9, 1) + '<small> B</small>' : '—'}</div></div>
          <div class="kpi"><div class="kpi-l">費用率</div><div class="kpi-v">${isNum(d.fee) ? numTxt(d.fee * 100, 2) + '%' : '—'}</div></div>
          <div class="kpi"><div class="kpi-l">近 12 月殖利率</div><div class="kpi-v">${numTxt(R.yld)}%</div><div class="kpi-s">${freqTxt(R.divN)}・合計 ${numTxt(R.div12, 3)}</div></div>
          <div class="kpi"><div class="kpi-l">1 年報酬</div><div class="kpi-v ${dirCls(R.tr1y)}">${pctTxt(R.tr1y)}</div><div class="kpi-s">含息；價格 ${pctTxt(R.r1y)}</div></div>
          <div class="kpi"><div class="kpi-l">1 個月</div><div class="kpi-v ${dirCls(R.r1m)}">${pctTxt(R.r1m)}</div></div>
          ${d.tw ? `<div class="kpi"><div class="kpi-l">今日申贖</div><div class="kpi-v ${dirCls(m.dUnits)}">${isNum(m.dUnits) && (m.nav || m.prevNav) ? signTxt(m.dUnits * (m.nav || m.prevNav) / 1e8, 1) + '<small> 億</small>' : '—'}</div></div>` : ''}
        </div>
      </div></section>

      <section class="panel" style="--span:7"><div class="panel-head"><h2 class="panel-title">前十大成分股</h2><span class="muted">合計 ${numTxt(top10 * 100, 1)}%</span></div>
        <div class="panel-body">${d.holdings.length ? `<div class="hbars">${d.holdings.map(h => `
          <div class="hbar"><span class="hbar-n">${esc(holdName(h[0], h[1]))} <span class="muted">${esc(String(h[0]).replace(/\.TWO?$/, ''))}</span></span>
            <span class="hbar-t"><i style="width:${(h[2] / maxW) * 100}%"></i></span><b>${numTxt(h[2] * 100, 2)}%</b></div>`).join('')}</div>` : '<div class="panel-msg">Yahoo 未提供此 ETF 的成分股（債券、期貨型常見）</div>'}
          ${changes}
          <div class="foot-note">成分股與權重來源 Yahoo Finance，可能比投信公告晚數日；完整持股請以投信官網為準。</div></div></section>

      <section class="panel" style="--span:5"><div class="panel-head"><h2 class="panel-title">產業權重</h2></div>
        <div class="panel-body">${d.sectors.length ? `<div class="hbars">${d.sectors.map(s => `
          <div class="hbar"><span class="hbar-n">${SECTOR_ZH[s[0]] || s[0]}</span><span class="hbar-t"><i style="width:${(s[1] / d.sectors[0][1]) * 100}%;background:#6d4bc4"></i></span><b>${numTxt(s[1] * 100, 1)}%</b></div>`).join('')}</div>` : '<div class="panel-msg">無產業權重資料</div>'}</div></section>

      <section class="panel" style="--span:12" id="etfHoldPanel"></section>

      <section class="panel" style="--span:7"><div class="panel-head"><h2 class="panel-title">價格與含息報酬（近 3 年）</h2></div>
        <div class="panel-body"><div class="chart-legend"><span style="--c:#1f4e8c">股價</span><span style="--c:#e67e22">還原權息（含息再投入）</span></div>
          <div class="mini-chart tall" id="etfPx"></div>
          <div class="foot-note">兩條線起點相同；差距愈大代表配息對報酬的貢獻愈大。</div></div></section>

      <section class="panel" style="--span:5"><div class="panel-head"><h2 class="panel-title">配息紀錄</h2></div>
        <div class="panel-body">${d.divs.length ? `<div class="tbl-wrap"><table class="mtbl"><thead><tr><th>除息日</th><th class="num">每單位配息</th><th class="num">當時殖利率</th></tr></thead><tbody>
          ${d.divs.map(x => { const i = d.chart.t.findIndex(t => t >= x[0]); const px = i > 0 ? d.chart.c[i - 1] : null;
            return `<tr><td class="nm">${x[0]}</td><td class="num strong">${numTxt(x[1], 3)}</td><td class="num">${px ? numTxt(x[1] / px * 100, 2) + '%' : '—'}</td></tr>`; }).join('')}</tbody></table></div>
          <div class="foot-note">當時殖利率 = 單次配息 ÷ 除息前一日收盤（未年化）。</div>` : '<div class="panel-msg">近年無配息紀錄</div>'}</div></section>

      ${d.tw ? `<section class="panel" style="--span:12"><div class="panel-head"><h2 class="panel-title">規模與受益權單位數</h2></div>
        <div class="panel-body">${uh.length >= 2 ? `<div class="chart-legend"><span style="--c:#16a085">受益權單位數（億，右軸）</span><span style="--c:#1f4e8c">規模（億元，左軸）</span></div><div class="mini-chart" id="etfUnits"></div>` :
          '<div class="panel-msg">單位數歷史累積中：每次開啟 ETF 總覽或每日排程會記錄一筆，累積兩天以上即可看到走勢與申贖變化。</div>'}</div></section>` : ''}
    </div>`;
  $('#etfAdd').addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true;
    try { await addToWatchlist(cat, d.code); b.textContent = '✓ 已在自選'; } catch (err) { b.disabled = false; toast('加入失敗：' + err.message); }
  });
  $('#etfChartBtn').addEventListener('click', () => openChart({ category: cat, symbol: d.code, name: d.name, source: 'yahoo:' + d.ysym }));
  etfRenderHold(d);
  etfDetailCharts(d);
}

/* ---------- 完整持股與增減（MoneyDJ 每日持股 + 後端快照比較） ---------- */
const HOLD_COLS = [['sym', '成分股', false], ['w', '權重%'], ['sh', '目前庫存'], ['ds', '增減'], ['dp', '增減%'], ['amt', '估計金額']];

function etfRenderHold(d) {
  const el = $('#etfHoldPanel');
  if (!el) return;
  const h = d.hold, cfg = etfS.hold;
  const head = sub => `<div class="panel-head"><h2 class="panel-title">完整持股與增減</h2>${sub || ''}<div class="panel-tools"></div></div>`;
  if (!h || h.err || !h.rows) {
    el.innerHTML = head() + `<div class="panel-body"><div class="panel-msg">${h && h.err ? '持股明細暫時無法取得：' + esc(h.err) : '查無完整持股資料（MoneyDJ 未提供此 ETF）'}</div></div>`;
    return;
  }
  const m = d.mis || {};
  const nav = m.nav || m.prevNav;
  // 規模：台股用證交所單位數 × 淨值；美股用 Yahoo 總資產（美元）
  const aum = d.tw ? (m.units && nav ? m.units * nav : null) : d.aum;
  const unitOf = sym => (d.tw && /^\d{4,6}[A-Z]?$/.test(sym) ? 1000 : 1); // 台股以「張」顯示
  const cmps = h.cmp || [];
  if (cmps.length && !cmps.some(c => c.k === cfg.k)) cfg.k = cmps[0].k;
  const cmp = cmps.find(c => c.k === cfg.k);
  const chg = new Map((cmp ? cmp.rows : []).map(r => [r[0], r]));
  const cur = new Map(h.rows.map(r => [r[0], r]));
  // 每股價值估算 = 權重 × 規模 ÷ 股數（成分股報價不另外抓）
  const px = (w, sh) => (isNum(w) && sh && aum ? (w / 100) * aum / sh : null);
  let rows = h.rows.map(r => {
    const c = chg.get(r[0]);
    const ds = c ? c[2] : 0;
    const prev = c ? c[3] : r[3];
    return { sym: r[0], name: r[1], w: r[2], sh: r[3], ds, prev, isNew: !!c && c[3] == null, out: false,
      dp: c && prev ? ds / prev * 100 : c ? null : 0, amt: ds ? ds * px(r[2], r[3]) : 0 };
  });
  (cmp ? cmp.rows : []).filter(r => !cur.has(r[0])).forEach(r => rows.push({
    sym: r[0], name: r[1], w: null, sh: 0, ds: r[2], prev: r[3], isNew: false, out: true, dp: -100, amt: r[2] * px(r[5], r[3]),
  }));
  const up = rows.filter(r => r.ds > 0), dn = rows.filter(r => r.ds < 0);
  const sumAmt = arr => arr.reduce((s, r) => s + (isNum(r.amt) ? r.amt : 0), 0);
  // 同期受益權單位數變化：持股增減幅度接近它，多半是申購買回造成的被動增減
  let unitChg = null;
  if (cmp && d.unitsHist && d.unitsHist.length) {
    const at = ds => d.unitsHist.filter(x => x[0] <= ds).pop();
    const a = at(cmp.date), b = at(h.date);
    if (a && b && a[0] !== b[0] && a[1]) unitChg = (b[1] / a[1] - 1) * 100;
  }
  const q = cfg.q.toUpperCase();
  let list = rows.filter(r => (!cfg.only || !cmp || r.ds) && (!q || r.sym.toUpperCase().includes(q) || r.name.toUpperCase().includes(q)));
  list = etfSorted(list, cfg);
  const amtTxt = v => (!isNum(v) || !v ? '—' : d.tw ? signTxt(v / 1e8, 2) + ' 億' : signTxt(v / 1e6, 1) + ' M');
  const shTxt = (v, sym) => (isNum(v) ? numTxt(v / unitOf(sym), unitOf(sym) > 1 && Math.abs(v) < 10000 ? 3 : 0) : '—');
  const top = (arr, dir) => arr.slice().sort((a, b) => dir * ((b.amt || 0) - (a.amt || 0))).slice(0, 5)
    .map(r => `<div class="etf-mini-row"><span>${esc(r.name)} <span class="muted">${esc(r.sym)}</span></span><b class="${dirCls(r.ds)}">${shTxt(r.ds, r.sym)}</b></div>`).join('') || '<div class="muted">—</div>';
  const unitLbl = d.tw ? '張' : '股';
  const dateNote = cmp ? `${cmp.date} → ${h.date}${cmp.exact ? '' : `（${cmp.want || ''} 無快照，改用最近一筆）`}` : '';
  el.innerHTML = head(`<span class="muted">資料日 ${esc(h.date)}・${h.rows.length} 檔</span>`) + `<div class="panel-body">
    ${cmp ? `
      <div class="kpis">
        <div class="kpi"><div class="kpi-l">比較區間</div><div class="kpi-v" style="font-size:15px">${esc(cmp.label)}</div><div class="kpi-s">${esc(dateNote)}</div></div>
        <div class="kpi"><div class="kpi-l">增持</div><div class="kpi-v up">${up.length}<small> 檔</small></div><div class="kpi-s">估計 ${amtTxt(sumAmt(up))}</div></div>
        <div class="kpi"><div class="kpi-l">減持</div><div class="kpi-v down">${dn.length}<small> 檔</small></div><div class="kpi-s">估計 ${amtTxt(sumAmt(dn))}</div></div>
        <div class="kpi"><div class="kpi-l">新進／剔除</div><div class="kpi-v">${rows.filter(r => r.isNew).length} / ${rows.filter(r => r.out).length}</div></div>
        ${isNum(unitChg) ? `<div class="kpi"><div class="kpi-l">同期受益權單位數</div><div class="kpi-v ${dirCls(unitChg)}">${signTxt(unitChg, 2, '%')}</div><div class="kpi-s">申購買回造成的被動增減</div></div>` : ''}
      </div>
      <div class="etf-minis etf-minis-2">
        <div class="etf-mini"><div class="sub-h">增持金額前 5（${unitLbl}）</div>${top(up, 1)}</div>
        <div class="etf-mini"><div class="sub-h">減持金額前 5（${unitLbl}）</div>${top(dn, -1)}</div>
      </div>` : `<div class="hold-wait">${h.monthly
        ? '美股 ETF 持股每月公布一次，已記錄本期資料；下次公布後即可看到與上期的增減。'
        : `已開始記錄此 ETF 的每日持股（目前 ${h.snaps + 1} 筆）。下一個交易日起可看「前 1 個交易日」增減，累積 6 個交易日後可看「前 5 個交易日」。
           建議在 Apps Script 執行一次 <b>setupEtf</b>，沒開網頁也會每天自動記錄。`}</div>`}
    <div class="etf-filter">
      ${cmps.length > 1 ? `<div class="seg seg-sm" id="holdK">${cmps.map(c => `<button data-v="${c.k}" class="${c.k === cfg.k ? 'on' : ''}">${esc(c.label)}</button>`).join('')}</div>` : ''}
      ${cmp ? `<label class="chk"><input type="checkbox" id="holdOnly" ${cfg.only ? 'checked' : ''}> 只看有增減</label>` : ''}
      <input id="holdQ" placeholder="搜尋成分股" value="${esc(cfg.q)}">
      <span class="muted">${list.length} 檔</span>
    </div>
    <div class="tbl-wrap hold-wrap"><table class="mtbl etf-tbl" id="holdTbl">
      <thead><tr>${HOLD_COLS.filter(c => cmp || !['ds', 'dp', 'amt'].includes(c[0])).map(c => etfTh(cfg, c[0], c[0] === 'sh' ? `${c[1]}（${unitLbl}）` : c[0] === 'ds' ? `${c[1]}（${unitLbl}）` : c[1], c[2] !== false)).join('')}</tr></thead>
      <tbody>${list.length ? list.map(r => `<tr>
        <td class="nm">${esc(r.name)} <span class="muted">${esc(r.sym === r.name ? '' : r.sym)}</span>${r.isNew ? ' <span class="tag ok">新進</span>' : r.out ? ' <span class="tag bad">剔除</span>' : ''}</td>
        <td class="num">${isNum(r.w) ? numTxt(r.w, 2) : '—'}</td>
        <td class="num strong">${shTxt(r.sh, r.sym)}</td>
        ${cmp ? `<td class="num ${dirCls(r.ds)}">${r.ds ? (r.ds > 0 ? '+' : '') + shTxt(r.ds, r.sym) : '—'}</td>
        <td class="num ${dirCls(r.ds)}">${r.isNew ? '新進' : r.ds ? signTxt(r.dp, 2, '%') : '—'}</td>
        <td class="num ${dirCls(r.amt)}">${amtTxt(r.amt)}</td>` : ''}</tr>`).join('')
        : `<tr><td colspan="6" class="muted">${cmp ? '此區間持股股數沒有變化' : '—'}</td></tr>`}</tbody>
    </table></div>
    <div class="foot-note">來源：MoneyDJ（投信公告的全部持股與股數${d.tw ? '，資料日通常是前一個交易日' : '，美股每月更新'}）。「目前庫存」為 ETF 持有的${d.tw ? '張數（1 張 = 1,000 股；期貨為口數）' : '股數'}；
      增減 = 與比較日快照的差。估計金額 = 增減股數 × 估計股價（權重 × 規模 ÷ 股數），僅供參考。
      持股增減幅度若都接近「同期受益權單位數」變化，代表是申購買回造成的等比例增減，偏離較大的才是經理人主動調整（主動式 ETF 尤其值得看）。</div>
  </div>`;
  $$('#holdK button').forEach(b => b.addEventListener('click', () => { cfg.k = +b.dataset.v; etfRenderHold(d); }));
  const only = $('#holdOnly');
  if (only) only.addEventListener('change', () => { cfg.only = only.checked; etfRenderHold(d); });
  const qi = $('#holdQ');
  qi.addEventListener('input', () => { cfg.q = qi.value.trim(); clearTimeout(qi._t); qi._t = setTimeout(() => { etfRenderHold(d); const n = $('#holdQ'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
  $$('#holdTbl th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    cfg.sort = [k, cfg.sort[0] === k ? -cfg.sort[1] : -1];
    etfRenderHold(d);
  }));
}

function etfDetailCharts(d) {
  const LWC = window.LightweightCharts;
  if (!LWC) return;
  const mk = el => { const ch = LWC.createChart(el, { autoSize: true, layout: { background: { type: 'solid', color: '#fff' }, textColor: '#5b6778', fontSize: 11 }, grid: { vertLines: { color: '#f2f4f7' }, horzLines: { color: '#f2f4f7' } }, rightPriceScale: { borderColor: '#e3e8ef' }, timeScale: { borderColor: '#e3e8ef' }, localization: { locale: 'zh-TW', dateFormat: 'yyyy-MM-dd' }, handleScale: { mouseWheel: false } }); etfS.charts.push(ch); return ch; };
  const plain = { priceLineVisible: false, lastValueVisible: true };
  const px = $('#etfPx');
  if (px && d.chart.t.length) {
    const ch = mk(px);
    const base = d.chart.c[0], baseA = d.chart.a[0];
    const pf = { type: 'custom', formatter: v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%' };
    ch.addSeries(LWC.LineSeries, { ...plain, color: '#1f4e8c', lineWidth: 2, priceFormat: pf }).setData(d.chart.t.map((t, i) => ({ time: t, value: (d.chart.c[i] / base - 1) * 100 })));
    ch.addSeries(LWC.LineSeries, { ...plain, color: '#e67e22', lineWidth: 2, priceFormat: pf }).setData(d.chart.t.map((t, i) => ({ time: t, value: (d.chart.a[i] / baseA - 1) * 100 })));
    ch.timeScale().fitContent();
  }
  const ue = $('#etfUnits');
  if (ue) {
    const ch = mk(ue);
    ch.applyOptions({ leftPriceScale: { visible: true, borderColor: '#e3e8ef' } });
    ch.addSeries(LWC.LineSeries, { ...plain, color: '#16a085', lineWidth: 2, priceScaleId: 'right' }).setData(d.unitsHist.map(x => ({ time: x[0], value: x[1] / 1e8 })));
    ch.addSeries(LWC.LineSeries, { ...plain, color: '#1f4e8c', lineWidth: 2, priceScaleId: 'left' }).setData(d.unitsHist.map(x => ({ time: x[0], value: x[1] * x[2] / 1e8 })));
    ch.timeScale().fitContent();
  }
}

/* ---------- 持股重疊 ---------- */
function etfRenderOverlap() {
  $('#etfBody').innerHTML = `
    <form class="rs-search" id="ovForm" autocomplete="off">
      <input id="ovA" value="${esc(etfS.ovA)}" placeholder="ETF A，例如 0056"><input id="ovB" value="${esc(etfS.ovB)}" placeholder="ETF B，例如 00878">
      <button class="btn btn-primary" type="submit">比較</button>
    </form>
    <div id="ovOut"><div class="panel-msg">輸入兩檔 ETF，比較成分股的重疊程度（有完整持股時比較全部持股），避免買了兩檔其實持有同一批股票</div></div>`;
  $('#ovForm').addEventListener('submit', async e => {
    e.preventDefault();
    const a = $('#ovA').value.trim().toUpperCase(), b = $('#ovB').value.trim().toUpperCase();
    if (!a || !b) return;
    etfS.ovA = a; etfS.ovB = b;
    $('#ovOut').innerHTML = '<div class="panel-msg">載入中…</div>';
    try {
      for (const c of [a, b]) if (!etfS.detail[c]) etfS.detail[c] = (await api('etf', { part: 'detail', code: c })).data;
      etfRenderOverlapResult(etfS.detail[a], etfS.detail[b]);
    } catch (err) { $('#ovOut').innerHTML = `<div class="panel-msg err">${esc(err.message)}</div>`; }
  });
}

/** 重疊比較用的持股：兩檔都有完整持股就用完整持股，否則都用前十大（代號統一去掉 .TW） */
function ovHoldings(A, B) {
  const full = A.hold && A.hold.rows && B.hold && B.hold.rows;
  const pick = d => (full ? d.hold.rows.filter(r => isNum(r[2])).map(r => [r[0], r[1], r[2] / 100])
    : d.holdings.map(h => [String(h[0]).replace(/\.TWO?$/, ''), h[1], h[2] || 0]));
  return { full, a: pick(A), b: pick(B) };
}

function etfRenderOverlapResult(A, B) {
  const H = ovHoldings(A, B);
  const scope = H.full ? '全部持股' : '前十大持股';
  const ma = new Map(H.a.map(h => [h[0], h])), mb = new Map(H.b.map(h => [h[0], h]));
  const common = [...ma.keys()].filter(k => mb.has(k)).map(k => ({ s: k, n: ma.get(k)[1], a: ma.get(k)[2], b: mb.get(k)[2] }))
    .sort((x, y) => Math.min(y.a, y.b) - Math.min(x.a, x.b));
  const ov = common.reduce((s, x) => s + Math.min(x.a, x.b), 0);
  const secA = new Map(A.sectors), secB = new Map(B.sectors);
  const secOv = [...new Set([...secA.keys(), ...secB.keys()])].reduce((s, k) => s + Math.min(secA.get(k) || 0, secB.get(k) || 0), 0);
  $('#ovOut').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">${scope}重疊</div><div class="kpi-v">${numTxt(ov * 100, 1)}%</div><div class="kpi-s">共同持股 ${common.length} 檔</div></div>
      <div class="kpi"><div class="kpi-l">產業權重重疊</div><div class="kpi-v">${numTxt(secOv * 100, 1)}%</div></div>
      <div class="kpi"><div class="kpi-l">${esc(A.code)} 持股檔數</div><div class="kpi-v">${H.a.length}</div><div class="kpi-s">比較範圍權重合計 ${numTxt(H.a.reduce((s, h) => s + h[2], 0) * 100, 1)}%</div></div>
      <div class="kpi"><div class="kpi-l">${esc(B.code)} 持股檔數</div><div class="kpi-v">${H.b.length}</div><div class="kpi-s">比較範圍權重合計 ${numTxt(H.b.reduce((s, h) => s + h[2], 0) * 100, 1)}%</div></div>
    </div>
    <div class="tbl-wrap"><table class="mtbl"><thead><tr><th>共同持股</th><th class="num">${esc(A.code)} 權重</th><th class="num">${esc(B.code)} 權重</th><th class="num">重疊</th></tr></thead>
      <tbody>${common.length ? common.map(x => `<tr><td class="nm">${esc(holdName(x.s, x.n))}</td><td class="num">${numTxt(x.a * 100, 2)}%</td><td class="num">${numTxt(x.b * 100, 2)}%</td><td class="num strong">${numTxt(Math.min(x.a, x.b) * 100, 2)}%</td></tr>`).join('')
        : `<tr><td colspan="4" class="muted">${scope}沒有重疊</td></tr>`}</tbody></table></div>
    <div class="foot-note">重疊度 = 共同持股在兩檔 ETF 中「較小權重」的加總（比較範圍：${scope}${H.full ? '，來源 MoneyDJ' : '，實際重疊可能更高'}）。產業重疊同理。重疊度高代表分散效果有限。</div>`;
}

initEtf();
