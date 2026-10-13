/* =========================================================
 * 選股篩選器 — 前端
 * 後端每天晚上算好全市場（上市＋上櫃）指標表，這裡下載後在瀏覽器即時篩選
 * 依賴 app.js（$, $$, api, esc, state, store, toast, addToWatchlist, inWatchlist）
 *      macro.js（isNum, pctTxt, signTxt, numTxt, dirCls）、research.js（openResearch）
 * ========================================================= */
const scr = { table: null, rows: [], loadedAt: 0, values: {}, sort: { k: 'amt', dir: -1 }, shown: 100, presets: null };

/**
 * 篩選條件定義
 * type: range（最小～最大）、min（≥）、max（≤）、flag（勾選）、select
 * f：欄位或計算函式；unit：顯示單位
 */
const SCR_FILTERS = [
  // 基本
  { id: 'mkt', g: '基本條件', label: '市場', type: 'select', opts: [['', '全部'], ['L', '上市'], ['O', '上櫃']] },
  { id: 'ind', g: '基本條件', label: '產業', type: 'select', opts: 'ind' },
  { id: 'noEtf', g: '基本條件', label: '排除 ETF', type: 'flag', test: r => !r.etf, def: true },
  { id: 'close', g: '基本條件', label: '股價', type: 'range', unit: '元' },
  { id: 'vol', g: '基本條件', label: '今日成交量', type: 'min', unit: '張' },
  { id: 'vol20', g: '基本條件', label: '20 日均量', type: 'min', unit: '張' },
  { id: 'amt', g: '基本條件', label: '今日成交值', type: 'min', unit: '億' },
  // 價值
  { id: 'pe', g: '價值', label: '本益比', type: 'range', unit: '倍' },
  { id: 'pb', g: '價值', label: '股價淨值比', type: 'range', unit: '倍' },
  { id: 'yld', g: '價值', label: '殖利率', type: 'min', unit: '%' },
  // 成長
  { id: 'revYoY', g: '成長（月營收）', label: '月營收年增率', type: 'range', unit: '%' },
  { id: 'revMoM', g: '成長（月營收）', label: '月營收月增率', type: 'range', unit: '%' },
  { id: 'revCum', g: '成長（月營收）', label: '累計營收年增率', type: 'range', unit: '%' },
  // 均線與趨勢
  { id: 'aMa5', g: '均線與趨勢', label: '站上 5 日線', type: 'flag', test: r => r.ma5 && r.close > r.ma5 },
  { id: 'aMa20', g: '均線與趨勢', label: '站上 20 日線（月線）', type: 'flag', test: r => r.ma20 && r.close > r.ma20 },
  { id: 'aMa60', g: '均線與趨勢', label: '站上 60 日線（季線）', type: 'flag', test: r => r.ma60 && r.close > r.ma60 },
  { id: 'aMa120', g: '均線與趨勢', label: '站上 120 日線（半年線）', type: 'flag', test: r => r.ma120 && r.close > r.ma120 },
  { id: 'aMa240', g: '均線與趨勢', label: '站上 240 日線（年線）', type: 'flag', test: r => r.ma240 && r.close > r.ma240 },
  { id: 'bMa60', g: '均線與趨勢', label: '跌破季線', type: 'flag', test: r => r.ma60 && r.close < r.ma60 },
  { id: 'bull', g: '均線與趨勢', label: '均線多頭排列（5>10>20>60）', type: 'flag', test: r => r.bull === 1 },
  { id: 'bear', g: '均線與趨勢', label: '均線空頭排列', type: 'flag', test: r => r.bear === 1 },
  { id: 'ma60up', g: '均線與趨勢', label: '季線上揚', type: 'flag', test: r => r.ma60up === 1 },
  { id: 'x520g', g: '均線與趨勢', label: '今日 5 日線黃金交叉 20 日線', type: 'flag', test: r => r.x520 === 1 },
  { id: 'x520d', g: '均線與趨勢', label: '今日 5 日線死亡交叉 20 日線', type: 'flag', test: r => r.x520 === -1 },
  { id: 'bias20', g: '均線與趨勢', label: '20 日乖離率', type: 'range', unit: '%' },
  { id: 'bias60', g: '均線與趨勢', label: '60 日乖離率', type: 'range', unit: '%' },
  // 價量與突破
  { id: 'vr', g: '價量與突破', label: '量比（今日 ÷ 20 日均量）', type: 'min', unit: '倍', hint: '≥2 常視為爆量' },
  { id: 'nh20', g: '價量與突破', label: '創 20 日新高', type: 'flag', test: r => r.nh >= 20 },
  { id: 'nh60', g: '價量與突破', label: '創 60 日新高', type: 'flag', test: r => r.nh >= 60 },
  { id: 'nh250', g: '價量與突破', label: '創 52 週新高', type: 'flag', test: r => r.nh >= 250 },
  { id: 'nl20', g: '價量與突破', label: '創 20 日新低', type: 'flag', test: r => r.nl >= 20 },
  { id: 'nl60', g: '價量與突破', label: '創 60 日新低', type: 'flag', test: r => r.nl >= 60 },
  { id: 'dHi', g: '價量與突破', label: '距 52 週高點', type: 'range', unit: '%', hint: '例：最小 −5 代表離高點 5% 以內' },
  { id: 'dLo', g: '價量與突破', label: '距 52 週低點', type: 'range', unit: '%' },
  { id: 'r1', g: '價量與突破', label: '1 日漲跌幅', type: 'range', unit: '%' },
  { id: 'r5', g: '價量與突破', label: '5 日漲跌幅', type: 'range', unit: '%' },
  { id: 'r20', g: '價量與突破', label: '20 日漲跌幅', type: 'range', unit: '%' },
  { id: 'r60', g: '價量與突破', label: '60 日漲跌幅', type: 'range', unit: '%' },
  { id: 'r120', g: '價量與突破', label: '120 日漲跌幅', type: 'range', unit: '%' },
  { id: 'r250', g: '價量與突破', label: '一年漲跌幅', type: 'range', unit: '%' },
  // 技術指標
  { id: 'rsi', g: '技術指標', label: 'RSI(14)', type: 'range' },
  { id: 'k', g: '技術指標', label: 'K 值', type: 'range' },
  { id: 'kdg', g: '技術指標', label: '今日 KD 黃金交叉', type: 'flag', test: r => r.kdx === 1 },
  { id: 'kdd', g: '技術指標', label: '今日 KD 死亡交叉', type: 'flag', test: r => r.kdx === -1 },
  { id: 'kdLow', g: '技術指標', label: 'KD 低檔黃金交叉（K<30）', type: 'flag', test: r => r.kdx === 1 && r.k < 30 },
  { id: 'macdP', g: '技術指標', label: 'MACD 柱狀體為正', type: 'flag', test: r => r.macd > 0 },
  { id: 'macdG', g: '技術指標', label: '今日 MACD 柱翻正', type: 'flag', test: r => r.macdx === 1 },
  { id: 'macdD', g: '技術指標', label: '今日 MACD 柱翻負', type: 'flag', test: r => r.macdx === -1 },
  { id: 'hv20', g: '技術指標', label: '20 日年化波動度', type: 'range', unit: '%' },
  // 籌碼
  { id: 'fBuyN', g: '籌碼', label: '外資連買天數', type: 'min', f: r => (r.fS > 0 ? r.fS : 0), unit: '天' },
  { id: 'fSellN', g: '籌碼', label: '外資連賣天數', type: 'min', f: r => (r.fS < 0 ? -r.fS : 0), unit: '天' },
  { id: 'itBuyN', g: '籌碼', label: '投信連買天數', type: 'min', f: r => (r.itS > 0 ? r.itS : 0), unit: '天' },
  { id: 'itSellN', g: '籌碼', label: '投信連賣天數', type: 'min', f: r => (r.itS < 0 ? -r.itS : 0), unit: '天' },
  { id: 'f1', g: '籌碼', label: '外資今日買賣超', type: 'range', unit: '張' },
  { id: 'f5', g: '籌碼', label: '外資 5 日買賣超', type: 'range', unit: '張' },
  { id: 'f20', g: '籌碼', label: '外資 20 日買賣超', type: 'range', unit: '張' },
  { id: 'it1', g: '籌碼', label: '投信今日買賣超', type: 'range', unit: '張' },
  { id: 'it5', g: '籌碼', label: '投信 5 日買賣超', type: 'range', unit: '張' },
  { id: 'it20', g: '籌碼', label: '投信 20 日買賣超', type: 'range', unit: '張' },
  { id: 'both', g: '籌碼', label: '今日土洋同買（外資、投信皆買超）', type: 'flag', test: r => r.f1 > 0 && r.it1 > 0 },
  { id: 'mb5', g: '籌碼', label: '融資 5 日增減', type: 'range', unit: '%' },
  { id: 'sr', g: '籌碼', label: '券資比', type: 'range', unit: '%' },
];

/** 內建常用條件（快速按鈕） */
const SCR_BUILTIN = [
  { name: '高殖利率價值股', v: { noEtf: true, yld: { min: 5 }, pe: { min: 0, max: 15 }, vol20: { min: 300 } } },
  { name: '營收高成長', v: { noEtf: true, revYoY: { min: 20 }, revCum: { min: 15 }, vol20: { min: 300 } } },
  { name: '外資連買 5 天', v: { noEtf: true, fBuyN: { min: 5 }, vol20: { min: 300 } } },
  { name: '投信認養', v: { noEtf: true, itBuyN: { min: 3 }, it5: { min: 200 } } },
  { name: '多頭排列＋爆量', v: { noEtf: true, bull: true, vr: { min: 2 }, vol: { min: 1000 } } },
  { name: '站上季線＋均線金叉', v: { noEtf: true, aMa60: true, x520g: true, vol20: { min: 300 } } },
  { name: '創 60 日新高', v: { noEtf: true, nh60: true, vol: { min: 1000 } } },
  { name: '超跌反彈（KD 低檔金叉）', v: { noEtf: true, kdLow: true, rsi: { max: 40 }, vol20: { min: 300 } } },
  { name: '土洋同買', v: { noEtf: true, both: true, f5: { min: 0 }, it5: { min: 0 } } },
];

function initScreener() {
  $('.nav-btn[data-section="screener"]').addEventListener('click', () => loadScreener(false));
  $('#scrApply').addEventListener('click', () => { scrReadForm(); scrRun(); });
  $('#scrClear').addEventListener('click', () => { scrSetValues({ noEtf: true }); scrRun(); });
  $('#scrSave').addEventListener('click', scrSavePreset);
  $('#scrReload').addEventListener('click', () => loadScreener(true));
  scrBuildForm();
  scrSetValues({ noEtf: true });
}

async function loadScreener(force) {
  if (!state.token) return;
  if (!force && scr.table && Date.now() - scr.loadedAt < 10 * 60000) return;
  const st = $('#scrStatus');
  st.className = 'status';
  st.innerHTML = '<span class="dot"></span>載入全市場資料中…';
  try {
    const t = (await api('screener')).data;
    scr.loadedAt = Date.now();
    if (!t.ready) {
      scr.table = null;
      $('#scrResult').innerHTML = `<div class="panel-msg">${t.setup
        ? '首次資料建置中：後端正在下載全市場歷史資料，約 20–40 分鐘完成，請稍後再開啟此頁。'
        : '尚未啟用選股資料：請到 Apps Script 編輯器，上方函式選單選「setupScreener」→ 執行一次（會要求授權）。之後每天晚上會自動更新。'}</div>`;
      st.className = 'status err';
      st.innerHTML = '<span class="dot"></span>' + (t.setup ? '資料建置中' : '尚未啟用');
      return;
    }
    scr.table = t;
    scr.rows = t.rows.map(r => Object.fromEntries(t.fields.map((k, i) => [k, r[i]])));
    scrFillIndustries();
    scr.presets = null; // 登入後才讀得到個人設定
    scrRenderPresets();
    st.className = 'status live';
    st.innerHTML = `<span class="dot"></span>資料日 ${esc(t.date)}・${t.rows.length} 檔・歷史 ${t.days} 個交易日` +
      (t.filling ? '（補齊中）' : '');
    $('#scrNote').innerHTML = t.days < 250
      ? `歷史資料累積中（目前 ${t.days} 個交易日、法人 ${t.flowDays} 日）：需要較長歷史的條件（年線、52 週新高、一年漲跌幅等）暫時不完整。`
      : '';
    scrRun();
  } catch (err) {
    st.className = 'status err';
    st.innerHTML = '<span class="dot"></span>' + esc(err.message);
  }
}

/* ---------- 條件表單 ---------- */
function scrBuildForm() {
  const groups = [...new Set(SCR_FILTERS.map(f => f.g))];
  $('#scrForm').innerHTML = groups.map(g => `
    <fieldset class="scr-group"><legend>${g}</legend>
      ${SCR_FILTERS.filter(f => f.g === g).map(f => {
        const unit = f.unit ? `<span class="muted">${f.unit}</span>` : '';
        const hint = f.hint ? ` title="${esc(f.hint)}"` : '';
        if (f.type === 'flag') return `<label class="scr-flag"${hint}><input type="checkbox" data-f="${f.id}"> ${f.label}</label>`;
        if (f.type === 'select') return `<label class="scr-row"><span>${f.label}</span><select data-f="${f.id}">${Array.isArray(f.opts) ? f.opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('') : '<option value="">全部</option>'}</select></label>`;
        const mn = f.type !== 'max' ? `<input type="number" step="any" data-f="${f.id}" data-b="min" placeholder="${f.type === 'range' ? '最小' : '≥'}">` : '';
        const mx = f.type === 'range' || f.type === 'max' ? `<input type="number" step="any" data-f="${f.id}" data-b="max" placeholder="${f.type === 'range' ? '最大' : '≤'}">` : '';
        return `<label class="scr-row"${hint}><span>${f.label}</span><span class="scr-in">${mn}${f.type === 'range' ? '～' : ''}${mx}${unit}</span></label>`;
      }).join('')}
    </fieldset>`).join('');
  $('#scrForm').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); scrReadForm(); scrRun(); } });
}

function scrFillIndustries() {
  const sel = $('select[data-f="ind"]');
  const cur = sel.value;
  const inds = [...new Set(scr.rows.map(r => r.ind).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  sel.innerHTML = '<option value="">全部</option>' + inds.map(i => `<option value="${esc(i)}">${esc(i)}</option>`).join('');
  sel.value = cur;
}

function scrReadForm() {
  const v = {};
  SCR_FILTERS.forEach(f => {
    if (f.type === 'flag') { if ($(`input[data-f="${f.id}"]`).checked) v[f.id] = true; return; }
    if (f.type === 'select') { const x = $(`select[data-f="${f.id}"]`).value; if (x) v[f.id] = x; return; }
    const o = {};
    $$(`input[data-f="${f.id}"]`).forEach(inp => { if (inp.value !== '' && isFinite(+inp.value)) o[inp.dataset.b] = +inp.value; });
    if (Object.keys(o).length) v[f.id] = o;
  });
  scr.values = v;
}

function scrSetValues(v) {
  scr.values = JSON.parse(JSON.stringify(v));
  SCR_FILTERS.forEach(f => {
    const x = v[f.id];
    if (f.type === 'flag') { $(`input[data-f="${f.id}"]`).checked = !!x; return; }
    if (f.type === 'select') { $(`select[data-f="${f.id}"]`).value = x || ''; return; }
    $$(`input[data-f="${f.id}"]`).forEach(inp => { inp.value = x && isNum(x[inp.dataset.b]) ? x[inp.dataset.b] : ''; });
  });
}

/* ---------- 篩選與結果 ---------- */
function scrVal(f, r) { return f.f ? f.f(r) : r[f.id]; }

function scrRun() {
  if (!scr.table) return;
  const active = SCR_FILTERS.filter(f => scr.values[f.id] != null);
  const res = scr.rows.filter(r => active.every(f => {
    const x = scr.values[f.id];
    if (f.type === 'flag') return f.test(r);
    if (f.type === 'select') return r[f.id] === x;
    const val = scrVal(f, r);
    if (!isNum(val)) return false;
    return (!isNum(x.min) || val >= x.min) && (!isNum(x.max) || val <= x.max);
  }));
  scr.result = res;
  scr.shown = 100;
  // 依啟用條件動態加欄位
  scr.cols = active.filter(f => f.type === 'range' || f.type === 'min' || f.type === 'max').map(f => f.id)
    .filter(id => !['close', 'amt'].includes(id)).slice(0, 6);
  scrRenderActive(active);
  scrRenderTable();
}

function scrRenderActive(active) {
  const txt = f => {
    const x = scr.values[f.id];
    if (f.type === 'flag') return f.label;
    if (f.type === 'select') return `${f.label}：${f.opts === 'ind' ? x : f.opts.find(o => o[0] === x)[1]}`;
    const u = f.unit || '';
    return isNum(x.min) && isNum(x.max) ? `${f.label} ${x.min}～${x.max}${u}` : isNum(x.min) ? `${f.label} ≥ ${x.min}${u}` : `${f.label} ≤ ${x.max}${u}`;
  };
  $('#scrActive').innerHTML = active.length
    ? active.map(f => `<span class="fchip">${esc(txt(f))}<button data-x="${f.id}" title="移除條件">×</button></span>`).join('')
    : '<span class="muted">尚未設定條件，顯示全部股票</span>';
  $$('#scrActive [data-x]').forEach(b => b.addEventListener('click', () => {
    delete scr.values[b.dataset.x];
    scrSetValues(scr.values);
    scrRun();
  }));
}

const SCR_COLS = {
  pe: ['本益比', 1], pb: ['淨值比', 2], yld: ['殖利率%', 2], revYoY: ['營收年增%', 1], revMoM: ['營收月增%', 1], revCum: ['累計年增%', 1],
  vol: ['成交量', 0], vol20: ['20日均量', 0], vr: ['量比', 2], bias20: ['20日乖離%', 1], bias60: ['60日乖離%', 1], dHi: ['距高點%', 1], dLo: ['距低點%', 1],
  r1: ['1日%', 2], r5: ['5日%', 1], r20: ['20日%', 1], r60: ['60日%', 1], r120: ['120日%', 1], r250: ['1年%', 1], rsi: ['RSI', 1], k: ['K', 1], hv20: ['波動%', 1],
  fBuyN: ['外資連買', 0], fSellN: ['外資連賣', 0], itBuyN: ['投信連買', 0], itSellN: ['投信連賣', 0],
  f1: ['外資今日', 0], f5: ['外資5日', 0], f20: ['外資20日', 0], it1: ['投信今日', 0], it5: ['投信5日', 0], it20: ['投信20日', 0], mb5: ['融資5日%', 1], sr: ['券資比%', 1],
};

function scrRenderTable() {
  const res = scr.result || [];
  const { k, dir } = scr.sort;
  const fdef = id => SCR_FILTERS.find(f => f.id === id);
  const sv = (r, key) => { const f = fdef(key); return f && f.f ? f.f(r) : r[key]; };
  const sorted = res.slice().sort((a, b) => {
    const x = sv(a, k), y = sv(b, k);
    if (!isNum(x)) return 1;
    if (!isNum(y)) return -1;
    return dir * (x - y);
  });
  const cols = ['r1', 'vol', 'amt'].concat(scr.cols.filter(c => !['r1', 'vol'].includes(c)));
  const label = c => (c === 'amt' ? '成交值(億)' : (SCR_COLS[c] || [c])[0]);
  const dec = c => (c === 'amt' ? 1 : (SCR_COLS[c] || [0, 2])[1]);
  const signed = c => /^(r\d|f\d|it\d|bias|dHi|dLo|mb5|revYoY|revMoM|revCum)/.test(c);
  const head = `<tr><th>代號</th><th>名稱</th><th>產業</th>${['close'].concat(cols).map(c =>
    `<th class="num click ${k === c ? 'sel' : ''}" data-s="${c}">${c === 'close' ? '收盤' : label(c)}${k === c ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th></th></tr>`;
  const body = sorted.slice(0, scr.shown).map(r => {
    const have = inWatchlist('tw', r.code);
    return `<tr>
      <td class="nm"><a href="#" data-r="${r.code}" title="開啟個股研究">${r.code}</a></td>
      <td class="nm">${esc(r.name)}<span class="muted">${r.mkt === 'O' ? '櫃' : ''}</span></td>
      <td class="muted">${esc(r.ind || '')}</td>
      <td class="num strong">${numTxt(r.close)}</td>
      ${cols.map(c => { const v = sv(r, c); return `<td class="num ${signed(c) ? dirCls(v) : ''}">${signed(c) ? signTxt(v, dec(c)) : numTxt(v, dec(c))}</td>`; }).join('')}
      <td class="scr-act"><button class="btn btn-ghost btn-sm" data-r="${r.code}">研究</button>
        <button class="btn btn-ghost btn-sm" data-add="${r.code}" ${have ? 'disabled' : ''}>${have ? '✓ 自選' : '＋ 自選'}</button></td></tr>`;
  }).join('');
  $('#scrResult').innerHTML = `
    <div class="scr-count">符合 <b>${res.length}</b> 檔${res.length > scr.shown ? `（顯示前 ${scr.shown} 檔）` : ''}</div>
    <div class="tbl-wrap"><table class="mtbl scr-tbl"><thead>${head}</thead><tbody>${body || '<tr><td colspan="20" class="muted">沒有符合條件的股票</td></tr>'}</tbody></table></div>
    ${res.length > scr.shown ? '<button class="btn btn-ghost btn-sm" id="scrMore">顯示更多</button>' : ''}`;
  $$('#scrResult th[data-s]').forEach(th => th.addEventListener('click', () => {
    const c = th.dataset.s;
    scr.sort = { k: c, dir: scr.sort.k === c ? -scr.sort.dir : -1 };
    scrRenderTable();
  }));
  $$('#scrResult [data-r]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); openResearch(el.dataset.r); }));
  $$('#scrResult [data-add]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await addToWatchlist('tw', b.dataset.add); b.textContent = '✓ 自選'; }
    catch (err) { b.disabled = false; toast('加入失敗：' + err.message); }
  }));
  const more = $('#scrMore');
  if (more) more.addEventListener('click', () => { scr.shown += 200; scrRenderTable(); });
}

/* ---------- 常用條件 ---------- */
function scrUserPresets() {
  if (!scr.presets) {
    try { scr.presets = JSON.parse((state.settings && state.settings.screenPresets) || '[]'); } catch { scr.presets = []; }
  }
  return scr.presets;
}

function scrRenderPresets() {
  const mine = scrUserPresets();
  $('#scrPresets').innerHTML =
    SCR_BUILTIN.map((p, i) => `<button class="pchip" data-b="${i}">${esc(p.name)}</button>`).join('') +
    mine.map((p, i) => `<span class="pchip mine"><button data-u="${i}">★ ${esc(p.name)}</button><button class="px" data-del="${i}" title="刪除">×</button></span>`).join('');
  $$('#scrPresets [data-b]').forEach(b => b.addEventListener('click', () => { scrSetValues(SCR_BUILTIN[+b.dataset.b].v); scrRun(); }));
  $$('#scrPresets [data-u]').forEach(b => b.addEventListener('click', () => { scrSetValues(scrUserPresets()[+b.dataset.u].v); scrRun(); }));
  $$('#scrPresets [data-del]').forEach(b => b.addEventListener('click', async () => {
    const p = scrUserPresets()[+b.dataset.del];
    if (!confirm(`刪除常用條件「${p.name}」？`)) return;
    scr.presets.splice(+b.dataset.del, 1);
    await scrSavePresets();
  }));
}

async function scrSavePreset() {
  scrReadForm();
  if (!Object.keys(scr.values).length) return toast('請先設定條件');
  const name = (prompt('為這組條件命名（會出現在快速按鈕）：') || '').trim();
  if (!name) return;
  const list = scrUserPresets().filter(p => p.name !== name);
  list.push({ name, v: scr.values });
  scr.presets = list;
  await scrSavePresets();
  toast(`已儲存「${name}」`);
}

async function scrSavePresets() {
  const value = JSON.stringify(scr.presets);
  state.settings = Object.assign(state.settings || {}, { screenPresets: value });
  scrRenderPresets();
  try { await api('saveSetting', { key: 'screenPresets', value }); }
  catch (err) { toast('儲存失敗：' + err.message); }
}

initScreener();
