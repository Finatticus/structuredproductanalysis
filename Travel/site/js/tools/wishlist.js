/* 旅行工具箱：願望清單
 * #/tool/wishlist            全部願望（通用 bucket list ＋ 已連結旅程的）
 * #/tool/wishlist/<tripId>   這趟旅程的願望：可從同國家的願望加入、排進某一天的行程
 * 資料存在雲端紀錄 __wishlist：{ items: [...] }
 * 項目：{ id, title, type, url, mapUrl, ll, country, city, note, stars, tripId, dayId, done, createdAt } */
(function () {
  const U = TA.u, S = TA.store, E = TA.u.esc, UI = TA.ui;
  const REC_ID = '__wishlist';
  const TYPES = { sight: '景點', food: '美食', activity: '活動', shop: '購物', stay: '住宿', other: '其他' };

  const items = () => U.clone(S.record(REC_ID)?.items || []);
  const saveItems = list => S.saveRecord(REC_ID, 'wishlist', '願望清單（非旅程）', { items: list });
  const update = fn => { const list = items(); fn(list); saveItems(list); return list; };

  /** 解析 Google 地圖網址：地點名稱與座標 */
  function parseMaps(url) {
    try {
      const u = new URL(url);
      const isMaps = /(^|\.)google\.[a-z.]+$/.test(u.hostname) && /\/maps|^maps\./.test(u.pathname + ' ' + u.hostname) || /^(maps\.app\.goo\.gl|goo\.gl)$/.test(u.hostname);
      if (!isMaps) return null;
      let name = '';
      const m = u.pathname.match(/\/place\/([^/]+)/);
      if (m) name = decodeURIComponent(m[1].replace(/\+/g, ' '));
      if (!name) name = u.searchParams.get('q') || u.searchParams.get('query') || '';
      const d = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || (u.searchParams.get('q') || '').match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/);
      return { name, ll: d ? [Math.round(+d[1] * 1e4) / 1e4, Math.round(+d[2] * 1e4) / 1e4] : null, short: /goo\.gl$/.test(u.hostname) };
    } catch { return null; }
  }
  /** 用 Apps Script 抓網頁標題、展開短網址（需更新 Code.gs；沒有也能用） */
  async function linkMeta(url) {
    try { const r = await S.call('meta', { url }); return r; } catch { return null; }
  }
  const mapsSearch = (q) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  const mapLink = x => x.mapUrl || (x.ll ? mapsSearch(x.ll.join(',')) : mapsSearch([x.title, x.city, x.country].filter(Boolean).join(' ')));

  // ---------- 新增／編輯 ----------
  function editDialog(item = {}, { tripId, onSaved } = {}) {
    const isNew = !item.id;
    const x = { type: 'sight', stars: 2, ...item };
    if (isNew && tripId) x.tripId = tripId;
    const trips = S.all().slice().sort((a, b) => {
      const pa = S.statusOf(a) !== 'done', pb = S.statusOf(b) !== 'done';
      if (pa !== pb) return pa ? -1 : 1;
      return (b.startDate || '').localeCompare(a.startDate || '');
    });
    const m = U.modal(`
      <datalist id="dl-w-countries">${TA.countries.list.map(c => `<option value="${c.zh}">`).join('')}</datalist>
      <label class="fld"><span>網址或 Google 地圖連結 <em class="hint">貼上後會自動帶入名稱與地點</em></span>
        <input type="url" id="w-url" value="${E(x.mapUrl || x.url || '')}" placeholder="https://"></label>
      <p class="hint w-status"></p>
      <label class="fld"><span>名稱</span><input type="text" id="w-title" value="${E(x.title || '')}" placeholder="例如：吉卜力美術館、晚上看極光、某家拉麵店"></label>
      <div class="row3">
        <label class="fld"><span>類型</span><select id="w-type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${x.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="fld"><span>國家</span><input type="text" id="w-country" list="dl-w-countries" value="${E(x.country || '')}"></label>
        <label class="fld"><span>城市</span><input type="text" id="w-city" value="${E(x.city || '')}"></label>
      </div>
      <div class="row2">
        <label class="fld"><span>連結到旅程</span><select id="w-trip"><option value="">不指定（通用願望清單）</option>
          ${trips.map(t => `<option value="${t.id}" ${x.tripId === t.id ? 'selected' : ''}>${E(t.title)}（${(t.startDate || '').slice(0, 7).replace('-', '/')}）</option>`).join('')}</select></label>
        <div class="fld"><span>想去程度</span><div class="stars" id="w-stars">${[1, 2, 3].map(n => `<button type="button" data-n="${n}" class="${n <= x.stars ? 'on' : ''}" aria-label="${n} 顆星">★</button>`).join('')}</div></div>
      </div>
      <label class="fld"><span>備註</span><textarea id="w-note" rows="4" placeholder="營業時間、要預約、推薦菜色、誰推薦的……">${E(x.note || '')}</textarea></label>
      <label class="mini-check"><input type="checkbox" id="w-done" ${x.done ? 'checked' : ''}>已經去過／完成了</label>
      <div class="modal-actions">${isNew ? '' : '<button class="btn danger" id="w-del">刪除</button><span style="flex:1"></span>'}
        <button class="btn ghost" data-close>取消</button><button class="btn primary" id="w-save">儲存</button></div>
    `, { title: isNew ? '新增願望' : '編輯願望', wide: true });
    const $ = sel => U.$(sel, m.el);
    const status = $('.w-status');
    let ll = x.ll || null, url = x.url || '', mapUrl = x.mapUrl || '';
    let stars = x.stars;
    $('#w-stars').onclick = e => { const b = e.target.closest('[data-n]'); if (!b) return; stars = +b.dataset.n; U.$$('#w-stars button', m.el).forEach(s => s.classList.toggle('on', +s.dataset.n <= stars)); };

    async function fillFrom(raw) {
      raw = raw.trim(); if (!raw) return;
      if (!/^https?:\/\//.test(raw)) raw = 'https://' + raw;
      let pm = parseMaps(raw);
      if (pm) {
        mapUrl = raw; url = '';
        if (pm.short || !pm.ll) {
          status.textContent = '正在讀取地圖連結…';
          const meta = await linkMeta(raw);
          if (meta?.url) { const p2 = parseMaps(meta.url); if (p2) pm = { ...p2, name: p2.name || pm.name }; }
          if (!pm.name && meta?.title) pm.name = meta.title.replace(/\s*[-–·]\s*Google\s*(地圖|Maps).*$/i, '');
        }
        if (pm.name && !$('#w-title').value.trim()) $('#w-title').value = pm.name;
        if (pm.ll) {
          ll = pm.ll;
          status.textContent = '已取得地點座標，正在查詢所在城市…';
          try {
            const r = await TA.geo.reverse(ll);
            if (r.country && !$('#w-country').value.trim()) $('#w-country').value = r.country;
            if (r.city && !$('#w-city').value.trim()) $('#w-city').value = r.city;
          } catch { }
          status.textContent = `已定位（${ll.join(', ')}）`;
        } else status.textContent = pm.short ? '短網址需要更新 Apps Script 後才能自動讀取，請手動填寫名稱與地點。' : '';
      } else {
        url = raw; mapUrl = '';
        if (!$('#w-title').value.trim()) {
          status.textContent = '正在讀取網頁標題…';
          const meta = await linkMeta(raw);
          if (meta?.title) { $('#w-title').value = meta.title.trim(); status.textContent = ''; }
          else status.textContent = '';
        }
      }
    }
    $('#w-url').addEventListener('change', e => fillFrom(e.target.value));
    $('#w-url').addEventListener('paste', () => setTimeout(() => fillFrom($('#w-url').value), 0));

    $('#w-save').onclick = () => {
      const title = $('#w-title').value.trim();
      if (!title) { $('#w-title').focus(); return U.toast('請填寫名稱', 'err'); }
      const raw = $('#w-url').value.trim();
      if (raw && !url && !mapUrl) { if (parseMaps(raw)) mapUrl = raw; else url = raw; }
      if (!raw) { url = ''; mapUrl = ''; }
      const tripSel = $('#w-trip').value;
      const data = {
        ...x, title, type: $('#w-type').value, url, mapUrl, ll,
        country: $('#w-country').value.trim(), city: $('#w-city').value.trim(), note: $('#w-note').value.trim(),
        stars, tripId: tripSel || null, done: $('#w-done').checked, updatedAt: new Date().toISOString(),
      };
      if (data.tripId !== x.tripId) data.dayId = null;
      if (isNew) { data.id = U.uid('w'); data.createdAt = data.updatedAt; }
      update(list => { const i = list.findIndex(w => w.id === data.id); if (i >= 0) list[i] = data; else list.unshift(data); });
      m.close(); U.toast(isNew ? '已加入願望清單' : '已儲存'); onSaved && onSaved();
    };
    if (!isNew) $('#w-del').onclick = async () => {
      if (!(await U.confirm(`刪除「${x.title}」？`, { ok: '刪除', danger: true }))) return;
      update(list => list.splice(list.findIndex(w => w.id === x.id), 1));
      m.close(); onSaved && onSaved();
    };
    setTimeout(() => $(isNew ? '#w-url' : '#w-title').focus(), 50);
  }

  // ---------- 單一項目 ----------
  function itemHtml(x, { trip } = {}) {
    const t = x.tripId ? S.get(x.tripId) : null;
    const day = t && x.dayId ? t.days.findIndex(d => d.id === x.dayId) : -1;
    const link = x.url || x.mapUrl;
    return `<div class="wl-item${x.done ? ' done' : ''}" data-id="${x.id}" id="wl-${x.id}">
      <button class="pk-cb" data-act="done" title="標記去過／完成" aria-label="完成"></button>
      <div class="wl-main">
        <div class="wl-top"><span class="wl-type">${TYPES[x.type] || '其他'}</span>${'★'.repeat(x.stars || 0) ? `<span class="wl-stars">${'★'.repeat(x.stars)}</span>` : ''}
          <b class="wl-title">${link ? `<a href="${E(link)}" target="_blank" rel="noopener">${E(x.title)}</a>` : E(x.title)}</b></div>
        ${x.note ? `<p class="wl-note">${E(x.note).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">連結</a>')}</p>` : ''}
        <div class="wl-meta">
          ${x.city || x.country ? `<span>${E([x.city, x.country].filter(Boolean).join('，'))}</span>` : ''}
          <a href="${E(mapLink(x))}" target="_blank" rel="noopener">${UI.icon('map', 14)}地圖</a>
          ${!trip && t ? `<a href="#/tool/wishlist/${t.id}" class="wl-trip">${E(t.title)}</a>` : ''}
          ${trip ? (day >= 0 ? `<span class="wl-day">已排入 Day ${day + 1}</span>` : `<select class="wl-sched" title="排進某一天的行程"><option value="">排入行程…</option>${trip.days.map((d, i) => `<option value="${d.id}">Day ${i + 1}　${UI.dot(d.date, false)}${d.title ? '　' + E(d.title) : ''}</option>`).join('')}</select>`) : ''}
        </div>
      </div>
      <div class="wl-act">
        ${trip ? `<button class="icon-btn" data-act="unlink" title="從這趟移除（保留在願望清單）">${UI.icon('x', 14)}</button>` : ''}
        <button class="icon-btn" data-act="edit" title="編輯">${UI.icon('edit', 16)}</button>
      </div>
    </div>`;
  }

  // ---------- 全部願望 ----------
  function renderAll(el) {
    let f = sessionStorage.getItem('ta.wl.f') || 'open', type = '', q = '';
    function paint() {
      const all = items();
      const cnt = { open: all.filter(x => !x.done).length, general: all.filter(x => !x.tripId && !x.done).length, linked: all.filter(x => x.tripId && !x.done).length, done: all.filter(x => x.done).length };
      let list = all.filter(x => f === 'done' ? x.done : !x.done && (f === 'open' || (f === 'general' ? !x.tripId : !!x.tripId)));
      if (type) list = list.filter(x => x.type === type);
      if (q) list = list.filter(x => [x.title, x.note, x.city, x.country].join(' ').toLowerCase().includes(q.toLowerCase()));
      const groups = new Map();
      list.sort((a, b) => (b.stars || 0) - (a.stars || 0)).forEach(x => { const k = x.country || '未指定國家'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); });
      const keys = [...groups.keys()].sort((a, b) => a === '未指定國家' ? 1 : b === '未指定國家' ? -1 : groups.get(b).length - groups.get(a).length);
      el.innerHTML = `<div class="narrow wide">
        <a class="back" href="#/tools">${UI.icon('back', 16)}旅行工具箱</a>
        <header class="page-head"><div class="eyebrow">Wishlist</div><h1 class="display">願望清單</h1>
          <p class="lede">想去的地方、想吃的店、想做的事都先收在這裡；排行程時再拉進某一趟、某一天。</p></header>
        <form class="wl-quick"><input type="text" id="wl-q" placeholder="貼上網址或 Google 地圖連結，或直接輸入想去的地方"><button class="btn primary" type="submit">${UI.icon('plus', 16)}新增</button></form>
        <div class="wl-filters">
          <div class="tabs-text">${[['open', '全部'], ['general', '還沒排'], ['linked', '已連結旅程'], ['done', '去過了']].map(([k, l]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l}<i>${cnt[k]}</i></button>`).join('')}</div>
          <select id="wl-type"><option value="">所有類型</option>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <input type="search" id="wl-search" placeholder="搜尋" value="${E(q)}">
        </div>
        ${keys.length ? keys.map(k => `<section class="wl-group"><div class="pk-gh">${k !== '未指定國家' ? UI.flag(k) : ''}<span>${E(k)}</span><small>${groups.get(k).length}</small></div>
          ${groups.get(k).map(x => itemHtml(x)).join('')}</section>`).join('')
        : `<div class="empty-box">${all.length ? '沒有符合的項目' : '還沒有任何願望。看到想去的地方，貼上連結就能收藏。'}</div>`}
      </div>`;
    }
    paint();
    el.addEventListener('submit', e => {
      if (!e.target.classList.contains('wl-quick')) return;
      e.preventDefault();
      const v = U.$('#wl-q', el).value.trim();
      const isUrl = /^https?:\/\/|^[\w-]+\.[a-z]{2,}\//i.test(v);
      editDialog(isUrl ? { url: v } : { title: v }, { onSaved: paint });
      if (isUrl) setTimeout(() => { const i = document.querySelector('#w-url'); if (i) i.dispatchEvent(new Event('change')); }, 80);
    });
    el.addEventListener('change', e => {
      if (e.target.id === 'wl-type') { type = e.target.value; paint(); }
    });
    el.addEventListener('input', U.debounce(e => { if (e.target.id === 'wl-search') { q = e.target.value; paint(); const i = U.$('#wl-search', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250));
    el.addEventListener('click', e => {
      const fb = e.target.closest('[data-f]'); if (fb) { f = fb.dataset.f; sessionStorage.setItem('ta.wl.f', f); paint(); return; }
      handleItemClick(e, paint);
    });
  }

  function handleItemClick(e, paint, trip) {
    const a = e.target.closest('[data-act]'); if (!a) return false;
    const id = a.closest('.wl-item')?.dataset.id; if (!id) return false;
    const x = items().find(w => w.id === id);
    switch (a.dataset.act) {
      case 'done': update(list => { const w = list.find(i => i.id === id); w.done = !w.done; w.updatedAt = new Date().toISOString(); }); paint(); return true;
      case 'edit': editDialog(x, { onSaved: paint }); return true;
      case 'unlink': update(list => { const w = list.find(i => i.id === id); w.tripId = null; w.dayId = null; }); paint(); U.toast('已移回通用願望清單'); return true;
    }
    return false;
  }

  // ---------- 這趟旅程的願望 ----------
  function renderTrip(el, trip) {
    function paint() {
      const all = items();
      const mine = all.filter(x => x.tripId === trip.id);
      const tripCountries = new Set((trip.countries || []).map(c => TA.countries.find(c)?.zh || c));
      const suggest = all.filter(x => !x.tripId && !x.done && tripCountries.has(TA.countries.find(x.country)?.zh || x.country));
      el.innerHTML = `<div class="narrow wide">
        <a class="back" href="#/trip/${trip.id}">${UI.icon('back', 16)}${E(trip.title)}</a>
        <header class="page-head slim"><div class="eyebrow">Wishlist</div><h1 class="display">這趟的願望清單</h1>
          <p class="lede">${E(trip.title)}　${UI.range(trip.startDate, trip.endDate)}</p>
          <div class="add-row"><button class="btn primary" data-act="add">${UI.icon('plus', 16)}新增願望</button><a class="btn ghost" href="#/tool/wishlist">全部願望清單</a></div></header>
        ${mine.length ? mine.map(x => itemHtml(x, { trip })).join('') : '<div class="empty-box">這趟還沒有願望。可以直接新增，或從下方同國家的願望加入。</div>'}
        ${suggest.length ? `<section class="wl-suggest"><div class="pk-gh"><span>同國家的其他願望</span><small>${suggest.length}</small></div>
          ${suggest.map(x => `<div class="wl-item sug" data-id="${x.id}"><div class="wl-main"><div class="wl-top"><span class="wl-type">${TYPES[x.type] || '其他'}</span><b class="wl-title">${E(x.title)}</b></div>
            <div class="wl-meta"><span>${E([x.city, x.country].filter(Boolean).join('，'))}</span></div></div>
            <div class="wl-act"><button class="btn sm" data-act="link">加入這趟</button></div></div>`).join('')}</section>` : ''}
      </div>`;
    }
    paint();
    el.addEventListener('change', e => {
      if (!e.target.classList.contains('wl-sched') || !e.target.value) return;
      const id = e.target.closest('.wl-item').dataset.id;
      const x = items().find(w => w.id === id);
      const day = trip.days.find(d => d.id === e.target.value);
      day.stops = day.stops || [];
      day.stops.push({ id: U.uid('p'), time: '', name: x.title, url: x.mapUrl || x.url || '' });
      if (x.note) day.notes = (day.notes || '') + `<p><strong>${E(x.title)}</strong>：${E(x.note).replace(/\n/g, '<br>')}</p>`;
      S.upsert(trip);
      update(list => { const w = list.find(i => i.id === id); w.dayId = day.id; });
      U.toast(`已排入 Day ${trip.days.indexOf(day) + 1}`); paint();
    });
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'add') return editDialog({}, { tripId: trip.id, onSaved: paint });
      if (a.dataset.act === 'link') {
        const id = a.closest('.wl-item').dataset.id;
        update(list => { const w = list.find(i => i.id === id); w.tripId = trip.id; });
        paint(); return;
      }
      handleItemClick(e, paint, trip);
    });
  }

  const tool = TA.tools.get('wishlist');
  tool.status = 'ready';
  tool.render = (el, { trip, sub }) => {
    if (trip) return renderTrip(el, trip);
    if (sub) { el.innerHTML = `<div class="empty-box">找不到這段旅程<br><a class="btn" href="#/tool/wishlist">回願望清單</a></div>`; return; }
    return renderAll(el);
  };
  TA.wishlist = { items, editDialog, countFor: id => items().filter(x => x.tripId === id).length, mapsSearch };
})();
