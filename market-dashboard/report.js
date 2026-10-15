/* =========================================================
 * PDF 報告（總經與板塊分析、財金日曆、個股研究）
 *  - 按「📄 產出 PDF 報告」：檢查各字卡是否都已成功更新，有未成功的先列出並確認是否繼續
 *  - 依目前資料重新排版成 A4 直式報告（封面、重點摘要、目錄、編號章節、表格與向量圖表、頁首頁碼），
 *    在新分頁開啟並叫出列印視窗，「目的地」選「另存為 PDF」即可存檔
 *  - 只用瀏覽器裡已載入的資料，不會另外抓資料
 * 依賴 app.js（$, esc, state, toast）、macro.js（macro, isNum, numTxt, signTxt, pctTxt, sparkSvg, mdTxt, tpDate, weekBounds, WD_ZH, LIGHT, moveLabel, PERIODS, FNG_ZH）、
 *      cal.js（calPage, CC_ZH, twDeadline, calMyGlobal）
 * ========================================================= */

/* ---------- 共用：格式與小工具 ---------- */
const rc = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
const rTime = ts => {
  if (!ts) return '';
  const t = new Date(ts + 8 * 3600000);
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
};
const rDateLong = ts => {
  const t = new Date(ts + 8 * 3600000);
  return `${t.getUTCFullYear()} 年 ${t.getUTCMonth() + 1} 月 ${t.getUTCDate()} 日（${WD_ZH[t.getUTCDay()]}）`;
};
const rTbl = (head, rows, cls = '') => `<table class="rt ${cls}"><thead><tr>${head.map(h => `<th class="${/^#|^\./.test(h) ? 'num' : ''}">${h.replace(/^[#.]/, '')}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
const rNum = (v, d = 2, unit = '') => `<td class="num">${isNum(v) ? numTxt(v, d) + unit : '—'}</td>`;
const rSign = (v, d = 2, unit = '') => `<td class="num ${rc(v)}">${isNum(v) ? signTxt(v, d, unit) : '—'}</td>`;
const rPct = v => `<td class="num ${rc(v)}">${pctTxt(v)}</td>`;
const rKpis = list => `<div class="kpis">${list.filter(Boolean).map(([l, v, s, c]) => `<div class="kpi"><div class="kl">${l}</div><div class="kv ${c || ''}">${v}</div>${s ? `<div class="ks">${s}</div>` : ''}</div>`).join('')}</div>`;

/** 整齊的座標刻度（1／2／2.5／5 × 10 的次方） */
function niceAxis(mn, mx, n = 4) {
  const raw = (mx - mn) / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
  const st = [1, 2, 2.5, 5, 10].map(m => m * p).find(v => v >= raw) || raw;
  const lo = Math.floor(mn / st) * st, hi = Math.ceil(mx / st) * st;
  const ticks = [];
  for (let v = lo; v <= hi + st / 2; v += st) ticks.push(Math.round(v / st) * st);
  return { mn: lo, mx: hi, ticks };
}

/** 向量折線圖：labels 為日期字串；series = [{ name, color, vals, axis: 'l'|'r', fmt, width, dash }] */
function rChart(o) {
  const W = o.w || 680, H = o.h || 190, L = 52, R = o.series.some(s => s.axis === 'r') ? 56 : 14, T = 22, B = 22;
  const n = o.labels.length;
  if (n < 2) return '';
  const ax = {};
  ['l', 'r'].forEach(a => {
    const v = o.series.filter(s => (s.axis || 'l') === a).flatMap(s => s.vals.filter(isNum));
    if (!v.length) return;
    let mn = Math.min(...v, ...(o.zero && a === 'l' ? [0] : [])), mx = Math.max(...v, ...(o.zero && a === 'l' ? [0] : []));
    if (mx === mn) { mx += 1; mn -= 1; }
    ax[a] = Object.assign(niceAxis(mn, mx), { fmt: (o.series.find(s => (s.axis || 'l') === a) || {}).fmt || (x => numTxt(x, 0)) });
  });
  const x = i => L + (i * (W - L - R)) / (n - 1);
  const y = (v, a) => T + (H - T - B) * (1 - (v - ax[a].mn) / (ax[a].mx - ax[a].mn));
  let g = '';
  const main = ax.l ? 'l' : 'r';
  ax[main].ticks.forEach(v => {
    const yy = y(v, main);
    g += `<line x1="${L}" x2="${W - R}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" class="gl"/>`;
    if (ax.l) g += `<text x="${L - 5}" y="${yy + 3}" class="ax" text-anchor="end">${ax.l.fmt(v)}</text>`;
  });
  if (ax.r) ax.r.ticks.forEach(v => { g += `<text x="${W - R + 5}" y="${y(v, 'r') + 3}" class="ax">${ax.r.fmt(v)}</text>`; });
  if (o.zero && ax.l && ax.l.mn < 0 && ax.l.mx > 0) g += `<line x1="${L}" x2="${W - R}" y1="${y(0, 'l')}" y2="${y(0, 'l')}" class="zl"/>`;
  // 橫軸：跨度超過約 8 個月時顯示「年/月」，否則「月/日」
  const long = /^\d{4}-\d{2}/.test(o.labels[0]) && Date.parse(o.labels[n - 1]) - Date.parse(o.labels[0]) > 240 * 86400000;
  const xl = s => (long ? s.slice(2, 4) + '/' + s.slice(5, 7) : mdTxt(s) || s);
  const step = Math.max(1, Math.round(n / 6));
  for (let i = 0; i < n; i += step) g += `<text x="${x(i)}" y="${H - 6}" class="ax" text-anchor="middle">${esc(xl(o.labels[i]))}</text>`;
  o.series.forEach(s => {
    const a = s.axis || 'l';
    if (!ax[a]) return;
    let seg = [], segs = [];
    s.vals.forEach((v, i) => { if (isNum(v)) seg.push(`${x(i).toFixed(1)},${y(v, a).toFixed(1)}`); else if (seg.length) { segs.push(seg); seg = []; } });
    if (seg.length) segs.push(seg);
    segs.forEach(p => { g += `<polyline points="${p.join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.6}" ${s.dash ? 'stroke-dasharray="4 3"' : ''}/>`; });
  });
  const legend = o.series.map((s, i) => `<tspan x="${L + i * 150}" dy="0"><tspan fill="${s.color}">■</tspan> ${esc(s.name)}${s.axis === 'r' ? '（右軸）' : ''}</tspan>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="rchart"><text x="${L}" y="11" class="lg">${legend}</text>${g}</svg>`;
}

/** 熱力格背景（依漲跌色與幅度） */
function rHeat(v, scale) {
  if (!isNum(v)) return '';
  const t = Math.min(Math.abs(v) / scale, 1);
  return `style="background:color-mix(in srgb, var(${v >= 0 ? '--up' : '--down'}) ${Math.round(6 + t * 60)}%, #fff);${t > 0.6 ? 'color:#fff' : ''}"`;
}

/* ---------- 檢查：哪些區塊還沒成功 ---------- */
function reportIssues(page, parts) {
  const out = [];
  parts.forEach(p => {
    const part = page.apiPart(p.key), d = page.data[part];
    if (page.inflight.has(p.key)) out.push(`・${p.title}：仍在載入中${d ? `，將使用 ${rTime(d.updated)} 的資料` : '，報告中會略過'}`);
    else if (!d) out.push(`・${p.title}：沒有資料，報告中會略過`);
    else if (page.retry.has(p.key) || d.stale) out.push(`・${p.title}：最近一次更新失敗，將使用 ${rTime(d.updated)} 的資料`);
    else if (d.cached) out.push(`・${p.title}：尚未更新，將使用上次（${rTime(d.updated)}）的資料`);
  });
  return out;
}

/** 依畫面上的字卡順序，列出顯示中的字卡 */
function reportParts(page) {
  const order = $$('.panel', page.$('Grid')).map(x => x.dataset.part);
  return page.visibleParts().slice().sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

/* =========================================================
 * 總經與板塊分析：各章節
 * ========================================================= */
function crossFind(d, sym) { for (const g of d.groups || []) for (const it of g.items) if (it.sym === sym) return it; return null; }

const MACRO_REPORT = {
  cross(d) {
    const vix = crossFind(d, '^VIX'), v3 = crossFind(d, '^VIX3M'), tnx = crossFind(d, '^TNX'), dxy = crossFind(d, 'DX-Y.NYB');
    const k = [];
    if (vix) k.push(['VIX 恐慌指數', numTxt(vix.price), vix.price < 15 ? '低波動' : vix.price < 20 ? '正常' : vix.price < 30 ? '偏高' : '恐慌']);
    if (vix && v3 && v3.price) { const r = vix.price / v3.price; k.push(['VIX ÷ VIX3M', r.toFixed(2), r > 1 ? '逆價差・避險升溫' : '正價差・情緒平穩']); }
    if (tnx) k.push(['美 10 年期殖利率', numTxt(tnx.price) + '%', `1M ${signTxt(isNum(tnx.a && tnx.a.m1) ? tnx.a.m1 * 100 : null, 0, 'bp')}`]);
    if (dxy) k.push(['美元指數', numTxt(dxy.price), `1M ${pctTxt(dxy.m1)}`]);
    if (d.fng) k.push(['加密恐懼貪婪', d.fng.value, FNG_ZH[d.fng.cls] || d.fng.cls]);
    const rows = [];
    (d.groups || []).forEach(g => {
      rows.push(`<tr class="grp"><td colspan="7">${esc(g.name)}${g.rate ? '（變動以 bp 表示）' : ''}</td></tr>`);
      g.items.filter(it => isNum(it.price)).forEach(it => {
        const cell = key => (g.rate ? rSign(isNum(it.a && it.a[key]) ? it.a[key] * 100 : null, 0) : rPct(it[key]));
        rows.push(`<tr><td>${esc(it.name)}</td><td class="sp">${sparkSvg(it.spark, 70, 16)}</td><td class="num b">${g.rate ? numTxt(it.price, 3) + '%' : numTxt(it.price, it.price >= 10 ? 2 : 4)}</td>${['d1', 'w1', 'm1', 'ytd'].map(cell).join('')}</tr>`);
      });
    });
    return { src: 'Yahoo Finance、alternative.me', html: rKpis(k) + rTbl(['標的', '3 個月走勢', '#最新', '#1D', '#1W', '#1M', '#YTD'], rows) };
  },
  news(d) {
    const tabs = (d.tabs || []).filter(t => (t.items || []).length);
    return {
      src: '鉅亨網、CNBC',
      html: tabs.map(t => `<h4>${esc(t.name)}</h4><ol class="news">${t.items.slice(0, 6).map(n => `<li><a href="${esc(n.u)}">${esc(n.t)}</a><span class="muted">　${esc(n.s)}・${rTime(n.ts)}</span></li>`).join('')}</ol>`).join(''),
    };
  },
  sectors(d) {
    const tbl = (list, bench, isUS) => {
      const rows = list.filter(x => isNum(x.d1) || isNum(x.m1)).slice().sort((a, b) => (b.m1 ?? -999) - (a.m1 ?? -999)).map(x =>
        `<tr><td>${esc(x.name)}${isUS ? ` <span class="muted">${esc(x.sym)}</span>` : ''}</td>${PERIODS.map(p => `<td class="num heat" ${rHeat(x[p[0]], p[2])}>${pctTxt(x[p[0]])}</td>`).join('')}</tr>`);
      if (bench) rows.unshift(`<tr class="bench"><td>${esc(bench.name || '大盤')}</td>${PERIODS.map(p => `<td class="num ${rc(bench[p[0]])}">${pctTxt(bench[p[0]])}</td>`).join('')}</tr>`);
      return rTbl(['板塊（依 1M 排序）', ...PERIODS.map(p => '#' + p[1])], rows, 'sm');
    };
    const best = (list, k) => list.filter(x => isNum(x[k])).sort((a, b) => b[k] - a[k]);
    const us = d.us || [], tw = d.tw || [];
    const lines = [];
    if (us.length) { const s = best(us, 'm1'); lines.push(`美股近 1 個月最強：${s.slice(0, 3).map(x => `${esc(x.name)} ${pctTxt(x.m1)}`).join('、')}；最弱：${s.slice(-3).reverse().map(x => `${esc(x.name)} ${pctTxt(x.m1)}`).join('、')}。`); }
    if (tw.length) { const s = best(tw, 'm1'); lines.push(`台股近 1 個月最強：${s.slice(0, 3).map(x => `${esc(x.name)} ${pctTxt(x.m1)}`).join('、')}；最弱：${s.slice(-3).reverse().map(x => `${esc(x.name)} ${pctTxt(x.m1)}`).join('、')}。`); }
    return {
      src: '美股 SPDR 產業與主題 ETF（Yahoo）、台股證交所類股指數',
      html: `<p>${lines.join('<br>')}</p>
        <h4>美股產業與主題</h4>${us.length ? tbl(us, d.usBench, true) : `<p class="muted">資料暫時無法取得${d.usErr ? '：' + esc(d.usErr) : ''}</p>`}
        <h4>台股類股${d.twDate ? `（資料日 ${d.twDate.slice(4, 6)}/${d.twDate.slice(6)}）` : ''}</h4>${tw.length ? tbl(tw, d.twBench, false) : `<p class="muted">資料暫時無法取得${d.twErr ? '：' + esc(d.twErr) : ''}</p>`}
        <p class="note">底色深淺代表漲跌幅大小；美股以 SPDR 產業 ETF 代表 11 大產業，另列 6 個主題 ETF，大盤為 SPY；台股為證交所類股指數。</p>`,
    };
  },
  curve(d) {
    const C = ['#1f4e8c', '#5aa0e6', '#e67e22', '#a3abb8'];
    const now = d.curves[0], m1 = d.curves[2], S = d.spreads, n = S.d.length;
    const at = date => { const i = S.d.indexOf(date); return i < 0 ? n - 1 : i; };
    const i1m = at(d.curves[2].date), i1y = at(d.curves[3].date);
    const curveChart = (() => {
      const W = 680, H = 190, L = 44, R = 14, T = 22, B = 22, vals = d.curves.flatMap(c => c.y.filter(isNum));
      const mn = Math.floor((Math.min(...vals) - 0.1) * 4) / 4, mx = Math.ceil((Math.max(...vals) + 0.1) * 4) / 4;
      const x = i => L + (i * (W - L - R)) / (d.tenors.length - 1), y = v => T + (H - T - B) * (1 - (v - mn) / (mx - mn));
      let g = '';
      for (let k = 0; k <= 4; k++) { const v = mn + ((mx - mn) * k) / 4; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${L - 5}" y="${y(v) + 3}" class="ax" text-anchor="end">${v.toFixed(2)}</text>`; }
      d.tenors.forEach((t, i) => { g += `<text x="${x(i)}" y="${H - 6}" class="ax" text-anchor="middle">${t}</text>`; });
      d.curves.slice().reverse().forEach((c, j) => {
        const i = d.curves.length - 1 - j;
        g += `<polyline fill="none" stroke="${C[i]}" stroke-width="${i ? 1.3 : 2.2}" ${i === 3 ? 'stroke-dasharray="4 3"' : ''} points="${c.y.map((v, k) => (isNum(v) ? `${x(k).toFixed(1)},${y(v).toFixed(1)}` : '')).filter(Boolean).join(' ')}"/>`;
      });
      const lg = d.curves.map((c, i) => `<tspan x="${L + i * 150}"><tspan fill="${C[i]}">■</tspan> ${esc(c.label)} ${mdTxt(c.date)}</tspan>`).join('');
      return `<svg viewBox="0 0 ${W} ${H}" class="rchart"><text x="${L}" y="11" class="lg">${lg}</text>${g}</svg>`;
    })();
    const sp = (label, arr) => {
      const v = arr[n - 1];
      return `<tr><td>${label}</td><td class="num b ${v < 0 ? 'down' : ''}">${signTxt(v, 0, 'bp')}</td>${rSign(arr[i1m], 0, 'bp')}${rSign(arr[i1y], 0, 'bp')}<td>${v == null ? '' : v < 0 ? '倒掛' : v < 50 ? '平坦' : '正斜率'}</td></tr>`;
    };
    return {
      src: d.src || '美國財政部每日殖利率',
      html: '<div class="keep">' + curveChart +
        rTbl(['期限', ...d.tenors.map(t => '#' + t)], [
          `<tr><td>最新 %</td>${now.y.map(v => `<td class="num b">${numTxt(v)}</td>`).join('')}</tr>`,
          `<tr><td>較 1 個月前（bp）</td>${now.y.map((v, i) => { const c = isNum(v) && isNum(m1.y[i]) ? Math.round((v - m1.y[i]) * 100) : null; return `<td class="num ${rc(c)}">${signTxt(c, 0)}</td>`; }).join('')}</tr>`,
        ], 'sm') + '</div>' +
        `<div class="keep"><h4>利差監控</h4>` + rTbl(['利差', '#最新', '#1 個月前', '#1 年前', '狀態'], [sp('10Y − 2Y', S.s102), sp('10Y − 3M', S.s103m), sp('30Y − 5Y', S.s305)]) +
        rChart({ labels: S.d, zero: true, series: [{ name: '10Y−2Y', color: '#1f4e8c', vals: S.s102, width: 2, fmt: v => Math.round(v) + 'bp' }, { name: '10Y−3M', color: '#e67e22', vals: S.s103m }, { name: '30Y−5Y', color: '#16a085', vals: S.s305 }] }) + '</div>',
    };
  },
  fomc(d) {
    const ms = d.meetings || [], nx = ms[0];
    const fr = (a, b) => `${a.toFixed(2)}–${b.toFixed(2)}%`;
    const mt = m => `${+m.start.slice(5, 7)}/${+m.start.slice(8)}–${+m.end.slice(8)}`;
    const k = [['目前目標區間', fr(d.from, d.to)], ['有效聯邦基金利率', numTxt(d.effr) + '%', mdTxt(d.effrDate)]];
    if (nx) k.push(['下次會議', mt(nx), `還有 ${Math.max(0, Math.ceil((Date.parse(nx.end + 'T18:00:00Z') - Date.now()) / 86400000))} 天`]);
    const prob = nx && nx.dist.length ? rTbl(['下次會議結果', '目標區間', '#機率'], nx.dist.slice().sort((a, b) => b.p - a.p).map(o => `<tr><td>${moveLabel(o.moves)}</td><td>${fr(o.from, o.to)}</td><td class="num b">${o.p.toFixed(1)}%</td></tr>`)) : '';
    const rows = ms.map(m => { const b = m.dist.slice().sort((x, y) => y.p - x.p)[0]; return `<tr><td>${mt(m)}${m.sep ? '（SEP）' : ''}</td><td class="num">${isNum(m.implied) ? m.implied.toFixed(3) + '%' : '—'}</td>${rSign(m.cum, 1, 'bp')}<td>${b ? `${fr(b.from, b.to)}（${b.p.toFixed(0)}%）` : '—'}</td></tr>`; });
    return { src: 'CBOT 30 天期聯邦基金期貨（CME FedWatch 算法）、聯準會、紐約聯準銀行', html: rKpis(k) + `<div class="two"><div>${prob}</div><div>${rTbl(['會議', '#隱含利率', '#累計變動', '最可能區間'], rows)}</div></div>` };
  },
  margin(d, mkt) {
    const n = d.d.length, i = n - 1;
    const ratio = j => (d.units[j] ? (d.short[j] / d.units[j]) * 100 : null);
    const k = [
      ['融資餘額', numTxt(d.money[i], 1) + ' 億', n > 1 ? `日 ${signTxt(d.money[i] - d.money[i - 1], 1, ' 億')}` : '', ''],
      ['融資張數', numTxt(d.units[i], 0), n > 1 ? `日 ${signTxt(d.units[i] - d.units[i - 1], 0)}` : ''],
      ['融券張數', numTxt(d.short[i], 0), n > 1 ? `日 ${signTxt(d.short[i] - d.short[i - 1], 0)}` : ''],
      ['券資比', numTxt(ratio(i)) + '%', n > 20 ? `20 日融資 ${signTxt(d.money[i] - d.money[i - 20], 0, ' 億')}` : ''],
    ];
    const rows = [];
    for (let j = i; j >= Math.max(1, n - 10); j--) {
      rows.push(`<tr><td>${mdTxt(d.d[j])}</td>${rNum(d.money[j], 1)}${rSign(d.money[j] - d.money[j - 1], 1)}${rNum(d.units[j], 0)}${rSign(d.units[j] - d.units[j - 1], 0)}${rNum(d.short[j], 0)}${rSign(d.short[j] - d.short[j - 1], 0)}${rNum(ratio(j), 2, '%')}${rNum(d.taiex[j], 0)}</tr>`);
    }
    return {
      title: '台股信用交易（' + (mkt === 'otc' ? '上櫃' : '上市') + '）', src: d.src,
      html: rKpis(k) + (n > 2 ? rChart({ labels: d.d, series: [{ name: '融資餘額（億）', color: '#e8a317', vals: d.money, width: 2, fmt: v => numTxt(v, 0) }, { name: d.idxName || '加權指數', color: '#1f4e8c', vals: d.taiex, axis: 'r' }] }) : '') +
        rTbl(['日期', '#融資餘額(億)', '#增減', '#融資張數', '#增減', '#融券張數', '#增減', '#券資比', '#' + (d.idxName || '指數')], rows, 'sm'),
    };
  },
  inst(d, mkt) {
    const R = d.rows || [], L = R[R.length - 1];
    if (!L) return { html: '<p class="muted">無資料</p>' };
    const sum = (arr, f) => arr.reduce((s, r) => s + (r[f] || 0), 0);
    const F = ['f', 'it', 'dl', 'total'];
    const sRow = (label, arr) => `<tr class="sum"><td>${label}</td>${F.map(f => rSign(sum(arr, f), 1)).join('')}</tr>`;
    const rows = R.slice(-10).reverse().map(r => `<tr><td>${mdTxt(r.d)}（${WD_ZH[new Date(r.d + 'T00:00:00Z').getUTCDay()]}）</td>${F.map(f => rSign(r[f], 1)).join('')}</tr>`);
    return {
      title: '三大法人買賣超（' + (mkt === 'otc' ? '上櫃' : '上市') + '）', src: d.src,
      html: rKpis([['外資', signTxt(L.f, 1) + ' 億', mdTxt(L.d), rc(L.f)], ['投信', signTxt(L.it, 1) + ' 億', '', rc(L.it)], ['自營商', signTxt(L.dl, 1) + ' 億', '', rc(L.dl)], ['合計', signTxt(L.total, 1) + ' 億', '', rc(L.total)]]) +
        `<div class="two"><div><h4>累計（億元）</h4>${rTbl(['期間', '#外資', '#投信', '#自營商', '#合計'], [sRow('近 5 日', R.slice(-5)), R.length >= 20 ? sRow('近 20 日', R.slice(-20)) : ''], 'sm')}</div>
        <div><h4>近 10 個交易日（億元）</h4>${rTbl(['日期', '#外資', '#投信', '#自營商', '#合計'], rows, 'sm')}</div></div>`,
    };
  },
  flow(d, mkt) {
    const rows = (d.rows || []).map(r => ({ c: r[0], nm: r[1], f: r[2], it: r[3], p: r[4], etf: r[5] })).filter(x => !x.etf);
    const top = (k, dir) => rows.filter(x => dir * x[k] > 0).sort((a, b) => dir * (b[k] - a[k])).slice(0, 10);
    const t = (title, list, k) => `<div><h4>${title}</h4>${rTbl(['#', '股票', '#張數', '#估計(億)'], list.map((x, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(x.nm)} <span class="muted">${esc(x.c)}</span></td>${rSign(x[k], 0)}${rSign(isNum(x.p) ? (x[k] * x.p * 1000) / 1e8 : null, 2)}</tr>`), 'sm')}</div>`;
    const both = dir => rows.filter(x => dir * x.f > 0 && dir * x.it > 0).sort((a, b) => dir * (b.f + b.it - a.f - a.it)).slice(0, 6).map(x => esc(x.nm)).join('、') || '—';
    return {
      title: '資金流向排行（' + (mkt === 'otc' ? '上櫃' : '上市') + '，排除 ETF）', src: (mkt === 'otc' ? '櫃買中心' : '臺灣證券交易所') + '，資料日 ' + d.date,
      html: `<p>土洋同買：${both(1)}<br>土洋同賣：${both(-1)}</p><div class="two">${t('外資買超', top('f', 1), 'f')}${t('外資賣超', top('f', -1), 'f')}${t('投信買超', top('it', 1), 'it')}${t('投信賣超', top('it', -1), 'it')}</div>`,
    };
  },
  twmacro(d) {
    let h = '';
    if (d.ndc) {
      const L = d.ndc.latest, P = d.ndc.prev;
      h += rKpis([[`${L.m.replace('-', '/')} 景氣燈號`, `<span class="light" style="background:${(LIGHT[L.light] || ['#999'])[0]}"></span>${esc(L.light)}燈`, (LIGHT[L.light] || ['', ''])[1]],
        ['綜合判斷分數', L.score + ' 分', P ? `較上月 ${signTxt(L.score - P.score, 0)} 分` : ''], ['領先指標', numTxt(L.lead), P ? `較上月 ${signTxt(L.lead - P.lead, 2)}` : ''], ['同時指標', numTxt(L.coin), P ? `較上月 ${signTxt(L.coin - P.coin, 2)}` : '']]);
      h += `<div class="lights">${(d.ndc.hist || []).slice(-24).map(x => `<span style="background:${(LIGHT[x.light] || ['#ccc'])[0]}">${x.score}<i>${x.m.slice(2).replace('-', '/')}</i></span>`).join('')}</div>`;
    } else h += `<p class="note">景氣對策信號：${esc(d.ndcErr || '暫時無法取得')}</p>`;
    if (d.cbc) {
      const c = d.cbc.latest, ch = d.cbc.changes || [], nx = (d.cbcNext || [])[0];
      h += `<div class="two"><div>${rKpis([['重貼現率', c.r.toFixed(3) + '%', '自 ' + c.d.replace(/-/g, '/') + ' 起'], ['擔保放款融通', c.sec.toFixed(3) + '%'], ['短期融通', c.st.toFixed(3) + '%'], ['下次理監事會', nx ? +nx.slice(5, 7) + '/' + +nx.slice(8) : '—', '依慣例推估']])}</div>
        <div>${rTbl(['調整日期', '#重貼現率', '#變動'], ch.slice(0, 5).map((x, i) => `<tr><td>${x.d.replace(/-/g, '/')}</td><td class="num">${x.r.toFixed(3)}%</td>${rSign(ch[i + 1] ? Math.round((x.r - ch[i + 1].r) * 1000) / 10 : null, 1, 'bp')}</tr>`), 'sm')}</div></div>`;
    } else h += `<p class="note">央行政策利率：${esc(d.cbcErr || '暫時無法取得')}</p>`;
    return { src: '國發會（政府資料開放平臺）、中央銀行', html: h };
  },
  econ(d) {
    const per = r => (!r.date ? '' : r.freq === 'Q' ? `${r.date.slice(0, 4)} Q${Math.floor((+r.date.slice(5, 7) - 1) / 3) + 1}` : r.freq === 'W' ? `${r.date.slice(0, 4)}/${mdTxt(r.date)} 當週` : `${r.date.slice(0, 4)}/${r.date.slice(5, 7)}`);
    const rows = d.rows.map(r => {
      if (r.err) return `<tr><td>${esc(r.name)}</td><td colspan="5" class="muted">暫時無法取得</td></tr>`;
      const dec = r.unit === '千人' ? 0 : r.unit === '' ? 1 : 2, pc = r.unit === '%' ? '%' : '';
      const chg = isNum(r.prev) ? r.latest - r.prev : null;
      return `<tr><td>${esc(r.name)}</td><td class="num b">${numTxt(r.latest, dec)}${pc}${r.unit && r.unit !== '%' ? ' ' + r.unit : ''}</td><td class="num">${numTxt(r.prev, dec)}${pc}</td><td class="num">${chg > 0 ? '▲ ' : chg < 0 ? '▼ ' : ''}${isNum(chg) ? numTxt(Math.abs(chg), dec) : '—'}</td><td>${per(r)}</td><td class="sp">${sparkSvg(r.series, 90, 16, false)}</td></tr>`;
    });
    return { src: 'FRED（聖路易聯準銀行）' + (d.api ? '官方 API' : ''), html: rTbl(['指標', '#最新', '#前值', '#變化', '資料期間', '近 13 期'], rows) };
  },
};

/** 總經重點摘要 */
function macroHighlights(D) {
  const out = [];
  const c = D.cross;
  if (c) {
    const sp = crossFind(c, '^GSPC'), tw = crossFind(c, '^TWII'), vix = crossFind(c, '^VIX'), tnx = crossFind(c, '^TNX');
    const p = [];
    if (sp) p.push(`S&P 500 ${numTxt(sp.price)}（1D ${pctTxt(sp.d1)}、1M ${pctTxt(sp.m1)}）`);
    if (tw) p.push(`加權指數 ${numTxt(tw.price)}（1D ${pctTxt(tw.d1)}、1M ${pctTxt(tw.m1)}）`);
    if (p.length) out.push('股市：' + p.join('；') + '。');
    const q = [];
    if (vix) q.push(`VIX ${numTxt(vix.price)}（${vix.price < 15 ? '低波動' : vix.price < 20 ? '正常' : vix.price < 30 ? '偏高' : '恐慌'}）`);
    if (tnx) q.push(`美 10 年期殖利率 ${numTxt(tnx.price)}%`);
    if (q.length) out.push('風險與利率：' + q.join('，') + '。');
  }
  if (D.curve) {
    const S = D.curve.spreads, v = S.s102[S.s102.length - 1], v3 = S.s103m[S.s103m.length - 1];
    out.push(`殖利率曲線：10Y−2Y ${signTxt(v, 0, 'bp')}（${v < 0 ? '倒掛' : v < 50 ? '平坦' : '正斜率'}），10Y−3M ${signTxt(v3, 0, 'bp')}。`);
  }
  if (D.fomc && D.fomc.meetings && D.fomc.meetings[0]) {
    const m = D.fomc.meetings[0], b = m.dist.slice().sort((x, y) => y.p - x.p)[0];
    if (b) out.push(`FOMC：下次會議（${+m.end.slice(5, 7)}/${+m.end.slice(8)}）市場預期「${moveLabel(b.moves)}」機率 ${b.p.toFixed(0)}%。`);
  }
  if (D.inst && D.inst.rows && D.inst.rows.length) {
    const R = D.inst.rows, L = R[R.length - 1], f5 = R.slice(-5).reduce((s, r) => s + (r.f || 0), 0);
    out.push(`上市法人：${mdTxt(L.d)} 外資 ${signTxt(L.f, 1)} 億、投信 ${signTxt(L.it, 1)} 億；外資近 5 日合計 ${signTxt(f5, 1)} 億。`);
  }
  if (D.margin && D.margin.d.length > 1) {
    const M = D.margin, n = M.d.length - 1;
    out.push(`上市融資餘額 ${numTxt(M.money[n], 1)} 億（日 ${signTxt(M.money[n] - M.money[n - 1], 1)} 億${n >= 20 ? `、20 日 ${signTxt(M.money[n] - M.money[n - 20], 0)} 億` : ''}）。`);
  }
  if (D.sectors && D.sectors.us && D.sectors.us.length) {
    const s = D.sectors.us.filter(x => isNum(x.m1)).sort((a, b) => b.m1 - a.m1);
    if (s.length) out.push(`美股板塊近 1 個月最強 ${esc(s[0].name)}（${pctTxt(s[0].m1)}），最弱 ${esc(s[s.length - 1].name)}（${pctTxt(s[s.length - 1].m1)}）。`);
  }
  if (D.twmacro && D.twmacro.ndc) { const L = D.twmacro.ndc.latest; out.push(`台灣景氣：${L.m.replace('-', '/')} ${esc(L.light)}燈、${L.score} 分。`); }
  if (D.econ && D.econ.rows) {
    const g = id => D.econ.rows.find(r => r.id === id && !r.err);
    const cpi = g('CPIAUCSL'), ur = g('UNRATE');
    const p = [];
    if (cpi) p.push(`CPI 年增 ${numTxt(cpi.latest)}%（前值 ${numTxt(cpi.prev)}%）`);
    if (ur) p.push(`失業率 ${numTxt(ur.latest)}%`);
    if (p.length) out.push('美國經濟：' + p.join('、') + '。');
  }
  return out;
}

/* =========================================================
 * 財金日曆：各章節
 * ========================================================= */
const CAL_REPORT = {
  econcal(d) {
    const now = Date.now();
    const blk = (from, to, label) => {
      const list = d.events.filter(e => e.ts >= from && e.ts < to);
      let last = '';
      const rows = list.map(e => {
        const day = tpDate(e.ts);
        const head = day !== last ? `<tr class="grp"><td colspan="6">${day}</td></tr>` : '';
        last = day;
        const a = parseFloat(String(e.act || '').replace(/[^\d.\-]/g, '')), f = parseFloat(String(e.fc || '').replace(/[^\d.\-]/g, ''));
        const diff = e.act && e.fc && isFinite(a) && isFinite(f) ? a - f : null;
        return head + `<tr><td class="num">${tpDate(e.ts, true).split(' ')[1]}</td><td>${CC_ZH[e.cc] || e.cc}</td><td>${esc(e.t)}</td>
          <td class="num b">${e.ts < now && e.act ? esc(e.act) + (diff > 0 ? ' ▲' : diff < 0 ? ' ▼' : '') : '—'}</td><td class="num">${esc(e.fc || '—')}</td><td class="num">${esc(e.prev || '—')}</td></tr>`;
      });
      return `<h4>${label}（${list.length} 項）</h4>` + (rows.length ? rTbl(['#時間', '國家', '事件', '#實際', '#預期', '#前值'], rows, 'sm ev') : '<p class="muted">本期間沒有重要事件</p>');
    };
    return { src: 'Forex Factory、Nasdaq、聯準會（台北時間）', html: blk(d.lastStart, d.weekStart, '上週') + blk(d.weekStart, d.nextStart, '本週') + blk(d.nextStart, d.end, '下週') + '<p class="note">實際值高於預期標 ▲、低於預期標 ▼（不代表利多或利空）。</p>' };
  },
  earnings(d) {
    const now = Date.now();
    const all = d.rows || [];
    // 只列出已有下次財報／法說日期的標的
    const up = all.filter(r => r.start && r.start > now - 86400000).sort((a, b) => a.start - b.start);
    const rows = up.map(r => `<tr><td>${esc(r.name)} <span class="muted">${esc(r.symbol)}</span></td><td>${tpDate(r.start)}${r.end && r.end - r.start > 86400000 ? ' ～ ' + tpDate(r.end) : ''}${r.est ? '（預估）' : ''}</td>
      <td>${Math.ceil((r.start - now) / 86400000)} 天後</td></tr>`);
    const noDate = all.length - up.length;
    return {
      src: 'Yahoo Finance（美股備援 Nasdaq）',
      html: (d.note ? `<p class="note">${esc(d.note)}</p>` : '') +
        (rows.length ? rTbl(['標的', '下次財報／法說', '倒數'], rows) : `<p class="muted">${all.length ? '自選清單中的股票目前都還沒有公布下次財報／法說日期' : '自選清單中沒有台股或國外股票'}</p>`) +
        (noDate ? `<p class="note">另有 ${noDate} 檔自選股尚未公布下次日期，未列出。</p>` : ''),
    };
  },
  usearn(d) {
    const mine = calMyGlobal();
    const half = Math.ceil(d.days.length / 2);
    const money = v => (isNum(v) ? (v < 0 ? '-$' : '$') + numTxt(Math.abs(v), 2) : '—');
    const blk = (days, label) => {
      let last = '';
      const rows = d.rows.filter(r => days.includes(r.d)).map(r => {
        const dt = new Date(r.d + 'T12:00:00Z');
        const head = r.d !== last ? `<tr class="grp"><td colspan="7">${dt.getUTCMonth() + 1}/${dt.getUTCDate()}（${WD_ZH[dt.getUTCDay()]}）美東</td></tr>` : '';
        last = r.d;
        return head + `<tr><td>${esc(r.sym)}${mine.has(r.sym) ? ' ★' : ''} <span class="muted">${esc(r.name.replace(/,? (Inc\.?|Corporation|Corp\.?|Holdings?|N\.V\.|plc|Ltd\.?|Company|\(The\))$/i, '').slice(0, 30))}</span></td><td>${r.time === 'pre' ? '盤前' : r.time === 'after' ? '盤後' : ''}</td>
          <td class="num">${numTxt(r.cap / 1e9, 0)}</td><td class="num">${money(r.fc)}</td><td class="num b">${isNum(r.eps) ? money(r.eps) : '—'}</td>${isNum(r.eps) ? rSign(r.surprise, 1, '%') : '<td class="num">—</td>'}<td class="num muted">${money(r.lastYear)}</td></tr>`;
      });
      return `<h4>${label}</h4>` + (rows.length ? rTbl(['公司', '時間', '#市值($B)', '#EPS 預估', '#實際', '#驚喜', '#去年同期'], rows, 'sm') : '<p class="muted">此期間沒有市值 100 億美元以上的公司公布財報</p>');
    };
    return { src: 'Nasdaq（市值 100 億美元以上；★ 為自選或持股）', html: blk(d.days.slice(0, half), '本週') + blk(d.days.slice(half), '下週') };
  },
  exdiv(d) {
    // 報告只列已公布金額或自選／持股的標的；只有日期、金額待公告的其餘標的彙總成一行
    const up = d.rows.filter(r => r.d >= d.today);
    const show = up.filter(r => r.cash > 0 || r.stock > 0 || r.qty || r.watch);
    const pending = up.length - show.length;
    const rows = show.map(r => `<tr><td>${+r.d.slice(5, 7)}/${+r.d.slice(8)}（${WD_ZH[new Date(r.d + 'T00:00:00Z').getUTCDay()]}）</td>
      <td>${esc(r.name)} <span class="muted">${esc(r.code)}${r.mkt === 'otc' ? '・櫃' : ''}</span>${r.qty ? ' 〔持股〕' : r.watch ? ' ★' : ''}</td><td>${esc(r.type)}</td>
      ${rNum(r.cash > 0 ? r.cash : null, r.cash < 1 ? 4 : 2)}${rNum(r.stock > 0 ? r.stock * 10 : null, 2)}${rNum(r.est || null, 0)}</tr>`);
    const est = d.rows.filter(r => r.qty && r.d >= d.today).reduce((s, r) => s + (r.est || 0), 0);
    return {
      src: '證交所除權除息預告表、櫃買中心',
      html: (est ? `<p>持股預估可領現金股利約 <b>${numTxt(est, 0)}</b> 元（稅前）。</p>` : '') +
        (rows.length ? rTbl(['除權息日', '標的', '類型', '#現金股利', '#配股(元)', '#持股可領'], rows, 'sm') : '<p class="muted">近期沒有已公布金額的除權息</p>') +
        (pending ? `<p class="note">另有 ${pending} 檔（多為 ETF）已公布除息日、金額待公告，未列出；〔持股〕為投資組合持有，★ 為自選清單。</p>` : ''),
    };
  },
  dates(d) {
    const days = s => Math.round((Date.parse(s) - Date.parse(d.today)) / 86400000);
    const K = { holiday: '休市', info: '交易日', settle: '結算', report: '申報', index: '指數', cb: '央行' };
    const rows = d.items.map(x => `<tr><td>${+x.d.slice(5, 7)}/${+x.d.slice(8)}（${WD_ZH[new Date(x.d + 'T00:00:00Z').getUTCDay()]}）</td><td>${x.mkt === 'TW' ? '台股' : '美股'}</td><td>${K[x.kind] || x.kind}</td><td>${esc(x.t)}${x.note ? ` <span class="muted">${esc(x.note)}</span>` : ''}</td><td class="num">${days(x.d) ? days(x.d) + ' 天' : '今天'}</td></tr>`);
    return { src: '證交所休市表；其餘依規則推算', html: rTbl(['日期', '市場', '類別', '事項', '#倒數'], rows, 'sm') };
  },
};

function calHighlights(D) {
  const out = [];
  const [w0, w1] = weekBounds();
  const now = Date.now();
  if (D.econ) {
    const wk = D.econ.events.filter(e => e.ts >= w0 && e.ts < w1);
    const us = wk.filter(e => e.cc === 'USD').map(e => esc(e.t));
    out.push(`本週重要經濟事件 ${wk.length} 項${us.length ? `，美國：${us.slice(0, 6).join('、')}${us.length > 6 ? ' 等' : ''}` : ''}。`);
  }
  if (D.earnings) {
    const wk = (D.earnings.rows || []).filter(r => r.start && r.start >= w0 && r.start < w1);
    if (wk.length) out.push(`自選清單本週財報／法說：${wk.map(r => `${esc(r.name)}（${tpDate(r.start)}）`).join('、')}。`);
  }
  if (D.usearn) {
    const half = Math.ceil(D.usearn.days.length / 2), days = D.usearn.days.slice(0, half);
    const big = D.usearn.rows.filter(r => days.includes(r.d)).sort((a, b) => b.cap - a.cap).slice(0, 8);
    if (big.length) out.push(`本週美股重要財報（依市值）：${big.map(r => esc(r.sym)).join('、')}。`);
  }
  if (D.exdiv) {
    const mine = D.exdiv.rows.filter(r => (r.watch || r.qty) && r.d >= D.exdiv.today);
    if (mine.length) out.push(`自選／持股即將除權息：${mine.slice(0, 6).map(r => `${esc(r.name)} ${+r.d.slice(5, 7)}/${+r.d.slice(8)}`).join('、')}${mine.length > 6 ? ` 等 ${mine.length} 檔` : ''}。`);
  }
  if (D.dates) {
    const h = D.dates.items.filter(x => x.kind === 'holiday').slice(0, 2);
    const s = D.dates.items.find(x => x.kind === 'settle');
    const p = [];
    h.forEach(x => p.push(`${x.mkt === 'TW' ? '台股' : '美股'}休市 ${+x.d.slice(5, 7)}/${+x.d.slice(8)}`));
    if (s) p.push(`${esc(s.t)} ${+s.d.slice(5, 7)}/${+s.d.slice(8)}`);
    if (p.length) out.push('近期重要日期：' + p.join('；') + '。');
  }
  if (!out.length && now) out.push('（各區塊尚無資料）');
  return out;
}

/* =========================================================
 * 組成報告並開啟列印
 * ========================================================= */
const REPORT_CFG = {
  macro: { title: '總經與板塊分析報告', file: '總經報告', page: () => macro, sections: MACRO_REPORT, highlights: macroHighlights, variants: ['margin', 'inst', 'flow'] },
  cal: { title: '財金日曆報告', file: '財金日曆', page: () => calPage, sections: CAL_REPORT, highlights: calHighlights, variants: [] },
};

function buildReport(id) {
  const cfg = REPORT_CFG[id], page = cfg.page();
  const parts = reportParts(page);
  const issues = reportIssues(page, parts);
  if (issues.length && !confirm(`以下區塊尚未成功更新：\n\n${issues.join('\n')}\n\n仍要產出報告嗎？（按「取消」可等更新完成後再產出）`)) return;

  // 各章節（上市／上櫃兩種都有資料時都放進報告）
  const D = {};
  const secs = [];
  parts.forEach(p => {
    const keys = cfg.variants.includes(p.key) ? [p.key, p.key + '_otc'] : [page.apiPart(p.key)];
    keys.forEach(part => {
      const d = page.data[part];
      if (!d) {
        if (part === page.apiPart(p.key)) secs.push({ title: p.title, html: '<p class="muted">本區塊資料未取得。</p>' });
        return;
      }
      D[part] = d;
      try {
        const fn = cfg.sections[p.key] || cfg.sections[part];
        const r = fn(d, /_otc$/.test(part) ? 'otc' : 'tse');
        const bad = page.retry.has(p.key) && part === page.apiPart(p.key) || d.stale;
        secs.push({ title: r.title || p.title, src: r.src, time: d.updated, html: (bad ? `<p class="note">⚠ 本區塊最近一次更新失敗，以下為 ${rTime(d.updated)} 的資料。</p>` : '') + r.html });
      } catch (err) {
        console.error(err);
        secs.push({ title: p.title, html: `<p class="muted">本區塊無法排版：${esc(err.message)}</p>` });
      }
    });
  });

  const now = Date.now();
  const times = secs.map(s => s.time).filter(Boolean);
  const hl = cfg.highlights(D);
  const css = getComputedStyle(document.body);
  const up = css.getPropertyValue('--up').trim() || '#d63a3a', down = css.getPropertyValue('--down').trim() || '#13894f';
  const stamp = new Date(now + 8 * 3600000).toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const docTitle = `MarketWatch_${cfg.file}_${stamp.slice(0, 8)}_${stamp.slice(8, 12)}`;
  const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${docTitle}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>${REPORT_CSS.replace('__UP__', up).replace('__DOWN__', down).replace('__TITLE__', cfg.title)}</style></head><body>
<div class="bar noprint"><b>${cfg.title}</b><span>列印視窗的「目的地」選「另存為 PDF」即可存檔；建議紙張 A4、勾選「背景圖形」。</span><button onclick="window.print()">列印／另存 PDF</button><button onclick="window.close()">關閉</button></div>
<section class="cover">
  <div class="band"><div class="brand">MARKET WATCH</div><h1>${cfg.title}</h1><div class="date">${rDateLong(now)}</div></div>
  <table class="meta"><tr><td>產出時間</td><td>${rTime(now)}（台北）</td><td>使用者</td><td>${esc(state.account || '')}</td></tr>
    <tr><td>資料時間</td><td>${times.length ? `${rTime(Math.min(...times))} ～ ${rTime(Math.max(...times))}` : '—'}</td><td>章節</td><td>${secs.length} 節</td></tr></table>
  <h2 class="ch">重點摘要</h2>
  <ul class="hl">${hl.map(x => `<li>${x}</li>`).join('')}</ul>
  ${issues.length ? `<p class="note">產出時有 ${issues.length} 個區塊未成功更新（已在各章節標示），數字可能不是最新。</p>` : ''}
  <h2 class="ch">目錄</h2>
  <ol class="toc">${secs.map(s => `<li><span>${esc(s.title)}</span></li>`).join('')}</ol>
  <p class="disc">本報告依公開資料自動整理，可能有延遲、遺漏或錯誤；各項數字與判斷僅供研究參考，不構成任何投資建議。</p>
</section>
${secs.map((s, i) => `<section class="sec"><h2><span class="no">${i + 1}</span>${esc(s.title)}</h2>
  <div class="src">${s.time ? '資料時間 ' + rTime(s.time) : ''}${s.src ? `${s.time ? '｜' : ''}來源：${esc(s.src)}` : ''}</div>${s.html}</section>`).join('')}
</body></html>`;
  openReport(html);
}

function openReport(html) {
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    const go = () => setTimeout(() => { try { w.focus(); w.print(); } catch { /* 使用者可按頁面上的按鈕 */ } }, 400);
    if (w.document.fonts && w.document.fonts.ready) w.document.fonts.ready.then(go); else w.addEventListener('load', go);
    return;
  }
  // 彈出視窗被封鎖：改用隱藏的 iframe 直接列印
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.contentDocument.open();
  f.contentDocument.write(html);
  f.contentDocument.close();
  const go = () => setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); }, 400);
  (f.contentDocument.fonts ? f.contentDocument.fonts.ready : Promise.resolve()).then(go);
  toast('瀏覽器擋住了新分頁，已直接開啟列印視窗；可在網址列右側允許彈出視窗，下次會開在新分頁方便預覽。');
}

const REPORT_CSS = `
:root { --up: __UP__; --down: __DOWN__; --ink: #1a2433; --muted: #7a8596; --rule: #d7dde6; --navy: #1b3a63; --soft: #f3f6fa; }
@page { size: A4; margin: 15mm 13mm 16mm;
  @top-left { content: "Market Watch｜__TITLE__"; font: 8pt "Noto Sans TC", sans-serif; color: #8a95a5; }
  @bottom-right { content: "第 " counter(page) " 頁／共 " counter(pages) " 頁"; font: 8pt "Noto Sans TC", sans-serif; color: #8a95a5; } }
@page :first { @top-left { content: none; } }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; background: #fff; }
body { font: 9.5pt/1.55 "Inter", "Noto Sans TC", "Microsoft JhengHei", sans-serif; color: var(--ink); max-width: 190mm; margin: 0 auto; padding: 0 0 20px; }
.bar { position: sticky; top: 0; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; background: #fffbe6; border: 1px solid #f0d58a; padding: 8px 12px; margin: 10px 0 16px; border-radius: 6px; font-size: 12px; z-index: 5; }
.bar span { color: #6b5600; flex: 1; }
.bar button { font: inherit; padding: 5px 12px; border: 1px solid #1b3a63; background: #1b3a63; color: #fff; border-radius: 5px; cursor: pointer; }
.bar button + button { background: #fff; color: #1b3a63; }
@media print { .noprint { display: none !important; } body { max-width: none; padding: 0; } }
.cover { break-after: page; }
.band { background: var(--navy); color: #fff; padding: 26px 28px 22px; border-radius: 4px; }
.band .brand { font: 600 9pt "Inter", sans-serif; letter-spacing: 3px; opacity: .75; }
.band h1 { margin: 8px 0 6px; font-size: 24pt; font-weight: 700; letter-spacing: 1px; }
.band .date { font-size: 11pt; opacity: .9; }
table.meta { width: 100%; border-collapse: collapse; margin: 14px 0 6px; font-size: 9pt; }
table.meta td { padding: 5px 8px; border-bottom: 1px solid var(--rule); }
table.meta td:nth-child(odd) { color: var(--muted); width: 14%; }
h2.ch { font-size: 12.5pt; color: var(--navy); border-bottom: 2px solid var(--navy); padding-bottom: 4px; margin: 22px 0 10px; }
ul.hl { margin: 0; padding-left: 18px; } ul.hl li { margin: 5px 0; }
ol.toc { margin: 0; padding-left: 22px; columns: 2; column-gap: 28px; } ol.toc li { margin: 3px 0; }
.disc { margin-top: 26px; font-size: 8pt; color: var(--muted); border-top: 1px solid var(--rule); padding-top: 8px; }
.sec { margin: 0 0 20px; }
.sec h2 { font-size: 13pt; color: var(--navy); margin: 0 0 2px; padding: 10px 0 5px; border-bottom: 1.5px solid var(--navy); break-after: avoid; display: flex; align-items: baseline; gap: 10px; }
.sec h2 .no { font: 700 11pt "Inter", sans-serif; color: #fff; background: var(--navy); border-radius: 3px; padding: 1px 7px; }
.src { font-size: 8pt; color: var(--muted); margin: 4px 0 10px; break-after: avoid; }
.sec > .kpis:first-of-type, .sec > p:first-of-type { break-before: avoid; }
h4 { font-size: 10pt; margin: 12px 0 6px; color: var(--ink); break-after: avoid; }
p { margin: 6px 0 8px; }
.note { font-size: 8.5pt; color: #8a6400; background: #fff8e1; border-left: 3px solid #e0a100; padding: 4px 8px; }
.muted { color: var(--muted); }
table.rt { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-size: 8.8pt; }
table.rt th { text-align: left; font-weight: 600; color: var(--muted); border-bottom: 1px solid var(--ink); padding: 4px 6px; font-size: 8pt; white-space: nowrap; }
table.rt td { padding: 3.5px 6px; border-bottom: 1px solid #eef1f5; vertical-align: middle; }
table.rt.sm { font-size: 8.2pt; } table.rt.sm td { padding: 2.5px 5px; }
table.rt.ev { table-layout: fixed; } table.rt.ev th:nth-child(1) { width: 11%; } table.rt.ev th:nth-child(2) { width: 9%; }
table.rt.ev th:nth-child(4), table.rt.ev th:nth-child(5), table.rt.ev th:nth-child(6) { width: 11%; }
table.rt tr { break-inside: avoid; }
table.rt thead { display: table-header-group; }
table.rt .num, table.rt th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.rt tr.grp td { background: var(--soft); font-weight: 600; color: var(--navy); }
table.rt tr.sum td, table.rt tr.bench td { background: var(--soft); font-weight: 600; }
table.rt td.sp { width: 80px; } table.rt td.heat { font-weight: 600; }
.b { font-weight: 700; } .up { color: var(--up); } .down { color: var(--down); }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(32mm, 1fr)); border: 1px solid var(--rule); border-radius: 4px; margin: 6px 0 10px; break-inside: avoid; }
.kpi { padding: 7px 10px; border-right: 1px solid var(--rule); } .kpi:last-child { border-right: 0; }
.kl { font-size: 8pt; color: var(--muted); } .kv { font: 700 12.5pt "Inter", "Noto Sans TC", sans-serif; margin: 1px 0; } .ks { font-size: 8pt; color: var(--muted); }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; break-inside: avoid; } .two > div { min-width: 0; }
.keep { break-inside: avoid; }
svg.rchart { width: 100%; height: auto; margin: 4px 0 8px; break-inside: avoid; display: block; }
svg .gl { stroke: #e6eaf0; stroke-width: 1; } svg .zl { stroke: #c62828; stroke-dasharray: 3 3; }
svg .ax { font: 8px "Inter", sans-serif; fill: #8a95a5; } svg .lg { font: 9px "Noto Sans TC", sans-serif; fill: #5b6778; }
svg.mspark { display: block; } svg.mspark polyline { fill: none; stroke-width: 1.2; stroke: #8a95a5; }
svg.mspark.up polyline { stroke: var(--up); } svg.mspark.down polyline { stroke: var(--down); }
ol.news { margin: 0 0 6px; padding-left: 18px; } ol.news li { margin: 3px 0; break-inside: avoid; } ol.news a { color: var(--ink); text-decoration: none; }
.light { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; }
.lights { display: grid; grid-template-columns: repeat(12, 1fr); gap: 3px; margin: 6px 0 12px; break-inside: avoid; }
.lights span { color: #fff; font: 700 8.5pt "Inter", sans-serif; text-align: center; padding: 4px 0 2px; border-radius: 3px; }
.lights i { display: block; font: 400 6.5pt "Inter", sans-serif; opacity: .9; font-style: normal; }
`;

/* =========================================================
 * 個股研究 PDF 報告
 * ========================================================= */
const RSX_LABEL = { fin: '財務體質', est: '分析師預估與財報驚喜', chips: '股權分散、借券與當沖', own: '內部人、機構與選擇權', events: '新聞與事件', peers: '同業比較' };

function reportShell(title, docTitle, cover, secs) {
  const css = getComputedStyle(document.body);
  const up = css.getPropertyValue('--up').trim() || '#d63a3a', down = css.getPropertyValue('--down').trim() || '#13894f';
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${docTitle}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>${REPORT_CSS.replace('__UP__', up).replace('__DOWN__', down).replace('__TITLE__', title)}</style></head><body>
<div class="bar noprint"><b>${esc(title)}</b><span>列印視窗的「目的地」選「另存為 PDF」即可存檔；建議紙張 A4、勾選「背景圖形」。</span><button onclick="window.print()">列印／另存 PDF</button><button onclick="window.close()">關閉</button></div>
${cover}
${secs.map((s, i) => `<section class="sec"><h2><span class="no">${i + 1}</span>${esc(s.title)}</h2>
  ${s.src ? `<div class="src">來源：${esc(s.src)}</div>` : ''}${s.html}</section>`).join('')}
</body></html>`;
}

function buildResearchReport() {
  const d = research.data, C = research.calc, X = research.x || {}, E = research.xerr || {};
  if (!d || !C) { toast('請先查詢一檔股票'); return; }
  const isTW = d.mkt === 'TW', cur = d.currency || '';
  const parts = isTW ? RSX_PARTS.TW : RSX_PARTS.US;
  const issues = parts.filter(p => !X[p]).map(p => `・${RSX_LABEL[p]}：${E[p] ? '無法取得（' + E[p].slice(0, 40) + '）' : '仍在背景載入中'}，報告中會略過`);
  if (issues.length && !confirm(`以下延伸資料尚未載入完成：\n\n${issues.join('\n')}\n\n仍要產出報告嗎？（按「取消」可等載入完成後再產出）`)) return;

  const secs = [];
  const add = (title, html, src) => { if (html) secs.push({ title, html, src }); };
  const last = C.last, P = d.price, n = P.c.length;

  // 1. 價格與技術
  {
    const s = Math.max(0, n - 250), T = C.tech;
    const chart = rChart({ labels: P.t.slice(s), h: 200, series: [
      { name: '收盤價', color: '#1f4e8c', vals: P.c.slice(s), width: 1.8, fmt: v => numTxt(v, v >= 100 ? 0 : 2) },
      { name: 'MA60', color: '#e67e22', vals: C.ma[60].slice(s), width: 1.2 }, { name: 'MA240', color: '#7f8c8d', vals: C.ma[240].slice(s), width: 1.2, dash: true }] });
    const tech = rTbl(['指標', '#數值', '解讀'], [
      `<tr><td>RSI(14)</td>${rNum(T.rsi, 1)}<td>${T.rsi >= 70 ? '超買區' : T.rsi <= 30 ? '超賣區' : T.rsi >= 50 ? '強勢區' : '弱勢區'}</td></tr>`,
      `<tr><td>KD(9,3,3)</td><td class="num">K ${numTxt(T.k, 1)} / D ${numTxt(T.d, 1)}</td><td>${T.k > T.d ? 'K 在 D 之上' : 'K 在 D 之下'}</td></tr>`,
      `<tr><td>MACD(12,26,9)</td><td class="num">DIF ${numTxt(T.dif, 2)} / ${numTxt(T.dea, 2)}</td><td class="${rc(T.osc)}">柱 ${signTxt(T.osc, 2)}</td></tr>`,
      `<tr><td>乖離率</td><td class="num">20 日 ${signTxt(T.bias20, 1, '%')}／60 日 ${signTxt(T.bias60, 1, '%')}</td><td></td></tr>`,
      ...[20, 60, 240].map(k => { const m = C.ma[k][n - 1]; return `<tr><td>MA${k}</td>${rNum(m)}<td class="${rc(last - m)}">${isNum(m) ? (last >= m ? '股價在上' : '股價在下') : '—'}</td></tr>`; })], 'sm');
    const R = C.risk || rsxRiskCalc(), RT = C.rets || rsxReturnsCalc();
    const risk = rTbl(['風險指標', '#數值'], [
      `<tr><td>最大回撤（近 ${R.years} 年）</td>${rSign(R.mdd, 1, '%')}</tr>`, `<tr><td>近 1 年最大回撤</td>${rSign(R.mdd1, 1, '%')}</tr>`,
      `<tr><td>年化波動度</td>${rNum(R.vol, 1, '%')}</tr>`, `<tr><td>Beta</td>${rNum(R.beta, 2)}</tr>`, `<tr><td>夏普值／索提諾值</td><td class="num">${numTxt(R.sharpe, 2)}／${numTxt(R.sortino, 2)}</td></tr>`,
      `<tr><td>單日最大漲／跌</td><td class="num"><span class="up">${signTxt(R.best, 1, '%')}</span>／<span class="down">${signTxt(R.worst, 1, '%')}</span></td></tr>`], 'sm');
    const rets = rTbl(['期間', '#股價', '#含息', '#年化'], RT.map(r => `<tr><td>${r.label}</td>${rSign(r.p, 1, '%')}${'t' in r ? rSign(r.t, 1, '%') : '<td class="num">—</td>'}${rSign(r.ann, 1, '%')}</tr>`), 'sm');
    const S = C.season || rsxSeasonCalc();
    const season = S ? `<h4>季節性（近 ${Math.round(d.mo.t.length / 12)} 年各月份）</h4>` + rTbl(['月份', ...S.map(x => '#' + x.m + '月')], [
      `<tr><td>平均報酬</td>${S.map(x => rSign(x.avg, 1, '%')).join('')}</tr>`, `<tr><td>上漲機率</td>${S.map(x => rNum(x.win, 0, '%')).join('')}</tr>`], 'sm') : '';
    const LV = C.levels || rsxLevelsCalc();
    const lv = `<p>成交密集壓力區：${LV.res.map(x => `${numTxt(x.lo, 1)}–${numTxt(x.hi, 1)}`).join('、') || '無'}；支撐區：${LV.sup.map(x => `${numTxt(x.lo, 1)}–${numTxt(x.hi, 1)}`).join('、') || '無'}；52 週區間 ${numTxt(LV.r250.lo)}–${numTxt(LV.r250.hi)}。</p>`;
    add('價格與技術', chart + `<div class="two"><div><h4>技術指標</h4>${tech}</div><div><h4>風險指標</h4>${risk}</div></div><div class="two"><div><h4>長期報酬</h4>${rets}</div><div><h4>支撐與壓力</h4>${lv}</div></div>` + season, 'Yahoo Finance 日線與月線');
  }
  // 2. 估值與合理價
  {
    const VA = C.val, F = rsxFairCalc();
    const k = rKpis([['本益比', isNum(VA.cur) && VA.cur > 0 ? numTxt(VA.cur, 1) : '—', VA.pr != null ? '歷史百分位 ' + numTxt(VA.pr, 0) : ''], ['歷史中位數', numTxt(VA.q[2], 1), `25–75%：${numTxt(VA.q[1], 1)}–${numTxt(VA.q[3], 1)}`],
      ['股價淨值比', numTxt(VA.curPb, 2), ''], ['殖利率', isNum(VA.yld) ? numTxt(VA.yld, 2) + '%' : '—', ''], ['估值判斷', C.verdict.valuation ? esc(C.verdict.valuation.label) : '—', '']]);
    const fair = F.ok ? rTbl(['合理價依據', '#EPS', '#便宜（P25）', '#合理（中位）', '#昂貴（P75）'], [
      `<tr><td>近四季 EPS</td>${rNum(F.ttm, 2)}${rNum(F.cheap)}<td class="num b">${numTxt(F.fair)}</td>${rNum(F.rich)}</tr>`,
      F.fwd ? `<tr><td>預估 EPS（${esc(F.fwd.p)}）</td>${rNum(F.fwd.eps, 2)}${rNum(F.fwd.cheap)}<td class="num b">${numTxt(F.fwd.fair)}</td>${rNum(F.fwd.rich)}</tr>` : '']) +
      `<p>現價 ${numTxt(last)}，距合理價 ${signTxt((F.fair / last - 1) * 100, 1, '%')}。</p>` +
      (F.warn ? `<p class="note">歷史本益比區間很寬（${numTxt(F.p25, 1)}–${numTxt(F.p75, 1)} 倍）或與現價差距很大：過去的獲利基期變化大（高成長或景氣循環），用歷史本益比推算的合理價參考性低。</p>` : '')
      : '<p class="muted">本益比資料不足或近四季虧損，無法估算合理價。</p>';
    add('估值與合理價', k + fair, isTW ? '證交所／FinMind 本益比歷史' : 'Yahoo Finance（歷史本益比以股價 ÷ 近四季 EPS 重建）');
  }
  // 3. 成長與獲利
  if (C.fin && C.fin.length) {
    const F = C.fin.slice(-12);
    const rows = C.fin.slice(-8).reverse().map(x => { const j = C.fin.indexOf(x), ly = C.fin[j - 4]; const g = ly && ly.rev ? (x.rev / ly.rev - 1) * 100 : null;
      return `<tr><td>${qLabel(x.p)}</td><td class="num">${fmtBig(x.rev, cur)}</td>${rSign(g, 1, '%')}${rNum(x.gm, 1, '%')}${rNum(x.om, 1, '%')}${rNum(x.nm, 1, '%')}<td class="num b">${numTxt(x.eps, 2)}</td></tr>`; });
    const chart = rChart({ labels: F.map(x => x.p), h: 170, series: [{ name: '毛利率', color: '#1f4e8c', vals: F.map(x => x.gm), fmt: v => v.toFixed(0) + '%' }, { name: '營益率', color: '#e67e22', vals: F.map(x => x.om) }, { name: '淨利率', color: '#16a085', vals: F.map(x => x.nm) }] });
    const v = [C.verdict.growth, C.verdict.profit].filter(Boolean).map(x => `${esc(x.label)}：${x.reasons.slice(0, 2).map(esc).join('；')}`).join('<br>');
    let html = `<p>${v}</p>` + chart + rTbl(['季度', '#營收', '#年增', '#毛利率', '#營益率', '#淨利率', '#EPS'], rows, 'sm');
    if (isTW && C.mrev.list.length) {
      const L = C.mrev.list.slice(-12).reverse(), hl = rsxRevHighlights();
      html += `<h4>月營收</h4>${hl.length ? `<p>${hl.join('；')}</p>` : ''}` + rTbl(['月份', '#營收', '#年增', '#月增'], L.map(x => `<tr><td>${x.ym.replace('-', '/')}</td><td class="num">${fmtBig(x.rev, 'TWD')}</td>${rSign(x.yoy, 1, '%')}${rSign(x.mom, 1, '%')}</tr>`), 'sm');
    }
    add('成長與獲利', html, isTW ? 'FinMind（公開資訊觀測站財報、月營收）' : 'Yahoo Finance');
  }
  // 4. 財務體質
  if (X.fin) {
    const q = (X.fin.q || []).filter(r => r.p), fcur = X.fin.cur || cur;
    const now = q.length >= 4 ? rsxFinRatios(q, q.length - 1) : X.fin.a && X.fin.a.length ? rsxAnnRatios(X.fin.a, X.fin.a.length - 1) : null;
    if (now) {
      let prev = null;
      if (isTW && q.length >= 8) prev = rsxFinRatios(q, q.length - 5);
      else if (!isTW && X.fin.a && X.fin.a.length >= 2) prev = rsxAnnRatios(X.fin.a, X.fin.a.length - 2);
      const curY = !isTW && X.fin.a && X.fin.a.length >= 2 ? rsxAnnRatios(X.fin.a, X.fin.a.length - 1) : now;
      const F = rsxFScore(curY, prev);
      const mcap = isTW ? (d.shares ? d.shares * last : null) : d.stats && d.stats.mcap;
      const Z = /金融|銀行|保險|證券/.test(d.industry || '') ? null : rsxZScore(now, mcap);
      let html = rKpis([['負債比', numTxt(now.debtR, 1) + '%'], ['流動比／速動比', `${numTxt(now.curR, 2)}／${numTxt(now.quick, 2)}`], ['ROE（近四季）', numTxt(now.roe, 1) + '%', 'ROA ' + numTxt(now.roa, 1) + '%'],
        ['自由現金流（近四季）', fmtBig(now.t.fcf, fcur), '', rc(now.t.fcf)], ['F-Score', F ? `${F.score}／${F.of}` : '—'], ['Z-Score', Z ? numTxt(Z.z, 2) : '—', Z ? Z.zone[0] : '']]);
      if (F) html += `<div class="two"><div><h4>Piotroski F-Score</h4>${rTbl(['項目', '結果'], F.items.map(([t, ok]) => `<tr><td>${t}</td><td class="${ok ? 'up' : ok === false ? 'down' : ''}">${ok === null ? '—' : ok ? '✓ 符合' : '✗ 不符合'}</td></tr>`), 'sm')}</div>`;
      const pts = [];
      if (isTW) for (let i = q.length - 1; i >= 3 && pts.length < 5; i -= 4) pts.push(rsxFinRatios(q, i));
      else (X.fin.a || []).forEach((r, k) => { if (k >= 1 || (X.fin.a || []).length === 1) pts.unshift(rsxAnnRatios(X.fin.a, k)); });
      html += `<div><h4>杜邦分析</h4>${rTbl(['期間', '#ROE', '#淨利率', '#資產週轉', '#權益乘數'], pts.slice(0, 5).map(r => `<tr><td>${isTW ? qLabel(r.p) : r.p.slice(0, 4)}</td>${rNum(r.roe, 1, '%')}${rNum(r.nm, 1, '%')}${rNum(r.turn, 2)}${rNum(r.lev, 2)}</tr>`), 'sm')}</div>${F ? '</div>' : ''}`;
      html += `<h4>近 8 季現金流與資產負債</h4>` + rTbl(['季度', '#營收', '#淨利', '#營業現金流', '#資本支出', '#自由現金流', '#負債比', '#流動比'],
        q.slice(-8).reverse().map(r => `<tr><td>${qLabel(r.p)}</td><td class="num">${fmtBig(r.rev, fcur)}</td><td class="num">${fmtBig(r.ni, fcur)}</td><td class="num">${fmtBig(r.ocf, fcur)}</td><td class="num">${fmtBig(r.capex, fcur)}</td><td class="num ${rc(r.fcf)}">${fmtBig(r.fcf, fcur)}</td>${rNum(rxPct(r.tl, r.ta), 1, '%')}${rNum(r.ca && r.cl ? r.ca / r.cl : null, 2)}</tr>`), 'sm');
      const S = X.fin.sec;
      if (S && S.rows && S.rows.length) {
        html += `<h4>長期財報（SEC，近 ${S.rows.length} 年，${esc(S.cur)}）</h4>` + rChart({ labels: S.rows.map(r => String(r.y)), h: 160, series: [{ name: '營收', color: '#1f4e8c', vals: S.rows.map(r => rxDiv(r.rev, S.cur)), width: 2, fmt: v => numTxt(v, 0) }, { name: '淨利', color: '#16a085', vals: S.rows.map(r => rxDiv(r.ni, S.cur)) }] }) +
          rTbl(['年度', '#營收', '#毛利率', '#營益率', '#淨利', '#淨利率', '#營業現金流', '#ROE'], S.rows.slice().reverse().map(r => `<tr><td>${r.y}</td><td class="num">${fmtBig(r.rev, S.cur)}</td>${rNum(rxPct(r.gp, r.rev), 1, '%')}${rNum(rxPct(r.op, r.rev), 1, '%')}<td class="num">${fmtBig(r.ni, S.cur)}</td>${rNum(rxPct(r.ni, r.rev), 1, '%')}<td class="num">${fmtBig(r.ocf, S.cur)}</td>${rNum(rxPct(r.ni, r.eq), 1, '%')}</tr>`), 'sm');
      }
      add('財務體質', html, X.fin.src + (X.fin.sec ? '、SEC' : ''));
    }
  }
  // 5. 預估與分析師
  {
    let html = '';
    const A = d.analyst;
    if (A && (A.mean || A.trend)) {
      html += rKpis([['平均目標價', numTxt(A.mean), A.mean ? '距現價 ' + signTxt((A.mean / last - 1) * 100, 1, '%') : ''], ['目標價區間', `${numTxt(A.low)}–${numTxt(A.high)}`], ['分析師人數', A.n || '—'],
        ['評等分布', A.trend ? `買進 ${(A.trend.sb || 0) + (A.trend.b || 0)}・持有 ${A.trend.h || 0}・賣出 ${(A.trend.s || 0) + (A.trend.ss || 0)}` : '—']]);
    }
    if (X.est) {
      const fr = r => `<tr><td>${esc(r.p)}</td><td class="num b">${numTxt(r.avg, 2)}</td><td class="num">${numTxt(r.lo, 2)}–${numTxt(r.hi, 2)}</td>${rNum(r.n, 0)}<td class="num">${r.up ? '▲' + r.up : ''} ${r.dn ? '▼' + r.dn : ''}</td></tr>`;
      const idx = ds => P.t.findIndex(t => t >= ds);
      html += `<div class="two"><div><h4>EPS 預估</h4>${rTbl(['期間', '#平均', '#區間', '#家數', '#4 週調整'], (X.est.qf || []).concat(X.est.yf || []).map(fr), 'sm')}</div>
        <div><h4>財報驚喜與股價反應</h4>${rTbl(['季度', '#實際', '#預估', '#驚喜', '#反應'], (X.est.surprise || []).map(r => { const k = r.d ? idx(r.d) : -1; const rx = k > 0 && k + 1 < n ? (P.c[k + 1] / P.c[k - 1] - 1) * 100 : null;
          return `<tr><td>${esc(r.p)}</td>${rNum(r.eps, 2)}${rNum(r.est, 2)}${rSign(r.sp, 1, '%')}${rSign(rx, 1, '%')}</tr>`; }), 'sm')}</div></div>`;
    }
    add('預估與分析師', html, (A ? (A.src === 'Nasdaq' ? 'Nasdaq' : 'Yahoo Finance') : '') + (X.est ? '、Nasdaq（Zacks 共識）' : ''));
  }
  // 6. 籌碼
  {
    let html = '';
    const CH = C.chips || {};
    if (isTW) {
      html += rKpis([['外資 20 日', signTxt(CH.f20, 0) + ' 張', '5 日 ' + signTxt(CH.f5, 0), rc(CH.f20)], ['投信 20 日', signTxt(CH.it20, 0) + ' 張', '5 日 ' + signTxt(CH.it5, 0), rc(CH.it20)],
        ['外資持股', numTxt((d.foreign || []).slice(-1)[0] && d.foreign.slice(-1)[0].r, 2) + '%', '20 日 ' + signTxt(CH.fr, 2)], ['融資 20 日', signTxt(CH.mg20, 1, '%'), '']]);
      const Xc = X.chips;
      if (Xc) {
        const W = Xc.tdcc || [];
        if (W.length) {
          const pct = (w, lv) => w.lv.filter(x => lv.includes(x[0])).reduce((s, x) => s + x[3], 0), ppl = w => w.lv.reduce((s, x) => s + x[1], 0);
          html += `<h4>集保股權分散（近 ${W.length} 週）</h4>` + rTbl(['週', '#千張大戶', '#400 張以上', '#10 張以下', '#股東人數'], W.slice().reverse().slice(0, 8).map(w =>
            `<tr><td>${mdTxt(w.d)}</td>${rNum(pct(w, [15]), 2, '%')}${rNum(pct(w, [12, 13, 14, 15]), 2, '%')}${rNum(pct(w, [1, 2, 3]), 2, '%')}${rNum(ppl(w), 0)}</tr>`), 'sm');
        }
        const S = Xc.sbl || [], vb = new Map(P.t.map((t, i) => [t, (P.v[i] || 0) / 1000])), db = new Map((Xc.dt || []).map(x => [x.d, x.v]));
        if (S.length) html += `<h4>借券與當沖（近 10 日）</h4>` + rTbl(['日期', '#借券賣出', '#借券餘額', '#融券餘額', '#當沖比'], S.slice(-10).reverse().map(x =>
          `<tr><td>${mdTxt(x.d)}</td>${rNum(x.ss, 0)}${rNum(x.sb, 0)}${rNum(x.mb, 0)}${rNum(db.has(x.d) && vb.get(x.d) ? (db.get(x.d) / vb.get(x.d)) * 100 : null, 1, '%')}</tr>`), 'sm');
        if (Xc.etfs && Xc.etfs.length) html += `<h4>持有的 ETF（追蹤中）</h4>` + rTbl(['ETF', '#權重', '#張數', '資料日'], Xc.etfs.map(x => `<tr><td>${esc(x.etf)} ${esc(x.name)}</td>${rNum(x.w, 2, '%')}${rNum(x.sh / 1000, 0)}<td>${mdTxt(x.d)}</td></tr>`), 'sm');
      }
    } else {
      html += rKpis([['機構持股', isNum(CH.inst) ? numTxt(CH.inst * 100, 1) + '%' : '—'], ['內部人持股', isNum(CH.insider) ? numTxt(CH.insider * 100, 2) + '%' : '—'],
        ['放空比例', isNum(CH.shortPct) ? numTxt(CH.shortPct * 100, 2) + '%' : '—', '較上期 ' + signTxt(CH.shortChg, 1, '%')], ['回補天數', numTxt(CH.shortRatio, 1)]]);
      const O = X.own;
      if (O) {
        html += `<h4>內部人交易（近期）</h4>${rTbl(['日期', '內部人', '職務', '類型', '#股數', '#價格'], (O.insiders || []).slice(0, 10).map(x => `<tr><td>${esc(x.d)}</td><td>${esc(x.who)}</td><td>${esc(x.rel || '')}</td><td>${esc(INSIDER_ZH[x.type] || x.type)}</td>${rNum(x.sh, 0)}${rNum(x.px || null, 2)}</tr>`), 'sm')}
          <h4>前十大機構</h4>${rTbl(['機構', '#持股(M)', '#變動', '申報日'], (O.holders || []).map(x => `<tr><td>${esc(x.who)}</td>${rNum(x.sh / 1e6, 1)}${rSign(x.chgPct, 2, '%')}<td>${esc(x.d)}</td></tr>`), 'sm')}`;
        if (O.opt) {
          const o = O.opt;
          html += `<h4>選擇權（${o.exp} 到期）</h4>` + rKpis([['Put/Call（未平倉）', numTxt(o.callOI ? o.putOI / o.callOI : null, 2)], ['最大買權未平倉', numTxt(o.maxCall.k, 2)], ['最大賣權未平倉', numTxt(o.maxPut.k, 2)], ['最大痛點', numTxt(o.pain, 2), isNum(o.px) ? '距現價 ' + signTxt((o.pain / o.px - 1) * 100, 1, '%') : '']]);
        }
      }
    }
    add('籌碼', html, isTW ? 'FinMind（法人、融資、借券、當沖）、集保結算所' : 'Yahoo／Nasdaq（SEC Form 4、13F）');
  }
  // 7. 股利
  {
    let html = '';
    const D = d.div || [];
    if (D.length) html += rTbl(isTW ? ['期別', '#現金股利', '#股票股利', '除息日'] : ['除息日', '#每股現金股利'], D.slice(0, 10).map(x => (isTW
      ? `<tr><td>${esc(x.y)}</td>${rNum(x.cash, 2)}${rNum(x.stock, 2)}<td>${esc(x.ex || '—')}</td></tr>` : `<tr><td>${new Date(x.t + 8 * 3600000).toISOString().slice(0, 10)}</td>${rNum(x.cash, 4)}</tr>`)), 'sm');
    if (isTW && X.events && (X.events.divs || []).length) {
      const rows = X.events.divs.filter(x => x.d >= P.t[0]).slice().reverse().map(x => {
        const k = P.t.findIndex(t => t >= x.d);
        let days = null;
        if (k >= 0) for (let i = k; i < n; i++) if (P.h[i] >= x.before) { days = i - k + 1; break; }
        return `<tr><td>${esc(x.d)}</td>${rNum(x.amt, 2)}${rNum(x.before)}${rNum(x.ref)}<td class="num">${days != null ? days + ' 天' : '未填息'}</td></tr>`;
      });
      html += `<h4>填息紀錄</h4>` + rTbl(['除權息日', '#配發', '#除息前收盤', '#參考價', '#填息'], rows, 'sm');
    }
    add('股利', html, isTW ? 'FinMind' : 'Yahoo Finance');
  }
  // 8. 新聞與事件
  if (X.events) {
    let html = (X.events.notes || []).map(x => `<p class="note">${esc(x.kind)}：${esc(x.text)}</p>`).join('');
    html += `<ol class="news">${(X.events.news || []).slice(0, 12).map(x => `<li><a href="${esc(x.u)}">${esc(x.t)}</a><span class="muted">　${esc(x.s)}・${rTime(x.ts)}</span></li>`).join('')}</ol>`;
    if (!isTW && (X.events.filings || []).length) html += `<h4>SEC 申報文件</h4>` + rTbl(['日期', '文件', '內容'], X.events.filings.slice(0, 10).map(f => `<tr><td>${esc(f.d)}</td><td><a href="${esc(f.u)}">${esc(f.form)}</a> ${esc(f.zh)}</td><td>${esc(f.items || '')}</td></tr>`), 'sm');
    add('新聞與事件', html, isTW ? '鉅亨網、證交所、櫃買中心' : 'Yahoo Finance、SEC EDGAR');
  }
  // 9. 同業比較
  if (X.peers && (X.peers.rows || []).length) {
    const R = X.peers.rows;
    const html = isTW
      ? `<p>${esc(X.peers.ind)}（共 ${X.peers.total} 家），本股市值排名第 ${X.peers.rank}。</p>` + rTbl(['公司', '#市值(億)', '#本益比', '#淨值比', '#殖利率', '#月營收年增', '#今年'], R.map(r =>
        `<tr class="${r.me ? 'sum' : ''}"><td>${r.me ? '★ ' : ''}${esc(r.n)} ${esc(r.c)}</td>${rNum(r.cap, 0)}${rNum(r.pe, 1)}${rNum(r.pb, 2)}${rNum(r.y, 2, '%')}${rSign(r.ry, 1, '%')}${rSign(r.ytd, 1, '%')}</tr>`), 'sm')
      : rTbl(['公司', '#市值', '#本益比', '#預估本益比', '#營收年增', '#毛利率', '#淨利率', '#今年'], R.map(r =>
        `<tr class="${r.me ? 'sum' : ''}"><td>${r.me ? '★ ' : ''}${esc(r.s)} <span class="muted">${esc(String(r.n).slice(0, 22))}</span></td><td class="num">${fmtBig(r.cap, 'USD')}</td>${rNum(r.pe, 1)}${rNum(r.fpe, 1)}${rSign(r.ry, 1, '%')}${rNum(r.gm, 1, '%')}${rNum(r.nm, 1, '%')}${rSign(r.ytd, 1, '%')}</tr>`), 'sm');
    add('同業比較', html, isTW ? '證交所、櫃買中心開放資料' : 'Yahoo Finance 相關個股（不一定同產業）');
  }
  // 10. 公司簡介
  {
    const pf = d.profile || {};
    const html = rKpis([['產業', esc(d.industry || pf.industry || '—'), esc(pf.sector || '')], ['員工數', pf.employees ? numTxt(pf.employees, 0) : '—'], ['國家', esc(pf.country || (isTW ? 'Taiwan' : '—'))]]) +
      (pf.summary ? `<p>${esc(pf.summary)}</p>` : '');
    add('公司簡介', html, pf.summary ? (pf.src === 'Nasdaq' ? 'Nasdaq' : 'Yahoo Finance') : '');
  }

  // 封面：股價、主要指標、各面向判斷
  const now = Date.now();
  const verdicts = RS_BLOCKS.map(([k, label]) => [label, C.verdict[k]]).filter(x => x[1]);
  const mcap = isTW ? (d.shares ? d.shares * last : null) : d.stats && d.stats.mcap;
  const cover = `<section class="cover">
  <div class="band"><div class="brand">MARKET WATCH｜個股研究報告</div><h1>${esc(d.name)} <span style="font-size:15pt;opacity:.85">${esc(d.code)}</span></h1>
    <div class="date">${rDateLong(now)}　${esc(d.industry || '')}${d.board ? '・' + esc(d.board) : ''}</div></div>
  ${rKpis([['股價', numTxt(last), `<span class="${rc(C.chg)}">${pctTxt(C.chg)}</span>　${esc(P.t[n - 1])}`], ['市值', fmtBig(mcap, cur)], ['本益比', isNum(C.val.cur) && C.val.cur > 0 ? numTxt(C.val.cur, 1) : '—'],
    ['股價淨值比', numTxt(C.val.curPb, 2)], ['殖利率', isNum(C.val.yld) ? numTxt(C.val.yld, 2) + '%' : '—', `52 週 ${numTxt(C.lo52)}–${numTxt(C.hi52)}`]])}
  <h2 class="ch">各面向判斷</h2>
  ${rTbl(['面向', '判斷', '主要依據'], verdicts.map(([l, v]) => `<tr><td>${l}</td><td class="b ${v.tone === 'bull' ? 'up' : v.tone === 'bear' ? 'down' : ''}">${esc(v.label)}</td><td>${v.reasons.slice(0, 2).map(esc).join('；')}</td></tr>`))}
  ${issues.length ? `<p class="note">產出時有 ${issues.length} 組延伸資料尚未載入，相關章節已略過。</p>` : ''}
  <h2 class="ch">目錄</h2>
  <ol class="toc">${secs.map(s => `<li><span>${esc(s.title)}</span></li>`).join('')}</ol>
  <p class="disc">產出時間 ${rTime(now)}（台北）。各面向依固定統計規則判斷，彼此獨立、不加總成買賣建議；資料來自公開來源，可能有延遲或錯誤，僅供研究參考，不構成任何投資建議。</p>
</section>`;
  const stamp = new Date(now + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
  openReport(reportShell(`${d.name} ${d.code} 個股研究報告`, `MarketWatch_個股研究_${d.code}_${stamp}`, cover, secs));
}

/* ---------- 工具列按鈕 ---------- */
['macro', 'cal'].forEach(id => {
  const b = $('#' + id + 'Pdf');
  if (b) b.addEventListener('click', () => {
    try { buildReport(id); } catch (err) { console.error(err); toast('報告產出失敗：' + err.message); }
  });
});
