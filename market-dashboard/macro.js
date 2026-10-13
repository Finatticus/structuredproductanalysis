/* =========================================================
 * 總經與板塊分析 — 前端
 * 只在點開此頁（或按重新整理）時向後端要資料；各區塊獨立載入、獨立顯示錯誤
 * 依賴 app.js 的 $, $$, api, esc, store, state, toast
 * ========================================================= */
const MACRO_PARTS = [
  { key: 'cross', title: '跨資產與市場情緒', span: 7 },
  { key: 'news', title: '即時重大新聞', span: 5 },
  { key: 'sectors', title: '板塊輪動熱力圖', span: 12 },
  { key: 'calendar', title: '經濟日曆', span: 7 },
  { key: 'earnings', title: '財報日曆（自選清單）', span: 5 },
  { key: 'curve', title: '美債殖利率曲線與利差', span: 7 },
  { key: 'fomc', title: 'FOMC 利率預測', span: 5 },
  { key: 'margin', title: '台股信用交易', span: 6 },
  { key: 'inst', title: '三大法人買賣超', span: 6 },
  { key: 'flow', title: '資金流向排行（個股法人買賣超）', span: 12 },
  { key: 'twmacro', title: '台灣景氣與央行', span: 5 },
  { key: 'econ', title: '美國經濟數據', span: 7 },
];
const SPAN_OPTS = [[4, '1/3 寬'], [5, '5/12 寬'], [6, '1/2 寬'], [7, '7/12 寬'], [8, '2/3 寬'], [12, '全寬']];
const PERIODS = [['d1', '1D', 3], ['w1', '1W', 6], ['m1', '1M', 10], ['m3', '3M', 18], ['ytd', 'YTD', 30]];
const CURVE_COLORS = ['#1f4e8c', '#5aa0e6', '#e67e22', '#a3abb8'];
const MACRO_RELOAD_MS = 60000; // 一分鐘內切回此頁不重抓

const macro = {
  loadedAt: 0,
  data: {},
  charts: {},
  editing: false,
  sortable: null,
  layout: null,
  ui: Object.assign(
    { news: 'headline', mkt: 'us', period: 'd1', view: 'tiles', curves: [true, true, true, true], marginMkt: 'tse', instMkt: 'tse',
      flowMkt: 'tse', flowBy: 'shares', flowEtf: '0' },
    (() => { try { return JSON.parse(store.get('mw_macro') || '{}'); } catch { return {}; } })(),
  ),
};
function saveMacroUi() { store.set('mw_macro', JSON.stringify(macro.ui)); }

/** 面板 → 後端區塊名稱（信用交易、法人依上市／上櫃選擇） */
function apiPart(key) {
  if (key === 'margin' && macro.ui.marginMkt === 'otc') return 'margin_otc';
  if (key === 'inst' && macro.ui.instMkt === 'otc') return 'inst_otc';
  if (key === 'flow' && macro.ui.flowMkt === 'otc') return 'flow_otc';
  return key;
}

/** 上市／上櫃切換：已載入過就直接顯示，否則向後端要 */
function marketSeg(tools, key, uiKey) {
  seg(tools, [['tse', '上市'], ['otc', '上櫃']], macro.ui[uiKey], v => {
    macro.ui[uiKey] = v;
    saveMacroUi();
    if (macro.data[apiPart(key)]) renderPart(key); else loadPart(key, false);
  });
}

/* ---------- 初始化 ---------- */
function initMacro() {
  const grid = $('#macroGrid');
  grid.innerHTML = MACRO_PARTS.map(p => `
    <section class="panel" data-part="${p.key}" style="--span:${p.span}">
      <div class="panel-head">
        <h2 class="panel-title">${p.title}</h2>
        <div class="panel-tools"></div>
        <span class="panel-time"></span>
        <div class="panel-edit">
          <select data-w title="字卡寬度">${SPAN_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          <label class="chk"><input type="checkbox" data-show checked> 顯示</label>
        </div>
      </div>
      <div class="panel-body"><div class="panel-msg">尚未載入</div></div>
    </section>`).join('');
  $('.nav-btn[data-section="macro"]').addEventListener('click', () => loadMacro(false));
  $('#macroRefresh').addEventListener('click', () => loadMacro(true));
  $('#colorSel').addEventListener('change', () => MACRO_PARTS.forEach(p => renderPart(p.key)));

  $('#macroEdit').addEventListener('click', () => setMacroEditing(!macro.editing));
  $('#macroReset').addEventListener('click', () => {
    if (!confirm('確定要還原預設的字卡順序與寬度？')) return;
    macro.layout = { order: [], w: {}, hide: [] };
    applyMacroLayout();
    saveMacroLayout();
  });
  grid.addEventListener('change', e => {
    const panel = e.target.closest('.panel');
    if (!panel) return;
    const key = panel.dataset.part, L = macroLayout();
    if (e.target.matches('[data-w]')) L.w[key] = +e.target.value;
    if (e.target.matches('[data-show]')) {
      L.hide = L.hide.filter(k => k !== key);
      if (!e.target.checked) L.hide.push(key);
    }
    applyMacroLayout();
    saveMacroLayout();
  });
  if (window.Sortable) {
    macro.sortable = Sortable.create(grid, {
      draggable: '.panel', handle: '.panel-head', filter: 'select, input, label', preventOnFilter: false,
      animation: 180, ghostClass: 'sortable-ghost', disabled: true,
      onEnd: e => {
        if (e.oldIndex === e.newIndex) return;
        macroLayout().order = $$('#macroGrid .panel').map(x => x.dataset.part);
        saveMacroLayout();
      },
    });
  }
}

/* ---------- 字卡版面（順序／寬度／顯示）：存在試算表的個人設定 macroLayout ---------- */
function macroLayout() {
  if (!macro.layout) {
    let L = {};
    try { L = JSON.parse((state.settings && state.settings.macroLayout) || '{}'); } catch { L = {}; }
    macro.layout = { order: L.order || [], w: L.w || {}, hide: L.hide || [] };
  }
  return macro.layout;
}

function applyMacroLayout() {
  const L = macroLayout(), grid = $('#macroGrid');
  const def = MACRO_PARTS.map(p => p.key);
  // 已存順序優先；新加入的字卡依預設位置插入
  const order = L.order.filter(k => def.includes(k));
  def.forEach((k, i) => { if (!order.includes(k)) order.splice(Math.min(i, order.length), 0, k); });
  order.forEach(k => grid.appendChild($(`.panel[data-part="${k}"]`, grid)));
  MACRO_PARTS.forEach(p => {
    const panel = $(`.panel[data-part="${p.key}"]`, grid);
    const span = L.w[p.key] || p.span;
    panel.style.setProperty('--span', span);
    $('[data-w]', panel).value = String(span);
    const hidden = L.hide.includes(p.key);
    panel.classList.toggle('is-hidden', hidden);
    $('[data-show]', panel).checked = !hidden;
  });
}

async function saveMacroLayout() {
  const value = JSON.stringify(macroLayout());
  state.settings = Object.assign(state.settings || {}, { macroLayout: value });
  try { await api('saveSetting', { key: 'macroLayout', value }); }
  catch (err) { toast('版面儲存失敗：' + err.message); }
}

function setMacroEditing(on) {
  macro.editing = on;
  $('#macroGrid').classList.toggle('editing', on);
  $('#macroEditHint').classList.toggle('hidden', !on);
  $('#macroReset').classList.toggle('hidden', !on);
  const b = $('#macroEdit');
  b.classList.toggle('on', on);
  b.textContent = on ? '✓ 完成' : '✎ 編輯版面';
  if (macro.sortable) macro.sortable.option('disabled', !on);
  if (!on) {
    // 結束編輯：重新顯示的字卡若還沒資料就載入；圖表依新寬度重畫
    MACRO_PARTS.forEach(p => {
      if (macroLayout().hide.includes(p.key)) return;
      if (macro.data[apiPart(p.key)]) renderPart(p.key); else loadPart(p.key, false);
    });
  }
}

async function loadMacro(force) {
  if (!state.token) return;
  if (!force && Date.now() - macro.loadedAt < MACRO_RELOAD_MS) return;
  macro.loadedAt = Date.now();
  const st = $('#macroStatus');
  st.className = 'status';
  st.innerHTML = '<span class="dot"></span>更新中…';
  applyMacroLayout();
  const visible = MACRO_PARTS.filter(p => !macroLayout().hide.includes(p.key)); // 隱藏的字卡不抓，省額度
  const results = await Promise.allSettled(visible.map(p => loadPart(p.key, force)));
  const fail = results.filter(r => r.status === 'rejected' || r.value === false).length;
  st.className = 'status ' + (fail ? 'err' : 'live');
  st.innerHTML = '<span class="dot"></span>' + (fail ? `${fail} 個區塊載入失敗 · ` : '已更新 · ') +
    new Date().toLocaleTimeString('zh-TW', { hour12: false });
}

async function loadPart(key, force) {
  const panel = $(`.panel[data-part="${key}"]`);
  const part = apiPart(key);
  panel.classList.add('loading');
  if (!macro.data[part]) $('.panel-body', panel).innerHTML = '<div class="panel-msg">載入中…</div>';
  try {
    const r = await api('macro', { part, force: !!force });
    macro.data[part] = r.data;
    renderPart(key);
    return true;
  } catch (err) {
    $('.panel-body', panel).innerHTML =
      `<div class="panel-msg err">載入失敗：${esc(err.message)}<br><button class="btn btn-ghost btn-sm" data-retry>重試</button></div>`;
    $('[data-retry]', panel).addEventListener('click', () => loadPart(key, true));
    return false;
  } finally {
    panel.classList.remove('loading');
  }
}

function renderPart(key) {
  const d = macro.data[apiPart(key)];
  const panel = $(`.panel[data-part="${key}"]`);
  if (!d || !panel) return;
  (macro.charts[key] || []).forEach(c => c.remove());
  macro.charts[key] = [];
  $('.panel-time', panel).textContent = d.updated ? '更新 ' + new Date(d.updated).toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '';
  const tools = $('.panel-tools', panel), body = $('.panel-body', panel);
  tools.innerHTML = '';
  try {
    ({ cross: renderCross, news: renderNews, sectors: renderSectors, curve: renderCurve,
      fomc: renderFomc, margin: renderMargin, inst: renderInst, econ: renderEcon, flow: renderFlow,
      earnings: renderEarnings, calendar: renderCalendar, twmacro: renderTwMacro })[key](d, body, tools, key);
  } catch (err) {
    console.error(err);
    body.innerHTML = `<div class="panel-msg err">顯示失敗：${esc(err.message)}</div>`;
  }
}

/* ---------- 共用小工具 ---------- */
const isNum = v => v != null && isFinite(v);
const pctTxt = v => (isNum(v) ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '—');
const signTxt = (v, d = 2, unit = '') => (isNum(v) ? (v > 0 ? '+' : '') + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) + unit : '—');
const numTxt = (v, d = 2) => (isNum(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const dirCls = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');

function heatStyle(v, scale) {
  if (!isNum(v)) return 'background:var(--surface-2);color:var(--text-3)';
  const t = Math.min(Math.abs(v) / scale, 1);
  const mix = Math.round(8 + t * 72);
  return `background:color-mix(in srgb, var(${v >= 0 ? '--up' : '--down'}) ${mix}%, #fff);color:${t > 0.55 ? '#fff' : 'var(--text)'}`;
}

function sparkSvg(arr, w = 84, h = 24, colorByTrend = true) {
  const pts = (arr || []).filter(isNum);
  if (pts.length < 2) return '';
  let min = Math.min(...pts), max = Math.max(...pts);
  if (max === min) { max += 1; min -= 1; }
  const xy = pts.map((v, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(2 + (h - 4) * (1 - (v - min) / (max - min))).toFixed(1)}`).join(' ');
  const cls = colorByTrend ? dirCls(pts[pts.length - 1] - pts[0]) : 'flat';
  return `<svg class="mspark ${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none"><polyline points="${xy}" vector-effect="non-scaling-stroke"/></svg>`;
}

function seg(tools, items, current, onPick) {
  const el = document.createElement('div');
  el.className = 'seg seg-sm';
  el.innerHTML = items.map(([v, label]) => `<button data-v="${v}" class="${v === current ? 'on' : ''}">${label}</button>`).join('');
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) onPick(b.dataset.v);
  });
  tools.appendChild(el);
}

function relTime(ts) {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return '剛剛';
  if (m < 60) return m + ' 分鐘前';
  if (m < 24 * 60) return Math.floor(m / 60) + ' 小時前';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function mdTxt(s) { // 'YYYY-MM-DD' → 'MM/DD'
  return s && s.length >= 10 ? s.slice(5, 7) + '/' + s.slice(8, 10) : s || '';
}

function newChart(key, el, opts = {}) {
  const LWC = window.LightweightCharts;
  const chart = LWC.createChart(el, Object.assign({
    autoSize: true,
    layout: { background: { type: 'solid', color: '#ffffff' }, textColor: '#5b6778', fontSize: 11, fontFamily: 'Inter, "Noto Sans TC", sans-serif' },
    grid: { vertLines: { color: '#f2f4f7' }, horzLines: { color: '#f2f4f7' } },
    rightPriceScale: { borderColor: '#e3e8ef' },
    timeScale: { borderColor: '#e3e8ef' },
    localization: { locale: 'zh-TW', dateFormat: 'yyyy-MM-dd' },
    handleScale: { mouseWheel: false }, // 避免捲動頁面時誤觸縮放
  }, opts));
  macro.charts[key].push(chart);
  return chart;
}

function cssVar(name) { return getComputedStyle(document.body).getPropertyValue(name).trim(); }

/* =========================================================
 * 跨資產與市場情緒
 * ========================================================= */
const FNG_ZH = { 'Extreme Fear': '極度恐懼', Fear: '恐懼', Neutral: '中性', Greed: '貪婪', 'Extreme Greed': '極度貪婪' };

function renderCross(d, body) {
  const find = sym => { for (const g of d.groups) for (const it of g.items) if (it.sym === sym) return it; return null; };
  const vix = find('^VIX'), vix3 = find('^VIX3M'), tnx = find('^TNX'), dxy = find('DX-Y.NYB');
  const chips = [];
  if (vix && isNum(vix.price)) {
    const v = vix.price;
    const [lab, lv] = v < 15 ? ['低波動', 'ok'] : v < 20 ? ['正常', 'ok'] : v < 30 ? ['偏高', 'warn'] : ['恐慌', 'bad'];
    chips.push(chip('VIX 恐慌指數', numTxt(v), lab, lv, `1D ${pctTxt(vix.d1)}`));
  }
  if (vix && vix3 && isNum(vix.price) && isNum(vix3.price)) {
    const r = vix.price / vix3.price;
    chips.push(chip('VIX 期限結構', r.toFixed(2), r > 1 ? '逆價差・避險升溫' : r > 0.9 ? '趨平' : '正價差・情緒平穩', r > 1 ? 'bad' : r > 0.9 ? 'warn' : 'ok', 'VIX ÷ VIX3M'));
  }
  if (tnx && isNum(tnx.price)) {
    chips.push(chip('美 10 年期殖利率', numTxt(tnx.price) + '%', `1M ${signTxt(isNum(tnx.a.m1) ? tnx.a.m1 * 100 : null, 0, 'bp')}`, '', `1D ${signTxt(isNum(tnx.a.d1) ? tnx.a.d1 * 100 : null, 1, 'bp')}`));
  }
  if (dxy && isNum(dxy.price)) {
    chips.push(chip('美元指數', numTxt(dxy.price), `1M ${pctTxt(dxy.m1)}`, '', `YTD ${pctTxt(dxy.ytd)}`));
  }
  if (d.fng) {
    const v = d.fng.value;
    chips.push(chip('加密恐懼貪婪', v, FNG_ZH[d.fng.cls] || d.fng.cls, v <= 25 || v >= 75 ? 'bad' : v <= 45 || v >= 55 ? 'warn' : 'ok', `前日 ${d.fng.prev}`));
  }

  const rows = d.groups.map(g => {
    const head = `<tr class="grp"><th colspan="7">${esc(g.name)}${g.rate ? '<span class="muted">（變動以 bp 表示）</span>' : ''}</th></tr>`;
    const items = g.items.filter(it => isNum(it.price)).map(it => {
      const cell = k => {
        if (g.rate) { const bp = isNum(it.a && it.a[k]) ? it.a[k] * 100 : null; return `<td class="num ${dirCls(bp)}">${signTxt(bp, 0)}</td>`; }
        return `<td class="num ${dirCls(it[k])}">${pctTxt(it[k])}</td>`;
      };
      const price = g.rate ? numTxt(it.price, 3) + '%' : numTxt(it.price, it.price >= 1000 ? 2 : it.price >= 10 ? 2 : 4);
      return `<tr><td class="nm">${esc(it.name)}</td><td class="sp">${sparkSvg(it.spark)}</td><td class="num strong">${price}</td>${['d1', 'w1', 'm1', 'ytd'].map(cell).join('')}</tr>`;
    }).join('');
    return head + items;
  }).join('');

  body.innerHTML = `
    <div class="chips">${chips.join('')}</div>
    <div class="tbl-wrap"><table class="mtbl cross">
      <thead><tr><th>標的</th><th>3 個月</th><th class="num">最新</th><th class="num">1D</th><th class="num">1W</th><th class="num">1M</th><th class="num">YTD</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function chip(label, value, tag, level, sub) {
  return `<div class="chip ${level || ''}"><div class="chip-label">${esc(label)}</div>
    <div class="chip-value">${esc(String(value))}</div>
    <div class="chip-tag">${esc(tag || '')}</div>${sub ? `<div class="chip-sub">${esc(sub)}</div>` : ''}</div>`;
}

/* =========================================================
 * 即時重大新聞
 * ========================================================= */
function renderNews(d, body, tools, key) {
  const tabs = d.tabs || [];
  if (!tabs.some(t => t.key === macro.ui.news)) macro.ui.news = tabs[0] && tabs[0].key;
  seg(tools, tabs.map(t => [t.key, t.name]), macro.ui.news, v => { macro.ui.news = v; saveMacroUi(); renderPart(key); });
  const tab = tabs.find(t => t.key === macro.ui.news);
  const items = (tab && tab.items) || [];
  body.innerHTML = items.length
    ? `<ul class="news">${items.map(n => `
        <li><a href="${esc(n.u)}" target="_blank" rel="noopener noreferrer">
          <span class="news-t">${esc(n.t)}</span>
          <span class="news-m">${esc(n.s)} · ${relTime(n.ts)}</span>
        </a></li>`).join('')}</ul>`
    : '<div class="panel-msg">此分類暫無新聞</div>';
}

/* =========================================================
 * 板塊輪動熱力圖
 * ========================================================= */
function renderSectors(d, body, tools, key) {
  const ui = macro.ui;
  const rerender = () => { saveMacroUi(); renderPart(key); };
  seg(tools, [['us', '美股'], ['tw', '台股']], ui.mkt, v => { ui.mkt = v; rerender(); });
  seg(tools, PERIODS.map(p => [p[0], p[1]]), ui.period, v => { ui.period = v; rerender(); });
  seg(tools, [['tiles', '方塊'], ['matrix', '輪動矩陣']], ui.view, v => { ui.view = v; rerender(); });

  const isUS = ui.mkt === 'us';
  const list = (isUS ? d.us : d.tw) || [];
  const bench = isUS ? d.usBench : d.twBench;
  if (!isUS && !list.length) {
    body.innerHTML = `<div class="panel-msg err">台股類股資料暫時無法取得${d.twErr ? '：' + esc(d.twErr) : ''}</div>`;
    return;
  }
  const [pk, plabel, scale] = PERIODS.find(p => p[0] === ui.period);
  const sorted = list.filter(x => isNum(x[pk])).sort((a, b) => b[pk] - a[pk]);

  // 動能變化：1M 排名相對 3M 排名的進退
  const rank = k => { const r = {}; list.filter(x => isNum(x[k])).sort((a, b) => b[k] - a[k]).forEach((x, i) => { r[x.sym] = i; }); return r; };
  const r1 = rank('m1'), r3 = rank('m3');
  const moves = list.filter(x => x.sym in r1 && x.sym in r3).map(x => ({ x, dv: r3[x.sym] - r1[x.sym] }));
  const up = moves.filter(m => m.dv >= 3).sort((a, b) => b.dv - a.dv).slice(0, 3);
  const dn = moves.filter(m => m.dv <= -3).sort((a, b) => a.dv - b.dv).slice(0, 3);
  const nm = arr => arr.map(m => esc(m.x.name)).join('、') || '—';

  const summary = `
    <div class="sec-sum">
      <span><b>${esc(bench && bench.name || '大盤')}</b> ${plabel} <b class="${dirCls(bench && bench[pk])}">${pctTxt(bench && bench[pk])}</b></span>
      <span>最強：${sorted.slice(0, 3).map(x => `${esc(x.name)} <b class="${dirCls(x[pk])}">${pctTxt(x[pk])}</b>`).join('、')}</span>
      <span>最弱：${sorted.slice(-3).reverse().map(x => `${esc(x.name)} <b class="${dirCls(x[pk])}">${pctTxt(x[pk])}</b>`).join('、')}</span>
      <span title="近 1 月排名相較近 3 月排名明顯上升／下降">動能轉強：${nm(up)}　轉弱：${nm(dn)}</span>
    </div>`;

  let view;
  if (ui.view === 'tiles') {
    view = `<div class="tiles">${sorted.map(x => `
      <div class="tile" style="${heatStyle(x[pk], scale)}"
        title="${esc(x.name)}${isUS ? ' ' + x.sym : ''}&#10;${PERIODS.map(p => p[1] + ' ' + pctTxt(x[p[0]])).join('&#10;')}">
        <div class="tile-n">${esc(x.name)}</div>
        <div class="tile-s">${isUS ? esc(x.sym) + (x.group === '主題' ? ' · 主題' : '') : ''}</div>
        <div class="tile-v">${pctTxt(x[pk])}</div>
      </div>`).join('')}</div>`;
  } else {
    const row = (x, cls = '') => `<tr class="${cls}"><td class="nm">${esc(x.name)}${isUS && x.sym ? ` <span class="muted">${esc(x.sym)}</span>` : ''}</td>
      ${PERIODS.map(p => `<td class="heat ${p[0] === pk ? 'sel' : ''}" style="${heatStyle(x[p[0]], p[2])}">${pctTxt(x[p[0]])}</td>`).join('')}</tr>`;
    view = `<div class="tbl-wrap"><table class="mtbl matrix">
      <thead><tr><th>板塊</th>${PERIODS.map(p => `<th class="num click ${p[0] === pk ? 'sel' : ''}" data-p="${p[0]}">${p[1]}${p[0] === pk ? ' ▼' : ''}</th>`).join('')}</tr></thead>
      <tbody>${bench ? row(bench, 'bench') : ''}${sorted.map(x => row(x)).join('')}</tbody></table></div>`;
  }
  body.innerHTML = summary + view + `<div class="foot-note">${isUS
    ? '美股以 SPDR 產業 ETF（XL*）代表 11 大產業，另列 6 個主題 ETF；大盤為 SPY。'
    : `台股為證交所類股指數，1D 為盤中即時，其餘以歷史收盤比較${d.twDate ? `（資料日 ${d.twDate.slice(0, 4)}/${d.twDate.slice(4, 6)}/${d.twDate.slice(6)}）` : ''}。`}</div>`;
  $$('th[data-p]', body).forEach(th => th.addEventListener('click', () => { ui.period = th.dataset.p; rerender(); }));
}

/* =========================================================
 * 美債殖利率曲線與利差
 * ========================================================= */
function renderCurve(d, body, tools, key) {
  const ui = macro.ui;
  const legend = document.createElement('div');
  legend.className = 'legend-chips';
  legend.innerHTML = d.curves.map((c, i) => `<label style="--c:${CURVE_COLORS[i]}"><input type="checkbox" data-i="${i}" ${ui.curves[i] !== false ? 'checked' : ''}><i></i>${esc(c.label)}<span class="muted">${mdTxt(c.date)}</span></label>`).join('');
  legend.addEventListener('change', e => { ui.curves[+e.target.dataset.i] = e.target.checked; saveMacroUi(); renderPart(key); });
  tools.appendChild(legend);

  const now = d.curves[0], m1 = d.curves[2];
  const S = d.spreads, n = S.d.length;
  const at = date => { const i = S.d.indexOf(date); return i < 0 ? n - 1 : i; };
  const i1m = at(d.curves[2].date), i1y = at(d.curves[3].date);
  const spreadRow = (label, arr, hint) => {
    const v = arr[n - 1];
    const st = v == null ? '' : v < 0 ? '<span class="tag bad">倒掛</span>' : v < 50 ? '<span class="tag warn">平坦</span>' : '<span class="tag ok">正斜率</span>';
    return `<tr><td class="nm" title="${esc(hint)}">${label}</td><td class="num strong ${v < 0 ? 'down' : ''}">${signTxt(v, 0, 'bp')}</td>
      <td class="num">${signTxt(arr[i1m], 0, 'bp')}</td><td class="num">${signTxt(arr[i1y], 0, 'bp')}</td><td>${st}</td></tr>`;
  };

  body.innerHTML = `
    <div class="curve-svg">${curveSvg(d)}</div>
    <div class="tbl-wrap"><table class="mtbl tenor">
      <tr><th>期限</th>${d.tenors.map(t => `<th class="num">${t}</th>`).join('')}</tr>
      <tr><td class="nm">最新 %</td>${now.y.map(v => `<td class="num strong">${numTxt(v)}</td>`).join('')}</tr>
      <tr><td class="nm">較 1 個月前</td>${now.y.map((v, i) => { const c = isNum(v) && isNum(m1.y[i]) ? Math.round((v - m1.y[i]) * 100) : null; return `<td class="num ${dirCls(c)}">${signTxt(c, 0)}</td>`; }).join('')}</tr>
    </table></div>
    <div class="sub-h">利差監控</div>
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>利差</th><th class="num">最新</th><th class="num">1 個月前</th><th class="num">1 年前</th><th>狀態</th></tr></thead>
      <tbody>
        ${spreadRow('10Y − 2Y', S.s102, '最常用的殖利率曲線斜率指標')}
        ${spreadRow('10Y − 3M', S.s103m, '紐約聯準銀行衰退機率模型採用，倒掛常被視為衰退前兆')}
        ${spreadRow('30Y − 5Y', S.s305, '長端斜率，反映期限溢酬與長期通膨預期')}
      </tbody></table></div>
    <div class="mini-chart" id="spreadChart"></div>
    <div class="foot-note">資料：FRED／美國財政部固定期限殖利率（日資料，約落後 1 個交易日）。即時 10 年期殖利率見「跨資產」。</div>`;

  const chart = newChart(key, $('#spreadChart', body), { rightPriceScale: { borderColor: '#e3e8ef', scaleMargins: { top: 0.1, bottom: 0.1 } } });
  const LWC = window.LightweightCharts;
  [['10Y−2Y', S.s102, '#1f4e8c'], ['10Y−3M', S.s103m, '#e67e22'], ['30Y−5Y', S.s305, '#16a085']].forEach(([title, arr, color], j) => {
    const s = chart.addSeries(LWC.LineSeries, {
      color, lineWidth: j ? 1 : 2, title, priceLineVisible: false, lastValueVisible: true,
      priceFormat: { type: 'custom', formatter: v => Math.round(v) + 'bp' },
    });
    s.setData(S.d.map((t, i) => (isNum(arr[i]) ? { time: t, value: arr[i] } : { time: t })));
    if (!j) s.createPriceLine({ price: 0, color: '#c62828', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false, title: '倒掛線' });
  });
  chart.timeScale().fitContent();
}

function curveSvg(d) {
  const W = 640, H = 230, L = 42, R = 14, T = 14, B = 26;
  const shown = d.curves.map((c, i) => ({ c, i })).filter(o => macro.ui.curves[o.i] !== false);
  const vals = shown.flatMap(o => o.c.y.filter(isNum));
  if (!vals.length) return '<div class="panel-msg">請至少勾選一條曲線</div>';
  let min = Math.floor((Math.min(...vals) - 0.1) * 4) / 4, max = Math.ceil((Math.max(...vals) + 0.1) * 4) / 4;
  const nT = d.tenors.length;
  const x = i => L + (i * (W - L - R)) / (nT - 1);
  const y = v => T + (H - T - B) * (1 - (v - min) / (max - min));
  const step = (max - min) / 4;
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = min + k * step;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v.toFixed(2)}</text>`;
  }
  d.tenors.forEach((t, i) => { g += `<text x="${x(i)}" y="${H - 8}" class="ax" text-anchor="middle">${t}</text>`; });
  const lines = shown.reverse().map(({ c, i }) => {
    const pts = c.y.map((v, j) => (isNum(v) ? [x(j), y(v), v, d.tenors[j]] : null)).filter(Boolean);
    return `<polyline points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="${CURVE_COLORS[i]}"
        stroke-width="${i ? 1.6 : 2.6}" ${i === 3 ? 'stroke-dasharray="4 3"' : ''}/>` +
      pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i ? 2.5 : 3.5}" fill="${CURVE_COLORS[i]}"><title>${esc(c.label)} ${p[3]}：${p[2].toFixed(2)}%</title></circle>`).join('');
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="curve">${g}${lines}</svg>`;
}

/* =========================================================
 * FOMC 利率預測
 * ========================================================= */
function moveLabel(m) {
  if (m === 0) return '維持不變';
  return (m > 0 ? '升息 ' : '降息 ') + Math.abs(m) + ' 碼';
}

function renderFomc(d, body) {
  const ms = d.meetings || [];
  const nx = ms[0];
  const fmtR = (a, b) => `${a.toFixed(2)}–${b.toFixed(2)}%`;
  const meetTxt = m => `${+m.start.slice(5, 7)}/${+m.start.slice(8)}–${m.start.slice(5, 7) === m.end.slice(5, 7) ? +m.end.slice(8) : +m.end.slice(5, 7) + '/' + +m.end.slice(8)}`;
  const days = nx ? Math.ceil((Date.parse(nx.end + 'T18:00:00Z') - Date.now()) / 86400000) : null;
  const probBars = nx && nx.dist.length
    ? nx.dist.slice().sort((a, b) => b.p - a.p).map((o, i) => `
      <div class="pbar ${i === 0 ? 'top' : ''}">
        <div class="pbar-l">${moveLabel(o.moves)}<span class="muted">${fmtR(o.from, o.to)}</span></div>
        <div class="pbar-track"><i style="width:${o.p}%"></i></div>
        <div class="pbar-v">${o.p.toFixed(1)}%</div>
      </div>`).join('')
    : '<div class="panel-msg">期貨報價暫時無法取得，無法推算機率</div>';
  const rows = ms.map((m, i) => {
    const best = m.dist.slice().sort((a, b) => b.p - a.p)[0];
    return `<tr><td class="nm">${meetTxt(m)}${m.sep ? ' <span class="tag" title="本次會議公布經濟預測（SEP）與點陣圖">SEP</span>' : ''}</td>
      <td class="num">${isNum(m.implied) ? m.implied.toFixed(3) + '%' : '—'}</td>
      <td class="num ${dirCls(m.cum)}">${signTxt(m.cum, 1, 'bp')}</td>
      <td>${best ? `${fmtR(best.from, best.to)} <span class="muted">${best.p.toFixed(0)}%</span>` : '—'}</td></tr>`;
  }).join('');
  body.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">目前目標區間</div><div class="kpi-v">${fmtR(d.from, d.to)}</div></div>
      <div class="kpi"><div class="kpi-l">有效聯邦基金利率</div><div class="kpi-v">${numTxt(d.effr)}%</div><div class="kpi-s">${mdTxt(d.effrDate)}</div></div>
      <div class="kpi"><div class="kpi-l">下次會議</div><div class="kpi-v">${nx ? meetTxt(nx) : '—'}</div><div class="kpi-s">${isNum(days) ? (days <= 0 ? '今日決議' : `還有 ${days} 天`) : ''}</div></div>
    </div>
    <div class="sub-h">下次會議結果機率</div>
    ${probBars}
    <div class="sub-h">未來三次會議</div>
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>會議日期</th><th class="num">會後隱含利率</th><th class="num">較目前累計</th><th>最可能目標區間</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="foot-note">依 CBOT 30 天期聯邦基金期貨價格推算（CME FedWatch 方法，1 碼 = 25bp）；會議日期取自聯準會官網。期貨含期限溢酬，機率僅供參考。</div>`;
}

/* =========================================================
 * 台股信用交易
 * ========================================================= */
function renderMargin(d, body, tools, key) {
  marketSeg(tools, key, 'marginMkt');
  const n = d.d.length;
  const last = i => (n - 1 - i >= 0 ? n - 1 - i : null);
  const v = (arr, i) => (last(i) == null ? null : arr[last(i)]);
  const ratio = i => (isNum(v(d.short, i)) && v(d.units, i) ? (v(d.short, i) / v(d.units, i)) * 100 : null);
  const dm = isNum(v(d.money, 1)) ? v(d.money, 0) - v(d.money, 1) : null;
  const dm20 = n > 20 ? v(d.money, 0) - v(d.money, 20) : null;
  const du = isNum(v(d.units, 1)) ? v(d.units, 0) - v(d.units, 1) : null;
  const ds = isNum(v(d.short, 1)) ? v(d.short, 0) - v(d.short, 1) : null;
  const dr = isNum(ratio(1)) ? ratio(0) - ratio(1) : null;
  body.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">融資餘額</div><div class="kpi-v">${numTxt(v(d.money, 0), 1)}<small> 億</small></div>
        <div class="kpi-s ${dirCls(dm)}">日 ${signTxt(dm, 1, ' 億')}${isNum(dm20) ? ` · 20 日 ${signTxt(dm20, 0, ' 億')}` : ''}</div></div>
      <div class="kpi"><div class="kpi-l">融資張數</div><div class="kpi-v">${numTxt(v(d.units, 0), 0)}</div><div class="kpi-s ${dirCls(du)}">日 ${signTxt(du, 0)}</div></div>
      <div class="kpi"><div class="kpi-l">融券張數</div><div class="kpi-v">${numTxt(v(d.short, 0), 0)}</div><div class="kpi-s ${dirCls(ds)}">日 ${signTxt(ds, 0)}</div></div>
      <div class="kpi"><div class="kpi-l">券資比</div><div class="kpi-v">${numTxt(ratio(0))}%</div><div class="kpi-s ${dirCls(dr)}">日 ${signTxt(dr, 2, ' 個百分點')}</div></div>
    </div>
    ${n > 2 ? `<div class="chart-legend"><span style="--c:#e8a317">融資餘額（億，右軸）</span><span style="--c:#1f4e8c">${esc(d.idxName || '加權指數')}（左軸）</span></div><div class="mini-chart tall" id="marginChart"></div>` : ''}
    <div class="foot-note">資料日 ${esc(d.d[n - 1])}，來源 ${esc(d.src)}。${d.filling ? `<b>歷史資料逐步補齊中（目前 ${n} 個交易日，每次開啟會再補一些）。</b>` : ''}交易所約於交易日晚間公布當日餘額。融資快速增加常代表散戶追價、籌碼轉弱；指數下跌時融資大減則可能是斷頭賣壓。</div>`;
  $('.foot-note', body).insertAdjacentHTML('beforebegin', marginTable(d)); // 圖表下方、說明上方
  if (n <= 2) return;
  const LWC = window.LightweightCharts;
  const chart = newChart(key, $('#marginChart', body), { leftPriceScale: { visible: true, borderColor: '#e3e8ef' } });
  const area = chart.addSeries(LWC.AreaSeries, {
    lineColor: '#e8a317', topColor: 'rgba(232,163,23,.28)', bottomColor: 'rgba(232,163,23,.02)', lineWidth: 2,
    priceScaleId: 'right', priceLineVisible: false, priceFormat: { type: 'custom', formatter: x => Math.round(x).toLocaleString() + ' 億' },
  });
  area.setData(d.d.map((t, i) => ({ time: t, value: d.money[i] })));
  const tx = chart.addSeries(LWC.LineSeries, { color: '#1f4e8c', lineWidth: 1.5, priceScaleId: 'left', priceLineVisible: false });
  tx.setData(d.d.map((t, i) => (isNum(d.taiex[i]) ? { time: t, value: d.taiex[i] } : { time: t })));
  chart.timeScale().fitContent();
}

/** 近 14 個交易日的融資餘額／融資張數／融券張數／券資比 */
function marginTable(d) {
  const n = d.d.length;
  if (n < 2 || !/^\d{4}-/.test(d.d[0])) return '';
  const rows = [];
  for (let i = n - 1; i >= Math.max(1, n - 14); i--) {
    const ratio = j => (d.units[j] ? (d.short[j] / d.units[j]) * 100 : null);
    const dm = d.money[i] - d.money[i - 1], du = d.units[i] - d.units[i - 1], ds = d.short[i] - d.short[i - 1];
    const dr = isNum(ratio(i)) && isNum(ratio(i - 1)) ? ratio(i) - ratio(i - 1) : null;
    rows.push(`<tr><td class="nm">${mdTxt(d.d[i])}</td>
      <td class="num strong">${numTxt(d.money[i], 1)}</td><td class="num ${dirCls(dm)}">${signTxt(dm, 1)}</td>
      <td class="num">${numTxt(d.units[i], 0)}</td><td class="num ${dirCls(du)}">${signTxt(du, 0)}</td>
      <td class="num">${numTxt(d.short[i], 0)}</td><td class="num ${dirCls(ds)}">${signTxt(ds, 0)}</td>
      <td class="num">${numTxt(ratio(i))}%</td><td class="num ${dirCls(dr)}">${signTxt(dr, 2)}</td></tr>`);
  }
  return `<div class="sub-h">近 ${rows.length} 個交易日明細</div>
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>日期</th><th class="num">融資餘額(億)</th><th class="num">增減</th><th class="num">融資張數</th><th class="num">增減</th>
        <th class="num">融券張數</th><th class="num">增減</th><th class="num">券資比</th><th class="num">增減</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>`;
}

/* =========================================================
 * 三大法人買賣超
 * ========================================================= */
function renderInst(d, body, tools, key) {
  marketSeg(tools, key, 'instMkt');
  const rows = d.rows || [];
  const lastN = k => rows.slice(-k);
  const sum = (arr, f) => arr.reduce((s, r) => s + (r[f] || 0), 0);
  const cell = v => `<td class="num ${dirCls(v)}">${signTxt(v, 1)}</td>`;
  const latest = rows[rows.length - 1];
  const F = ['f', 'it', 'dl', 'total'];
  const head = `<thead><tr><th>日期</th><th class="num">外資</th><th class="num">投信</th><th class="num">自營商</th><th class="num">合計</th><th style="width:26%"></th></tr></thead>`;
  const sumRow = (arr, label) => (arr.length
    ? `<tr class="sum"><td class="nm">${label}</td>${F.map(f => cell(sum(arr, f))).join('')}<td></td></tr>` : '');

  // 依週（週一起算）分組，取最近兩週
  const monday = s => { const t = Date.parse(s + 'T00:00:00Z'); const dow = (new Date(t).getUTCDay() + 6) % 7; return new Date(t - dow * 86400000).toISOString().slice(0, 10); };
  const weeks = [];
  rows.forEach(r => {
    const m = monday(r.d);
    if (!weeks.length || weeks[weeks.length - 1].m !== m) weeks.push({ m, rows: [] });
    weeks[weeks.length - 1].rows.push(r);
  });
  // 從最新一週往前取，直到至少 10 個交易日（本週剛開始或遇假日時仍有完整兩週）
  const two = [];
  for (let i = weeks.length - 1, cnt = 0; i >= 0 && (cnt < 10 || two.length < 2); i--) {
    two.push(weeks[i]);
    cnt += weeks[i].rows.length;
  }
  const thisMonday = monday(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)); // 台北日期
  const weekLabel = w => {
    const ago = Math.round((Date.parse(thisMonday) - Date.parse(w.m)) / (7 * 86400000));
    return ago === 0 ? '本週' : ago === 1 ? '上週' : `${mdTxt(w.m)} 當週`;
  };
  const maxAbs = Math.max(1, ...two.flatMap(w => w.rows.map(r => Math.abs(r.total))));
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const dayRow = r => `<tr><td class="nm">${mdTxt(r.d)} <span class="muted">週${WD[new Date(r.d + 'T00:00:00Z').getUTCDay()]}</span></td>
    ${F.map(f => cell(r[f])).join('')}
    <td><div class="dbar"><i class="${dirCls(r.total)}" style="width:${(Math.abs(r.total) / maxAbs) * 50}%"></i></div></td></tr>`;
  const detail = two.map(w => `
    <tr class="grp"><th colspan="6">${weekLabel(w)}（${mdTxt(w.m)} 起，${w.rows.length} 個交易日）</th></tr>
    ${w.rows.slice().reverse().map(dayRow).join('')}
    ${sumRow(w.rows, weekLabel(w) + '小計')}`).join('');

  body.innerHTML = `
    <div class="kpis">
      ${[['外資', 'f'], ['投信', 'it'], ['自營商', 'dl'], ['合計', 'total']].map(([l, f]) =>
        `<div class="kpi"><div class="kpi-l">${l}<span class="muted">${mdTxt(latest.d)}</span></div><div class="kpi-v ${dirCls(latest[f])}">${signTxt(latest[f], 1)}<small> 億</small></div></div>`).join('')}
    </div>
    <div class="tbl-wrap"><table class="mtbl">
      ${head.replace('日期', '累計')}
      <tbody>
        ${two.map(w => sumRow(w.rows, weekLabel(w))).join('')}
        ${rows.length >= 5 ? sumRow(lastN(5), '近 5 日') : ''}${rows.length >= 20 ? sumRow(lastN(20), '近 20 日') : ''}
      </tbody></table></div>
    <div class="sub-h">近兩週每日明細</div>
    <div class="tbl-wrap"><table class="mtbl">${head}<tbody>${detail}</tbody></table></div>
    <div class="foot-note">單位：新台幣億元，資料日 ${esc(latest.d)}，來源 ${esc(d.src || '')}。外資含外資自營商，自營商含自行買賣與避險。${d.filling ? `<b>歷史資料逐步補齊中（目前 ${rows.length} 個交易日）。</b>` : ''}</div>`;
}

/* =========================================================
 * 美國經濟數據
 * ========================================================= */
function renderEcon(d, body) {
  const period = r => {
    if (!r.date) return '';
    if (r.freq === 'Q') return `${r.date.slice(0, 4)} Q${Math.floor((+r.date.slice(5, 7) - 1) / 3) + 1}`;
    if (r.freq === 'W') return `${r.date.slice(0, 4)}/${mdTxt(r.date)} 當週`;
    return `${r.date.slice(0, 4)}/${r.date.slice(5, 7)}`;
  };
  const rows = d.rows.map(r => {
    if (r.err) return `<tr><td class="nm">${esc(r.name)}</td><td colspan="5" class="muted">暫時無法取得</td></tr>`;
    const chg = isNum(r.prev) ? r.latest - r.prev : null;
    const dec = r.unit === '千人' ? 0 : r.unit === '' ? 1 : 2;
    const arrow = chg > 0 ? '▲' : chg < 0 ? '▼' : '';
    return `<tr>
      <td class="nm"><a href="https://fred.stlouisfed.org/series/${esc(r.id)}" target="_blank" rel="noopener noreferrer">${esc(r.name)}</a></td>
      <td class="num strong">${numTxt(r.latest, dec)}${r.unit === '%' ? '%' : ''}${r.unit && r.unit !== '%' ? `<small> ${r.unit}</small>` : ''}</td>
      <td class="num">${numTxt(r.prev, dec)}${r.unit === '%' ? '%' : ''}</td>
      <td class="num neutral">${arrow} ${isNum(chg) ? numTxt(Math.abs(chg), dec) : '—'}</td>
      <td>${period(r)}</td>
      <td class="sp">${sparkSvg(r.series, 110, 26, false)}</td></tr>`;
  }).join('');
  body.innerHTML = `
    <div class="tbl-wrap"><table class="mtbl econ">
      <thead><tr><th>指標</th><th class="num">最新</th><th class="num">前值</th><th class="num">變化</th><th>資料期間</th><th>近 13 期走勢</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="foot-note">資料：FRED。數據依官方公布時程更新（CPI／就業約每月上旬、GDP 每季、初領失業金每週四），點指標名稱可看完整歷史。</div>`;
}

/* =========================================================
 * 資金流向排行（個股外資／投信買賣超）
 * ========================================================= */
function renderFlow(d, body, tools, key) {
  const ui = macro.ui;
  const rerender = () => { saveMacroUi(); renderPart(key); };
  marketSeg(tools, key, 'flowMkt');
  seg(tools, [['shares', '張數'], ['amt', '金額']], ui.flowBy, v => { ui.flowBy = v; rerender(); });
  seg(tools, [['0', '排除 ETF'], ['1', '含 ETF']], ui.flowEtf, v => { ui.flowEtf = v; rerender(); });

  const byAmt = ui.flowBy === 'amt';
  const mine = new Set(state.items.filter(i => i.category === 'tw').map(i => i.symbol));
  const rows = d.rows.map(r => ({ c: r[0], nm: r[1], f: r[2], it: r[3], p: r[4], etf: r[5] }))
    .filter(x => ui.flowEtf === '1' || !x.etf);
  const val = (x, k) => (byAmt ? (isNum(x.p) ? (x[k] * x.p * 1000) / 1e8 : null) : x[k]); // 金額：張 × 1000 股 × 收盤 → 億
  const top = (k, dir) => rows.filter(x => isNum(val(x, k)) && (dir > 0 ? val(x, k) > 0 : val(x, k) < 0))
    .sort((a, b) => dir * (val(b, k) - val(a, k))).slice(0, 10);
  const unit = byAmt ? '億' : '張';
  const table = (title, list, k) => `
    <div class="flow-col">
      <div class="sub-h">${title}</div>
      <table class="mtbl flow">
        <thead><tr><th>#</th><th>股票</th><th class="num">${byAmt ? '金額(億)' : '張數'}</th><th class="num">收盤</th></tr></thead>
        <tbody>${list.length ? list.map((x, i) => `<tr class="${mine.has(x.c) ? 'mine' : ''}">
          <td class="muted">${i + 1}</td>
          <td class="nm">${mine.has(x.c) ? '★ ' : ''}${esc(x.nm)} <span class="muted">${esc(x.c)}</span></td>
          <td class="num strong ${dirCls(val(x, k))}">${signTxt(val(x, k), byAmt ? 2 : 0)}</td>
          <td class="num">${numTxt(x.p)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">無資料</td></tr>'}</tbody>
      </table>
    </div>`;
  // 土洋同買／同賣：外資與投信同方向
  const both = (dir) => rows.filter(x => dir * x.f > 0 && dir * x.it > 0)
    .sort((a, b) => dir * ((val(b, 'f') || 0) + (val(b, 'it') || 0) - (val(a, 'f') || 0) - (val(a, 'it') || 0))).slice(0, 6)
    .map(x => `${mine.has(x.c) ? '★' : ''}${esc(x.nm)}`).join('、') || '—';

  body.innerHTML = `
    <div class="sec-sum">
      <span>資料日 <b>${esc(d.date)}</b></span>
      <span>土洋同買：${both(1)}</span>
      <span>土洋同賣：${both(-1)}</span>
    </div>
    <div class="flow-grid">
      ${table('外資買超', top('f', 1), 'f')}${table('外資賣超', top('f', -1), 'f')}
      ${table('投信買超', top('it', 1), 'it')}${table('投信賣超', top('it', -1), 'it')}
    </div>
    <div class="foot-note">外資含外資自營商。金額以最近收盤價估算（張數 × 1,000 股 × 收盤價）。★ 為你自選清單中的台股。
      ETF 為代號 0 開頭者。資料來源：${macro.ui.flowMkt === 'otc' ? '櫃買中心' : '臺灣證券交易所'}，約交易日 16:30 後公布。</div>`;
}

/* =========================================================
 * 財報日曆（自選清單）
 * ========================================================= */
/** 台北時間的週界線：回傳 [本週一, 下週一, 下下週一]（ms） */
function weekBounds() {
  const tp = new Date(Date.now() + 8 * 3600000);
  const day = (tp.getUTCDay() + 6) % 7;
  const mon = Date.UTC(tp.getUTCFullYear(), tp.getUTCMonth(), tp.getUTCDate()) - day * 86400000 - 8 * 3600000;
  return [mon, mon + 7 * 86400000, mon + 14 * 86400000];
}
const WD_ZH = ['日', '一', '二', '三', '四', '五', '六'];
function tpDate(ts, withTime) {
  const t = new Date(ts + 8 * 3600000);
  const s = `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WD_ZH[t.getUTCDay()]}）`;
  return withTime ? s + ' ' + String(t.getUTCHours()).padStart(2, '0') + ':' + String(t.getUTCMinutes()).padStart(2, '0') : s;
}

/** 台股法定財報公告期限（一般公司）：年報 3/31、Q1 5/15、Q2 8/14、Q3 11/14 */
function twDeadline() {
  const tp = new Date(Date.now() + 8 * 3600000), y = tp.getUTCFullYear();
  const md = `${String(tp.getUTCMonth() + 1).padStart(2, '0')}-${String(tp.getUTCDate()).padStart(2, '0')}`;
  const list = [['03-31', '年報'], ['05-15', 'Q1'], ['08-14', 'Q2'], ['11-14', 'Q3']];
  const hit = list.find(([d]) => d >= md) || list[0];
  return `${hit[1]} 財報 ${+hit[0].slice(0, 2)}/${+hit[0].slice(3)} 前`;
}

function renderEarnings(d, body) {
  const [w0, w1, w2] = weekBounds();
  const now = Date.now();
  const rows = (d.rows || []).slice().sort((a, b) => {
    const fa = a.start && a.start > now - 86400000 ? a.start : Infinity;
    const fb = b.start && b.start > now - 86400000 ? b.start : Infinity;
    return fa - fb;
  });
  if (!rows.length) {
    body.innerHTML = '<div class="panel-msg">自選清單中沒有台股或國外股票</div>';
    return;
  }
  const thisWeek = rows.filter(r => r.start && r.start >= w0 && r.start < w1);
  body.innerHTML = `
    ${thisWeek.length ? `<div class="earn-alert">📢 本週財報：${thisWeek.map(r => `<b>${esc(r.name)}</b> ${tpDate(r.start)}`).join('、')}</div>` : ''}
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>標的</th><th>下次財報／法說</th><th>狀態</th></tr></thead>
      <tbody>${rows.map(r => {
        const upcoming = r.start && r.start > now - 86400000;
        let tag, when;
        if (!upcoming) {
          when = r.start ? `<span class="muted">上次 ${tpDate(r.start)}，下次未公布</span>` : '<span class="muted">尚無日期</span>';
          tag = r.cat === 'tw' ? `<span class="tag">${twDeadline()}</span>` : '';
        } else {
          const days = Math.ceil((r.start - now) / 86400000);
          when = tpDate(r.start) + (r.end && r.end - r.start > 86400000 ? ` ～ ${tpDate(r.end)}` : '') + (r.est ? ' <span class="muted">預估</span>' : '');
          tag = r.start < w1 ? '<span class="tag bad">本週財報</span>'
            : r.start < w2 ? '<span class="tag warn">下週</span>'
              : `<span class="tag">${days} 天後</span>`;
        }
        return `<tr><td class="nm">${esc(r.name)} <span class="muted">${esc(r.symbol)}</span></td><td>${when}</td><td>${tag}</td></tr>`;
      }).join('')}</tbody></table></div>
    <div class="foot-note">日期來源 Yahoo Finance（台北時間）。台股多為法說會或董事會日期；查無日期的台股顯示法定公告期限（一般公司：年報 3/31、Q1 5/15、Q2 8/14、Q3 11/14）。</div>`;
}

/* =========================================================
 * 經濟日曆
 * ========================================================= */
const CC_ZH = { USD: '美國', EUR: '歐元區', JPY: '日本', CNY: '中國', GBP: '英國', TWD: '台灣' };

function renderCalendar(d, body) {
  const now = Date.now();
  const todayKey = tpDate(now);
  const group = (from, to) => {
    const list = d.events.filter(e => e.ts >= from && e.ts < to);
    if (!list.length) return '<tr><td colspan="5" class="muted">本期間沒有重要事件</td></tr>';
    let lastDay = '';
    return list.map(e => {
      const day = tpDate(e.ts);
      const head = day !== lastDay ? `<tr class="cal-day ${day === todayKey ? 'today' : ''}"><th colspan="5">${day}${day === todayKey ? '　今天' : ''}</th></tr>` : '';
      lastDay = day;
      return head + `<tr class="${e.ts < now ? 'past' : ''}">
        <td class="num">${tpDate(e.ts, true).split(' ')[1]}</td>
        <td>${CC_ZH[e.cc] || e.cc}</td>
        <td class="nm">${esc(e.t)}</td>
        <td class="num">${esc(e.fc || '—')}</td>
        <td class="num">${esc(e.prev || '—')}</td></tr>`;
    }).join('');
  };
  const head = '<thead><tr><th class="num">時間</th><th>國家</th><th>事件</th><th class="num">預期</th><th class="num">前值</th></tr></thead>';
  body.innerHTML = `
    <div class="sub-h">本週</div>
    <div class="tbl-wrap"><table class="mtbl cal">${head}<tbody>${group(d.weekStart, d.nextStart)}</tbody></table></div>
    <div class="sub-h">下週</div>
    <div class="tbl-wrap"><table class="mtbl cal">${head}<tbody>${group(d.nextStart, d.end)}</tbody></table></div>
    <div class="foot-note">時間為台北時間，只列高影響事件（美、歐、日、中、英、台）。本週來源 Forex Factory（含市場預期）；
      下週為 FRED 公布的美國數據日程與央行會議，預期值通常要到該週才會出現，前值取自 FRED 最新數據。台灣央行理監事會日期依慣例推估。灰色為已公布。</div>`;
}

/* =========================================================
 * 台灣景氣與央行
 * ========================================================= */
const LIGHT = {
  '紅': ['#d63a3a', '熱絡'], '黃紅': ['#f08c00', '轉向'], '綠': ['#20a464', '穩定'], '黃藍': ['#5aa0e6', '轉向'], '藍': ['#1f4e8c', '低迷'],
};

function renderTwMacro(d, body) {
  const now = Date.now();
  let html = '';
  if (d.ndc) {
    const L = d.ndc.latest, P = d.ndc.prev, light = LIGHT[L.light] || ['#999', ''];
    const diff = P ? L.score - P.score : null;
    const hist = d.ndc.hist || [];
    html += `
      <div class="sub-h">國發會景氣對策信號</div>
      <div class="kpis">
        <div class="kpi"><div class="kpi-l">${L.m.replace('-', '/')} 燈號</div>
          <div class="kpi-v"><span class="light" style="background:${light[0]}"></span>${esc(L.light)}燈 <small>${light[1]}</small></div></div>
        <div class="kpi"><div class="kpi-l">綜合判斷分數</div><div class="kpi-v">${L.score}<small> 分</small></div>
          <div class="kpi-s">較上月 ${signTxt(diff, 0)} 分</div></div>
        <div class="kpi"><div class="kpi-l">領先指標（不含趨勢）</div><div class="kpi-v">${numTxt(L.lead)}</div>
          <div class="kpi-s">較上月 ${P ? signTxt(L.lead - P.lead, 2) : '—'}</div></div>
        <div class="kpi"><div class="kpi-l">同時指標（不含趨勢）</div><div class="kpi-v">${numTxt(L.coin)}</div>
          <div class="kpi-s">較上月 ${P ? signTxt(L.coin - P.coin, 2) : '—'}</div></div>
      </div>
      <div class="lights">${hist.map(h => `<span title="${h.m}：${h.score} 分（${h.light}燈）" style="background:${(LIGHT[h.light] || ['#ccc'])[0]}">${h.score}</span>`).join('')}</div>
      <div class="lights-axis"><span>${(hist[0] || {}).m || ''}</span><span>近 ${hist.length} 個月燈號（數字為分數）</span><span>${L.m}</span></div>
      <div class="light-legend">${Object.entries(LIGHT).map(([k, v]) => `<span><i style="background:${v[0]}"></i>${k}燈 ${v[1]}</span>`).join('')}
        <span class="muted">（分數：藍 9–16、黃藍 17–22、綠 23–31、黃紅 32–37、紅 38–45）</span></div>`;
  } else {
    html += `<div class="panel-msg err">${esc(d.ndcErr || '景氣資料暫時無法取得')}</div>`;
  }

  const next = (d.cbcNext || [])[0];
  const days = next ? Math.ceil((Date.parse(next + 'T16:00:00+08:00') - now) / 86400000) : null;
  if (d.cbc) {
    const c = d.cbc.latest, ch = d.cbc.changes;
    html += `
      <div class="sub-h">中央銀行政策利率</div>
      <div class="kpis">
        <div class="kpi"><div class="kpi-l">重貼現率</div><div class="kpi-v">${c.r.toFixed(3)}%</div><div class="kpi-s">自 ${c.d.replace(/-/g, '/')} 起</div></div>
        <div class="kpi"><div class="kpi-l">擔保放款融通利率</div><div class="kpi-v">${c.sec.toFixed(3)}%</div></div>
        <div class="kpi"><div class="kpi-l">短期融通利率</div><div class="kpi-v">${c.st.toFixed(3)}%</div></div>
        <div class="kpi"><div class="kpi-l">下次理監事會</div><div class="kpi-v">${next ? +next.slice(5, 7) + '/' + +next.slice(8) : '—'}</div>
          <div class="kpi-s">${isNum(days) ? `還有 ${days} 天・依慣例推估` : ''}</div></div>
      </div>
      <div class="tbl-wrap"><table class="mtbl">
        <thead><tr><th>調整日期</th><th class="num">重貼現率</th><th class="num">變動</th></tr></thead>
        <tbody>${ch.slice(0, 5).map((x, i) => {
          const dv = ch[i + 1] ? Math.round((x.r - ch[i + 1].r) * 1000) / 10 : null; // 百分點 → bp（0.125% = 12.5bp = 半碼）
          return `<tr><td class="nm">${x.d.replace(/-/g, '/')}</td><td class="num">${x.r.toFixed(3)}%</td><td class="num ${dirCls(dv)}">${signTxt(dv, 1, 'bp')}</td></tr>`;
        }).join('')}</tbody></table></div>`;
  } else {
    html += `<div class="panel-msg err">${esc(d.cbcErr || '央行利率暫時無法取得')}</div>`;
  }
  body.innerHTML = html + `<div class="foot-note">景氣對策信號每月約 27 日公布前一個月資料（國發會，經政府資料開放平臺）。
    央行利率取自中央銀行網站；理監事會依慣例於每季末月第三個週四召開，日期為推估，請以央行公告為準。</div>`;
}

initMacro();
