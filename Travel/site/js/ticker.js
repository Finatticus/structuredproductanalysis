/* 匯率 & 時差：依「行程清單中出現過的國家」自動產生
 * 匯率來源：open.er-api.com（免金鑰，每日更新），快取 6 小時 */
(function () {
  const RATE_KEY = 'ta.rates.v1';
  const TTL = 6 * 3600 * 1000;

  function tzOffsetMin(tz, d = new Date()) {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUTC - d.getTime()) / 60000);
  }
  const fmtTime = (tz, d = new Date()) => new Intl.DateTimeFormat('zh-TW', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  const fmtDiff = min => {
    if (!min) return '同時區';
    const h = Math.abs(min) / 60;
    return `${min > 0 ? '+' : '−'}${Number.isInteger(h) ? h : h.toFixed(1)}h`;
  };
  const fmtDiffLong = min => {
    if (!min) return '與台北同時區';
    const h = Math.abs(min) / 60;
    return `${min > 0 ? '快' : '慢'} ${Number.isInteger(h) ? h : h.toFixed(1)} 小時`;
  };

  /** 行程中出現的國家（去重，依最近一次旅行排序，安排中的在前） */
  function places() {
    const S = TA.store, home = S.settings().homeTz;
    const seen = new Map();
    const trips = S.all().slice().sort((a, b) => {
      const pa = S.statusOf(a) !== 'done', pb = S.statusOf(b) !== 'done';
      if (pa !== pb) return pa ? -1 : 1;
      return (b.startDate || '').localeCompare(a.startDate || '');
    });
    for (const t of trips) for (const name of t.countries || []) {
      const c = TA.countries.find(name);
      const key = c ? c.zh : name;
      if (seen.has(key)) continue;
      const tz = c ? TA.countries.tzFor(c, t.cities) : null;
      seen.set(key, { name: key, c, tz, cur: c?.cur, upcoming: S.statusOf(t) !== 'done', home });
    }
    return [...seen.values()];
  }

  let rates = null;
  async function loadRates(force) {
    const base = TA.store.settings().baseCurrency || 'TWD';
    try {
      const cached = JSON.parse(localStorage.getItem(RATE_KEY) || 'null');
      if (!force && cached && cached.base === base && Date.now() - cached.at < TTL) return (rates = cached);
    } catch { }
    try {
      const r = await fetch(`https://open.er-api.com/v6/latest/${base}`);
      const j = await r.json();
      if (j.result !== 'success') throw new Error('rate api');
      rates = { base, at: Date.now(), updated: j.time_last_update_utc, rates: j.rates };
      localStorage.setItem(RATE_KEY, JSON.stringify(rates));
    } catch (e) {
      console.warn('匯率取得失敗', e);
      try { rates = JSON.parse(localStorage.getItem(RATE_KEY) || 'null'); } catch { }
    }
    return rates;
  }

  /** 1 單位外幣 = ? 本國幣，並挑合適的單位 */
  function rateOf(cur) {
    if (!rates || !cur) return null;
    if (cur === rates.base) return null;
    const r = rates.rates[cur];
    if (!r) return null;
    const v = 1 / r;
    const unit = v < 0.01 ? 1000 : v < 0.1 ? 100 : 1;
    const val = v * unit;
    return { unit, val, text: val >= 100 ? val.toFixed(1) : val >= 10 ? val.toFixed(2) : val.toFixed(3) };
  }

  function itemHtml(p) {
    const E = TA.u.esc;
    const flag = p.c ? `<img class="flag" src="${TA.countries.flagUrl(p.c, 40)}" alt="">` : '';
    let t = '';
    if (p.tz) t = `<span class="tk-time" data-tz="${p.tz}">${fmtTime(p.tz)}</span><span class="tk-diff">${fmtDiff(tzOffsetMin(p.tz) - tzOffsetMin(p.home))}</span>`;
    const r = rateOf(p.cur);
    const rt = r ? `<span class="tk-rate">${r.unit > 1 ? r.unit + ' ' : ''}${p.cur} ${r.text}</span>` : '';
    return `<span class="tk-item${p.upcoming ? ' up' : ''}">${flag}<b>${E(p.name)}</b>${t}${rt}</span>`;
  }

  function renderMarquee(el) {
    const list = places();
    if (!list.length) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    const key = list.map(p => p.name + p.tz).join() + '|' + (rates?.at || '');
    if (el.dataset.key === key) return tick();
    el.dataset.key = key;
    const inner = list.map(itemHtml).join('');
    el.innerHTML = `<div class="tk-track" style="--dur:${Math.max(40, list.length * 7)}s"><div class="tk-seg">${inner}</div><div class="tk-seg" aria-hidden="true">${inner}</div></div>`;
  }

  /** 世界時鐘與匯率頁 */
  function renderBoard(el) {
    const E = TA.u.esc, list = places();
    const base = rates?.base || TA.store.settings().baseCurrency;
    if (!list.length) { el.innerHTML = '<p class="muted">尚無國家資料</p>'; return; }
    el.innerHTML = `<div class="wb-head"><span>國家／地區</span><span>當地時間</span><span>時差</span><span>貨幣</span><span>匯率（兌 ${base}）</span></div>` + list.map(p => {
      const r = rateOf(p.cur);
      const diff = p.tz ? tzOffsetMin(p.tz) - tzOffsetMin(p.home) : null;
      const date = p.tz ? new Intl.DateTimeFormat('zh-TW', { timeZone: p.tz, month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date()) : '';
      return `<div class="wb-row${p.upcoming ? ' up' : ''}">
        <span class="wb-c">${p.c ? `<img class="flag" src="${TA.countries.flagUrl(p.c, 80)}" alt="">` : ''}<b>${E(p.name)}</b>${p.upcoming ? '<em>即將前往</em>' : ''}</span>
        <span class="wb-t"><b>${p.tz ? fmtTime(p.tz) : '--:--'}</b><small>${date}</small></span>
        <span class="wb-d">${diff === null ? '—' : fmtDiffLong(diff)}</span>
        <span class="wb-cur">${p.cur ? `${p.cur}<small>${TA.countries.curName(p.cur)}</small>` : '—'}</span>
        <span class="wb-r">${r ? `${r.unit > 1 ? r.unit : 1} ${p.cur} = <b>${r.text}</b> ${base}` : p.cur === base ? '本國貨幣' : p.cur ? '載入中' : '—'}</span>
      </div>`;
    }).join('') + `<p class="wb-note">匯率更新於 ${rates?.updated ? new Date(rates.updated).toLocaleString('zh-TW') : '—'}，僅供參考。</p>`;
  }

  /** 只更新時間文字，不重設跑馬燈動畫 */
  function tick() { document.querySelectorAll('#ticker [data-tz]').forEach(n => (n.textContent = fmtTime(n.dataset.tz))); }

  window.TA = window.TA || {};
  TA.ticker = { rateOf, rates: () => rates, tick, loadRates, renderMarquee, renderBoard, places, tzOffsetMin, fmtTime };
})();
