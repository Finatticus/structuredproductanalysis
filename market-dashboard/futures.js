/* =========================================================
 * 期貨專區 — 前端
 * 字卡：台灣期貨即時行情、期貨重要日期、三大法人期貨未平倉、大額交易人、台指選擇權籌碼、
 *       美國期貨行情、期限結構、CFTC 持倉報告
 * 載入、重試、瀏覽器快取、版面編輯由 panels.js 的 PanelPage 處理；資料由瀏覽器資料引擎經中繼站抓（Futures.gs）
 * 依賴 app.js（$, $$, esc, store, state）、macro.js（isNum, numTxt, signTxt, pctTxt, dirCls, sparkSvg, seg, chip, mdTxt, WD_ZH）、
 *      panels.js（PanelPage, newChart）、engine.js（engineOn, engineCall）
 * ========================================================= */
const FUT_PARTS = [
  { key: 'tw_quote', title: '台灣期貨即時行情', span: 7 },
  { key: 'fut_dates', title: '期貨重要日期', span: 5 },
  { key: 'tw_inst', title: '三大法人期貨未平倉', span: 7 },
  { key: 'tw_large', title: '大額交易人未沖銷部位', span: 5 },
  { key: 'tw_opt', title: '台指選擇權籌碼', span: 12 },
  { key: 'us_quote', title: '美國期貨行情', span: 7 },
  { key: 'us_curve', title: '期限結構（正價差／逆價差）', span: 5 },
  { key: 'us_cot', title: 'CFTC 持倉報告（投機部位）', span: 12 },
];

const futUi = Object.assign(
  { sess: 'auto', dMkt: '', large: 'all', curve: 'CL', cot: '13874A' },
  (() => { try { return JSON.parse(store.get('mw_fut') || '{}'); } catch { return {}; } })(),
);
function saveFutUi() { store.set('mw_fut', JSON.stringify(futUi)); }

const futPage = new PanelPage({
  id: 'fut', action: 'fut', parts: FUT_PARTS, layoutKey: 'futLayout', cachePrefix: 'mw_fc_', staleMs: 3600000,
  direct: (part, force) => (engineOn() ? engineCall('fut_', [part, force], part) : null),
  renderers: {
    tw_quote: (...a) => renderFutTwQuote(...a), fut_dates: (...a) => renderFutDates(...a), tw_inst: (...a) => renderFutInst(...a),
    tw_large: (...a) => renderFutLarge(...a), tw_opt: (...a) => renderFutOpt(...a), us_quote: (...a) => renderFutUs(...a),
    us_curve: (...a) => renderFutCurve(...a), us_cot: (...a) => renderFutCot(...a),
  },
});
function futRerender(key) { futPage.renderPart(key); }

/* ---------- 交易時段（台北） ---------- */
function tpNow() {
  const t = new Date(Date.now() + 8 * 3600000);
  return { dow: t.getUTCDay(), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
/** 台灣期貨：一般時段 08:45–13:45；盤後（夜盤）15:00–隔日 05:00 */
function twFutSession() {
  const { dow, min } = tpNow();
  if (dow >= 1 && dow <= 5 && min >= 525 && min <= 825) return 'day';
  if ((dow >= 1 && dow <= 5 && min >= 900) || (dow >= 2 && dow <= 6 && min < 300)) return 'night';
  return '';
}
/** 美國期貨（CME Globex）：台北週一 06:00～週六 05:00 幾乎全天交易 */
function usFutOpen() {
  const { dow, min } = tpNow();
  return !(dow === 0 || (dow === 6 && min >= 300) || (dow === 1 && min < 360));
}

/* 交易時段內、停留此頁時自動更新即時行情（台灣 30 秒、美國 60 秒） */
setInterval(() => {
  if (!futPage.loadedAt || !futPage.active()) return;
  if (!futPage.hidden('tw_quote') && twFutSession() && !futPage.retry.has('tw_quote')) futPage.loadPart('tw_quote', false);
}, 30000);
setInterval(() => {
  if (!futPage.loadedAt || !futPage.active()) return;
  if (!futPage.hidden('us_quote') && usFutOpen() && !futPage.retry.has('us_quote')) futPage.loadPart('us_quote', false);
}, 60000);

const intTxt = v => numTxt(v, 0);
const hhmm = s => (s && s.length >= 4 ? s.slice(0, 2) + ':' + s.slice(2, 4) : '');

/** 台指期下次月結算：第三個週三（休市順延以「期貨重要日期」字卡為準） */
function nextTxSettle() {
  const fd = futPage.data.fut_dates;
  if (fd && fd.nextTx) return fd.nextTx;
  const tp = new Date(Date.now() + 8 * 3600000);
  for (let k = 0; k < 2; k++) {
    const y = tp.getUTCFullYear(), m = tp.getUTCMonth() + k;
    const first = new Date(Date.UTC(y, m, 1));
    const d = new Date(Date.UTC(y, m, 1 + ((3 - first.getUTCDay() + 7) % 7) + 14)).toISOString().slice(0, 10);
    if (d >= tp.toISOString().slice(0, 10)) return d;
  }
  return '';
}
function daysTo(ds) { return Math.round((Date.parse(ds) - Date.parse(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10))) / 86400000); }
function mdW(ds) { return `${+ds.slice(5, 7)}/${+ds.slice(8)}（${WD_ZH[new Date(ds + 'T00:00:00Z').getUTCDay()]}）`; }

/* =========================================================
 * 台灣期貨即時行情
 * ========================================================= */
function renderFutTwQuote(d, body, tools, key) {
  seg(tools, [['auto', '自動'], ['day', '日盤'], ['night', '夜盤']], futUi.sess, v => { futUi.sess = v; saveFutUi(); futRerender(key); });
  const live = twFutSession();
  const { min } = tpNow();
  let sess = futUi.sess;
  if (sess === 'auto') sess = live || (min >= 525 && min < 900 ? 'day' : 'night');
  if (sess === 'night' && !d.products.some(p => p.night.length)) sess = 'day';
  const tx = d.products.find(p => p.id === 'TXF');
  const near = tx && (tx[sess][0] || tx.day[0]);
  const spot = tx && tx.spot;
  const basis = near && spot && isNum(near.last) && isNum(spot.last) ? near.last - spot.last : null;
  const settle = nextTxSettle();
  const chips = [];
  if (near) chips.push(chip(`臺指期 ${near.ym.slice(5)} 月（${sess === 'night' ? '夜盤' : '日盤'}）`, numTxt(near.last, 0), `${signTxt(near.chg, 0)}（${pctTxt(near.pct)}）`, '', `量 ${intTxt(near.vol)}・未平倉 ${intTxt(near.oi)}`));
  if (spot) chips.push(chip('加權指數（現貨）', numTxt(spot.last, 2), pctTxt(spot.pct), '', spot.time ? `${hhmm(spot.time)} 更新` : ''));
  if (isNum(basis)) chips.push(chip('期現價差', signTxt(basis, 0), basis > 0 ? '正價差' : basis < 0 ? '逆價差' : '平價', basis < -50 ? 'warn' : '', '近月期貨 − 加權指數'));
  if (settle) chips.push(chip('下次月結算', `${+settle.slice(5, 7)}/${+settle.slice(8)}`, daysTo(settle) ? `${daysTo(settle)} 天後` : '今天結算', daysTo(settle) <= 2 ? 'warn' : '', '第三個週三'));

  const rows = d.products.map(p => {
    const list = p[sess].length ? p[sess] : p.day;
    return list.map((c, i) => {
      const b = p.spot && isNum(c.last) && isNum(p.spot.last) ? c.last - p.spot.last : null;
      const dec = p.spot && p.spot.last < 1000 ? 2 : 0;
      return `<tr class="${i ? 'sub' : ''}"><td class="nm">${i ? '' : esc(p.name)}</td><td>${c.ym}</td>
        <td class="num strong">${isNum(c.last) ? numTxt(c.last, dec) : '—'}</td>
        <td class="num ${dirCls(c.chg)}">${signTxt(c.chg, dec)}</td><td class="num ${dirCls(c.pct)}">${pctTxt(c.pct)}</td>
        <td class="num ${b < 0 ? 'down' : ''}">${isNum(b) ? signTxt(b, dec) : '—'}</td>
        <td class="num">${intTxt(c.vol)}</td><td class="num">${isNum(c.oi) ? intTxt(c.oi) : '—'}</td></tr>`;
    }).join('');
  }).join('');
  const t = tx && near ? `${near.date ? mdTxt(near.date) + ' ' : ''}${hhmm(near.time)}` : '';
  body.innerHTML = `
    <div class="chips">${chips.join('')}</div>
    <div class="tbl-wrap"><table class="mtbl fut">
      <thead><tr><th>商品</th><th>月份</th><th class="num">成交</th><th class="num">漲跌</th><th class="num">漲跌%</th><th class="num">期現價差</th><th class="num">成交量</th><th class="num">未平倉</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="foot-note">來源：期交所即時行情（${sess === 'night' ? '盤後交易時段 15:00–05:00' : '一般交易時段 08:45–13:45'}${t ? '，最後成交 ' + t : ''}）。
      期現價差 = 期貨 − 現貨指數：正值為正價差（期貨較貴），逆價差常見於除息旺季或市場看空避險。每檔列出近月與次月；
      交易時段內停留此頁時每 30 秒自動更新${live ? '' : '（目前非交易時段）'}。</div>`;
}

/* =========================================================
 * 期貨重要日期
 * ========================================================= */
const FUT_DATE_KIND = { settle: ['結算', 'warn'], weekly: ['週結算', ''], roll: ['換月', 'ok'], report: ['報告', ''] };

function renderFutDates(d, body, tools, key) {
  seg(tools, [['', '全部'], ['TW', '台灣'], ['US', '美國']], futUi.dMkt, v => { futUi.dMkt = v; saveFutUi(); futRerender(key); });
  const items = d.items.filter(x => !futUi.dMkt || x.mkt === futUi.dMkt);
  const firstOf = re => d.items.find(x => re.test(x.t));
  const k = [
    ['台指期月結算', firstOf(/台指期／台指選擇權月結算/)], ['美股季結算（四巫日）', firstOf(/四巫日/)],
    ['VIX 結算', firstOf(/^VIX/)], ['WTI 原油換月', firstOf(/WTI/)],
  ].filter(x => x[1]);
  let lastM = '';
  body.innerHTML = `
    <div class="kpis cal-kpis">${k.map(([l, x]) => `<div class="kpi"><div class="kpi-l">${l}</div><div class="kpi-v sm">${mdW(x.d)}</div>
      <div class="kpi-s">${daysTo(x.d) ? daysTo(x.d) + ' 天後' : '今天'}</div></div>`).join('')}</div>
    <div class="tbl-wrap cal-scroll"><table class="mtbl cal">
      <thead><tr><th>日期</th><th>市場</th><th>類別</th><th>事項</th><th class="num">倒數</th></tr></thead>
      <tbody>${items.map(x => {
        const m = x.d.slice(0, 7);
        const head = m !== lastM ? `<tr class="cal-day"><th colspan="5">${+m.slice(0, 4)} 年 ${+m.slice(5)} 月</th></tr>` : '';
        lastM = m;
        const kk = FUT_DATE_KIND[x.kind] || [x.kind, ''];
        return head + `<tr class="${x.d === d.today ? 'cal-today' : ''}"><td>${mdW(x.d)}</td><td>${x.mkt === 'TW' ? '台灣' : '美國'}</td>
          <td><span class="tag ${kk[1]}">${kk[0]}</span></td><td class="nm">${esc(x.t)}${x.note ? ` <span class="muted">${esc(x.note)}</span>` : ''}</td>
          <td class="num">${daysTo(x.d) ? daysTo(x.d) + ' 天' : '今天'}</td></tr>`;
      }).join('')}</tbody></table></div>
    <div class="foot-note">未來約 100 天，依交易所規則推算：台指期與月選擇權為第三個週三、週選擇權每週三（遇休市順延${d.twHolidays ? '，已套用證交所休市表' : ''}）；
      美股指數期貨為 3／6／9／12 月第三個週五；VIX 為次月第三個週五往前 30 天；WTI 原油為交割前一月 25 日前第 3 個營業日。實際日期以交易所公告為準。</div>`;
}

/* =========================================================
 * 三大法人期貨未平倉
 * ========================================================= */
const WHO_ZH = { f: '外資', it: '投信', dl: '自營商' };

function renderFutInst(d, body, tools, key) {
  const tx = d.contracts.find(c => c.name === '臺股期貨') || {};
  const kv = (w, label) => {
    const o = tx[w];
    if (!o) return '';
    return `<div class="kpi"><div class="kpi-l">${label}<span class="muted">台指期</span></div><div class="kpi-v ${dirCls(o.oi)}">${signTxt(o.oi, 0)}<small> 口</small></div>
      <div class="kpi-s ${dirCls(o.chg)}">${isNum(o.chg) ? '日 ' + signTxt(o.chg, 0) + ' 口' : ''}${isNum(o.val) && w === 'f' ? `・${signTxt(o.val, 1)} 億` : ''}</div></div>`;
  };
  const rt = (o, label) => (o ? `<div class="kpi"><div class="kpi-l">${label}散戶多空比</div><div class="kpi-v ${dirCls(o.ratio)}">${signTxt(o.ratio, 1, '%')}</div>
      <div class="kpi-s">${o.ratio > 10 ? '散戶偏多（常視為反向指標）' : o.ratio < -10 ? '散戶偏空' : '散戶中性'}</div></div>` : '');
  const cell = o => (o ? `<td class="num strong ${dirCls(o.oi)}">${signTxt(o.oi, 0)}</td><td class="num muted ${dirCls(o.chg)}">${isNum(o.chg) ? signTxt(o.chg, 0) : '—'}</td>` : '<td class="num">—</td><td></td>');
  const H = d.hist || { d: [] }, n = H.d.length;
  const recent = [];
  for (let i = n - 1; i >= Math.max(0, n - 10); i--) {
    const sum = (H.f[i] || 0) + (H.it[i] || 0) + (H.dl[i] || 0);
    const chg = i > 0 && isNum(H.f[i]) && isNum(H.f[i - 1]) ? H.f[i] - H.f[i - 1] : null;
    recent.push(`<tr><td class="nm">${mdTxt(H.d[i])}</td><td class="num strong ${dirCls(H.f[i])}">${signTxt(H.f[i], 0)}</td><td class="num ${dirCls(chg)}">${signTxt(chg, 0)}</td>
      <td class="num ${dirCls(H.it[i])}">${signTxt(H.it[i], 0)}</td><td class="num ${dirCls(H.dl[i])}">${signTxt(H.dl[i], 0)}</td>
      <td class="num ${dirCls(sum)}">${signTxt(sum, 0)}</td><td class="num">${numTxt(H.twii[i], 0)}</td></tr>`);
  }
  body.innerHTML = `
    <div class="kpis">${kv('f', '外資')}${kv('it', '投信')}${kv('dl', '自營商')}${rt(d.retail && d.retail.mtx, '小台')}${rt(d.retail && d.retail.tmf, '微台')}</div>
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>契約（未平倉淨口數）</th><th class="num">外資</th><th class="num">日變化</th><th class="num">投信</th><th class="num">日變化</th><th class="num">自營商</th><th class="num">日變化</th></tr></thead>
      <tbody>${d.contracts.map(c => `<tr><td class="nm">${esc(c.name)}</td>${cell(c.f)}${cell(c.it)}${cell(c.dl)}</tr>`).join('')}</tbody></table></div>
    ${n > 5 ? `<div class="chart-legend"><span style="--c:#1f4e8c">外資台指期淨未平倉（口，右軸）</span><span style="--c:#e67e22">加權指數（左軸）</span></div><div class="mini-chart tall" id="futInstChart"></div>` : ''}
    <div class="sub-h">台指期近 ${recent.length} 個交易日（未平倉淨口數）</div>
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>日期</th><th class="num">外資</th><th class="num">外資增減</th><th class="num">投信</th><th class="num">自營商</th><th class="num">合計</th><th class="num">加權指數</th></tr></thead>
      <tbody>${recent.join('')}</tbody></table></div>
    <div class="foot-note">資料日 ${esc(d.date)}，來源期交所（交易日約 15:00 後公布）。未平倉淨口數 = 多方未平倉 − 空方未平倉，正值為淨多單。
      外資台指期空單常用於避險現貨持股，宜搭配現貨買賣超判讀；投信多單多為 ETF 避險或期貨 ETF 部位。
      散戶多空比 =（全市場未平倉 − 三大法人淨部位）÷ 全市場未平倉，正值代表散戶淨多，常被當作反向指標。</div>`;
  if (n <= 5) return;
  const LWC = window.LightweightCharts;
  const chart = newChart(key, $('#futInstChart', body), { leftPriceScale: { visible: true, borderColor: '#e3e8ef' } });
  const up = cssVar('--up'), dn = cssVar('--down');
  const hs = chart.addSeries(LWC.HistogramSeries, { priceScaleId: 'right', priceLineVisible: false, priceFormat: { type: 'custom', formatter: v => Math.round(v).toLocaleString() } });
  hs.setData(H.d.map((t, i) => (isNum(H.f[i]) ? { time: t, value: H.f[i], color: H.f[i] >= 0 ? up : dn } : { time: t })));
  const ls = chart.addSeries(LWC.LineSeries, { color: '#e67e22', lineWidth: 1.5, priceScaleId: 'left', priceLineVisible: false });
  ls.setData(H.d.map((t, i) => (isNum(H.twii[i]) ? { time: t, value: H.twii[i] } : { time: t })));
  chart.timeScale().fitContent();
}

/* =========================================================
 * 大額交易人
 * ========================================================= */
function renderFutLarge(d, body, tools, key) {
  seg(tools, [['all', '所有月份'], ['near', '近月']], futUi.large, v => { futUi.large = v; saveFutUi(); futRerender(key); });
  const near = futUi.large === 'near';
  const A = near ? d.nearAll : d.all, S = near ? d.nearSp : d.allSp;
  const row = (label, P, n) => {
    const c = P && P.cur, p = P && P.prev;
    if (!c) return `<tr><td class="nm">${label}</td><td colspan="5" class="muted">無資料</td></tr>`;
    const net = c['b' + n] - c['s' + n], pnet = p ? p['b' + n] - p['s' + n] : null;
    return `<tr><td class="nm">${label}</td><td class="num">${intTxt(c['b' + n])}</td><td class="num">${intTxt(c['s' + n])}</td>
      <td class="num strong ${dirCls(net)}">${signTxt(net, 0)}</td><td class="num ${dirCls(isNum(pnet) ? net - pnet : null)}">${isNum(pnet) ? signTxt(net - pnet, 0) : '—'}</td>
      <td class="num">${c.oi ? numTxt((net / c.oi) * 100, 1) + '%' : '—'}</td></tr>`;
  };
  const c = A && A.cur;
  const net10 = c ? c.b10 - c.s10 : null, net5 = c ? c.b5 - c.s5 : null;
  const sp = S && S.cur, spNet = sp ? sp.b10 - sp.s10 : null;
  body.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">前十大交易人淨部位</div><div class="kpi-v ${dirCls(net10)}">${signTxt(net10, 0)}<small> 口</small></div><div class="kpi-s">${c && c.oi ? '占全市場 ' + numTxt((net10 / c.oi) * 100, 1) + '%' : ''}</div></div>
      <div class="kpi"><div class="kpi-l">前五大交易人淨部位</div><div class="kpi-v ${dirCls(net5)}">${signTxt(net5, 0)}<small> 口</small></div></div>
      <div class="kpi"><div class="kpi-l">特定法人（前十大）</div><div class="kpi-v ${dirCls(spNet)}">${signTxt(spNet, 0)}<small> 口</small></div></div>
      <div class="kpi"><div class="kpi-l">全市場未沖銷</div><div class="kpi-v">${c ? intTxt(c.oi) : '—'}<small> 口</small></div><div class="kpi-s">${near ? esc(d.near.slice(0, 4) + '/' + d.near.slice(4)) + ' 合約' : '所有月份'}</div></div>
    </div>
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>交易人</th><th class="num">買方</th><th class="num">賣方</th><th class="num">淨部位</th><th class="num">較前日</th><th class="num">占全市場</th></tr></thead>
      <tbody>${row('前五大交易人', A, 5)}${row('前十大交易人', A, 10)}${row('特定法人前五大', S, 5)}${row('特定法人前十大', S, 10)}</tbody></table></div>
    <div class="foot-note">資料日 ${esc(d.date)}${d.prevDate ? `（較前日 ${esc(d.prevDate)}）` : ''}，來源期交所。臺股期貨口數已把小台 ÷4、微台 ÷20 換算成大台口數。
      「前十大」為未沖銷部位最多的 10 位交易人（含自然人與法人），「特定法人」為其中的法人身分。前十大淨空單持續增加，常被解讀為大戶看空或避險需求升高。</div>`;
}

/* =========================================================
 * 台指選擇權籌碼
 * ========================================================= */
function optDistSvg(ch) {
  const S = ch.strikes || [];
  if (!S.length) return '';
  const W = 760, H = 220, L = 46, R = 10, T = 12, B = 34;
  const max = Math.max(1, ...S.flatMap(x => [x[1], x[2]]));
  const bw = (W - L - R) / S.length;
  const mid = T + (H - T - B) / 2, half = (H - T - B) / 2;
  let g = `<line x1="${L}" x2="${W - R}" y1="${mid}" y2="${mid}" class="gl"/>`;
  [1, 0.5].forEach(f => {
    g += `<text x="${L - 6}" y="${mid - half * f + 4}" class="ax" text-anchor="end">${Math.round(max * f).toLocaleString()}</text>`;
    g += `<text x="${L - 6}" y="${mid + half * f + 4}" class="ax" text-anchor="end">${Math.round(max * f).toLocaleString()}</text>`;
  });
  const every = Math.ceil(S.length / 12);
  S.forEach((x, i) => {
    const cx = L + i * bw;
    const hc = (x[1] / max) * half, hp = (x[2] / max) * half;
    const hot = x[0] === ch.maxCall.k || x[0] === ch.maxPut.k;
    g += `<rect x="${(cx + 1).toFixed(1)}" y="${(mid - hc).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${hc.toFixed(1)}" class="oc${x[0] === ch.maxCall.k ? ' hot' : ''}"><title>${x[0]} 買權未平倉 ${x[1].toLocaleString()} 口</title></rect>`;
    g += `<rect x="${(cx + 1).toFixed(1)}" y="${mid.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${hp.toFixed(1)}" class="op${x[0] === ch.maxPut.k ? ' hot' : ''}"><title>${x[0]} 賣權未平倉 ${x[2].toLocaleString()} 口</title></rect>`;
    if (i % every === 0 || hot) g += `<text x="${(cx + bw / 2).toFixed(1)}" y="${H - 18}" class="ax${hot ? ' strong' : ''}" text-anchor="middle">${x[0]}</text>`;
  });
  if (isNum(ch.spot) && S.length > 1) {
    const k0 = S[0][0], k1 = S[S.length - 1][0];
    const sx = L + ((ch.spot - k0) / (k1 - k0)) * (W - L - R - bw) + bw / 2;
    if (sx >= L && sx <= W - R) g += `<line x1="${sx.toFixed(1)}" x2="${sx.toFixed(1)}" y1="${T}" y2="${H - B}" class="spot"/><text x="${sx.toFixed(1)}" y="${H - 4}" class="ax strong" text-anchor="middle">現貨 ${Math.round(ch.spot).toLocaleString()}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="optdist">${g}<text x="${L + 4}" y="${T + 10}" class="ax">▲ 買權（Call）</text><text x="${L + 4}" y="${H - B - 4}" class="ax">▼ 賣權（Put）</text></svg>`;
}

function renderFutOpt(d, body, tools, key) {
  const P = d.pcr || { d: [] }, I = d.inst || { d: [] }, ch = d.chain;
  const pn = P.d.length, inn = I.d.length;
  const pcr = pn ? P.oi[pn - 1] : null, pcrChg = pn > 1 && isNum(P.oi[pn - 2]) ? pcr - P.oi[pn - 2] : null;
  const fNet = i => (isNum(I.cfv[i]) && isNum(I.pfv[i]) ? I.cfv[i] - I.pfv[i] : null); // 外資買權淨額 − 賣權淨額（億）
  const li = inn - 1;
  const chips = [];
  if (isNum(pcr)) chips.push(chip('Put/Call 比（未平倉）', numTxt(pcr, 1) + '%', pcr >= 120 ? '賣權支撐強・偏多' : pcr <= 80 ? '買權壓力大・偏空' : '中性', pcr >= 120 ? 'ok' : pcr <= 80 ? 'bad' : '', `日 ${signTxt(pcrChg, 1)}・成交量比 ${numTxt(P.vol[pn - 1], 1)}%`));
  if (inn) chips.push(chip('外資選擇權淨部位', signTxt(fNet(li), 2) + ' 億', fNet(li) > 0 ? '偏多' : fNet(li) < 0 ? '偏空' : '中性', fNet(li) > 0 ? 'ok' : fNet(li) < 0 ? 'bad' : '', '買權淨額 − 賣權淨額'));
  if (ch) {
    chips.push(chip(`最大買權未平倉（${ch.month}）`, intTxt(ch.maxCall.k), '上檔壓力', 'warn', `${intTxt(ch.maxCall.oi)} 口${isNum(ch.spot) ? `・距現貨 ${signTxt(((ch.maxCall.k / ch.spot) - 1) * 100, 1, '%')}` : ''}`));
    chips.push(chip(`最大賣權未平倉（${ch.month}）`, intTxt(ch.maxPut.k), '下檔支撐', 'ok', `${intTxt(ch.maxPut.oi)} 口${isNum(ch.spot) ? `・距現貨 ${signTxt(((ch.maxPut.k / ch.spot) - 1) * 100, 1, '%')}` : ''}`));
  }
  const rows = [];
  for (let i = inn - 1; i >= Math.max(0, inn - 10); i--) {
    const pi = P.d.indexOf(I.d[i]);
    rows.push(`<tr><td class="nm">${mdTxt(I.d[i])}</td><td class="num">${pi >= 0 ? numTxt(P.oi[pi], 1) + '%' : '—'}</td>
      <td class="num ${dirCls(I.cf[i])}">${signTxt(I.cf[i], 0)}</td><td class="num ${dirCls(I.pf[i])}">${signTxt(I.pf[i], 0)}</td>
      <td class="num ${dirCls(I.cfv[i])}">${signTxt(I.cfv[i], 2)}</td><td class="num ${dirCls(I.pfv[i])}">${signTxt(I.pfv[i], 2)}</td>
      <td class="num strong ${dirCls(fNet(i))}">${signTxt(fNet(i), 2)}</td></tr>`);
  }
  body.innerHTML = `
    <div class="chips">${chips.join('')}</div>
    <div class="fut-two">
      <div>
        <div class="sub-h">${ch ? `${ch.month} 月選擇權各履約價未平倉（現貨上下約 8%）` : '各履約價未平倉'}</div>
        ${ch ? optDistSvg(ch) : '<div class="panel-msg">選擇權即時行情暫時無法取得</div>'}
        ${ch ? `<div class="foot-note" style="margin-top:4px">買權合計 ${intTxt(ch.callOI)} 口、賣權合計 ${intTxt(ch.putOI)} 口（本月合約 P/C ${numTxt((ch.putOI / ch.callOI) * 100, 1)}%）。深色為最大未平倉履約價。</div>` : ''}
      </div>
      <div>
        <div class="sub-h">Put/Call 比走勢（%）</div>
        ${pn > 3 ? '<div class="mini-chart" id="futPcrChart"></div>' : '<div class="panel-msg">資料不足</div>'}
      </div>
    </div>
    <div class="sub-h">外資台指選擇權（近 ${rows.length} 個交易日）</div>
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>日期</th><th class="num">P/C 比</th><th class="num">買權淨口數</th><th class="num">賣權淨口數</th><th class="num">買權淨額(億)</th><th class="num">賣權淨額(億)</th><th class="num">淨多空(億)</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>
    <div class="foot-note">資料日 ${esc(d.date)}，來源期交所。P/C 比 = 賣權未平倉 ÷ 買權未平倉：數值高代表賣方（多為法人）在下方建立支撐，台灣市場習慣視為偏多；過高或驟降時留意反轉。
      外資淨多空 = 買權未平倉淨額 − 賣權未平倉淨額，正值偏多。最大未平倉履約價是賣方的防守價位，常被當作月結算前的壓力與支撐參考。</div>`;
  if (pn > 3) {
    const LWC = window.LightweightCharts;
    const chart = newChart(key, $('#futPcrChart', body));
    const a = chart.addSeries(LWC.LineSeries, { color: '#1f4e8c', lineWidth: 2, title: '未平倉', priceLineVisible: false });
    a.setData(P.d.map((t, i) => (isNum(P.oi[i]) ? { time: t, value: P.oi[i] } : { time: t })));
    a.createPriceLine({ price: 100, color: '#a3abb8', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false });
    const b = chart.addSeries(LWC.LineSeries, { color: '#e67e22', lineWidth: 1, title: '成交量', priceLineVisible: false });
    b.setData(P.d.map((t, i) => (isNum(P.vol[i]) ? { time: t, value: P.vol[i] } : { time: t })));
    chart.timeScale().fitContent();
  }
}

/* =========================================================
 * 美國期貨行情
 * ========================================================= */
function renderFutUs(d, body) {
  const idx = (d.groups.find(g => g.name === '股價指數') || { items: [] }).items;
  const chips = idx.filter(x => isNum(x.price)).map(x => {
    const prem = x.cash && isNum(x.cash.price) ? x.price - x.cash.price : null;
    return chip(x.name, numTxt(x.price, 2), '1D ' + pctTxt(x.d1), '',
      isNum(prem) ? `期現價差 ${signTxt(prem, 1)}（${signTxt((prem / x.cash.price) * 100, 2, '%')}）` : '');
  });
  const month = s => { const m = String(s || '').match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[ ,-]*(20)?(\d{2})\b/i); return m ? `${m[1]} ${m[3]}` : ''; };
  const rows = d.groups.map(g => `<tr class="grp"><th colspan="7">${esc(g.name)}</th></tr>` + g.items.filter(it => isNum(it.price)).map(it => `
    <tr><td class="nm">${esc(it.name)} <span class="muted">${esc(it.sym)}${month(it.cname) ? '・' + month(it.cname) : ''}</span></td>
      <td class="sp">${sparkSvg(it.spark)}</td><td class="num strong">${numTxt(it.price, it.price >= 100 ? 2 : it.price >= 1 ? 3 : 5)}</td>
      ${['d1', 'w1', 'm1', 'ytd'].map(k => `<td class="num ${dirCls(it[k])}">${pctTxt(it[k])}</td>`).join('')}</tr>`).join('')).join('');
  body.innerHTML = `
    <div class="chips">${chips.join('')}</div>
    <div class="tbl-wrap"><table class="mtbl cross">
      <thead><tr><th>商品</th><th>3 個月</th><th class="num">最新</th><th class="num">1D</th><th class="num">1W</th><th class="num">1M</th><th class="num">YTD</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="foot-note">來源 Yahoo Finance 連續近月合約（可能延遲 10 分鐘）。期現價差 = 期貨 − 現貨指數，美股收盤後現貨不動、期貨仍在交易，此時價差反映盤後走勢。
      美國期貨台北時間週一早上 6 點到週六清晨 5 點幾乎全天交易，停留此頁時每 60 秒自動更新。美元指數為 ICE 現貨指數。</div>`;
}

/* =========================================================
 * 期限結構
 * ========================================================= */
const SHAPE_ZH = { contango: ['正價差', 'warn'], back: ['逆價差', 'ok'], flat: ['平坦', ''] };

function curveLineSvg(c) {
  const W = 520, H = 200, L = 52, R = 12, T = 14, B = 28;
  const v = c.pts.map(p => p.price);
  let min = Math.min(...v), max = Math.max(...v);
  const pad = (max - min) * 0.15 || max * 0.01 || 1;
  min -= pad; max += pad;
  const x = i => L + (c.pts.length > 1 ? (i * (W - L - R)) / (c.pts.length - 1) : 0);
  const y = val => T + (H - T - B) * (1 - (val - min) / (max - min));
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const val = min + ((max - min) * k) / 4;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(val)}" y2="${y(val)}" class="gl"/><text x="${L - 6}" y="${y(val) + 4}" class="ax" text-anchor="end">${numTxt(val, val >= 1000 ? 0 : 2)}</text>`;
  }
  const every = Math.ceil(c.pts.length / 8);
  c.pts.forEach((p, i) => { if (i % every === 0 || i === c.pts.length - 1) g += `<text x="${x(i)}" y="${H - 8}" class="ax" text-anchor="middle">${esc(p.label)}</text>`; });
  const pts = c.pts.map((p, i) => `${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  g += `<polyline points="${pts}" fill="none" stroke="#1f4e8c" stroke-width="2.4"/>` +
    c.pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.price).toFixed(1)}" r="3.2" fill="#1f4e8c"><title>${esc(p.label)}：${p.price}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="curve">${g}</svg>`;
}

function renderFutCurve(d, body, tools, key) {
  const list = d.curves || [];
  if (!list.length) { body.innerHTML = '<div class="panel-msg">期限結構資料暫時無法取得</div>'; return; }
  if (!list.some(c => c.key === futUi.curve)) futUi.curve = list[0].key;
  const sel = document.createElement('select');
  sel.className = 'cal-cc';
  sel.innerHTML = list.map(c => `<option value="${c.key}" ${c.key === futUi.curve ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  sel.addEventListener('change', () => { futUi.curve = sel.value; saveFutUi(); futRerender(key); });
  tools.appendChild(sel);
  const c = list.find(x => x.key === futUi.curve);
  const f = c.pts[0].price, b = c.pts[c.pts.length - 1].price;
  const sh = SHAPE_ZH[c.shape] || ['—', ''];
  body.innerHTML = `
    <div class="sec-sum"><span><b>${esc(c.name)}</b>（${esc(c.unit)}）</span><span><span class="tag ${sh[1]}">${sh[0]}</span>
      最遠 ÷ 最近 ${signTxt((b / f - 1) * 100, 2, '%')}</span></div>
    <div class="curve-svg">${curveLineSvg(c)}</div>
    <div class="sub-h">各商品一覽</div>
    <div class="tbl-wrap"><table class="mtbl">
      <thead><tr><th>商品</th><th class="num">近月</th><th class="num">次月差</th><th class="num">最遠</th><th class="num">遠／近</th><th>結構</th></tr></thead>
      <tbody>${list.map(x => {
        const p0 = x.pts[0].price, p1 = x.pts[1] ? x.pts[1].price : null, pn = x.pts[x.pts.length - 1].price, s = SHAPE_ZH[x.shape] || ['—', ''];
        return `<tr class="${x.key === c.key ? 'mine' : ''}"><td class="nm">${esc(x.name)} <span class="muted">${esc(x.pts[0].label)}～${esc(x.pts[x.pts.length - 1].label)}</span></td>
          <td class="num">${numTxt(p0, p0 >= 1000 ? 1 : 2)}</td><td class="num ${dirCls(isNum(p1) ? p1 - p0 : null)}">${isNum(p1) ? signTxt(((p1 / p0) - 1) * 100, 2, '%') : '—'}</td>
          <td class="num">${numTxt(pn, pn >= 1000 ? 1 : 2)}</td><td class="num">${signTxt(((pn / p0) - 1) * 100, 2, '%')}</td><td><span class="tag ${s[1]}">${s[0]}</span></td></tr>`;
      }).join('')}</tbody></table></div>
    <div class="foot-note">正價差（Contango）：遠月比近月貴，常見於供給充足或持有成本高，做多期貨轉倉會有損耗；逆價差（Backwardation）：近月較貴，代表現貨吃緊或需求強。
      VIX 為 9 天～1 年期波動率指數：正常為正價差，短天期高於長天期（逆價差）代表市場恐慌、避險需求急升。來源 Yahoo Finance 各月份合約。</div>`;
}

/* =========================================================
 * CFTC 持倉報告
 * ========================================================= */
function cotStats(m) {
  const n = m.d.length, i = n - 1;
  const win = m.net.slice(-52), mn = Math.min(...win), mx = Math.max(...win);
  return {
    net: m.net[i], chg: n > 1 ? m.net[i] - m.net[i - 1] : null, pct: m.oi[i] ? (m.net[i] / m.oi[i]) * 100 : null,
    idx: mx > mn ? ((m.net[i] - mn) / (mx - mn)) * 100 : 50, longPct: m.nl[i] + m.ns[i] ? (m.nl[i] / (m.nl[i] + m.ns[i])) * 100 : null,
    comm: m.comm[i], date: m.d[i],
  };
}

function renderFutCot(d, body, tools, key) {
  const mkts = d.mkts || [];
  if (!mkts.some(m => m.code === futUi.cot)) futUi.cot = mkts[0] && mkts[0].code;
  let grp = '';
  const rows = mkts.map(m => {
    const s = cotStats(m);
    const head = m.grp !== grp ? `<tr class="grp"><th colspan="8">${esc(m.grp)}</th></tr>` : '';
    grp = m.grp;
    const sig = s.idx >= 80 ? ['投機偏多（高檔）', 'bad'] : s.idx <= 20 ? ['投機偏空（低檔）', 'ok'] : ['中性', ''];
    return head + `<tr class="click ${m.code === futUi.cot ? 'mine' : ''}" data-cot="${m.code}">
      <td class="nm">${esc(m.name)}</td><td class="num strong ${dirCls(s.net)}">${signTxt(s.net, 0)}</td><td class="num ${dirCls(s.chg)}">${signTxt(s.chg, 0)}</td>
      <td class="num">${signTxt(s.pct, 1, '%')}</td>
      <td><div class="cotbar" title="近 52 週位置 ${numTxt(s.idx, 0)}"><i style="left:${s.idx.toFixed(0)}%"></i></div></td>
      <td><span class="tag ${sig[1]}">${sig[0]}</span></td><td class="num muted ${dirCls(s.comm)}">${signTxt(s.comm, 0)}</td>
      <td class="sp">${sparkSvg(m.net.slice(-26), 84, 24, true)}</td></tr>`;
  }).join('');
  const sel = mkts.find(m => m.code === futUi.cot);
  body.innerHTML = `
    <div class="tbl-wrap"><table class="mtbl cot">
      <thead><tr><th>市場</th><th class="num">投機淨部位</th><th class="num">週變化</th><th class="num">占未平倉</th><th>52 週位置</th><th>訊號</th><th class="num">商業（避險）淨部位</th><th>近半年</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${sel ? `<div class="chart-legend"><span style="--c:#1f4e8c">${esc(sel.name)}：投機（非商業）淨部位</span><span style="--c:#a3abb8">商業（避險）淨部位</span></div><div class="mini-chart tall" id="futCotChart"></div>` : ''}
    <div class="foot-note">資料日 ${esc(d.date)}（每週二部位，週五美東 15:30 公布），來源美國商品期貨交易委員會 CFTC（Legacy 報告，僅期貨）。點列可切換下方走勢圖。
      投機淨部位 = 非商業交易人（基金等）多單 − 空單；52 週位置 = 目前淨部位在近一年最低～最高之間的百分位（≥80 高檔、≤20 低檔）。
      投機部位極端時常被視為反向訊號（擁擠交易），商業交易人多為避險者，方向通常相反。</div>`;
  $$('[data-cot]', body).forEach(tr => tr.addEventListener('click', () => { futUi.cot = tr.dataset.cot; saveFutUi(); futRerender(key); }));
  if (!sel) return;
  const LWC = window.LightweightCharts;
  const chart = newChart(key, $('#futCotChart', body));
  const up = cssVar('--up'), dn = cssVar('--down');
  const hs = chart.addSeries(LWC.HistogramSeries, { priceLineVisible: false, priceFormat: { type: 'custom', formatter: v => Math.round(v).toLocaleString() } });
  hs.setData(sel.d.map((t, i) => ({ time: t, value: sel.net[i], color: sel.net[i] >= 0 ? up : dn })));
  const ls = chart.addSeries(LWC.LineSeries, { color: '#a3abb8', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
  ls.setData(sel.d.map((t, i) => ({ time: t, value: sel.comm[i] })));
  chart.timeScale().fitContent();
}

function initFut() { futPage.init(); }
initFut();
