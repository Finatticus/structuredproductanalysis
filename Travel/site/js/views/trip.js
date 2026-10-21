/* 旅程閱讀頁 */
(function () {
  const U = TA.u, S = TA.store, E = TA.u.esc, UI = TA.ui, R = TA.rich;

  function stayList(t) {
    const out = [];
    for (const d of t.days || []) {
      if (!d.hotel) continue;
      const last = out[out.length - 1];
      if (last && last.hotel === d.hotel && U.diffDays(last.to, d.date) === 1) last.to = d.date;
      else out.push({ hotel: d.hotel, url: d.hotelUrl, from: d.date, to: d.date });
    }
    return out;
  }
  const rich = (html, path) => R.isEmpty(html) ? '' : `<div class="rich" data-path="${path}">${R.view(html)}</div>`;
  const foldHtml = (title, body, path, open) => `<div class="fold${open ? ' open' : ''}"><div class="fold-title">${E(title)}</div><div class="fold-body">${rich(body, path)}</div></div>`;

  // 沒有連結的站點，用名稱＋國家在 Google 地圖搜尋
  // 超過 40 個字元、中間沒有空白的一串（通常是殘留的網址）顯示成「…」
  const tidy = s => String(s || '').replace(/[!-~]{41,}/g, m => (m.match(/^[^,%/+]{1,20}/) || [''])[0] + '…');
  const mapQ = (name, t) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([name, (t.countries || [])[0]].filter(Boolean).join(' '));

  /** 小鉛筆：只編輯這一塊（訪客看不到） */
  const pen = (t, part, label) => TA.store.isGuest() ? '' : `<a class="ed-pen" href="#/trip/${t.id}/edit/${part}" title="${label}" aria-label="${label}">${UI.icon('edit', 14)}</a>`;
  const lockIco = s => Array.isArray(s.visibleTo) && !TA.store.isGuest() ? `<span class="tab-lock" title="${s.visibleTo.length ? '只有你和指定的訪客看得到' : '只有你看得到'}">${UI.icon('lock', 11)}</span>` : '';

  /** 站點的介紹與資訊：小視窗 */
  function stopInfo(t, dayId, stopId) {
    const di = t.days.findIndex(d => d.id === dayId), d = t.days[di];
    const p = d?.stops.find(x => x.id === stopId);
    if (!p || R.isEmpty(p.info)) return;
    const hasMap = /google\.[^/]+\/maps|maps\.app\.goo\.gl/.test(p.url || '');
    const links = [
      p.url ? `<a class="btn sm ghost" href="${E(p.url)}" target="_blank" rel="noopener">${UI.icon(hasMap ? 'map' : 'link', 14)}${hasMap ? 'Google 地圖' : '開啟連結'}</a>` : '',
      !hasMap && p.name ? `<a class="btn sm ghost" href="${E(mapQ(tidy(p.name), t))}" target="_blank" rel="noopener">${UI.icon('map', 14)}在地圖查看</a>` : '',
      S.isGuest() ? '' : `<a class="btn sm ghost" href="#/trip/${t.id}/edit/day-${d.id}" data-close>${UI.icon('edit', 14)}編輯</a>`,
    ].filter(Boolean).join('');
    const m = U.modal(`<div class="si-meta">Day ${di + 1}　${UI.dot(d.date, false)}${d.date ? '　' + UI.week(d.date) : ''}${p.time ? `<b>${E(p.time)}</b>` : ''}</div>
      <div class="rich si-body">${R.view(p.info)}</div>
      ${links ? `<div class="si-links">${links}</div>` : ''}`, { title: tidy(p.name) || '介紹與資訊' });
    m.el.classList.add('si-modal');
    m.el.addEventListener('click', e => { const ft = e.target.closest('.fold-title'); if (ft) ft.parentElement.classList.toggle('open'); });
  }

  function dayHtml(d, i, t) {
    const today = U.todayStr() === d.date;
    const stops = (d.stops || []).filter(p => p.name || p.time);
    const empty = !stops.length && R.isEmpty(d.notes) && !d.hotel && !(d.blocks || []).length;
    return `<article class="day${today ? ' today' : ''}" id="day-${d.id}">
      <div class="day-side">
        <span class="day-no">DAY ${String(i + 1).padStart(2, '0')}</span>
        <span class="day-date">${UI.dot(d.date, false)}</span>
        <span class="day-week">${UI.week(d.date)}${today ? '・今天' : ''}</span>
        ${pen(t, 'day-' + d.id, `編輯 Day ${i + 1}`)}
      </div>
      <div class="day-main">
        ${d.title ? `<h3 class="day-title">${E(d.title)}</h3>` : ''}
        ${TA.bookings.dayItems(t, d.date)}
        ${stops.length ? `<ol class="stops">${stops.map(p => `<li><span class="t">${E(p.time || '')}</span><span class="n" title="${E(p.name)}">${p.url ? `<a href="${E(p.url)}" target="_blank" rel="noopener">${E(tidy(p.name || p.url))}</a>` : E(tidy(p.name))}${p.name && !/google\.[^/]+\/maps|maps\.app\.goo\.gl/.test(p.url || '') ? `<a class="map-ic" href="${E(mapQ(tidy(p.name), t))}" target="_blank" rel="noopener" title="在 Google 地圖查看">${UI.icon('map', 13)}</a>` : ''}${R.isEmpty(p.info) ? '' : `<button type="button" class="stop-info" data-stop-info="${E(d.id)}|${E(p.id)}" title="介紹與資訊" aria-label="${E(tidy(p.name))} 的介紹與資訊">${UI.icon('info', 15)}</button>`}</span></li>`).join('')}</ol>` : ''}
        ${rich(d.notes, `days.${i}.notes`)}
        ${d.hotel ? `<div class="stay-line"><span class="lbl">住宿</span>${d.hotelUrl ? `<a href="${E(d.hotelUrl)}" target="_blank" rel="noopener">${E(d.hotel)}</a>` : E(d.hotel)}${/google\.[^/]+\/maps|maps\.app\.goo\.gl/.test(d.hotelUrl || '') ? '' : `<a class="map-ic" href="${E(mapQ(d.hotel, t))}" target="_blank" rel="noopener" title="在 Google 地圖查看">${UI.icon('map', 13)}</a>`}</div>` : ''}
        ${(d.blocks || []).map((b, j) => foldHtml(b.title || '詳細內容', b.body, `days.${i}.blocks.${j}.body`, b.open)).join('')}
        ${empty ? '<p class="muted">尚未安排</p>' : ''}
      </div>
    </article>`;
  }

  /** 找不到旅程：如果是在回收桶裡（例如舊書籤），管理者可以直接救回 */
  function missing(el, id) {
    const x = S.isGuest() ? null : S.trashed().find(t => t.id === id);
    if (!x) { el.innerHTML = `<div class="empty-box">找不到這段旅程<br><a class="btn" href="#/">回主頁</a></div>`; return; }
    el.innerHTML = `<div class="empty-box">「${E(x.title)}」在回收桶裡，${S.trashLeft(x)} 天後會永久刪除。<br>
      <a class="btn ghost" href="#/">回主頁</a> <button class="btn primary" data-restore>救回這段旅程</button></div>`;
    U.$('[data-restore]', el).onclick = () => { S.restore(id); U.toast(`已救回「${x.title}」`); TA.app.rerender(); };
  }
  (TA.views = TA.views || {}).missingTrip = missing;

  function render(el, { id }) {
    const t = S.get(id);
    if (!t) return missing(el, id);
    const st = S.statusOf(t);
    const n = UI.nDays(t);
    const left = t.startDate ? U.diffDays(U.todayStr(), t.startDate) : null;
    const stays = stayList(t);
    const secs = (t.sections || []).filter(s => !R.isEmpty(s.body) && S.canSee(s));
    // 每一種訂位各自一個分頁；名稱相符的舊分頁（例如「機票」「飯店」）合併進去，放在訂位下面
    const BK = TA.bookings;
    const bkTypes = Object.keys(BK.TYPES).filter(ty => (t.bookings || []).some(b => b.type === ty));
    const merged = new Map();
    bkTypes.forEach(ty => { const s = secs.find(x => BK.SECTION_MATCH[ty].test(x.title) && ![...merged.values()].includes(x)); if (s) merged.set(ty, s); });
    const tabs = [{ key: 'plan', label: '每日行程' }];
    bkTypes.forEach(ty => tabs.push({ key: 'bk-' + ty, label: BK.TYPES[ty].label }));
    const showStays = stays.length && !bkTypes.includes('hotel');
    if (showStays) tabs.push({ key: 'stays', label: '住宿' });
    const offRec = TA.offline.records()[t.id];
    const restSecs = secs.filter(s => ![...merged.values()].includes(s));
    restSecs.forEach(s => tabs.push({ key: s.id, label: s.title, lock: lockIco(s) }));
    let tab = sessionStorage.getItem('ta.tab.' + id) || 'plan';
    // 舊分頁 id 被合併時，跳到對應的訂位分頁
    for (const [ty, s] of merged) if (tab === s.id) tab = 'bk-' + ty;
    if (!tabs.some(x => x.key === tab)) tab = 'plan';
    const km = Math.round(TA.geo.tripKm(t));

    el.innerHTML = `
      <header class="trip-head${t.cover ? ' has-cover' : ''}"${t.cover ? ` style="--cover:url('${E(t.cover)}')"` : ''}>
        <a class="back" href="#/">${UI.icon('back', 16)}全部旅程</a>
        <div class="eyebrow">${(t.countries || []).map(c => UI.flag(c)).join('')}<span>${E((t.countries || []).join('　'))}</span></div>
        <h1 class="display">${E(t.title)}</h1>
        ${t.summary ? `<p class="lede">${E(t.summary)}</p>` : ''}
        <dl class="meta">
          <div><dt>日期</dt><dd>${UI.range(t.startDate, t.endDate)}</dd></div>
          <div><dt>天數</dt><dd>${n} 天 ${n > 1 ? n - 1 + ' 夜' : ''}</dd></div>
          ${(t.cities || []).length ? `<div><dt>城市</dt><dd>${E(t.cities.join('、'))}</dd></div>` : ''}
          ${km ? `<div><dt>移動距離</dt><dd>約 ${UI.num(km)} km</dd></div>` : ''}
          <div><dt>狀態</dt><dd><span class="status st-${st}">${S.STATUS[st]}</span>${st === 'planning' && left > 0 ? `　還有 ${left} 天` : ''}</dd></div>
        </dl>
        <div class="head-actions">
          <a class="btn primary" href="#/trip/${t.id}/edit">${UI.icon('edit', 16)}編輯</a>
          <a class="btn" href="#/tool/packing/${t.id}">${UI.icon('packing', 16)}行李與出發須知</a>
          <a class="btn" href="#/tool/wishlist/${t.id}">${UI.icon('wishlist', 16)}願望清單${TA.wishlist?.countFor(t.id) ? `　${TA.wishlist.countFor(t.id)}` : ''}</a>
          <a class="btn" href="#/tool/expense/${t.id}">${UI.icon('expense', 16)}記帳分帳</a>
          <a class="btn ghost" href="#/tool/weather/${t.id}">${UI.icon('weather', 16)}天氣</a>
          <a class="btn ghost" href="#/tool/emergency/${t.id}">${UI.icon('emergency', 16)}緊急資訊</a>
          <button class="btn ghost" data-act="print">${UI.icon('print', 16)}列印</button>
          <button class="btn ghost${offRec ? ' off-saved' : ''}" data-act="offline" title="${offRec ? `已離線下載（${new Date(offRec.at).toLocaleString('zh-TW')}），點一下更新或移除` : '存到這台裝置，沒有網路也能看'}">${UI.icon('download', 16)}離線下載${offRec ? '<i class="off-dot"></i>' : ''}</button>
        </div>
      </header>

      ${(t.facts || []).filter(f => f.label || f.value).length ? `<dl class="facts">${t.facts.filter(f => f.label || f.value).map(f => `<div><dt>${E(f.label)}</dt><dd>${E(S.isGuest() && /代號|訂位|confirmation|booking/i.test(f.label || '') ? S.maskCode(f.value) : f.value).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">連結</a>')}</dd></div>`).join('')}</dl>` : ''}

      <nav class="tabs">${tabs.map(x => `<button data-tab="${x.key}" class="${x.key === tab ? 'on' : ''}">${E(x.label)}${x.lock || ''}</button>`).join('')}</nav>

      <div class="tab-pane" data-pane="plan" ${tab !== 'plan' ? 'hidden' : ''}>
        <div class="plan">
          <aside class="day-index">
            ${R.isEmpty(t.intro) ? '' : `<a href="#" data-jump="intro" class="solo">行前備註</a>`}
            ${t.days.map((d, i) => `<a href="#" data-jump="day-${d.id}" class="${U.todayStr() === d.date ? 'today' : ''}"><b>${String(i + 1).padStart(2, '0')}</b><span>${UI.dot(d.date, false)}</span><em>${E(d.title || (d.stops || [])[0]?.name || '')}</em></a>`).join('')}
          </aside>
          <div class="days">
            ${R.isEmpty(t.intro) ? '' : `<section class="intro" id="intro"><div class="intro-lbl">行前備註${pen(t, 'intro', '編輯行前備註')}</div>${rich(t.intro, 'intro')}</section>`}
            ${t.days.length ? t.days.map((d, i) => dayHtml(d, i, t)).join('') : `<div class="empty-box">還沒有每日行程<br><a class="btn primary" href="#/trip/${t.id}/edit">開始安排</a></div>`}
          </div>
        </div>
      </div>

      ${bkTypes.map(ty => { const s = merged.get(ty); return `<div class="tab-pane" data-pane="bk-${ty}" ${tab !== 'bk-' + ty ? 'hidden' : ''}>
        <div class="pane-tools">${pen(t, 'bk-' + ty, '編輯' + BK.TYPES[ty].label)}</div>
        ${BK.viewHtml(t, ty)}
        ${s ? `<article class="sheet bk-sheet"><h2 class="sheet-title">${E(s.title)}${lockIco(s)}${pen(t, 'sec-' + s.id, '編輯「' + s.title + '」')}</h2>${rich(s.body, `sections.${t.sections.indexOf(s)}.body`)}</article>` : ''}
      </div>`; }).join('')}

      ${showStays ? `<div class="tab-pane" data-pane="stays" ${tab !== 'stays' ? 'hidden' : ''}>
        <table class="stays"><thead><tr><th>入住</th><th>退房</th><th>晚數</th><th>住宿</th></tr></thead><tbody>
        ${stays.map(s => `<tr><td>${UI.dot(s.from, false)}</td><td>${UI.dot(U.addDays(s.to, 1), false)}</td><td>${U.diffDays(s.from, s.to) + 1}</td><td>${s.url ? `<a href="${E(s.url)}" target="_blank" rel="noopener">${E(s.hotel)}</a>` : E(s.hotel)}</td></tr>`).join('')}
        </tbody></table>
      </div>` : ''}

      ${restSecs.map(s => `<div class="tab-pane" data-pane="${s.id}" ${tab !== s.id ? 'hidden' : ''}>
        <article class="sheet"><h2 class="sheet-title">${E(s.title)}${lockIco(s)}${pen(t, 'sec-' + s.id, '編輯「' + s.title + '」')}</h2>${rich(s.body, `sections.${t.sections.indexOf(s)}.body`)}</article>
      </div>`).join('')}
    `;

    el.addEventListener('click', e => {
      const tb = e.target.closest('[data-tab]');
      if (tb) {
        tab = tb.dataset.tab; sessionStorage.setItem('ta.tab.' + id, tab);
        U.$$('[data-tab]', el).forEach(b => b.classList.toggle('on', b === tb));
        U.$$('[data-pane]', el).forEach(p => (p.hidden = p.dataset.pane !== tab));
        return;
      }
      const ft = e.target.closest('.fold-title');
      if (ft) { ft.parentElement.classList.toggle('open'); return; }
      const si = e.target.closest('[data-stop-info]');
      if (si) { stopInfo(t, ...si.dataset.stopInfo.split('|')); return; }
      const cp = e.target.closest('[data-copy]');
      if (cp) {
        const v = cp.dataset.copy;
        (navigator.clipboard?.writeText(v) || Promise.reject()).then(() => U.toast(`已複製 ${v}`)).catch(() => U.toast(v));
        return;
      }
      if (e.target.closest('[data-act="offline"]')) { TA.offline.dialog(t, () => TA.app.rerender()); return; }
      const li = e.target.closest('.rich li.task');
      if (li && e.offsetX < 26 && !S.isGuest()) {
        // 勾選待辦清單：直接存回
        li.classList.toggle('done');
        const box = li.closest('.rich[data-path]');
        const keys = box.dataset.path.split('.');
        let o = t; for (let k = 0; k < keys.length - 1; k++) o = o[keys[k]];
        o[keys[keys.length - 1]] = R.sanitize(box.innerHTML.replace(/ target="_blank" rel="noopener"/g, ''));
        S.upsert(t);
        return;
      }
      const j = e.target.closest('[data-jump]');
      if (j) { e.preventDefault(); document.getElementById(j.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (e.target.closest('[data-act="print"]')) {
        U.$$('[data-pane]', el).forEach(p => (p.hidden = false));
        U.$$('.fold', el).forEach(d => d.classList.add('open'));
        setTimeout(() => window.print(), 100);
      }
    });

    const links = U.$$('.day-index a', el);
    const io = new IntersectionObserver(ents => ents.forEach(en => {
      if (en.isIntersecting) links.forEach(a => a.classList.toggle('on', a.dataset.jump === en.target.id));
    }), { rootMargin: '-30% 0px -60% 0px' });
    U.$$('.days > article, .days > section', el).forEach(a => io.observe(a));
    return () => io.disconnect();
  }

  TA.views = TA.views || {};
  TA.views.trip = render;
})();
