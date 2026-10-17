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
    const cell = (n, label, sub = '') => `<div class="stat"><span class="stat-n">${n}</span><span class="stat-l">${label}</span>${sub ? `<span class="stat-s">${sub}</span>` : ''}</div>`;
    return `<section class="stats">
      ${cell(s.trips, '完成的旅程')}
      ${cell(s.countries, '國家與地區')}
      ${cell(s.cities, '城市')}
      ${cell(s.days, '在外的天數', `約 ${s.months.toFixed(1)} 個月`)}
      ${cell(UI.num(s.km) + '<small>km</small>', '移動距離', `約繞地球 ${s.laps.toFixed(1)} 圈`)}
      ${cell(s.hotels, '住過的旅宿')}
    </section>`;
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

  function render(el) {
    el.innerHTML = `
      <section class="world-map" aria-label="足跡地圖"></section>
      ${heroHtml()}
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
    el.addEventListener('click', async e => {
      const f = e.target.closest('[data-f]');
      if (f) { filter = f.dataset.f; sessionStorage.setItem('ta.filter', filter); paint(); return; }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'footprint') return TA.views.footprintDialog(() => TA.app.rerender());
      const t = S.get(act.closest('.trip-row')?.dataset.id);
      if (!t) return;
      e.preventDefault();
      if (act.dataset.act === 'del') {
        if (await U.confirm(`確定刪除「${t.title}」？刪除後無法復原。`, { ok: '刪除', danger: true })) { S.remove(t.id); U.toast('已刪除'); TA.app.rerender(); }
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
