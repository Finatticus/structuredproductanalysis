/* 全站搜尋：旅程、訂位代號／航班、景點、住宿、願望清單、內容文字
 * 頂部列的放大鏡，或按「/」開啟；Enter 直接跳到第一筆 */
(function () {
  const U = TA.u, S = TA.store, E = TA.u.esc, UI = TA.ui;
  const norm = s => String(s || '').toLowerCase().replace(/臺/g, '台').replace(/\s+/g, ' ');
  const GROUPS = [['booking', '訂位'], ['trip', '旅程'], ['stop', '景點與行程'], ['hotel', '住宿'], ['wish', '願望清單'], ['text', '內容']];

  function search(q) {
    const nq = norm(q).trim();
    if (!nq) return [];
    const out = [];
    const hit = (s) => norm(s).includes(nq);
    const snippet = (text) => {
      const n = norm(text), i = n.indexOf(nq);
      if (i < 0) return '';
      const a = Math.max(0, i - 20);
      return (a ? '…' : '') + text.slice(a, i + nq.length + 40).trim() + (i + nq.length + 40 < text.length ? '…' : '');
    };
    for (const t of S.all()) {
      const base = { trip: t };
      if (hit([t.title, ...(t.countries || []), ...(t.cities || []), ...(t.tags || []), t.summary].join(' ')))
        out.push({ ...base, kind: 'trip', title: t.title, sub: `${(t.countries || []).join('、')}　${UI.range(t.startDate, t.endDate)}`, score: norm(t.title).startsWith(nq) ? 50 : 30 });
      (t.bookings || []).forEach(b => {
        const code = norm(b.code), no = norm(b.no);
        const exact = (code && code === nq) || (no && no.replace(/\s/g, '') === nq.replace(/\s/g, ''));
        const fields = [b.code, b.no, b.name, b.airline, b.from, b.to, b.company, b.place, b.addr, TA.rich.textOf(b.note)].join(' ');
        if (exact || hit(fields)) out.push({ ...base, kind: 'booking', b, title: TA.bookings.titleOf(b), sub: [b.code && `代號 ${S.codeOf(b.code)}`, TA.bookings.TYPES[b.type]?.label].filter(Boolean).join('　'), score: exact ? 100 : 40, tab: 'bk-' + b.type, jump: 'bk-' + b.id });
      });
      const hotels = new Set();
      (t.days || []).forEach((d, i) => {
        const dayLabel = `Day ${i + 1}　${UI.dot(d.date, false)}`;
        (d.stops || []).forEach(p => { if (hit(p.name + ' ' + (p.todo || ''))) out.push({ ...base, kind: 'stop', title: (p.todo ? `（${p.todo}）` : '') + p.name.replace(/[!-~]{41,}/g, '…'), sub: dayLabel + (p.time ? '　' + p.time : ''), score: 20, tab: 'plan', jump: 'day-' + d.id }); });
        if (d.title && hit(d.title)) out.push({ ...base, kind: 'stop', title: d.title, sub: dayLabel, score: 22, tab: 'plan', jump: 'day-' + d.id });
        if (d.hotel && hit(d.hotel) && !hotels.has(d.hotel)) { hotels.add(d.hotel); out.push({ ...base, kind: 'hotel', title: d.hotel, sub: dayLabel, score: 25, tab: 'plan', jump: 'day-' + d.id }); }
        (d.stops || []).forEach(p => { if (p.info && !hit(p.name)) { const it = TA.rich.textOf(p.info); if (hit(it)) out.push({ ...base, kind: 'stop', title: p.name.replace(/[!-~]{41,}/g, '…') || snippet(it), sub: dayLabel + '　介紹：' + snippet(it), score: 12, tab: 'plan', jump: 'day-' + d.id }); } });
        const txt = [TA.rich.textOf(d.notes), ...(d.blocks || []).map(b => b.title + ' ' + TA.rich.textOf(b.body))].join(' ');
        if (hit(txt)) out.push({ ...base, kind: 'text', title: snippet(txt), sub: dayLabel, score: 5, tab: 'plan', jump: 'day-' + d.id });
      });
      if (hit(TA.rich.textOf(t.intro))) out.push({ ...base, kind: 'text', title: snippet(TA.rich.textOf(t.intro)), sub: '行前備註', score: 5, tab: 'plan', jump: 'intro' });
      (t.sections || []).filter(s => S.canSee(s)).forEach(s => { const txt = s.title + ' ' + TA.rich.textOf(s.body); if (hit(txt)) out.push({ ...base, kind: 'text', title: snippet(txt), sub: `分頁「${s.title}」`, score: 6, tab: s.id }); });
    }
    for (const w of TA.wishlist?.items() || []) {
      if (hit([w.title, w.note, w.city, w.country].join(' '))) out.push({ kind: 'wish', w, title: w.title, sub: [w.city, w.country].filter(Boolean).join('，') + (w.done ? '　去過了' : ''), score: 15 });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 60);
  }

  /** 跳過去：設定要開的分頁與要捲到的位置，再換頁 */
  function go(r) {
    if (r.kind === 'wish') {
      sessionStorage.setItem('ta.wl.f', r.w.done ? 'done' : 'open');
      sessionStorage.setItem('ta.jump', 'wl-' + r.w.id);
      location.hash = '#/tool/wishlist';
      return;
    }
    if (r.tab) sessionStorage.setItem('ta.tab.' + r.trip.id, r.tab);
    if (r.jump) sessionStorage.setItem('ta.jump', r.jump);
    const target = '#/trip/' + r.trip.id;
    if (location.hash === target) TA.app.rerender(); else location.hash = target;
  }

  function open() {
    if (document.querySelector('.search-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'search-wrap';
    wrap.innerHTML = `<div class="search-box" role="dialog" aria-label="搜尋">
      <div class="search-bar">${UI.icon('search', 20)}<input type="search" id="gs-q" placeholder="搜尋旅程、景點、飯店、訂位代號、願望清單" autocomplete="off" enterkeyhint="go"><button class="icon-btn" data-close aria-label="關閉">${UI.icon('x', 18)}</button></div>
      <div class="search-res"><p class="muted gs-tip">例如：VGLPTX、BR12、清水寺、Hilton、拉麵</p></div></div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    const input = U.$('#gs-q', wrap), res = U.$('.search-res', wrap);
    let results = [];
    const close = () => { wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 150); document.removeEventListener('keydown', onKey); };
    const paint = U.debounce(() => {
      const q = input.value;
      results = search(q);
      if (!q.trim()) { res.innerHTML = '<p class="muted gs-tip">例如：VGLPTX、BR12、清水寺、Hilton、拉麵</p>'; return; }
      if (!results.length) { res.innerHTML = '<p class="muted gs-tip">找不到符合的內容</p>'; return; }
      res.innerHTML = GROUPS.filter(([k]) => results.some(r => r.kind === k)).map(([k, label]) => `<div class="gs-group"><div class="gs-gh">${label}</div>
        ${results.map((r, i) => r.kind !== k ? '' : `<button class="gs-item${i === 0 ? ' first' : ''}" data-i="${i}">
          <span class="gs-t">${k === 'booking' ? TA.bookings.ico(r.b.type, 14) : ''}${E(r.title)}</span>
          <span class="gs-s">${r.trip ? E(r.trip.title) + '　' : ''}${E(r.sub || '')}</span></button>`).join('')}</div>`).join('');
    }, 120);
    input.addEventListener('input', paint);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); close(); go(results[0]); } });
    res.addEventListener('click', e => { const b = e.target.closest('.gs-item'); if (b) { close(); go(results[+b.dataset.i]); } });
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    setTimeout(() => input.focus(), 30);
  }

  // 「/」開啟搜尋（輸入框裡打字時不觸發）
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey) return;
    const tag = document.activeElement?.tagName;
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || document.activeElement?.isContentEditable || !S.isAuthed()) return;
    e.preventDefault(); open();
  });

  window.TA = window.TA || {};
  TA.search = { open, search, go };
})();
