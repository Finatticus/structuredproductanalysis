/* 主頁：下一段旅程、旅行統計、旅程清單 */
(function () {
  const U = TA.u, S = TA.store, E = TA.u.esc, UI = TA.ui;
  let filter = sessionStorage.getItem('ta.filter') || 'all';
  let query = '';

  function nextTrip() {
    const today = U.todayStr();
    return S.all().filter(t => S.statusOf(t) !== 'done' && t.startDate && t.endDate >= today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  }

  function heroHtml() {
    const t = nextTrip();
    if (!t) return `<section class="hero empty">
      <div class="hero-main"><div class="eyebrow">下一段旅程</div><h1 class="display">還沒有安排中的旅程</h1>
      <a class="btn primary" href="#/new">${UI.icon('plus', 16)}規劃新旅程</a></div></section>`;
    const left = U.diffDays(U.todayStr(), t.startDate);
    const ongoing = left <= 0;
    return `<section class="hero"${t.cover ? ` style="--cover:url('${E(t.cover)}')"` : ''}>
      <a class="hero-main" href="#/trip/${t.id}">
        <div class="eyebrow">${ongoing ? '旅行中' : '下一段旅程'}</div>
        <h1 class="display">${E(t.title)}</h1>
        <div class="hero-meta">
          <span class="flags">${(t.countries || []).map(c => UI.flag(c)).join('')}</span>
          <span>${E((t.countries || []).join('、'))}</span><i></i>
          <span>${UI.range(t.startDate, t.endDate)}</span><i></i>
          <span>${UI.nDays(t)} 天</span>
        </div>
        <span class="link-arrow">查看行程 ${UI.icon('arrow', 16)}</span>
      </a>
      <div class="hero-count">
        ${ongoing ? `<span class="num">${U.diffDays(t.startDate, U.todayStr()) + 1}</span><span class="unit">/ ${UI.nDays(t)} 天　旅行中</span>`
        : `<span class="num">${left}</span><span class="unit">天後出發</span>`}
      </div>
    </section>`;
  }

  function statsHtml() {
    const s = TA.geo.stats(S.all(), S.profile());
    const cell = (k, n, label, sub = '') => `<button type="button" class="stat${openStat === k ? ' on' : ''}" data-stat="${k}" aria-expanded="${openStat === k}"><span class="stat-n">${n}</span><span class="stat-l">${label}</span>${sub ? `<span class="stat-s">${sub}</span>` : ''}</button>`;
    return `<section class="stats">
      ${cell('trips', s.trips, '完成的旅程')}
      ${cell('countries', s.countries, '國家與地區')}
      ${cell('cities', s.cities, '城市')}
      ${cell('days', s.days, '在外的天數', `約 ${s.months.toFixed(1)} 個月`)}
      ${cell('km', UI.num(s.km) + '<small>km</small>', '移動距離', `約繞地球 ${s.laps.toFixed(1)} 圈`)}
      ${cell('hotels', s.hotels, '住過的旅宿')}
    </section>
    <section class="stat-panel"${openStat ? '' : ' hidden'}>${openStat ? detailHtml(openStat) : ''}</section>`;
  }

  // ---------- 統計明細（點統計數字展開，再點一次收起） ----------
  let openStat = null;
  const zh = c => TA.countries.find(c)?.zh || c;
  const doneTrips = () => S.all().filter(t => S.statusOf(t) === 'done').sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  const daysOf = t => t.startDate && t.endDate ? U.diffDays(t.startDate, t.endDate) + 1 : (t.days || []).length;
  const year = t => (t.startDate || '').slice(0, 4) || '未定';
  const flags = t => (t.countries || []).map(c => UI.flag(c, 20)).join('');
  const tripRow = (t, v) => `<a class="sd-row" href="#/trip/${t.id}"><span class="sd-d">${UI.dot(t.startDate) || '—'}</span><b>${E(t.title)}</b><span class="sd-f">${flags(t)}</span><span class="sd-v">${v}</span></a>`;
  /** 橫條圖：[[標籤, 數值, 顯示文字]] */
  const bars = rows => {
    const max = Math.max(1, ...rows.map(r => r[1]));
    return `<div class="sd-bars">${rows.map(([l, v, txt]) => `<div class="sd-bar"><span class="sd-bl">${l}</span><span class="sd-bt"><i style="width:${(v / max * 100).toFixed(1)}%"></i></span><span class="sd-bv">${txt}</span></div>`).join('')}</div>`;
  };
  const byYear = fn => {
    const m = new Map();
    doneTrips().forEach(t => m.set(year(t), (m.get(year(t)) || 0) + fn(t)));
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  };

  function detailHtml(k) {
    const prof = S.profile(), extras = prof.extras || [];
    const home = prof.home ? zh(prof.home) : '';
    const trips = doneTrips();
    const head = (title, sub) => `<div class="sd-head"><h3>${title}</h3>${sub ? `<span>${sub}</span>` : ''}<button class="icon-btn" data-stat-close aria-label="收起">${UI.icon('x', 16)}</button></div>`;

    if (k === 'trips') {
      const ys = byYear(() => 1);
      return head('完成的旅程', `平均每年 ${(trips.length / Math.max(1, ys.length)).toFixed(1)} 趟`)
        + bars(ys.map(([y, n]) => [y, n, n + ' 趟']))
        + `<div class="sd-list">${trips.map(t => tripRow(t, daysOf(t) + ' 天')).join('')}</div>`;
    }
    if (k === 'countries') {
      const m = new Map();
      const add = (c, t, n = 1) => {
        const name = zh(c); if (!name || name === home) return;
        const x = m.get(name) || { name, n: 0, trips: 0, first: '9999' };
        x.n += n; if (t) { x.trips++; if (t.startDate && t.startDate < x.first) x.first = t.startDate; }
        m.set(name, x);
      };
      trips.forEach(t => (t.countries || []).forEach(c => add(c, t)));
      extras.forEach(x => x.country && add(x.country, null, Math.max(1, +x.times || 1)));
      const list = [...m.values()].sort((a, b) => b.n - a.n || a.first.localeCompare(b.first));
      return head('國家與地區', '點國家可以看去過的旅程') + `<div class="sd-grid">${list.map(x => `<button type="button" class="sd-cty" data-country="${E(x.name)}">
        ${UI.flag(x.name, 40)}<span class="sd-cn"><b>${E(x.name)}</b><small>${x.trips ? `第一次 ${x.first.slice(0, 4)}` : '手動補充'}</small></span><span class="sd-cc">${x.n}<small> 次</small></span></button>`).join('')}</div>`;
    }
    if (k === 'cities') {
      const m = new Map();
      const add = (country, city, n = 1) => { const c = country ? zh(country) : '其他'; if (!m.has(c)) m.set(c, new Map()); const cm = m.get(c); cm.set(city, (cm.get(city) || 0) + n); };
      trips.forEach(t => (t.cities || []).forEach(city => {
        add(TA.geo.countryOf(city, t, t.countries), city);
      }));
      extras.forEach(x => (x.cities || []).forEach(c => add(x.country, c, Math.max(1, +x.times || 1))));
      const groups = [...m].sort((a, b) => b[1].size - a[1].size);
      return head('城市', `分布在 ${groups.length} 個國家與地區`) + `<div class="sd-cities">${groups.map(([c, cm]) => `<div class="sd-cg"><div class="sd-cgh">${UI.flag(c, 20)}<b>${E(c)}</b><small>${cm.size}</small></div>
        <div class="sd-chips">${[...cm].sort((a, b) => b[1] - a[1]).map(([city, n]) => `<span>${E(city)}${n > 1 ? `<i>×${n}</i>` : ''}</span>`).join('')}</div></div>`).join('')}</div>`;
    }
    if (k === 'days') {
      const ys = byYear(daysOf);
      const top = trips.slice().sort((a, b) => daysOf(b) - daysOf(a)).slice(0, 8);
      const ex = extras.reduce((s, x) => s + (+x.days || 0), 0);
      return head('在外的天數', ex ? `另含手動補充的 ${ex} 天` : '每年在國外的天數')
        + bars(ys.map(([y, n]) => [y, n, n + ' 天']))
        + `<div class="sd-sub">最長的旅程</div><div class="sd-list">${top.map(t => tripRow(t, daysOf(t) + ' 天')).join('')}</div>`;
    }
    if (k === 'km') {
      const rows = trips.map(t => [t, Math.round(TA.geo.tripKm(t))]).filter(r => r[1]).sort((a, b) => b[1] - a[1]);
      const max = Math.max(1, ...rows.map(r => r[1]));
      return head('移動距離', '從台灣出發、依序經過每個城市再回來的直線距離')
        + `<div class="sd-bars">${rows.map(([t, km]) => `<a class="sd-bar" href="#/trip/${t.id}"><span class="sd-bl wide">${E(t.title)}</span><span class="sd-bt"><i style="width:${(km / max * 100).toFixed(1)}%"></i></span><span class="sd-bv">${UI.num(km)} km</span></a>`).join('')}</div>`;
    }
    if (k === 'hotels') {
      const m = new Map();
      trips.forEach(t => TA.geo.hotelStays(t).forEach(h => {
        const x = m.get(h.key) || { name: h.name, nights: 0, trips: new Map(), url: '' };
        x.nights += h.nights; x.trips.set(t.id, t); if (!x.url && h.url) x.url = h.url;
        m.set(h.key, x);
      }));
      const list = [...m.values()].sort((a, b) => b.trips.size - a.trips.size || b.nights - a.nights);
      return head('住過的旅宿', `共 ${list.reduce((s, x) => s + x.nights, 0)} 晚`) + `<div class="sd-list">${list.map(x => `<div class="sd-row sd-hotel">
        <b>${x.url ? `<a href="${E(x.url)}" target="_blank" rel="noopener">${E(x.name)}</a>` : E(x.name)}</b>
        <span class="sd-trips">${[...x.trips.values()].map(t => `<a href="#/trip/${t.id}">${E(t.title)}</a>`).join('、')}</span>
        <span class="sd-v">${x.nights ? x.nights + ' 晚' : ''}${x.trips.size > 1 ? `<small>住過 ${x.trips.size} 次</small>` : ''}</span></div>`).join('')}</div>`;
    }
    return '';
  }

  function rowHtml(t) {
    const st = S.statusOf(t);
    const left = t.startDate ? U.diffDays(U.todayStr(), t.startDate) : null;
    return `<div class="trip-row st-${st}" data-id="${t.id}">
      <a class="row-link" href="#/trip/${t.id}" aria-label="${E(t.title)}"></a>
      <div class="c-date"><b>${UI.dot(t.startDate, false) || '—'}</b><span>${t.startDate ? t.startDate.slice(0, 4) : '未定'}</span></div>
      <div class="c-title"><b>${E(t.title || '未命名旅程')}</b><span>${E((t.cities || []).join('、'))}</span></div>
      <div class="c-country">${(t.countries || []).map(c => UI.flag(c)).join('')}<span>${E((t.countries || []).join('、'))}</span></div>
      <div class="c-days">${UI.nDays(t)}<small> 天</small></div>
      <div class="c-status"><span class="status st-${st}">${S.STATUS[st]}</span>${st === 'planning' && left > 0 ? `<small>${left} 天後</small>` : ''}</div>
      <div class="c-act">
        <a class="icon-btn" href="#/trip/${t.id}/edit" title="編輯">${UI.icon('edit', 16)}</a>
        <button class="icon-btn" data-act="dup" title="複製一份">${UI.icon('copy', 16)}</button>
        <button class="icon-btn" data-act="del" title="刪除">${UI.icon('trash', 16)}</button>
      </div>
    </div>`;
  }

  function listHtml() {
    const all = S.all();
    const cnt = { all: all.length, planning: 0, done: 0 };
    all.forEach(t => (S.statusOf(t) === 'done' ? cnt.done++ : cnt.planning++));
    const q = query.trim().toLowerCase();
    let list = all.filter(t => filter === 'all' || (filter === 'done' ? S.statusOf(t) === 'done' : S.statusOf(t) !== 'done'));
    if (q) list = list.filter(t => [t.title, ...(t.countries || []), ...(t.cities || []), ...(t.tags || []), t.startDate].join(' ').toLowerCase().includes(q)
      || (t.days || []).some(d => [d.title, d.hotel, ...(d.stops || []).map(p => p.name)].join(' ').toLowerCase().includes(q)));
    list.sort((a, b) => {
      const pa = S.statusOf(a) !== 'done', pb = S.statusOf(b) !== 'done';
      if (pa !== pb) return pa ? -1 : 1;
      return pa ? (a.startDate || '9').localeCompare(b.startDate || '9') : (b.startDate || '').localeCompare(a.startDate || '');
    });
    let html = '', last = null;
    for (const t of list) {
      const g = S.statusOf(t) !== 'done' ? '安排中' : (t.startDate || '').slice(0, 4) || '未定';
      if (g !== last) { const n = list.filter(x => (S.statusOf(x) !== 'done' ? '安排中' : (x.startDate || '').slice(0, 4) || '未定') === g).length; html += `<div class="group"><span>${g}</span><small>${n} 段旅程</small></div>`; last = g; }
      html += rowHtml(t);
    }
    if (!list.length) html = `<div class="empty-box">${q ? '找不到符合的旅程' : '這裡還沒有旅程'}</div>`;
    return { html, cnt };
  }

  /** 提醒：14 天內到期的免費取消、48 小時內起飛的航班 */
  function remindersHtml() {
    const list = TA.bookings.reminders(S.all().filter(t => S.statusOf(t) !== 'done'));
    if (!list.length) return '';
    return `<section class="reminders">${list.map(r => `<a class="rem ${r.level}" href="#/trip/${r.t.id}" data-tab-open="bk-${r.b.type}">
      ${TA.bookings.ico(r.b.type, 16)}<b>${E(TA.bookings.titleOf(r.b))}</b><span>${E(r.text)}</span><em>${E(r.t.title)}</em></a>`).join('')}</section>`;
  }

  function render(el) {
    el.innerHTML = `
      <section class="world-map" aria-label="足跡地圖"></section>
      ${heroHtml()}
      ${remindersHtml()}
      ${statsHtml()}
      <section class="trips">
        <div class="sec-head">
          <h2>旅程</h2>
          <div class="tabs-text" role="tablist">
            <button data-f="all">全部<i></i></button><button data-f="planning">安排中<i></i></button><button data-f="done">已完成<i></i></button>
          </div>
          <input class="search" type="search" placeholder="搜尋國家、城市、景點、飯店" value="${E(query)}">
          <a class="btn primary" href="#/new">${UI.icon('plus', 16)}新增旅程</a>
        </div>
        <div class="list-head"><span>出發</span><span>旅程</span><span>國家</span><span>天數</span><span>狀態</span><span></span></div>
        <div class="trip-list"></div>
        ${!S.isGuest() && S.trashed().length ? `<a class="trash-link" href="#/settings">${UI.icon('trash', 14)}回收桶（${S.trashed().length}）</a>` : ''}
      </section>`;

    TA.worldMap.render(U.$('.world-map', el), {
      onCountry: name => {
        query = name; U.$('.search', el).value = name; filter = 'all'; paint();
        U.$('.trips', el).scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    const listEl = U.$('.trip-list', el);
    const paint = () => {
      const { html, cnt } = listHtml();
      listEl.innerHTML = html;
      U.$$('[data-f]', el).forEach(b => { b.classList.toggle('on', b.dataset.f === filter); U.$('i', b).textContent = cnt[b.dataset.f]; });
    };
    paint();
    U.$('.search', el).addEventListener('input', U.debounce(e => { query = e.target.value; paint(); }, 150));
    const panel = U.$('.stat-panel', el);
    const showStat = k => {
      openStat = openStat === k ? null : k;
      U.$$('.stat', el).forEach(b => { b.classList.toggle('on', b.dataset.stat === openStat); b.setAttribute('aria-expanded', b.dataset.stat === openStat); });
      panel.innerHTML = openStat ? detailHtml(openStat) : '';
      panel.hidden = !openStat;
      if (openStat) { panel.classList.remove('in'); void panel.offsetWidth; panel.classList.add('in'); }
    };
    el.addEventListener('click', async e => {
      if (e.target.closest('.trash-link')) sessionStorage.setItem('ta.goto', 'trash');
      const sb = e.target.closest('[data-stat]'); if (sb) return showStat(sb.dataset.stat);
      if (e.target.closest('[data-stat-close]')) return showStat(openStat);
      const cty = e.target.closest('[data-country]');
      if (cty) { query = cty.dataset.country; U.$('.search', el).value = query; filter = 'all'; paint(); U.$('.trips', el).scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const rem = e.target.closest('[data-tab-open]');
      if (rem) sessionStorage.setItem('ta.tab.' + rem.getAttribute('href').split('/').pop(), rem.dataset.tabOpen);
      const f = e.target.closest('[data-f]');
      if (f) { filter = f.dataset.f; sessionStorage.setItem('ta.filter', filter); paint(); return; }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'footprint') return TA.views.footprintDialog(() => TA.app.rerender());
      const t = S.get(act.closest('.trip-row')?.dataset.id);
      if (!t) return;
      e.preventDefault();
      if (act.dataset.act === 'del') {
        if (await TA.confirmDeleteTrip(t)) { S.trash(t.id); U.toast(`已移到回收桶，${S.TRASH_DAYS} 天內可在設定救回`); TA.app.rerender(); }
      } else if (act.dataset.act === 'dup') {
        const c = U.clone(t);
        c.id = U.uid('t'); c.title += '（複本）'; c.status = 'auto'; c.createdAt = new Date().toISOString();
        S.upsert(c); U.toast('已複製'); TA.app.rerender();
      }
    });
  }

  TA.views = TA.views || {};
  TA.views.home = render;
})();
