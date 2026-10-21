/* 訂位與交通（結構化欄位）
 * trip.bookings = [{ id, type, ...欄位 }]
 * type：flight 機票、hotel 住宿、train 火車／巴士／船、car 租車、ticket 門票／活動／餐廳
 * 共用欄位：code 訂位代號、cancelBy 免費取消期限、price 金額、url 連結、note 備註 */
(function () {
  const U = TA.u, E = TA.u.esc, UI = TA.ui;

  const F = (k, label, type = 'text', opt = {}) => ({ k, label, type, ...opt });
  const COMMON = [F('code', '訂位代號'), F('cancelBy', '免費取消期限', 'datetime-local'), F('price', '金額', 'text', { ph: '例如：NT$ 12,000' }),
    F('url', '連結（訂單或官網）', 'url', { wide: true }), F('note', '備註與附件（可貼上機票、訂房確認信截圖）', 'rich', { wide: true })];
  const TYPES = {
    flight: { label: '機票', icon: 'flight', fields: [F('no', '航班編號', 'text', { ph: '例如：BR12', upper: true }), F('airline', '航空公司', 'text', { ph: '例如：長榮航空' }),
      F('from', '出發機場', 'text', { ph: '例如：TPE 桃園' }), F('to', '抵達機場', 'text', { ph: '例如：LAX 洛杉磯' }),
      F('dep', '起飛時間（當地）', 'datetime-local'), F('arr', '抵達時間（當地）', 'datetime-local'),
      F('seat', '座位／艙等', 'text', { ph: '例如：2A 商務艙' }), F('bag', '行李額度', 'text', { ph: '例如：託運 2 件 23kg' }), ...COMMON] },
    hotel: { label: '住宿', icon: 'bed', fields: [F('name', '飯店名稱', 'text', { wide: true }), F('addr', '地址', 'text', { wide: true }),
      F('checkin', '入住日期', 'date'), F('checkinTime', '入住時間', 'time'), F('checkout', '退房日期', 'date'), F('checkoutTime', '退房時間', 'time'),
      F('paid', '付款', 'select', { options: ['', '已付款', '到店付款', '未付款'] }), F('phone', '飯店電話'), ...COMMON] },
    train: { label: '交通', icon: 'train', fields: [F('kind', '種類', 'select', { options: ['火車', '高鐵', '巴士', '船', '其他'] }), F('no', '車次／班次'),
      F('from', '出發站'), F('to', '抵達站'), F('dep', '出發時間', 'datetime-local'), F('arr', '抵達時間', 'datetime-local'), F('seat', '座位／車廂'), ...COMMON] },
    car: { label: '租車', icon: 'car', fields: [F('company', '租車公司'), F('car', '車型'),
      F('pickupPlace', '取車地點', 'text', { wide: true }), F('pickup', '取車時間', 'datetime-local'),
      F('dropoffPlace', '還車地點', 'text', { wide: true }), F('dropoff', '還車時間', 'datetime-local'), ...COMMON] },
    ticket: { label: '門票／活動', icon: 'ticket', fields: [F('name', '名稱', 'text', { wide: true, ph: '例如：KA 秀、吉卜力美術館、餐廳訂位' }),
      F('when', '日期時間', 'datetime-local'), F('place', '地點'), F('people', '人數'), ...COMMON] },
  };
  const ICON = {
    flight: '<path d="M10.5 13.5L4 11l1-1.5 7 1 4-4.5c.8-.8 2.2-.8 2.7 0 .5.6.4 1.5-.3 2.1l-4.5 4 1 7L13.5 21l-2.5-6.5-3 2.7v2.3L6.5 21 5 18l-3-1.5 1.5-1.5h2.3z"/>',
    bed: '<path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.5"/>',
    train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M9 21l1.5-4M15 21l-1.5-4"/><circle cx="9" cy="14" r=".8"/><circle cx="15" cy="14" r=".8"/>',
    car: '<path d="M5 16l1.5-5a2 2 0 0 1 2-1.5h7a2 2 0 0 1 2 1.5L19 16M4 16h16v3H4z"/><circle cx="7.5" cy="19" r="1.2"/><circle cx="16.5" cy="19" r="1.2"/>',
    ticket: '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 5v12" stroke-dasharray="2 2"/>',
  };
  const ico = (type, s = 16) => `<svg class="ico" viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON[TYPES[type]?.icon] || ''}</svg>`;

  // ---------- 時間與文字 ----------
  const dPart = s => (s || '').slice(0, 10);
  const tPart = s => (s || '').slice(11, 16);
  const fmt = s => s ? `${UI.dot(dPart(s), false)}${tPart(s) ? ' ' + tPart(s) : ''}` : '';
  /** 這筆訂位的主要日期（排序與放進每日行程用） */
  const startOf = b => ({ flight: b.dep, hotel: b.checkin && (b.checkin + 'T' + (b.checkinTime || '15:00')), train: b.dep, car: b.pickup, ticket: b.when }[b.type] || '');
  const titleOf = b => ({
    flight: [b.no, b.airline].filter(Boolean).join('　') || '航班',
    hotel: b.name || '住宿', train: [b.kind, b.no].filter(Boolean).join(' ') || '交通', car: [b.company, b.car].filter(Boolean).join('　') || '租車', ticket: b.name || '門票／活動',
  }[b.type]);
  const routeOf = b => {
    if (b.type === 'flight' || b.type === 'train') return [b.from, b.to].filter(Boolean).join(' → ');
    if (b.type === 'hotel') return b.checkin ? `${UI.dot(b.checkin, false)}${b.checkinTime ? ' ' + b.checkinTime : ''} 入住 → ${b.checkout ? UI.dot(b.checkout, false) + (b.checkoutTime ? ' ' + b.checkoutTime : '') + ' 退房' : ''}${b.checkin && b.checkout ? `（${U.diffDays(b.checkin, b.checkout)} 晚）` : ''}` : '';
    if (b.type === 'car') return [b.pickupPlace, b.dropoffPlace && b.dropoffPlace !== b.pickupPlace ? b.dropoffPlace : ''].filter(Boolean).join(' → ');
    if (b.type === 'ticket') return b.place || '';
    return '';
  };
  const whenOf = b => {
    if (b.type === 'flight' || b.type === 'train') return [fmt(b.dep), b.arr ? '→ ' + (dPart(b.arr) === dPart(b.dep) ? tPart(b.arr) : fmt(b.arr)) : ''].filter(Boolean).join(' ');
    if (b.type === 'car') return [fmt(b.pickup), b.dropoff ? '→ ' + fmt(b.dropoff) : ''].filter(Boolean).join(' ');
    if (b.type === 'ticket') return fmt(b.when);
    return '';
  };

  /** 免費取消期限倒數 */
  function cancelInfo(b) {
    if (!b.cancelBy) return null;
    const end = new Date(b.cancelBy.length === 10 ? b.cancelBy + 'T23:59' : b.cancelBy);
    const ms = end - Date.now();
    const days = Math.ceil(ms / 86400000);
    const when = `${UI.dot(dPart(b.cancelBy), false)}${tPart(b.cancelBy) ? ' ' + tPart(b.cancelBy) : ''} 前`;
    if (ms < 0) return { level: 'past', text: '已過免費取消期限', when, days };
    if (days <= 1) return { level: 'urgent', text: ms < 86400000 && end.toDateString() === new Date().toDateString() ? '今天截止免費取消' : '免費取消期限剩 1 天', when, days };
    return { level: days <= 7 ? 'soon' : 'ok', text: `免費取消期限還剩 ${days} 天`, when, days };
  }
  const flightLink = no => `https://www.flightradar24.com/data/flights/${encodeURIComponent(no.replace(/\s/g, '').toLowerCase())}`;
  const mapLink = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);

  const sorted = list => (list || []).slice().sort((a, b) => (startOf(a) || '9').localeCompare(startOf(b) || '9'));

  /** 備註：舊的純文字轉成段落，圖文直接用 */
  const noteHtml = v => !v ? '' : /<[a-z][\s\S]*>/i.test(v) ? v : `<p>${E(v).replace(/\n/g, '<br>')}</p>`;

  // ---------- 閱讀：某一種訂位（或全部）的分頁 ----------
  /** 訂位代號按鈕：管理者點一下複製；訪客只看到遮住中間的代號，不能複製 */
  function codeBtn(code, size, label = '') {
    const m = E(TA.store.maskCode(code));
    if (TA.store.isGuest()) return `<span class="bk-code ${size} masked" title="只有旅程主人看得到完整代號">${label}${size === 'xs' ? m : `<b>${m}</b>`}</span>`;
    return `<button class="bk-code ${size}" data-copy="${E(code)}">${label}${size === 'xs' ? E(code) : `<b>${E(code)}</b>`}</button>`;
  }

  /** 最左欄：這筆的日期（星期、第幾天），住宿與租車另外標結束日 */
  function dateCol(t, b) {
    const d0 = dPart(startOf(b));
    if (!d0) return '<b class="bk-d none">日期未定</b>';
    const end = { hotel: b.checkout, car: dPart(b.dropoff), flight: dPart(b.arr), train: dPart(b.arr) }[b.type] || '';
    const day = (t.days || []).findIndex(d => d.date === d0);
    const nights = b.type === 'hotel' && end ? TA.u.diffDays(d0, end) : 0;
    return `<b class="bk-d">${UI.dot(d0, false)}</b><span class="bk-w">${UI.week(d0).replace('星期', '週')}${day >= 0 ? `・Day ${day + 1}` : ''}</span>
      ${end && end !== d0 ? `<span class="bk-end">至 ${UI.dot(end, false)}${nights > 0 ? `・${nights} 晚` : ''}</span>` : ''}`;
  }

  function viewHtml(t, type) {
    const list = sorted(t.bookings).filter(b => !type || b.type === type);
    if (!list.length) return '';
    const alerts = list.map(b => ({ b, c: cancelInfo(b) })).filter(x => x.c && (x.c.level === 'urgent' || x.c.level === 'soon'));
    return `
      ${alerts.length ? `<div class="bk-alerts">${alerts.map(x => `<div class="bk-alert ${x.c.level}">${ico(x.b.type)}<b>${E(titleOf(x.b))}</b><span>${x.c.text}（${x.c.when}）</span></div>`).join('')}</div>` : ''}
      <div class="bk-list">${list.map(b => {
        const c = cancelInfo(b);
        const links = [];
        if (b.type === 'flight' && b.no) links.push(`<a href="${flightLink(b.no)}" target="_blank" rel="noopener">航班動態</a>`);
        if (b.type === 'hotel' && (b.addr || b.name)) links.push(`<a href="${mapLink(b.addr || b.name)}" target="_blank" rel="noopener">地圖</a>`);
        if (b.type === 'car' && b.pickupPlace) links.push(`<a href="${mapLink(b.pickupPlace)}" target="_blank" rel="noopener">取車地點</a>`);
        if (b.type === 'ticket' && b.place) links.push(`<a href="${mapLink(b.place)}" target="_blank" rel="noopener">地點</a>`);
        if (b.url) links.push(`<a href="${E(b.url)}" target="_blank" rel="noopener">訂單／官網</a>`);
        if (b.type === 'hotel' && b.phone) links.push(`<a href="tel:${E(b.phone.replace(/[^\d+]/g, ''))}">撥打飯店</a>`);
        const extra = [b.seat && `座位 ${b.seat}`, b.bag, b.people && `${b.people} 人`, b.paid, b.price].filter(Boolean).join('　');
        return `<article class="bk-item" id="bk-${E(b.id)}">
          <div class="bk-when">${dateCol(t, b)}<span class="bk-type">${ico(b.type, 14)}${E(TYPES[b.type]?.label || '')}</span></div>
          <div class="bk-main">
            <b class="bk-title">${E(titleOf(b))}</b>
            ${routeOf(b) ? `<div class="bk-route">${E(routeOf(b))}</div>` : ''}
            ${whenOf(b) ? `<div class="bk-time">${E(whenOf(b))}</div>` : ''}
            ${extra ? `<div class="bk-extra">${E(extra)}</div>` : ''}
            ${b.addr ? `<div class="bk-extra">${E(b.addr)}</div>` : ''}
            ${links.length ? `<div class="bk-links">${links.join('')}</div>` : ''}
            ${!TA.rich.isEmpty(noteHtml(b.note)) ? `<div class="fold bk-fold"><div class="fold-title">${/<img/i.test(b.note) ? '確認信與附件' : '備註'}</div><div class="fold-body"><div class="rich">${TA.rich.view(noteHtml(b.note))}</div></div></div>` : ''}
          </div>
          <div class="bk-side">
            ${b.code ? codeBtn(b.code, 'sm', '<span>訂位代號</span>') : ''}
            ${c ? `<span class="bk-cancel ${c.level}">${c.text}<small>${c.when}</small></span>` : ''}
          </div>
        </article>`;
      }).join('')}</div>`;
  }

  /** 每日行程裡：當天的航班、入住退房、取還車、門票 */
  function dayItems(t, date) {
    const out = [];
    for (const b of t.bookings || []) {
      const add = (time, text) => out.push({ time, text, b });
      if (b.type === 'flight' && dPart(b.dep) === date) add(tPart(b.dep), `${b.no || '航班'}　${[b.from, b.to].filter(Boolean).join(' → ')}${b.arr ? '，' + (dPart(b.arr) === date ? tPart(b.arr) : fmt(b.arr)) + ' 抵達' : ''}`);
      if (b.type === 'flight' && b.arr && dPart(b.arr) === date && dPart(b.dep) !== date) add(tPart(b.arr), `${b.no || '航班'} 抵達 ${b.to || ''}`);
      if (b.type === 'train' && dPart(b.dep) === date) add(tPart(b.dep), `${[b.kind, b.no].filter(Boolean).join(' ')}　${[b.from, b.to].filter(Boolean).join(' → ')}`);
      if (b.type === 'hotel' && b.checkin === date) add(b.checkinTime || '', `入住 ${b.name || ''}`);
      if (b.type === 'hotel' && b.checkout === date) add(b.checkoutTime || '', `退房 ${b.name || ''}`);
      if (b.type === 'car' && dPart(b.pickup) === date) add(tPart(b.pickup), `取車 ${b.company || ''}${b.pickupPlace ? '（' + b.pickupPlace + '）' : ''}`);
      if (b.type === 'car' && dPart(b.dropoff) === date) add(tPart(b.dropoff), `還車${b.dropoffPlace ? '（' + b.dropoffPlace + '）' : ''}`);
      if (b.type === 'ticket' && dPart(b.when) === date) add(tPart(b.when), b.name || '門票／活動');
    }
    out.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    if (!out.length) return '';
    return `<ul class="bk-day">${out.map(x => `<li>${ico(x.b.type, 14)}<span class="t">${E(x.time)}</span><span>${E(x.text)}</span>${x.b.code ? codeBtn(x.b.code, 'xs') : ''}</li>`).join('')}</ul>`;
  }

  /** 首頁提醒：所有未結束旅程中，14 天內到期的免費取消、48 小時內起飛的航班 */
  function reminders(trips) {
    const out = [];
    for (const t of trips) for (const b of t.bookings || []) {
      const c = cancelInfo(b);
      if (c && c.level !== 'past' && c.days <= 14) out.push({ t, b, sort: c.days, text: `${c.text}（${c.when}）`, level: c.level });
      if (b.type === 'flight' && b.dep) {
        const h = (new Date(b.dep) - Date.now()) / 3600000;
        if (h > 0 && h <= 48) out.push({ t, b, sort: -1, text: `${dPart(b.dep) === TA.u.todayStr() ? '今天' : h < 48 && dPart(b.dep) === TA.u.addDays?.(TA.u.todayStr(), 1) ? '明天' : UI.dot(dPart(b.dep), false)} ${tPart(b.dep)} 起飛${b.from ? '，' + b.from : ''}`, level: 'urgent' });
      }
    }
    return out.sort((a, b) => a.sort - b.sort).slice(0, 5);
  }

  // ---------- 編輯 ----------
  function editorHtml(t, openIds) {
    const list = t.bookings || [];
    return `<div class="bk-ed-list">${list.map((b, i) => {
      const ty = TYPES[b.type] || TYPES.ticket;
      const open = openIds.has(b.id);
      const c = cancelInfo(b);
      return `<div class="bk-ed${open ? ' open' : ''}" data-i="${i}" data-type="${b.type}">
        <div class="bk-ed-head">
          <button type="button" class="bk-ed-toggle" data-act="bk-toggle" data-i="${i}">${ico(b.type)}<b>${E(ty.label)}</b><span>${E(titleOf(b))}</span><em>${E(whenOf(b) || routeOf(b))}</em>${c ? `<small class="bk-cancel ${c.level}">${c.text}</small>` : ''}</button>
          <button type="button" class="icon-btn" data-act="bk-dup" data-i="${i}" title="複製一筆">${UI.icon('copy', 16)}</button>
          <button type="button" class="icon-btn" data-act="bk-del" data-i="${i}" title="刪除">${UI.icon('trash', 16)}</button>
        </div>
        ${open ? `<div class="bk-ed-body">${ty.fields.map(f => {
          const v = b[f.k] ?? '';
          const bind = `data-bind="bookings.${i}.${f.k}"`;
          if (f.type === 'rich') return `<div class="fld wide"><span>${E(f.label)}</span>${TA.rich.editor(`bookings.${i}.${f.k}`, noteHtml(v), { simple: true, placeholder: '確認信、電子機票、座位圖等截圖可以直接貼上；也可以寫注意事項' })}</div>`;
          const input = f.type === 'select' ? `<select ${bind}>${f.options.map(o => `<option ${v === o ? 'selected' : ''}>${E(o)}</option>`).join('')}</select>`
            : f.type === 'textarea' ? `<textarea class="bk-ta" rows="2" ${bind}>${E(v)}</textarea>`
            : `<input type="${f.type}" ${bind} value="${E(v)}" placeholder="${E(f.ph || '')}"${f.upper ? ' data-upper="1"' : ''}>`;
          return `<label class="fld${f.wide ? ' wide' : ''}"><span>${E(f.label)}</span>${input}</label>`;
        }).join('')}</div>` : ''}
      </div>`;
    }).join('')}</div>
    <div class="add-row"><span class="muted">新增</span>${Object.entries(TYPES).map(([k, v]) => `<button type="button" class="btn sm ghost" data-act="bk-add" data-type="${k}">${ico(k, 14)}${v.label}</button>`).join('')}
      <button type="button" class="btn sm ghost" data-act="bk-from-days" title="依每日行程填的住宿，自動建立訂房（已經有的不會重複）">依每日住宿產生訂房</button></div>`;
  }

  /** 依每日住宿建立訂房（同名飯店連續住的天數合併） */
  function hotelsFromDays(t) {
    // 比對時忽略括號裡的備註，例如「Horseshoe (到店付 USD 226)」與「Horseshoe」視為同一間
    const key = s => String(s || '').replace(/[（(][^)）]*[)）]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const have = new Set((t.bookings || []).filter(b => b.type === 'hotel').map(b => key(b.name)));
    const out = [];
    for (const d of t.days || []) {
      if (!d.hotel) continue;
      const last = out[out.length - 1];
      if (last && key(last.name) === key(d.hotel) && last.checkout === d.date) { last.checkout = U.addDays(d.date, 1); continue; }
      out.push({ id: U.uid('k'), type: 'hotel', name: d.hotel, checkin: d.date, checkout: U.addDays(d.date, 1), checkinTime: '15:00', checkoutTime: '11:00', url: d.hotelUrl || '' });
    }
    return out.filter(b => !have.has(key(b.name)));
  }

  window.TA = window.TA || {};
  /** 跟訂位種類對應的舊分頁名稱（例如「機票」「飯店」），會合併到同一個分頁 */
  const SECTION_MATCH = { flight: /機票|航班|班機/, hotel: /飯店|住宿|酒店|旅館/, train: /交通|車票|火車|高鐵|巴士/, car: /租車/, ticket: /門票|票券|活動/ };

  TA.bookings = { TYPES, SECTION_MATCH, noteHtml, viewHtml, dayItems, reminders, editorHtml, hotelsFromDays, cancelInfo, titleOf, sorted, ico };
})();
