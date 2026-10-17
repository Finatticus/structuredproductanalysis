/* 旅行工具箱：行李打包清單
 * #/tool/packing              所有旅程的打包進度
 * #/tool/packing/<tripId>     這趟的清單 + 出發須知
 * #/tool/packing/templates    管理模板
 * 每趟清單存在 trip.packing；模板存在雲端紀錄 __packing */
(function () {
  const U = TA.u, S = TA.store, E = TA.u.esc, UI = TA.ui;
  const REC_ID = '__packing';
  const CATS = ['證件與金錢', '電子產品', '衣物', '盥洗保養', '藥品', '其他'];
  const BAGS = { carry: '隨身', check: '託運', '': '未分類' };
  const MUST_CARRY = /行動電源|鋰電池|備用電池|打火機/;
  const RULES = { always: '每次都套用', business: '商務／出差', cold: '天氣寒冷', hot: '天氣炎熱', drive: '自駕', long: '長途飛行', manual: '手動選擇' };

  // 數量：qty 固定數量；per 每幾天一件（1 = 每天），max 上限
  const it = (name, cat, bag, q = {}) => ({ name, cat, bag, ...q });
  const DEFAULTS = [
    { id: 'base', name: '基本必備', rule: 'always', items: [
      it('護照', '證件與金錢', 'carry'), it('機票／訂位確認（截圖）', '證件與金錢', 'carry'), it('信用卡（兩張不同發卡組織）', '證件與金錢', 'carry'),
      it('外幣現金', '證件與金錢', 'carry'), it('台幣（回程交通用）', '證件與金錢', 'carry'), it('旅遊保險資料', '證件與金錢', 'carry'),
      it('手機', '電子產品', 'carry'), it('充電線', '電子產品', 'carry', { qty: 2 }), it('充電頭', '電子產品', 'carry'), it('行動電源', '電子產品', 'carry'),
      it('eSIM／網卡', '電子產品', 'carry'), it('耳機', '電子產品', 'carry'),
      it('上衣', '衣物', 'check', { per: 1, max: 7 }), it('褲子', '衣物', 'check', { per: 2, max: 4 }), it('內衣褲', '衣物', 'check', { per: 1, max: 7 }),
      it('襪子', '衣物', 'check', { per: 1, max: 7 }), it('睡衣', '衣物', 'check'), it('外套', '衣物', 'carry'),
      it('牙刷牙膏', '盥洗保養', 'check'), it('洗面乳', '盥洗保養', 'check'), it('保養品（分裝 100ml 以下）', '盥洗保養', 'check'), it('刮鬍刀', '盥洗保養', 'check'),
      it('常備藥（感冒、腸胃、止痛）', '藥品', 'carry'), it('OK 繃', '藥品', 'check'),
      it('原子筆（填表用）', '其他', 'carry'), it('口罩', '其他', 'carry'), it('摺疊傘', '其他', 'check'), it('摺疊購物袋', '其他', 'check'),
    ] },
    { id: 'business', name: '商務／研討會', rule: 'business', items: [
      it('名片（一盒）', '其他', 'carry'), it('西裝', '衣物', 'check'), it('襯衫', '衣物', 'check', { per: 1, max: 5 }), it('領帶', '衣物', 'check'),
      it('皮鞋', '衣物', 'check'), it('筆電與充電器', '電子產品', 'carry'), it('簡報備份（隨身碟）', '電子產品', 'carry'), it('會議資料／識別證', '證件與金錢', 'carry'),
    ] },
    { id: 'winter', name: '冬季', rule: 'cold', items: [
      it('發熱衣', '衣物', 'check', { per: 2, max: 4 }), it('發熱褲', '衣物', 'check', { per: 3, max: 3 }), it('羽絨外套', '衣物', 'carry'),
      it('毛帽', '衣物', 'check'), it('手套', '衣物', 'check'), it('圍巾', '衣物', 'check'), it('暖暖包', '其他', 'check', { qty: 10 }),
      it('護唇膏', '盥洗保養', 'carry'), it('乳液', '盥洗保養', 'check'),
    ] },
    { id: 'summer', name: '夏季／海島', rule: 'hot', items: [
      it('泳衣', '衣物', 'check'), it('拖鞋', '衣物', 'check'), it('帽子', '衣物', 'check'), it('薄外套（室內冷氣）', '衣物', 'carry'),
      it('太陽眼鏡', '其他', 'carry'), it('防曬乳', '盥洗保養', 'check'), it('防蚊液', '藥品', 'check'),
    ] },
    { id: 'drive', name: '自駕', rule: 'drive', items: [
      it('國際駕照', '證件與金錢', 'carry'), it('台灣駕照正本', '證件與金錢', 'carry'), it('主駕駛名下信用卡（押金用）', '證件與金錢', 'carry'),
      it('租車確認單', '證件與金錢', 'carry'), it('車用充電器', '電子產品', 'check'), it('手機架', '電子產品', 'check'), it('離線地圖', '電子產品', 'carry'),
    ] },
    { id: 'long', name: '長途飛行', rule: 'long', items: [
      it('頸枕', '其他', 'carry'), it('眼罩', '其他', 'carry'), it('耳塞', '其他', 'carry'), it('保濕噴霧（100ml 以下）', '盥洗保養', 'carry'), it('壓縮襪', '衣物', 'carry'),
    ] },
  ];

  const templates = () => U.clone(S.record(REC_ID)?.templates || DEFAULTS);
  const saveTemplates = list => S.saveRecord(REC_ID, 'packing-templates', '行李模板（非旅程）', { templates: list });
  const qtyOf = (d, days) => (d.per ? Math.max(1, Math.min(d.max || 7, Math.ceil(days / d.per))) : (d.qty || 1));

  // ---------- 天氣：取「去年同期」實際氣溫（Open-Meteo 歷史資料，免金鑰） ----------
  async function climate(t) {
    if (!t.startDate) return null;
    const n = Math.min(UI.nDays(t) || 1, 16);
    const md = t.startDate.slice(4);
    let y = +t.startDate.slice(0, 4);
    const limit = U.addDays(U.todayStr(), -6); // 歷史資料約晚 5 天
    while (U.addDays(y + md, n - 1) > limit) y--;
    const s = y + md, e = U.addDays(s, n - 1);
    const seen = new Set();
    const pts = TA.geo.placePoints(t.countries, t.cities, t).filter(p => { const k = p.ll.join(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
    const avg = a => a.filter(v => v != null).reduce((x, v) => x + v, 0) / Math.max(1, a.filter(v => v != null).length);
    const list = await Promise.all(pts.map(async p => {
      const key = `ta.clim.${p.ll.join()}.${s}.${e}`;
      try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c) return c; } catch { }
      try {
        const r = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${p.ll[0]}&longitude=${p.ll[1]}&start_date=${s}&end_date=${e}&daily=temperature_2m_max,temperature_2m_min&timezone=auto`);
        const j = await r.json();
        const c = { name: p.name, max: Math.round(avg(j.daily.temperature_2m_max)), min: Math.round(avg(j.daily.temperature_2m_min)) };
        try { localStorage.setItem(key, JSON.stringify(c)); } catch { }
        return c;
      } catch { return null; }
    }));
    return { year: y, list: list.filter(Boolean) };
  }

  // ---------- 依旅程判斷要套用哪些模板 ----------
  function analyze(t, clim) {
    const days = UI.nDays(t) || 1;
    const m = t.startDate ? +t.startDate.slice(5, 7) : null;
    const pts = TA.geo.placePoints(t.countries, t.cities, t);
    const text = [t.title, t.summary, ...(t.tags || []), TA.rich.textOf(t.intro), ...(t.sections || []).map(s => s.title)].join(' ');
    const r = {};
    if (/出差|商務|研討會|會議|展覽|名片|西裝/.test(text)) r.business = '旅程內容提到出差／研討會';
    if (/自駕|租車/.test(text)) r.drive = '旅程有租車資訊';
    if (clim?.list.length) {
      for (const c of clim.list) {
        if (c.min < 8 && !r.cold) r.cold = `${c.name} 去年同期約 ${c.min}–${c.max}°C`;
        if (c.max >= 28 && !r.hot) r.hot = `${c.name} 去年同期約 ${c.min}–${c.max}°C`;
      }
    } else if (m) for (const p of pts) {
      const lat = p.ll[0], a = Math.abs(lat), south = lat < 0;
      const mm = south ? ((m + 5) % 12) + 1 : m; // 南半球季節相反
      const cold = (a >= 30 && [12, 1, 2].includes(mm)) || (a >= 35 && [11, 3].includes(mm)) || (a >= 45 && [10, 4].includes(mm));
      const hot = a < 23.5 || (a < 42 && [6, 7, 8, 9].includes(mm));
      if (cold && !r.cold) r.cold = `${m} 月去${p.name}，推測天氣寒冷`;
      if (hot && !r.hot) r.hot = `${m} 月去${p.name}，推測天氣炎熱`;
    }
    const far = Math.max(0, ...pts.map(p => TA.geo.dist(TA.geo.HOME.ll, p.ll)));
    if (far > 5000) r.long = `航程約 ${UI.num(Math.round(far / 100) * 100)} 公里`;
    return { days, reasons: r };
  }

  function generate(t, ids) {
    const { days } = analyze(t);
    const map = new Map();
    const add = (d, from) => {
      const key = d.name.trim();
      const q = qtyOf(d, days);
      const cur = map.get(key);
      if (cur) { cur.qty = Math.max(cur.qty, q); return; }
      map.set(key, { id: U.uid('k'), name: key, cat: CATS.includes(d.cat) ? d.cat : '其他', bag: MUST_CARRY.test(key) ? 'carry' : (d.bag || ''), qty: q, done: false, back: false, from });
    };
    for (const tp of templates()) if (ids.includes(tp.id)) tp.items.forEach(d => add(d, tp.name));
    // 依國家自動加入：入境文件、轉接頭
    const plugs = new Set();
    for (const c of t.countries || []) {
      const info = TA.countryInfo.get(c);
      (info?.docs || []).forEach(d => add(d, c));
      const a = TA.countryInfo.adapterNote(info);
      if (a?.need) plugs.add(a.type);
    }
    // 多國合併成一個轉接頭項目；插頭系統不只一種（例如英國 G ＋ 歐陸 C）時建議萬用轉接頭
    const types = [...new Set([...plugs].flatMap(p => p.split('／')))].sort();
    if (types.length) {
      const families = new Set(types.map(x => ('CEFJKL'.includes(x) ? 'EU' : x)));
      add({ name: `${families.size > 1 ? '萬用轉接頭' : '轉接頭'}（${types.join('／')} 型）`, cat: '電子產品', bag: 'check' }, '目的地');
    }
    return [...map.values()];
  }

  // ---------- 出發須知 ----------
  function tzRow(ctry, t) {
    const tz = ctry && TA.countries.tzFor(ctry, t.cities);
    if (!tz) return '';
    const diff = TA.ticker.tzOffsetMin(tz) - TA.ticker.tzOffsetMin(S.settings().homeTz);
    const h = Math.abs(diff) / 60;
    return `<div class="nt-row"><dt>時差</dt><dd>${diff ? `比台灣${diff > 0 ? '快' : '慢'} ${Number.isInteger(h) ? h : h.toFixed(1)} 小時` : '與台灣相同'}　當地現在 ${TA.ticker.fmtTime(tz)}</dd></div>`;
  }
  function noticeHtml(t, clim) {
    const cards = (t.countries || []).map((c, i) => {
      const info = TA.countryInfo.get(c);
      const ctry = TA.countries.find(c);
      const r = ctry ? TA.ticker.rateOf(ctry.cur) : null;
      const base = TA.ticker.rates()?.base || 'TWD';
      const ad = TA.countryInfo.adapterNote(info);
      const row = (k, v) => v ? `<div class="nt-row"><dt>${k}</dt><dd>${v}</dd></div>` : '';
      return `<div class="fold nt${i === 0 ? ' open' : ''}">
        <div class="fold-title">${UI.flag(c)}<span>${E(c)}</span></div>
        <div class="fold-body"><dl class="nt-dl">
          ${info ? `
            ${row('簽證', E(info.visa))}
            ${info.entry?.length ? row('入境手續', `<ul>${info.entry.map(x => `<li>${E(x.t)}${x.url ? ` <a href="${E(x.url)}" target="_blank" rel="noopener">官方網站</a>` : ''}</li>`).join('')}</ul>`) : ''}
            ${row('電源', ad ? E(ad.text) : '')}
            ${row('行車', info.drive ? `靠${info.drive}行駛` : '')}
            ${row('緊急電話', E(info.sos))}
            ${info.tips?.length ? row('注意事項', `<ul>${info.tips.map(x => `<li>${E(x)}</li>`).join('')}</ul>`) : ''}
          ` : row('簽證', `尚未整理這個國家的入境規定，請至 <a href="${TA.countryInfo.BOCA}" target="_blank" rel="noopener">外交部領事事務局</a> 查詢`) + row('行車', ctry ? `靠${ctry.drive}行駛` : '')}
          ${tzRow(ctry, t)}
          ${ctry && ctry.cur !== base ? row('匯率', `${r ? `${r.unit} ${ctry.cur} ≈ <b>${r.text}</b> ${base}` : '載入中'}
            <div class="conv" data-cur="${ctry.cur}" data-rate="${r ? r.val / r.unit : ''}">
              <input type="number" class="cv-a" placeholder="${ctry.cur}" inputmode="decimal"><span>=</span><input type="number" class="cv-b" placeholder="${base}" inputmode="decimal">
            </div>`) : ''}
        </dl></div>
      </div>`;
    }).join('');
    const wx = clim?.list.length ? `<div class="nt-wx"><div class="nt-wx-h">天氣參考<small>${clim.year} 年同期實際氣溫</small></div>
      ${clim.list.map(c => `<div class="nt-wx-r"><span>${E(c.name)}</span><b>${c.min}° — ${c.max}°C</b></div>`).join('')}</div>` : '';
    return `<aside class="pk-notice">
      <h3>出發須知</h3>
      ${wx}
      ${cards || '<p class="muted">這趟旅程還沒有填國家。</p>'}
      <p class="hint nt-foot">以中華民國護照為準，資料整理於 2026 年。入境規定常有變動，出發前請以各國官方網站及 <a href="${TA.countryInfo.BOCA}" target="_blank" rel="noopener">外交部領事事務局</a> 公告為準。</p>
    </aside>`;
  }
  function bindConverter(el) {
    el.addEventListener('input', e => {
      const box = e.target.closest('.conv');
      if (!box || !box.dataset.rate) return;
      const rate = +box.dataset.rate;
      const a = box.querySelector('.cv-a'), b = box.querySelector('.cv-b');
      const fmt = n => (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, '');
      if (e.target === a) b.value = a.value === '' ? '' : fmt(+a.value * rate);
      else a.value = b.value === '' ? '' : fmt(+b.value / rate);
    });
  }

  // ---------- 這趟的清單 ----------
  function renderTrip(el, t) {
    let onlyLeft = false, clim = null, picked = false;
    const save = U.debounce(() => S.upsert(t), 500);
    const head = `<a class="back" href="#/trip/${t.id}">${UI.icon('back', 16)}${E(t.title)}</a>
      <header class="page-head slim"><div class="eyebrow">Packing List</div><h1 class="display">行李打包</h1>
      <p class="lede">${E(t.title)}　${UI.range(t.startDate, t.endDate)}　${UI.nDays(t)} 天</p></header>`;

    function setupHtml() {
      if (S.isGuest()) return '<section class="panel"><p class="muted">這趟旅程還沒有建立行李清單。</p></section>';
      const { days, reasons } = analyze(t, clim);
      return `<section class="panel pk-setup">
        <h3>建立這趟的清單</h3>
        <p class="hint">依旅程內容建議套用以下模板，可自行勾選。衣物依 ${days} 天計算，每樣最多 7 件，超過請安排洗衣。</p>
        <div class="pk-tpls">${templates().map(tp => {
          const auto = tp.rule === 'always' || reasons[tp.rule];
          return `<label class="pk-tpl"><input type="checkbox" value="${tp.id}" ${auto ? 'checked' : ''} ${tp.rule === 'always' ? 'disabled' : ''}>
            <b>${E(tp.name)}</b><small>${tp.rule === 'always' ? '每次都套用' : reasons[tp.rule] ? '建議：' + E(reasons[tp.rule]) : `${tp.items.length} 項`}</small></label>`;
        }).join('')}</div>
        <p class="hint">另外會依目的地自動加入入境文件與轉接頭。</p>
        <div class="add-row"><button class="btn primary" data-act="gen">產生清單</button><a class="btn ghost" href="#/tool/packing/templates">管理模板</a></div>
      </section>`;
    }

    function listHtml() {
      const p = t.packing, key = p.mode === 'back' ? 'back' : 'done';
      const items = p.items;
      const n = items.filter(x => x[key]).length;
      const carry = items.filter(x => x.bag === 'carry').length, check = items.filter(x => x.bag === 'check').length;
      return `<section class="pk-list">
        <div class="pk-bar">
          <div class="tabs-text"><button data-mode="go" class="${key === 'done' ? 'on' : ''}">去程打包</button><button data-mode="back" class="${key === 'back' ? 'on' : ''}">回程檢查</button></div>
          <label class="mini-check"><input type="checkbox" id="pk-left" ${onlyLeft ? 'checked' : ''}>只看未完成</label>
        </div>
        <div class="pk-progress">
          <div class="pk-count"><b>${n}</b> / ${items.length}<span>${key === 'back' ? '回程已收好' : '已打包'}</span></div>
          <div class="bar"><i style="width:${items.length ? n / items.length * 100 : 0}%"></i></div>
          <div class="pk-sum">隨身 ${carry}　託運 ${check}${items.length - carry - check ? `　未分類 ${items.length - carry - check}` : ''}</div>
        </div>
        <form class="pk-add">
          <input type="text" id="pk-name" placeholder="新增項目，例如：相機" required>
          <select id="pk-cat">${CATS.map(c => `<option>${c}</option>`).join('')}</select>
          <select id="pk-bag"><option value="carry">隨身</option><option value="check">託運</option><option value="">未分類</option></select>
          <button class="btn" type="submit">${UI.icon('plus', 16)}加入</button>
        </form>
        ${CATS.map(cat => {
          const list = items.filter(x => x.cat === cat && (!onlyLeft || !x[key]));
          if (!list.length) return '';
          const all = items.filter(x => x.cat === cat);
          return `<div class="pk-group"><div class="pk-gh"><span>${cat}</span><small>${all.filter(x => x[key]).length} / ${all.length}</small></div>
            ${list.map(x => `<div class="pk-item${x[key] ? ' on' : ''}" data-id="${x.id}">
              <button class="pk-cb" data-act="tick" aria-label="勾選"></button>
              <input class="pk-n" value="${E(x.name)}" data-f="name">
              <div class="pk-qty"><button data-act="minus" aria-label="減少">−</button><span>${x.qty}</span><button data-act="plus" aria-label="增加">+</button></div>
              <button class="pk-bag b-${x.bag || 'none'}" data-act="bag" title="切換隨身／託運">${BAGS[x.bag || '']}</button>
              <button class="icon-btn pk-del" data-act="del" title="移除">${UI.icon('x', 14)}</button>
            </div>${MUST_CARRY.test(x.name) ? '<p class="pk-warn">鋰電池類禁止託運，請放隨身行李</p>' : ''}`).join('')}
          </div>`;
        }).join('')}
        ${onlyLeft && items.every(x => x[key]) ? '<p class="empty-box">全部完成了，一路順風。</p>' : ''}
        <div class="add-row pk-tools">
          <button class="btn sm ghost" data-act="more">加入其他模板</button>
          <button class="btn sm ghost" data-act="reset">清除${key === 'back' ? '回程' : '去程'}勾選</button>
          <button class="btn sm ghost" data-act="remove">刪除整份清單</button>
        </div>
      </section>`;
    }

    function paint() {
      const y = window.scrollY;
      el.innerHTML = `<div class="pk">${head}<div class="pk-layout"><div class="pk-main">${t.packing ? listHtml() : setupHtml()}</div>${noticeHtml(t, clim)}</div></div>`;
      window.scrollTo({ top: y, behavior: 'instant' });
    }
    paint();
    const safePaint = () => { if (!el.isConnected || el.querySelector('.conv input:focus') || (!t.packing && picked)) return; paint(); };
    TA.ticker.loadRates().then(safePaint);
    climate(t).then(c => { clim = c; safePaint(); });
    bindConverter(el);

    const find = node => t.packing.items.find(x => x.id === node.closest('.pk-item')?.dataset.id);
    el.addEventListener('submit', e => {
      if (!e.target.classList.contains('pk-add')) return;
      e.preventDefault();
      const name = U.$('#pk-name', el).value.trim(); if (!name) return;
      t.packing.items.push({ id: U.uid('k'), name, cat: U.$('#pk-cat', el).value, bag: MUST_CARRY.test(name) ? 'carry' : U.$('#pk-bag', el).value, qty: 1, done: false, back: false });
      S.upsert(t); paint(); U.$('#pk-name', el).focus();
    });
    el.addEventListener('change', e => {
      if (e.target.closest('.pk-tpl')) { picked = true; return; }
      if (e.target.id === 'pk-left') { onlyLeft = e.target.checked; paint(); return; }
      if (e.target.dataset.f === 'name') { const x = find(e.target); if (x) { x.name = e.target.value.trim() || x.name; save(); } }
    });
    el.addEventListener('click', async e => {
      const ft = e.target.closest('.fold-title'); if (ft) { ft.parentElement.classList.toggle('open'); return; }
      const md = e.target.closest('[data-mode]'); if (md) { t.packing.mode = md.dataset.mode; if (!S.isGuest()) S.upsert(t); paint(); return; }
      const a = e.target.closest('[data-act]'); if (!a) return;
      const key = t.packing?.mode === 'back' ? 'back' : 'done';
      const x = a.closest('.pk-item') ? find(a) : null;
      switch (a.dataset.act) {
        case 'gen': {
          const ids = U.$$('.pk-tpl input', el).filter(i => i.checked).map(i => i.value);
          t.packing = { items: generate(t, ids), mode: 'go', templates: ids, createdAt: new Date().toISOString() };
          S.upsert(t); paint(); U.toast(`已產生 ${t.packing.items.length} 項`); return;
        }
        case 'tick': x[key] = !x[key]; S.upsert(t); paint(); return;
        case 'plus': x.qty++; save(); paint(); return;
        case 'minus': x.qty = Math.max(1, x.qty - 1); save(); paint(); return;
        case 'bag': if (MUST_CARRY.test(x.name)) { U.toast('鋰電池類必須放隨身行李', 'err'); return; } x.bag = x.bag === 'carry' ? 'check' : x.bag === 'check' ? '' : 'carry'; save(); paint(); return;
        case 'del': t.packing.items = t.packing.items.filter(i => i !== x); save(); paint(); return;
        case 'reset': if (await U.confirm(`清除所有${key === 'back' ? '回程' : '去程'}勾選？`)) { t.packing.items.forEach(i => (i[key] = false)); S.upsert(t); paint(); } return;
        case 'remove': if (await U.confirm('刪除這趟的整份行李清單？', { ok: '刪除', danger: true })) { delete t.packing; S.upsert(t); paint(); } return;
        case 'more': {
          const used = t.packing.templates || [];
          const m = U.modal(`<div class="pk-tpls">${templates().map(tp => `<label class="pk-tpl"><input type="checkbox" value="${tp.id}" ${used.includes(tp.id) ? 'checked disabled' : ''}><b>${E(tp.name)}</b><small>${tp.items.length} 項</small></label>`).join('')}</div>
            <div class="modal-actions"><button class="btn ghost" data-close>取消</button><button class="btn primary" id="pk-more-ok">加入</button></div>`, { title: '加入其他模板', small: true });
          U.$('#pk-more-ok', m.el).onclick = () => {
            const ids = U.$$('input:checked:not(:disabled)', m.el).map(i => i.value);
            const have = new Set(t.packing.items.map(i => i.name));
            const add = generate(t, ids).filter(i => !have.has(i.name));
            t.packing.items.push(...add); t.packing.templates = [...used, ...ids];
            S.upsert(t); m.close(); paint(); U.toast(`加入了 ${add.length} 項`);
          };
          return;
        }
      }
    });
  }

  // ---------- 總覽 ----------
  function renderOverview(el) {
    const trips = S.all().slice().sort((a, b) => {
      const pa = S.statusOf(a) !== 'done', pb = S.statusOf(b) !== 'done';
      if (pa !== pb) return pa ? -1 : 1;
      return pa ? (a.startDate || '').localeCompare(b.startDate || '') : (b.startDate || '').localeCompare(a.startDate || '');
    });
    const row = t => {
      const p = t.packing, n = p ? p.items.filter(x => x.done).length : 0;
      return `<a class="pk-trip" href="#/tool/packing/${t.id}">
        <span class="c-date"><b>${UI.dot(t.startDate, false) || '—'}</b><span>${(t.startDate || '').slice(0, 4)}</span></span>
        <span class="c-title"><b>${E(t.title)}</b><span>${E((t.countries || []).join('、'))}　${UI.nDays(t)} 天</span></span>
        <span class="pk-st">${p ? `<span class="bar"><i style="width:${p.items.length ? n / p.items.length * 100 : 0}%"></i></span><small>${n} / ${p.items.length}</small>` : '<small class="muted">尚未建立</small>'}</span>
      </a>`;
    };
    const planning = trips.filter(t => S.statusOf(t) !== 'done'), done = trips.filter(t => S.statusOf(t) === 'done');
    el.innerHTML = `<div class="narrow">
      <a class="back" href="#/tools">${UI.icon('back', 16)}旅行工具箱</a>
      <header class="page-head"><div class="eyebrow">Packing List</div><h1 class="display">行李打包清單</h1>
        <p class="lede">選一段旅程，依模板自動產生清單，出發前一項一項勾。</p>
        <div class="add-row"><a class="btn" href="#/tool/packing/templates">管理模板</a></div></header>
      ${planning.length ? `<div class="group"><span>安排中</span></div>${planning.map(row).join('')}` : ''}
      ${done.length ? `<div class="group"><span>過去的旅程</span></div>${done.map(row).join('')}` : ''}
    </div>`;
  }

  // ---------- 模板管理 ----------
  function renderTemplates(el) {
    let list = templates();
    let dirty = false;
    const qtyMode = d => d.per ? 'per' + d.per : 'fixed';
    function paint() {
      el.innerHTML = `<div class="narrow">
        <a class="back" href="#/tool/packing">${UI.icon('back', 16)}行李打包清單</a>
        <header class="page-head"><div class="eyebrow">Templates</div><h1 class="display">行李模板</h1>
          <p class="lede">修改後只影響之後產生的清單，已經建立的清單不會變動。</p></header>
        ${list.map((tp, k) => `<section class="panel tpl" data-k="${k}">
          <div class="tpl-head">
            <input type="text" class="tpl-name" data-k="${k}" value="${E(tp.name)}">
            <select class="tpl-rule" data-k="${k}">${Object.entries(RULES).map(([v, l]) => `<option value="${v}" ${tp.rule === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <button class="icon-btn" data-act="tpl-del" data-k="${k}" title="刪除模板">${UI.icon('trash', 16)}</button>
          </div>
          <div class="tpl-items">${tp.items.map((d, j) => `<div class="tpl-item" data-k="${k}" data-j="${j}">
            <input type="text" data-f="name" value="${E(d.name)}" placeholder="項目">
            <select data-f="cat">${CATS.map(c => `<option ${d.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
            <select data-f="bag"><option value="carry" ${d.bag === 'carry' ? 'selected' : ''}>隨身</option><option value="check" ${d.bag === 'check' ? 'selected' : ''}>託運</option><option value="" ${!d.bag ? 'selected' : ''}>未分類</option></select>
            <select data-f="mode"><option value="fixed" ${qtyMode(d) === 'fixed' ? 'selected' : ''}>固定</option><option value="per1" ${qtyMode(d) === 'per1' ? 'selected' : ''}>每天 1 件</option><option value="per2" ${qtyMode(d) === 'per2' ? 'selected' : ''}>每 2 天 1 件</option><option value="per3" ${qtyMode(d) === 'per3' ? 'selected' : ''}>每 3 天 1 件</option></select>
            <input type="number" data-f="n" min="1" value="${d.per ? d.max || 7 : d.qty || 1}" title="${d.per ? '最多幾件' : '數量'}">
            <button class="icon-btn" data-act="item-del" title="移除">${UI.icon('x', 14)}</button>
          </div>`).join('')}</div>
          <button class="btn sm ghost" data-act="item-add" data-k="${k}">${UI.icon('plus', 14)}新增項目</button>
        </section>`).join('')}
        <div class="add-row tpl-foot">
          <button class="btn" data-act="tpl-add">${UI.icon('plus', 16)}新增模板</button>
          <button class="btn ghost" data-act="restore">恢復預設模板</button>
          <button class="btn primary" data-act="save">儲存模板</button>
        </div>
      </div>`;
    }
    paint();
    const touch = () => (dirty = true);
    el.addEventListener('change', e => {
      const f = e.target.dataset.f, row = e.target.closest('.tpl-item');
      if (e.target.classList.contains('tpl-name')) { list[+e.target.dataset.k].name = e.target.value; touch(); return; }
      if (e.target.classList.contains('tpl-rule')) { list[+e.target.dataset.k].rule = e.target.value; touch(); return; }
      if (!row || !f) return;
      const d = list[+row.dataset.k].items[+row.dataset.j];
      if (f === 'name' || f === 'cat' || f === 'bag') d[f] = e.target.value;
      if (f === 'mode') { if (e.target.value === 'fixed') { d.qty = d.max || 1; delete d.per; delete d.max; } else { d.per = +e.target.value.slice(3); d.max = d.max || 7; delete d.qty; } paint(); }
      if (f === 'n') { const n = Math.max(1, +e.target.value || 1); if (d.per) d.max = n; else d.qty = n; }
      touch();
    });
    el.addEventListener('click', async e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      const k = +(a.dataset.k ?? a.closest('[data-k]')?.dataset.k);
      switch (a.dataset.act) {
        case 'item-add': list[k].items.push({ name: '', cat: '其他', bag: 'check' }); touch(); paint(); U.$$(`.tpl-item[data-k="${k}"] input[data-f="name"]`, el).pop()?.focus(); return;
        case 'item-del': { const row = a.closest('.tpl-item'); list[+row.dataset.k].items.splice(+row.dataset.j, 1); touch(); paint(); return; }
        case 'tpl-add': list.push({ id: U.uid('tp'), name: '新模板', rule: 'manual', items: [] }); touch(); paint(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); return;
        case 'tpl-del': if (await U.confirm(`刪除模板「${list[k].name}」？`, { ok: '刪除', danger: true })) { list.splice(k, 1); touch(); paint(); } return;
        case 'restore': if (await U.confirm('恢復成預設模板？你修改過的內容會被取代。')) { list = U.clone(DEFAULTS); touch(); paint(); } return;
        case 'save':
          list.forEach(tp => (tp.items = tp.items.filter(d => d.name.trim())));
          saveTemplates(list); dirty = false; U.toast('模板已儲存'); paint(); return;
      }
    });
    return { canLeave: () => !dirty || window.confirm('模板有尚未儲存的變更，確定離開？') };
  }

  // ---------- 註冊到工具箱 ----------
  const tool = TA.tools.get('packing');
  tool.status = 'ready';
  tool.render = (el, { trip, sub }) => {
    if (sub === 'templates') return renderTemplates(el);
    if (trip) return renderTrip(el, trip);
    if (sub) { el.innerHTML = `<div class="empty-box">找不到這段旅程<br><a class="btn" href="#/tool/packing">回行李打包清單</a></div>`; return; }
    return renderOverview(el);
  };
  TA.packing = { analyze, generate };
})();
