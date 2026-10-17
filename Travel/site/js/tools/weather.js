/* 旅行工具箱：旅途天氣（資料來源：Open-Meteo，免金鑰）
 * #/tool/weather            選旅程，或搜尋任何城市
 * #/tool/weather/<tripId>   這趟旅程每個城市的天氣
 * 每個城市顯示：現在天氣、未來 16 天預報（標出旅行日）、最近 30 天實際氣溫、
 *               過去 3 年同期、近 5 年同月份平均 */
(function () {
  const U = TA.u, S = TA.store, E = TA.u.esc, UI = TA.ui;

  // ---------- 天氣代碼（WMO）→ 中文與圖示 ----------
  const P = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    partly: '<path d="M8 3v1.5M3.5 8H2M4.4 4.4l1 1M12.6 4.4l-1 1"/><path d="M5.5 10.5a3 3 0 0 1 5.6-1.7"/><path d="M8 20h9a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.5A3.3 3.3 0 0 0 8 20z"/>',
    cloud: '<path d="M7 19h10a4.5 4.5 0 0 0 .5-9A6 6 0 0 0 6 11.5 3.8 3.8 0 0 0 7 19z"/>',
    fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
    drizzle: '<path d="M7 15h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 8.5 3.3 3.3 0 0 0 7 15z"/><path d="M9 18v1M13 18v1M17 18v1"/>',
    rain: '<path d="M7 14h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 7.5 3.3 3.3 0 0 0 7 14z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>',
    snow: '<path d="M7 13h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 6.5 3.3 3.3 0 0 0 7 13z"/><path d="M8 17h.01M12 19h.01M16 17h.01M10 21h.01M14 21h.01"/>',
    storm: '<path d="M7 14h10a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.6 7.5 3.3 3.3 0 0 0 7 14z"/><path d="M12 15l-2 4h3l-2 4"/>',
  };
  const W = c => {
    if (c === 0) return ['晴', 'sun']; if (c === 1) return ['大致晴朗', 'sun']; if (c === 2) return ['晴時多雲', 'partly']; if (c === 3) return ['陰', 'cloud'];
    if (c === 45 || c === 48) return ['霧', 'fog']; if (c >= 51 && c <= 57) return ['毛毛雨', 'drizzle'];
    if (c === 61 || c === 80) return ['小雨', 'rain']; if (c === 63 || c === 81) return ['中雨', 'rain']; if (c === 65 || c === 82) return ['大雨', 'rain'];
    if (c === 66 || c === 67) return ['凍雨', 'rain']; if (c >= 71 && c <= 77) return ['下雪', 'snow']; if (c === 85 || c === 86) return ['陣雪', 'snow'];
    if (c >= 95) return ['雷雨', 'storm']; return ['—', 'cloud'];
  };
  const ico = (c, s = 22) => `<svg class="wx-ico" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${P[W(c)[1]]}</svg>`;
  const r1 = n => (n == null || isNaN(n) ? '—' : Math.round(n));
  const avg = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

  // ---------- 資料 ----------
  const cacheGet = (k, ttl) => { try { const c = JSON.parse(localStorage.getItem(k) || 'null'); if (c && Date.now() - c.at < ttl) return c.d; } catch { } return null; };
  /** 天氣快取只留最近用過的 12 個城市，避免佔滿瀏覽器空間（旅程資料也存在同一個空間） */
  function prune(prefix, keep) {
    try {
      // 已離線下載的旅程，它的城市天氣不清
      const keepLL = new Set();
      try { Object.keys(TA.offline?.records() || {}).forEach(id => { const t = S.get(id); if (t) TA.geo.placePoints(t.countries, t.cities, t).forEach(p => keepLL.add(p.ll.join())); }); } catch { }
      const ks = Object.keys(localStorage).filter(x => x.startsWith(prefix) && !keepLL.has((x.slice(prefix.length).match(/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/) || [''])[0]));
      if (ks.length <= keep) return;
      const at = k => { try { return JSON.parse(localStorage.getItem(k)).at || 0; } catch { return 0; } };
      ks.map(k => [k, at(k)]).sort((a, b) => b[1] - a[1]).slice(keep).forEach(([k]) => localStorage.removeItem(k));
    } catch { }
  }
  const cacheSet = (k, d) => {
    const v = JSON.stringify({ at: Date.now(), d });
    try { localStorage.setItem(k, v); }
    catch { prune('ta.wx.h.', 4); prune('ta.wx.f.', 6); try { localStorage.setItem(k, v); } catch { } }
    prune('ta.wx.h.', 12); prune('ta.wx.f.', 30);
  };

  // 連不上網路時，改用上次存的資料（不管多舊），並記下資料時間
  const stale = (prefix, exact) => {
    try {
      const k = exact ? prefix : Object.keys(localStorage).filter(x => x.startsWith(prefix)).sort().pop();
      const c = k && JSON.parse(localStorage.getItem(k));
      if (c) { const d = c.d; if (d && typeof d === 'object') d._savedAt = c.at; return d; }
    } catch { }
    return null;
  };

  async function forecast(ll, force) {
    const k = `ta.wx.f.${ll.join()}`;
    if (!force) { const c = cacheGet(k, 30 * 60 * 1000); if (c) return c; }
    const q = new URLSearchParams({ latitude: ll[0], longitude: ll[1], timezone: 'auto', forecast_days: 16,
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum' });
    try {
      const d = await (await fetch('https://api.open-meteo.com/v1/forecast?' + q)).json();
      // 額度用完或參數錯誤時會回 { error, reason }，不要存起來
      if (!d?.daily?.time || !d.current) throw new Error(d?.reason || '天氣資料格式不正確');
      cacheSet(k, d); return d;
    } catch (e) { const s = stale(k, true); if (s) return s; throw e; }
  }
  async function history(ll) {
    const end = U.addDays(U.todayStr(), -6);
    const start = (+end.slice(0, 4) - 5) + '-01-01';
    const k = `ta.wx.h.${ll.join()}.${end}`;
    const c = cacheGet(k, 24 * 3600 * 1000); if (c) return c;
    const q = new URLSearchParams({ latitude: ll[0], longitude: ll[1], timezone: 'auto', start_date: start, end_date: end, daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum' });
    let j;
    try { j = await (await fetch('https://archive-api.open-meteo.com/v1/archive?' + q)).json(); }
    catch (e) { const s = stale(`ta.wx.h.${ll.join()}.`); if (s) return s; throw e; }
    if (!j?.daily?.time) { const s = stale(`ta.wx.h.${ll.join()}.`); if (s) return s; throw new Error(j?.reason || '歷史天氣資料格式不正確'); }
    const d = j.daily.time.map((t, i) => [t, j.daily.temperature_2m_max[i], j.daily.temperature_2m_min[i], j.daily.precipitation_sum[i]]);
    try { Object.keys(localStorage).filter(x => x.startsWith(`ta.wx.h.${ll.join()}.`) && x !== k).forEach(x => localStorage.removeItem(x)); } catch { }
    cacheSet(k, d); return d;
  }

  // ---------- 小圖表：最近 30 天高低溫 ----------
  function spark(rows) {
    if (!rows.length) return '';
    const w = 300, h = 70, pad = 4;
    const hi = rows.map(r => r[1]), lo = rows.map(r => r[2]);
    const max = Math.max(...hi.filter(v => v != null)), min = Math.min(...lo.filter(v => v != null));
    const x = i => pad + i * (w - pad * 2) / Math.max(1, rows.length - 1);
    const y = v => h - pad - (v - min) / Math.max(1, max - min) * (h - pad * 2);
    const line = arr => arr.map((v, i) => v == null ? '' : `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    return `<svg class="wx-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="最近 30 天氣溫">
      <path d="${line(hi)}" class="hi"/><path d="${line(lo)}" class="lo"/></svg>
      <div class="wx-spark-l"><span>${U.md(rows[0][0])}</span><span><i class="lg hi"></i>每日最高（最熱 ${r1(max)}°）　<i class="lg lo"></i>每日最低（最冷 ${r1(min)}°）</span><span>${U.md(rows[rows.length - 1][0])}</span></div>`;
  }

  // ---------- 一個城市 ----------
  async function cityCard(box, place, trip) {
    box.innerHTML = `<div class="wx-h"><h3>${E(place.name)}</h3><span class="muted">讀取中…</span></div>`;
    let f, hist;
    try { [f, hist] = await Promise.all([forecast(place.ll), history(place.ll).catch(() => [])]); }
    catch (e) { box.innerHTML = `<div class="wx-h"><h3>${E(place.name)}</h3><span class="muted">天氣資料讀取失敗</span></div>`; return; }
    const cur = f.current, d = f.daily;
    const tripDays = new Set();
    if (trip?.startDate) for (let x = trip.startDate; x <= (trip.endDate || trip.startDate); x = U.addDays(x, 1)) tripDays.add(x);
    const inRange = d.time.some(t => tripDays.has(t));

    // 過去 3 年同期
    let same = [];
    if (trip?.startDate && hist.length) {
      const n = UI.nDays(trip) || 1;
      const lastY = +hist[hist.length - 1][0].slice(0, 4);
      for (let y = lastY; y >= lastY - 4 && same.length < 3; y--) {
        const s = y + trip.startDate.slice(4), e = U.addDays(s, n - 1);
        const rows = hist.filter(r => r[0] >= s && r[0] <= e);
        if (rows.length >= Math.min(n, 3) && rows.length === n) same.push({ y, hi: avg(rows.map(r => r[1])), lo: avg(rows.map(r => r[2])), mx: Math.max(...rows.map(r => r[1])), mn: Math.min(...rows.map(r => r[2])), rain: rows.filter(r => r[3] >= 1).length, mm: rows.reduce((s, r) => s + (r[3] || 0), 0), n });
      }
    }
    // 近 5 年同月份
    const month = trip?.startDate ? +trip.startDate.slice(5, 7) : (new Date().getMonth() + 1);
    const mrows = hist.filter(r => +r[0].slice(5, 7) === month);
    const years = new Set(mrows.map(r => r[0].slice(0, 4))).size || 1;
    const norm = mrows.length ? { hi: avg(mrows.map(r => r[1])), lo: avg(mrows.map(r => r[2])), rain: mrows.filter(r => r[3] >= 1).length / years, mm: mrows.reduce((s, r) => s + (r[3] || 0), 0) / years, years } : null;
    const recent = hist.slice(-30);
    const [txt] = W(cur.weather_code);
    const localTime = new Intl.DateTimeFormat('zh-TW', { timeZone: f.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

    box.innerHTML = `
      <div class="wx-h"><h3>${E(place.name)}</h3><span class="muted">${f._savedAt ? `離線資料（${new Date(f._savedAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 下載）　` : ''}當地 ${localTime}</span></div>
      <div class="wx-now">
        <div class="wx-now-main">${ico(cur.weather_code, 44)}<b>${r1(cur.temperature_2m)}°</b></div>
        <div class="wx-now-sub"><span>${txt}</span><span>體感 ${r1(cur.apparent_temperature)}°</span><span>濕度 ${r1(cur.relative_humidity_2m)}%</span><span>風速 ${r1(cur.wind_speed_10m)} km/h</span></div>
      </div>
      <div class="wx-sec"><div class="wx-lbl">未來 16 天${inRange ? '<em>深色為旅行日</em>' : trip?.startDate && trip.startDate > d.time[d.time.length - 1] ? `<em>出發日還在 16 天以後，請參考下方歷史資料</em>` : ''}</div>
        <div class="wx-days">${d.time.map((t, i) => `<div class="wx-day${tripDays.has(t) ? ' trip' : ''}">
          <span class="wd">${i === 0 ? '今天' : U.md(t)}</span><span class="ww">${U.weekday(t)}</span>${ico(d.weather_code[i], 20)}
          <span class="hi">${r1(d.temperature_2m_max[i])}°</span><span class="lo">${r1(d.temperature_2m_min[i])}°</span>
          <span class="pp">${d.precipitation_probability_max[i] != null ? d.precipitation_probability_max[i] + '%' : ''}</span></div>`).join('')}</div>
      </div>
      ${recent.length ? `<div class="wx-sec"><div class="wx-lbl">最近 30 天實際氣溫</div>${spark(recent)}</div>` : ''}
      ${same.length ? `<div class="wx-sec"><div class="wx-lbl">過去同期（${U.md(trip.startDate)}–${U.md(trip.endDate || trip.startDate)}）</div>
        <table class="wx-tbl"><thead><tr><th>年份</th><th>平均高溫</th><th>平均低溫</th><th>最熱／最冷</th><th>下雨天數</th></tr></thead><tbody>
        ${same.map(s => `<tr><td>${s.y}</td><td>${r1(s.hi)}°</td><td>${r1(s.lo)}°</td><td>${r1(s.mx)}°／${r1(s.mn)}°</td><td>${s.rain} / ${s.n} 天</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${norm ? `<div class="wx-sec"><div class="wx-lbl">${month} 月平均（近 ${norm.years} 年）</div>
        <div class="wx-norm"><div><b>${r1(norm.hi)}°</b><span>平均高溫</span></div><div><b>${r1(norm.lo)}°</b><span>平均低溫</span></div><div><b>${r1(norm.rain)}</b><span>雨天／月</span></div><div><b>${r1(norm.mm)}</b><span>雨量 mm／月</span></div></div></div>` : ''}`;
  }

  // ---------- 頁面 ----------
  function render(el, { trip, sub }) {
    if (sub && !trip) { el.innerHTML = `<div class="empty-box">找不到這段旅程<br><a class="btn" href="#/tool/weather">回旅途天氣</a></div>`; return; }
    const trips = S.all().filter(t => S.statusOf(t) !== 'done').sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    const recentDone = S.all().filter(t => S.statusOf(t) === 'done').sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')).slice(0, 4);
    const cur = trip || trips[0] || null;
    el.innerHTML = `<div class="narrow wide">
      <a class="back" href="${trip ? '#/trip/' + trip.id : '#/tools'}">${UI.icon('back', 16)}${trip ? E(trip.title) : '旅行工具箱'}</a>
      <header class="page-head slim"><div class="eyebrow">Weather</div><h1 class="display">旅途天氣</h1>
        <p class="lede">現在天氣、未來 16 天預報，以及最近一個月、過去同期與同月份的歷史氣溫。</p></header>
      <div class="wx-pick">
        ${[...trips, ...recentDone].map(t => `<a href="#/tool/weather/${t.id}" class="chip-x${cur && cur.id === t.id ? ' on' : ''}">${E(t.title)}</a>`).join('')}
      </div>
      <form class="wx-search"><input type="text" id="wx-q" placeholder="查詢其他城市，例如：札幌、Reykjavik"><button class="btn" type="submit">查詢</button></form>
      ${cur ? `<div class="wx-trip-h"><b>${E(cur.title)}</b><span class="muted">${UI.range(cur.startDate, cur.endDate)}</span></div>` : ''}
      <div class="wx-list"></div>
      <p class="hint">資料來源：Open-Meteo（預報每 30 分鐘、歷史資料每天更新）。歷史資料約晚 5 天。</p>
    </div>`;
    const list = U.$('.wx-list', el);
    const addCard = (place, t) => { const box = document.createElement('section'); box.className = 'wx-card'; list.appendChild(box); cityCard(box, place, t); return box; };
    if (cur) {
      const seen = new Set();
      TA.geo.placePoints(cur.countries, cur.cities, cur).forEach(p => { const k = p.ll.join(); if (!seen.has(k)) { seen.add(k); addCard(p, cur); } });
      if (!seen.size) list.innerHTML = '<p class="muted">這趟旅程還沒有可定位的城市。</p>';
    } else list.innerHTML = '<p class="muted">目前沒有安排中的旅程，可以在上方查詢任何城市。</p>';
    U.$('.wx-search', el).addEventListener('submit', async e => {
      e.preventDefault();
      const q = U.$('#wx-q', el).value.trim(); if (!q) return;
      let r = [];
      try { r = await TA.geo.search(q, []); } catch { }
      if (!r[0]) return U.toast('找不到這個城市', 'err');
      const box = addCard({ name: r[0].label || q, ll: r[0].ll }, null);
      list.prepend(box); box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const tool = TA.tools.get('weather');
  tool.status = 'ready';
  tool.render = render;
  TA.weather = { forecast, history, W, ico };
})();
