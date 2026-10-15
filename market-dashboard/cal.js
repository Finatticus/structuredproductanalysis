/* =========================================================
 * 財金日曆 — 前端
 * 字卡：經濟日曆（上週／本週／下週）、財報日曆（自選清單）、美股重要財報、台股除權息預告、市場重要日期
 * 載入、重試、瀏覽器快取、版面編輯由 panels.js 的 PanelPage 處理
 * 依賴 app.js（$, $$, esc, store, state）、macro.js（isNum, numTxt, signTxt, dirCls, seg, tpDate, weekBounds, WD_ZH）、
 *      research.js（openResearch）、portfolio.js（pf，選用：標示持股）
 * ========================================================= */
const CAL_PARTS = [
  { key: 'econcal', title: '經濟日曆', span: 7 },
  { key: 'earnings', title: '財報日曆（自選清單）', span: 5 },
  { key: 'usearn', title: '美股重要財報', span: 7 },
  { key: 'exdiv', title: '台股除權息預告', span: 5 },
  { key: 'dates', title: '市場重要日期', span: 12 },
];
const CC_ZH = { USD: '美國', EUR: '歐元區', JPY: '日本', CNY: '中國', GBP: '英國', TWD: '台灣' };

const calUi = Object.assign(
  { week: 'this', cc: '', ueWeek: 'this', ueMine: false, exMine: false, dMkt: '' },
  (() => { try { return JSON.parse(store.get('mw_cal') || '{}'); } catch { return {}; } })(),
);
function saveCalUi() { store.set('mw_cal', JSON.stringify(calUi)); }

const calPage = new PanelPage({
  id: 'cal', action: 'cal', parts: CAL_PARTS, layoutKey: 'calLayout', cachePrefix: 'mw_cc_', staleMs: 6 * 3600000,
  // 全部字卡都可在瀏覽器引擎計算（除權息要標示持股，先備妥交易紀錄）
  direct: (part, force) => {
    if (!engineOn()) return null;
    if (part === 'econ' || part === 'usearn') return engineCallPlanned('cal_', [part, force, state.account], part, part); // 逐日查詢：先平行抓
    return (part === 'exdiv' ? engineEnsureTxns() : Promise.resolve()).then(() => engineCall('cal_', [part, force, state.account], part));
  },
  apiPart: k => (k === 'econcal' ? 'econ' : k),
  variants: k => [k === 'econcal' ? 'econ' : k],
  renderers: {
    econcal: (...a) => renderEconCal(...a), earnings: (...a) => renderEarnings(...a), usearn: (...a) => renderUsEarn(...a),
    exdiv: (...a) => renderExdiv(...a), dates: (...a) => renderDates(...a),
  },
});

/** 在字卡內切換篩選：只重畫，不重新抓資料 */
function calRerender(key) { calPage.renderPart(key); }

/* ---------- 經濟日曆 ---------- */
function calActTxt(e) {
  if (!e.act) return '—';
  const a = parseFloat(String(e.act).replace(/[^\d.\-]/g, '')), f = parseFloat(String(e.fc || '').replace(/[^\d.\-]/g, ''));
  const diff = isFinite(a) && isFinite(f) && e.fc ? a - f : null;
  const arrow = diff == null || diff === 0 ? '' : diff > 0 ? ' ▲' : ' ▼';
  return `<b class="cal-act ${diff > 0 ? 'hi' : diff < 0 ? 'lo' : ''}">${esc(e.act)}${arrow}</b>`;
}

function renderEconCal(d, body, tools, key) {
  seg(tools, [['last', '上週'], ['this', '本週'], ['next', '下週'], ['all', '全部']], calUi.week, v => { calUi.week = v; saveCalUi(); calRerender(key); });
  const ccs = [...new Set(d.events.map(e => e.cc))];
  const sel = document.createElement('select');
  sel.className = 'cal-cc';
  sel.innerHTML = `<option value="">全部國家</option>${ccs.map(c => `<option value="${c}" ${c === calUi.cc ? 'selected' : ''}>${CC_ZH[c] || c}</option>`).join('')}`;
  sel.addEventListener('change', () => { calUi.cc = sel.value; saveCalUi(); calRerender(key); });
  tools.appendChild(sel);
  const now = Date.now();
  const todayKey = tpDate(now);
  const ranges = { last: [d.lastStart, d.weekStart, '上週'], this: [d.weekStart, d.nextStart, '本週'], next: [d.nextStart, d.end, '下週'] };
  const group = (from, to) => {
    const list = d.events.filter(e => e.ts >= from && e.ts < to && (!calUi.cc || e.cc === calUi.cc));
    if (!list.length) return '<tr><td colspan="6" class="muted">本期間沒有重要事件</td></tr>';
    let lastDay = '';
    return list.map(e => {
      const day = tpDate(e.ts);
      const head = day !== lastDay ? `<tr class="cal-day ${day === todayKey ? 'today' : ''}"><th colspan="6">${day}${day === todayKey ? '　今天' : ''}</th></tr>` : '';
      lastDay = day;
      return head + `<tr class="${e.ts < now ? 'past' : ''}">
        <td class="num">${tpDate(e.ts, true).split(' ')[1]}</td><td>${CC_ZH[e.cc] || e.cc}</td><td class="nm">${esc(e.t)}</td>
        <td class="num">${e.ts < now ? calActTxt(e) : '—'}</td><td class="num">${esc(e.fc || '—')}</td><td class="num">${esc(e.prev || '—')}</td></tr>`;
    }).join('');
  };
  const thead = '<thead><tr><th class="num">時間</th><th>國家</th><th>事件</th><th class="num">實際</th><th class="num">預期</th><th class="num">前值</th></tr></thead>';
  const blocks = calUi.week === 'all' ? ['last', 'this', 'next'] : [calUi.week];
  body.innerHTML = blocks.map(k => `${blocks.length > 1 ? `<div class="sub-h">${ranges[k][2]}</div>` : ''}
    <div class="tbl-wrap"><table class="mtbl cal">${thead}<tbody>${group(ranges[k][0], ranges[k][1])}</tbody></table></div>`).join('') + `
    <div class="foot-note">台北時間；實際值高於預期標 ▲、低於預期標 ▼（不代表利多或利空）。
      本週為 Forex Factory 高影響事件${d.ff ? '' : '（暫時無法取得，改用 Nasdaq）'}；上週${d.lastFromFF ? '沿用上週記錄的 Forex Factory 清單' : '與下週為 Nasdaq 各國重點數據'}，實際值來自 Nasdaq${d.nq ? '' : '（暫時無法取得）'}${d.fred ? '；下週改用 FRED 公布日程' : ''}。
      FOMC 依聯準會公告，台灣央行理監事會日期依慣例推估。灰色為已公布。</div>`;
}

/* ---------- 財報日曆（自選清單） ---------- */
/** 台股法定財報公告期限（一般公司）：年報 3/31、Q1 5/15、Q2 8/14、Q3 11/14 */
function twDeadline() {
  const tp = new Date(Date.now() + 8 * 3600000), y = tp.getUTCFullYear();
  const md = `${String(tp.getUTCMonth() + 1).padStart(2, '0')}-${String(tp.getUTCDate()).padStart(2, '0')}`;
  const list = [['03-31', '年報'], ['05-15', 'Q1'], ['08-14', 'Q2'], ['11-14', 'Q3']];
  const hit = list.find(([dd]) => dd >= md) || list[0];
  return `${hit[1]} 財報 ${+hit[0].slice(0, 2)}/${+hit[0].slice(3)} 前`;
}

function renderEarnings(d, body) {
  const [w0, w1, w2] = weekBounds();
  const now = Date.now();
  // 只列出已有下次財報／法說日期的標的（尚無日期或下次未公布的不列）
  const all = d.rows || [];
  const rows = all.filter(r => r.start && r.start > now - 86400000).sort((a, b) => a.start - b.start);
  const noDate = all.length - rows.length;
  const foot = `${d.note ? `<div class="foot-note warn">${esc(d.note)}</div>` : ''}
    <div class="foot-note">日期來源 Yahoo Finance（台北時間；美股 Yahoo 沒有日期時改用 Nasdaq，只有日期、不含時間）。台股多為法說會或董事會日期。
      ${noDate ? `另有 ${noDate} 檔自選股尚未公布下次日期，未列出；台股法定公告期限：${twDeadline()}（年報 3/31、Q1 5/15、Q2 8/14、Q3 11/14）。` : ''}</div>`;
  if (!all.length) {
    body.innerHTML = '<div class="panel-msg">自選清單中沒有台股或國外股票</div>';
    return;
  }
  if (!rows.length) {
    body.innerHTML = '<div class="panel-msg">自選清單中的股票目前都還沒有公布下次財報／法說日期</div>' + foot;
    return;
  }
  const thisWeek = rows.filter(r => r.start && r.start >= w0 && r.start < w1);
  body.innerHTML = `
    ${thisWeek.length ? `<div class="earn-alert">📢 本週財報：${thisWeek.map(r => `<b>${esc(r.name)}</b> ${tpDate(r.start)}`).join('、')}</div>` : ''}
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>標的</th><th>下次財報／法說</th><th>狀態</th></tr></thead>
      <tbody>${rows.map(r => {
        const days = Math.ceil((r.start - now) / 86400000);
        const when = tpDate(r.start) + (r.end && r.end - r.start > 86400000 ? ` ～ ${tpDate(r.end)}` : '') + (r.est ? ' <span class="muted">預估</span>' : '');
        const tag = r.start < w1 ? '<span class="tag bad">本週財報</span>'
          : r.start < w2 ? '<span class="tag warn">下週</span>'
            : `<span class="tag">${days} 天後</span>`;
        return `<tr><td class="nm"><a href="#" data-rs="${esc(r.symbol)}">${esc(r.name)}</a> <span class="muted">${esc(r.symbol)}</span></td><td>${when}</td><td>${tag}</td></tr>`;
      }).join('')}</tbody></table></div>${foot}`;
  calBindResearch(body);
}

function calBindResearch(body) {
  $$('[data-rs]', body).forEach(a => a.addEventListener('click', e => { e.preventDefault(); openResearch(a.dataset.rs); }));
}

/* ---------- 美股重要財報 ---------- */
/** 自選清單與投資組合中的國外股票代號 */
function calMyGlobal() {
  const s = new Set(state.items.filter(i => i.category === 'global').map(i => i.symbol.toUpperCase()));
  if (typeof pf !== 'undefined' && pf.calc) pf.calc.open.filter(p => p.cat === 'global').forEach(p => s.add(p.sym.toUpperCase()));
  return s;
}

function renderUsEarn(d, body, tools, key) {
  seg(tools, [['this', '本週'], ['next', '下週']], calUi.ueWeek, v => { calUi.ueWeek = v; saveCalUi(); calRerender(key); });
  const chk = document.createElement('label');
  chk.className = 'chk';
  chk.innerHTML = `<input type="checkbox" ${calUi.ueMine ? 'checked' : ''}> 只看自選／持股`;
  chk.querySelector('input').addEventListener('change', e => { calUi.ueMine = e.target.checked; saveCalUi(); calRerender(key); });
  tools.appendChild(chk);
  const mine = calMyGlobal();
  const half = Math.ceil(d.days.length / 2);
  const days = calUi.ueWeek === 'next' ? d.days.slice(half) : d.days.slice(0, half);
  const rows = d.rows.filter(r => days.includes(r.d) && (!calUi.ueMine || mine.has(r.sym)));
  const timeTxt = t => (t === 'pre' ? '<span class="tag">盤前</span>' : t === 'after' ? '<span class="tag warn">盤後</span>' : '');
  const money = v => (isNum(v) ? (v < 0 ? '-$' : '$') + numTxt(Math.abs(v), 2) : '—');
  let lastD = '';
  const body2 = rows.length ? rows.map(r => {
    const dt = new Date(r.d + 'T12:00:00Z');
    const head = r.d !== lastD ? `<tr class="cal-day ${r.d === d.today ? 'today' : ''}"><th colspan="7">${dt.getUTCMonth() + 1}/${dt.getUTCDate()}（${WD_ZH[dt.getUTCDay()]}）美東${r.d === d.today ? '　今天' : ''}</th></tr>` : '';
    lastD = r.d;
    const done = isNum(r.eps);
    return head + `<tr class="${mine.has(r.sym) ? 'cal-mine' : ''}">
      <td class="nm"><a href="#" data-rs="${esc(r.sym)}">${esc(r.sym)}</a>${mine.has(r.sym) ? ' ★' : ''} <span class="muted">${esc(r.name.replace(/,? (Inc\.?|Corporation|Corp\.?|Holdings?|N\.V\.|plc|Ltd\.?|Company)$/i, ''))}</span></td>
      <td>${timeTxt(r.time)}</td><td class="num">${numTxt(r.cap / 1e9, 0)}</td><td class="num">${money(r.fc)}</td>
      <td class="num strong">${done ? money(r.eps) : '—'}</td>
      <td class="num ${dirCls(r.surprise)}">${done && isNum(r.surprise) ? signTxt(r.surprise, 1, '%') : '—'}</td>
      <td class="num muted">${money(r.lastYear)}</td></tr>`;
  }).join('') : `<tr><td colspan="7" class="muted">${calUi.ueMine ? '自選與持股在此期間沒有財報' : '此期間沒有市值 100 億美元以上的公司公布財報'}</td></tr>`;
  body.innerHTML = `<div class="tbl-wrap cal-scroll"><table class="mtbl cal">
      <thead><tr><th>公司</th><th>時間</th><th class="num">市值($B)</th><th class="num">EPS 預估</th><th class="num">實際 EPS</th><th class="num">驚喜</th><th class="num">去年同期</th></tr></thead>
      <tbody>${body2}</tbody></table></div>
    <div class="foot-note">來源 Nasdaq（美東日期）。只列市值 100 億美元以上的公司，★ 為自選清單或投資組合持股；盤前約台北晚上、盤後約台北隔日清晨公布。
      驚喜 = 實際 EPS 相對預估的差距。${d.okDays < d.days.length ? `（${d.days.length - d.okDays} 天資料暫時無法取得）` : ''}點代號開啟個股研究。</div>`;
  calBindResearch(body);
}

/* ---------- 台股除權息預告 ---------- */
function renderExdiv(d, body, tools, key) {
  const chk = document.createElement('label');
  chk.className = 'chk';
  chk.innerHTML = `<input type="checkbox" ${calUi.exMine ? 'checked' : ''}> 只看自選／持股`;
  chk.querySelector('input').addEventListener('change', e => { calUi.exMine = e.target.checked; saveCalUi(); calRerender(key); });
  tools.appendChild(chk);
  const rows = d.rows.filter(r => !calUi.exMine || r.watch || r.qty);
  const [w0, w1] = weekBounds();
  const wkStart = new Date(w0 + 8 * 3600000).toISOString().slice(0, 10), wkEnd = new Date(w1 + 8 * 3600000).toISOString().slice(0, 10);
  const mineSoon = d.rows.filter(r => (r.watch || r.qty) && r.d >= d.today);
  const est = d.rows.filter(r => r.qty && r.d >= d.today).reduce((s, r) => s + (r.est || 0), 0);
  const md = s => `${+s.slice(5, 7)}/${+s.slice(8)}（${WD_ZH[new Date(s + 'T00:00:00Z').getUTCDay()]}）`;
  body.innerHTML = `
    ${mineSoon.length ? `<div class="earn-alert cal-ok">💰 自選／持股即將除權息：${mineSoon.slice(0, 8).map(r => `<b>${esc(r.name)}</b> ${md(r.d)}`).join('、')}${mineSoon.length > 8 ? ` 等 ${mineSoon.length} 檔` : ''}
      ${est ? `<br>持股預估可領現金股利約 <b>${numTxt(est, 0)}</b> 元（稅前）` : ''}</div>` : ''}
    <div class="tbl-wrap cal-scroll"><table class="mtbl cal">
      <thead><tr><th>除權息日</th><th>標的</th><th>類型</th><th class="num">現金股利</th><th class="num">配股(元)</th><th class="num">持股可領</th></tr></thead>
      <tbody>${rows.length ? rows.map(r => `<tr class="${r.d < d.today ? 'past' : ''} ${r.watch || r.qty ? 'cal-mine' : ''}">
        <td>${md(r.d)}${r.d >= wkStart && r.d < wkEnd && r.d >= d.today ? ' <span class="tag bad">本週</span>' : ''}</td>
        <td class="nm"><a href="#" data-rs="${esc(r.code)}">${esc(r.name)}</a> <span class="muted">${esc(r.code)}${r.mkt === 'otc' ? '・櫃' : ''}</span>${r.qty ? ' <span class="tag ok">持股</span>' : r.watch ? ' ★' : ''}</td>
        <td>${esc(r.type)}</td>
        <td class="num">${isNum(r.cash) && r.cash > 0 ? numTxt(r.cash, r.cash < 1 ? 4 : 2) : r.note ? `<span class="muted" title="${esc(r.note)}">待公告</span>` : '—'}</td>
        <td class="num">${isNum(r.stock) && r.stock > 0 ? numTxt(r.stock * 10, 2) : '—'}</td>
        <td class="num strong">${r.est ? numTxt(r.est, 0) : '—'}</td></tr>`).join('')
        : `<tr><td colspan="6" class="muted">${calUi.exMine ? '自選與持股近期沒有除權息' : '近期沒有除權息'}</td></tr>`}</tbody></table></div>
    <div class="foot-note">來源：證交所除權除息預告表、櫃買中心${d.partial && d.partial.length ? `（${esc(d.partial.join('、'))}暫時無法取得）` : ''}。★ 為自選清單，「持股」依投資組合的交易紀錄計算股數；
      配股以面額 10 元換算（每股配 1 元 = 每千股配 100 股）。除權息日前一天收盤持有才能參與。</div>`;
  calBindResearch(body);
}

/* ---------- 市場重要日期 ---------- */
const DATE_KIND = { holiday: ['休市', 'bad'], info: ['交易日', ''], settle: ['結算', 'warn'], report: ['申報', ''], index: ['指數', ''], cb: ['央行', 'ok'] };

function renderDates(d, body, tools, key) {
  seg(tools, [['', '全部'], ['TW', '台股'], ['US', '美股']], calUi.dMkt, v => { calUi.dMkt = v; saveCalUi(); calRerender(key); });
  const items = d.items.filter(x => !calUi.dMkt || x.mkt === calUi.dMkt);
  const today = d.today;
  const days = s => Math.round((Date.parse(s) - Date.parse(today)) / 86400000);
  const next = items.filter(x => x.kind === 'holiday').slice(0, 3);
  let lastM = '';
  body.innerHTML = `
    ${next.length ? `<div class="kpis cal-kpis">${next.map(x => `<div class="kpi"><div class="kpi-l">${x.mkt === 'TW' ? '下次台股休市' : '下次美股休市'}</div>
      <div class="kpi-v sm">${+x.d.slice(5, 7)}/${+x.d.slice(8)}（${WD_ZH[new Date(x.d + 'T00:00:00Z').getUTCDay()]}）</div><div class="kpi-s">${esc(x.t.replace(/^.+休市：/, ''))}・${days(x.d) ? days(x.d) + ' 天後' : '今天'}</div></div>`).join('')}</div>` : ''}
    <div class="tbl-wrap cal-scroll"><table class="mtbl cal">
      <thead><tr><th>日期</th><th>市場</th><th>類別</th><th>事項</th><th class="num">倒數</th></tr></thead>
      <tbody>${items.map(x => {
        const m = x.d.slice(0, 7);
        const head = m !== lastM ? `<tr class="cal-day"><th colspan="5">${+m.slice(0, 4)} 年 ${+m.slice(5)} 月</th></tr>` : '';
        lastM = m;
        const k = DATE_KIND[x.kind] || [x.kind, ''];
        return head + `<tr class="${x.d === today ? 'cal-today' : ''}"><td>${+x.d.slice(5, 7)}/${+x.d.slice(8)}（${WD_ZH[new Date(x.d + 'T00:00:00Z').getUTCDay()]}）</td>
          <td>${x.mkt === 'TW' ? '台股' : '美股'}</td><td><span class="tag ${k[1]}">${k[0]}</span></td>
          <td class="nm">${esc(x.t)}${x.note ? ` <span class="muted">${esc(x.note)}</span>` : ''}</td><td class="num">${days(x.d) ? days(x.d) + ' 天' : '今天'}</td></tr>`;
      }).join('')}</tbody></table></div>
    <div class="foot-note">未來 120 天。台股休市依證交所公告${d.twHolidays ? '' : '（暫時無法取得）'}；美股休市、台指期（第三個週三）與美股選擇權（第三個週五）結算、MSCI 季度調整（2／5／8／11 月最後一個交易日）依規則推算，
      遇臨時休市可能異動。FOMC 依聯準會公告，台灣央行理監事會依慣例推估。</div>`;
}

function initCal() { calPage.init(); }
initCal();
