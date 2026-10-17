/* 旅程編輯器（所見即所得）
 * 基本資訊 / 快速資訊 / 行前備註 / 每日行程（行程站點 + 備註 + 住宿 + 收合區塊）/ 其他資訊 */
(function () {
  const U = TA.u, S = TA.store, E = TA.u.esc, UI = TA.ui, R = TA.rich;

  const SECTION_TEMPLATES = [
    { title: '機票', body: '<h3>去程</h3><p>航班：<br>訂位代號：<br>座位 / 行李：</p><h3>回程</h3><p>航班：<br>訂位代號：</p>' },
    { title: '飯店', body: '<h3>飯店名稱</h3><p>入住 15:00 ／ 退房 11:00<br>免費取消期限：<br>地址：</p>' },
    { title: '交通', body: '<p><strong>取車</strong>：<br><strong>還車</strong>：<br><strong>必備文件</strong>：護照、國際駕照、信用卡</p>' },
    { title: '花費', body: '<table><thead><tr><th>項目</th><th>金額</th><th>備註</th></tr></thead><tbody><tr><td>機票</td><td>NT$</td><td><br></td></tr><tr><td>飯店</td><td>NT$</td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table>' },
    { title: '簽證與入境', body: '<ul class="checklist"><li class="task">簽證／電子旅行許可</li><li class="task">入境申報</li><li class="task">海關申報</li></ul>' },
    { title: '行前檢查', body: '<ul class="checklist"><li class="task">護照（效期六個月以上）</li><li class="task">網路／eSIM</li><li class="task">旅遊保險</li><li class="task">外幣／信用卡</li><li class="task">轉接頭</li><li class="task">常備藥品</li></ul>' },
    { title: '美食清單', body: '<ul><li><br></li></ul>' },
    { title: '緊急聯絡', body: '<p>駐外館處：<br>緊急救助電話：<br>當地報警／救護：<br>信用卡掛失：</p>' },
    { title: '其他', body: '' },
  ];
  const BLOCK_PRESETS = ['詳細內容', '交通與票券', '餐廳訂位', '門票與活動', '備案'];
  const FACT_PRESETS = ['訂位代號', 'eSIM', '保險', '緊急電話', '集合時間', '同行旅伴'];
  const newDay = (date = '', hotel = '') => ({ id: U.uid('d'), date, title: '', stops: [], notes: '', hotel, hotelUrl: '', blocks: [] });
  const newStop = () => ({ id: U.uid('p'), time: '', name: '', url: '' });

  function chipsHtml(field, values, placeholder, list, trip) {
    return `<div class="chips" data-chips="${field}">
      ${(values || []).map((v, i) => {
        let cls = '', title = '';
        if (field === 'countries' && !TA.countries.find(v)) { cls = ' warn'; title = '找不到這個國家，請確認名稱（例如：俄羅斯、阿聯）'; }
        if (field === 'cities') {
          const ll = TA.geo.cityLL(v, trip);
          const g = trip?.geo?.[v];
          if (ll) { cls = ' city'; title = `已定位${g?.label ? '：' + g.label : ''}，點一下可更改`; }
          else { cls = ' warn city'; title = '還沒找到位置，點一下搜尋'; }
        }
        return `<span class="chip-x${cls}" title="${E(title)}"${field === 'cities' ? ` data-city="${E(v)}"` : ''}>${field === 'countries' ? UI.flag(v) : ''}${E(v)}<button type="button" data-chip-del="${i}" aria-label="移除">${UI.icon('x', 12)}</button></span>`;
      }).join('')}
      <input type="text" ${list ? `list="${list}"` : ''} placeholder="${E(placeholder)}">
    </div>`;
  }

  function render(el, params) {
    const isNew = !params.id;
    const orig = isNew ? null : S.get(params.id);
    if (!isNew && !orig) { el.innerHTML = `<div class="empty-box">找不到這段旅程<br><a class="btn" href="#/">回主頁</a></div>`; return; }
    let t = isNew ? S.newTrip() : U.clone(orig);
    let dirty = false;
    const open = new Set(t.days.length <= 2 ? t.days.map(d => d.id) : []);
    t.bookings = t.bookings || [];
    const bkOpen = new Set();
    const draftKey = 'ta.draft.' + (params.id || 'new');

    try {
      const d = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (d && d.trip?.v >= 2 && (!orig || d.at > orig.updatedAt)) {
        U.confirm(`有一份 ${new Date(d.at).toLocaleString('zh-TW')} 尚未儲存的草稿，要還原嗎？`, { ok: '還原草稿', cancel: '捨棄' }).then(ok => {
          if (ok) { t = d.trip; dirty = true; paint(); } else localStorage.removeItem(draftKey);
        });
      }
    } catch { }

    const saveDraft = U.debounce(() => { if (!dirty) return; try { localStorage.setItem(draftKey, JSON.stringify({ at: new Date().toISOString(), trip: t })); } catch { } }, 600);
    const touch = () => { dirty = true; el.querySelector('.ed-state')?.classList.add('dirty'); saveDraft(); };
    function setPath(path, val) {
      const keys = path.split('.'); let o = t;
      for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
      o[keys[keys.length - 1]] = val;
    }

    function stopsHtml(d, i) {
      return `<div class="stops-ed" data-i="${i}">
        ${(d.stops || []).map((p, k) => `<div class="stop-ed" data-k="${k}">
          <span class="handle sh-stop" title="拖曳排序">${UI.icon('drag', 16)}</span>
          <input type="time" data-bind="days.${i}.stops.${k}.time" value="${E(p.time)}" title="時間（可空白）">
          <input type="text" class="stop-name" data-bind="days.${i}.stops.${k}.name" value="${E(p.name)}" placeholder="景點、餐廳或交通" data-i="${i}" data-k="${k}">
          <input type="url" class="stop-url" data-bind="days.${i}.stops.${k}.url" value="${E(p.url)}" placeholder="連結（選填）">
          <button type="button" class="icon-btn" data-act="stop-del" data-i="${i}" data-k="${k}" title="移除">${UI.icon('x', 14)}</button>
        </div>`).join('')}
        <button type="button" class="btn sm ghost" data-act="stop-add" data-i="${i}">${UI.icon('plus', 14)}新增一站</button>
      </div>`;
    }

    function dayHtml(d, i) {
      const isOpen = open.has(d.id);
      const preview = d.title || (d.stops || []).map(p => p.name).filter(Boolean).join(' · ') || R.textOf(d.notes);
      return `<div class="ed-day${isOpen ? ' open' : ''}" data-i="${i}">
        <div class="ed-day-head">
          <span class="handle sh-day" title="拖曳排序（內容會換到另一天）">${UI.icon('drag', 16)}</span>
          <button type="button" class="ed-day-toggle" data-act="toggle-day" data-i="${i}">
            <b>DAY ${String(i + 1).padStart(2, '0')}</b><span class="d">${d.date ? `${UI.dot(d.date, false)}　${UI.week(d.date)}` : '未設日期'}</span>
            <span class="pv">${E(preview.slice(0, 70)) || '<i>尚未安排</i>'}</span>
          </button>
          <div class="ed-day-acts">
            <button type="button" class="icon-btn" data-act="day-up" data-i="${i}" title="與前一天交換">${UI.icon('up', 16)}</button>
            <button type="button" class="icon-btn" data-act="day-down" data-i="${i}" title="與後一天交換">${UI.icon('down', 16)}</button>
            <button type="button" class="icon-btn" data-act="day-dup" data-i="${i}" title="複製這一天">${UI.icon('copy', 16)}</button>
            <button type="button" class="icon-btn" data-act="day-del" data-i="${i}" title="刪除這一天">${UI.icon('trash', 16)}</button>
          </div>
        </div>
        ${isOpen ? `<div class="ed-day-body">
          <div class="row2 narrow-first">
            <label class="fld"><span>日期</span><input type="date" data-bind="days.${i}.date" value="${E(d.date)}"></label>
            <label class="fld"><span>當天標題</span><input type="text" data-bind="days.${i}.title" value="${E(d.title)}" placeholder="例如：京都・嵐山（可空白）"></label>
          </div>
          <div class="fld"><span>行程</span>${stopsHtml(d, i)}</div>
          <div class="fld"><span>備註</span>${R.editor(`days.${i}.notes`, d.notes, { placeholder: '交通方式、訂位資訊、截圖、注意事項……' })}</div>
          <div class="row2">
            <label class="fld"><span>當晚住宿</span><input type="text" list="dl-hotels" data-bind="days.${i}.hotel" value="${E(d.hotel)}" placeholder="飯店名稱"></label>
            <label class="fld"><span>住宿連結</span><input type="url" data-bind="days.${i}.hotelUrl" value="${E(d.hotelUrl)}" placeholder="Google 地圖或訂房網址（選填）"></label>
          </div>
          <div class="ed-blocks" data-i="${i}">
            ${(d.blocks || []).map((b, j) => `<div class="ed-block" data-j="${j}">
              <div class="ed-block-head">
                <span class="handle sh-blk">${UI.icon('drag', 16)}</span>
                <input type="text" class="bt" data-bind="days.${i}.blocks.${j}.title" value="${E(b.title)}" placeholder="區塊標題">
                <label class="mini-check"><input type="checkbox" data-bind-bool="days.${i}.blocks.${j}.open" ${b.open ? 'checked' : ''}>預設展開</label>
                <button type="button" class="icon-btn" data-act="blk-del" data-i="${i}" data-j="${j}" title="刪除區塊">${UI.icon('trash', 16)}</button>
              </div>
              ${R.editor(`days.${i}.blocks.${j}.body`, b.body, { simple: true, placeholder: '閱讀時預設收合，適合放截圖、確認信、詳細介紹' })}
            </div>`).join('')}
          </div>
          <div class="add-row"><span class="muted">新增收合區塊</span>${BLOCK_PRESETS.map(p => `<button type="button" class="btn sm ghost" data-act="blk-add" data-i="${i}" data-title="${p}">${p}</button>`).join('')}</div>
        </div>` : ''}
      </div>`;
    }

    function secHtml(s, k) {
      return `<div class="ed-sec" data-k="${k}">
        <div class="ed-sec-head">
          <span class="handle sh-sec">${UI.icon('drag', 16)}</span>
          <input type="text" class="st" data-bind="sections.${k}.title" value="${E(s.title)}" placeholder="分頁名稱">
          <button type="button" class="icon-btn" data-act="sec-up" data-k="${k}" title="上移">${UI.icon('up', 16)}</button>
          <button type="button" class="icon-btn" data-act="sec-down" data-k="${k}" title="下移">${UI.icon('down', 16)}</button>
          <button type="button" class="icon-btn" data-act="sec-del" data-k="${k}" title="刪除">${UI.icon('trash', 16)}</button>
        </div>
        ${R.editor(`sections.${k}.body`, s.body)}
      </div>`;
    }

    function html() {
      const hotels = [...new Set(t.days.map(d => d.hotel).filter(Boolean))];
      const shiftable = t.startDate && t.days.length && t.days[0].date && t.days[0].date !== t.startDate;
      return `
      <div class="ed-top">
        <a class="back" href="${isNew ? '#/' : '#/trip/' + t.id}">${UI.icon('back', 16)}${isNew ? '取消' : '返回旅程'}</a>
        <h2>${isNew ? '新增旅程' : '編輯旅程'}</h2>
        <span class="ed-state ${dirty ? 'dirty' : ''}"><i class="saved">已儲存</i><i class="unsaved">尚未儲存</i></span>
        <button type="button" class="btn primary" data-act="save">儲存</button>
      </div>
      <datalist id="dl-countries">${TA.countries.list.map(c => `<option value="${c.zh}">${c.en}</option>`).join('')}</datalist>
      <datalist id="dl-hotels">${hotels.map(h => `<option value="${E(h)}">`).join('')}</datalist>

      <div class="ed-layout">
        <aside class="ed-nav">
          <a href="#" data-jump="ed-basic">基本資訊</a>
          <a href="#" data-jump="ed-bookings">訂位與交通 <small>${(t.bookings || []).length || ''}</small></a>
          <a href="#" data-jump="ed-intro">行前備註</a>
          <a href="#" data-jump="ed-days">每日行程</a>
          ${t.days.map((d, i) => `<a href="#" class="sub" data-jump="ed-day-${i}">${String(i + 1).padStart(2, '0')}　${d.date ? UI.dot(d.date, false) : ''}</a>`).join('')}
          <a href="#" data-jump="ed-secs">其他資訊</a>
        </aside>

        <div class="ed-main">
          <section class="panel" id="ed-basic">
            <h3>基本資訊</h3>
            <label class="fld"><span>旅程名稱</span><input type="text" class="big" data-bind="title" value="${E(t.title)}" placeholder="例如：洛杉磯・聖地牙哥・拉斯維加斯"></label>
            <div class="row3">
              <label class="fld"><span>出發日</span><input type="date" data-bind="startDate" value="${E(t.startDate)}"></label>
              <label class="fld"><span>回程日</span><input type="date" data-bind="endDate" value="${E(t.endDate)}"></label>
              <label class="fld"><span>狀態</span><select data-bind="status">
                ${[['auto', '依日期自動判斷'], ['planning', '安排中'], ['done', '已完成']].map(([v, l]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select></label>
            </div>
            <div class="fld"><span>國家與地區 <em class="hint">輸入後按 Enter，可輸入多個</em></span>${chipsHtml('countries', t.countries, '例如：日本', 'dl-countries')}</div>
            <div class="fld"><span>城市 <em class="hint">依造訪順序輸入；會自動在地圖上定位，紅框代表還沒找到位置</em></span>${chipsHtml('cities', t.cities, '例如：東京', '', t)}</div>
            <div class="row2">
              <div class="fld"><span>標籤</span>${chipsHtml('tags', t.tags, '例如：自駕、出差')}</div>
              <label class="fld"><span>封面圖片網址 <em class="hint">選填</em></span><input type="url" data-bind="cover" value="${E(t.cover)}" placeholder="https://"></label>
            </div>
            <label class="fld"><span>一句話簡介</span><input type="text" data-bind="summary" value="${E(t.summary)}" placeholder="例如：美西自駕，順道看秀"></label>
            <div class="fld"><span>快速資訊 <em class="hint">顯示在旅程頁上方，例如訂位代號、緊急電話</em></span>
              <div class="facts-ed">
                ${(t.facts || []).map((f, k) => `<div class="fact-ed">
                  <input type="text" data-bind="facts.${k}.label" value="${E(f.label)}" placeholder="名稱">
                  <input type="text" data-bind="facts.${k}.value" value="${E(f.value)}" placeholder="內容">
                  <button type="button" class="icon-btn" data-act="fact-del" data-k="${k}" title="移除">${UI.icon('x', 14)}</button></div>`).join('')}
              </div>
              <div class="add-row">${FACT_PRESETS.map(p => `<button type="button" class="btn sm ghost" data-act="fact-add" data-label="${p}">${p}</button>`).join('')}<button type="button" class="btn sm ghost" data-act="fact-add" data-label="">自訂</button></div>
            </div>
          </section>

          <section class="panel" id="ed-bookings">
            <h3>訂位與交通</h3>
            <p class="hint">機票、住宿、交通、租車、門票。填了日期會自動出現在那一天的行程；填了免費取消期限，期限前會在首頁提醒。</p>
            ${TA.bookings.editorHtml(t, bkOpen)}
          </section>

          <section class="panel" id="ed-intro">
            <h3>行前備註</h3>
            <p class="hint">記得帶的東西、集合時間、送機接機、網路等，會顯示在每日行程最上方。</p>
            ${R.editor('intro', t.intro, { placeholder: '例如：記得帶名片、西裝；3/24 晚上 8 點機場集合' })}
          </section>

          <section class="panel" id="ed-days">
            <div class="panel-head">
              <h3>每日行程</h3>
              <div class="head-actions">
                <button type="button" class="btn sm ghost" data-act="expand-all">${open.size ? '全部收合' : '全部展開'}</button>
                ${shiftable ? '<button type="button" class="btn sm ghost" data-act="shift-days">日期跟著出發日移動</button>' : ''}
                <button type="button" class="btn sm ghost" data-act="gen-days">依日期補齊天數</button>
              </div>
            </div>
            <div class="ed-days">${t.days.map((d, i) => `<div id="ed-day-${i}" class="ed-day-wrap">${dayHtml(d, i)}</div>`).join('')}</div>
            <button type="button" class="btn dashed" data-act="day-add">${UI.icon('plus', 16)}新增一天</button>
          </section>

          <section class="panel" id="ed-secs">
            <h3>其他資訊</h3>
            <p class="hint">機票、飯店、花費、簽證……每一項會在旅程頁成為一個分頁。</p>
            <div class="ed-secs">${t.sections.map(secHtml).join('')}</div>
            <div class="add-row"><span class="muted">新增分頁</span>${SECTION_TEMPLATES.map((s, k) => `<button type="button" class="btn sm ghost" data-act="sec-add" data-k="${k}">${s.title}</button>`).join('')}</div>
          </section>

          ${isNew ? '' : `<section class="panel danger-zone"><h3>刪除旅程</h3><p class="hint">刪除後無法復原。</p><button type="button" class="btn danger" data-act="delete">刪除這段旅程</button></section>`}
        </div>
      </div>`;
    }

    // ---------- 繪製 ----------
    let sortables = [];
    function paint(keepScroll = true) {
      const y = window.scrollY;
      sortables.forEach(s => s.destroy()); sortables = [];
      el.innerHTML = html();
      if (keepScroll) window.scrollTo({ top: y, behavior: 'instant' });
      if (!window.Sortable) return;
      const mk = (node, handle, arrFn, after) => sortables.push(Sortable.create(node, {
        handle, draggable: node.classList.contains('ed-days') ? '.ed-day-wrap' : undefined, animation: 150, filter: '.btn', onEnd: ev => {
          if (ev.oldIndex === ev.newIndex) return;
          const arr = arrFn(); const [m] = arr.splice(ev.oldIndex, 1); arr.splice(ev.newIndex, 0, m);
          after && after(); touch(); paint();
        }
      }));
      let dates;
      sortables.push(Sortable.create(U.$('.ed-days', el), {
        handle: '.sh-day', animation: 150, onStart: () => (dates = t.days.map(d => d.date)), onEnd: ev => {
          if (ev.oldIndex === ev.newIndex) return;
          const [m] = t.days.splice(ev.oldIndex, 1); t.days.splice(ev.newIndex, 0, m);
          t.days.forEach((d, i) => (d.date = dates[i])); // 日期順序不變，內容換天
          touch(); paint();
        }
      }));
      U.$$('.ed-blocks', el).forEach(b => mk(b, '.sh-blk', () => t.days[+b.dataset.i].blocks));
      U.$$('.stops-ed', el).forEach(b => sortables.push(Sortable.create(b, {
        handle: '.sh-stop', draggable: '.stop-ed', animation: 150, onEnd: ev => {
          if (ev.oldIndex === ev.newIndex) return;
          const arr = t.days[+b.dataset.i].stops; const [m] = arr.splice(ev.oldIndex, 1); arr.splice(ev.newIndex, 0, m); touch(); paint();
        }
      })));
      mk(U.$('.ed-secs', el), '.sh-sec', () => t.sections);
    }

    // 圖文編輯器行為
    const upload = async file => {
      const data = await compress(file);
      const r = await S.call('upload', { name: file.name || 'image.jpg', data });
      return r.url;
    };
    function compress(file) {
      return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => {
          const sc = Math.min(1, 1800 / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = img.width * sc; c.height = img.height * sc;
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', 0.85).split(',')[1]); URL.revokeObjectURL(img.src);
        };
        img.onerror = rej; img.src = URL.createObjectURL(file);
      });
    }
    const uninstall = R.install(el, { onChange: (path, html) => { setPath(path, html); touch(); }, upload });

    el.addEventListener('input', e => { const b = e.target.dataset?.bind; if (b) { setPath(b, e.target.value); touch(); } });
    el.addEventListener('change', e => {
      const bb = e.target.dataset?.bindBool;
      if (bb) { setPath(bb, e.target.checked); touch(); return; }
      const b = e.target.dataset?.bind;
      if (!b) return;
      if (e.target.dataset.upper) { e.target.value = e.target.value.toUpperCase().replace(/\s+/g, ''); setPath(b, e.target.value); }
      if (/^bookings\.\d+\.code$/.test(b)) { e.target.value = e.target.value.trim().toUpperCase(); setPath(b, e.target.value); }
      if (/^days\.\d+\.date$/.test(b) || b === 'startDate' || b === 'endDate') {
        if (b === 'startDate' && (!t.endDate || t.endDate < t.startDate)) t.endDate = t.startDate;
        paint();
      }
    });

    // 標籤式輸入 & 行程站點的 Enter
    el.addEventListener('keydown', e => {
      if (e.target.classList?.contains('stop-name') && e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        const i = +e.target.dataset.i, k = +e.target.dataset.k;
        t.days[i].stops.splice(k + 1, 0, newStop()); touch(); paint();
        U.$(`.stop-name[data-i="${i}"][data-k="${k + 1}"]`, el)?.focus();
        return;
      }
      const box = e.target.closest?.('.chips');
      if (box && e.target.tagName === 'INPUT') {
        const f = box.dataset.chips;
        if ((e.key === 'Enter' || e.key === ',') && !e.isComposing) { e.preventDefault(); addChips(f, e.target.value); }
        else if (e.key === 'Backspace' && !e.target.value && t[f].length) { t[f].pop(); touch(); refreshChips(f); }
      }
    });
    el.addEventListener('focusout', e => {
      const box = e.target.closest?.('.chips');
      if (box && e.target.tagName === 'INPUT' && e.target.value.trim()) addChips(box.dataset.chips, e.target.value, false);
    });
    function addChips(f, raw, focus = true) {
      const added = [];
      raw.split(/[,，、\n]/).map(s => s.trim()).filter(Boolean).forEach(v => { if (!t[f].includes(v)) { t[f].push(v); added.push(v); } });
      if (f === 'cities' && !t.title.trim() && t.cities.length) { t.title = t.cities.join('・'); const ti = U.$('[data-bind="title"]', el); if (ti) ti.value = t.title; }
      touch(); refreshChips(f, focus);
      if (f === 'cities') locate(added);
      if (f === 'countries') locate(t.cities.filter(c => !TA.geo.cityLL(c, t)));
    }
    async function locate(names) {
      for (const n of names) {
        try { if (await TA.geo.resolve(t, n, t.countries)) { touch(); } } catch { }
        if (el.isConnected && U.$('[data-chips="cities"]', el)) refreshChips('cities', false);
      }
    }
    function pickCity(name) {
      const m = U.modal(`<div class="row-inline"><input type="text" id="cp-q" value="${E(name)}"><button class="btn" id="cp-go">搜尋</button></div>
        <p class="hint">選擇正確的地點；也可以改用英文或當地名稱搜尋。</p><div class="cp-list"><p class="muted">搜尋中…</p></div>`, { title: `「${name}」在哪裡？`, small: true });
      const run = async () => {
        const box = U.$('.cp-list', m.el);
        box.innerHTML = '<p class="muted">搜尋中…</p>';
        let list = [];
        try { list = await TA.geo.search(U.$('#cp-q', m.el).value.trim(), t.countries); } catch { }
        if (!list.length) try { list = await TA.geo.search(U.$('#cp-q', m.el).value.trim(), []); } catch { }
        box.innerHTML = list.length ? list.map((r, i) => `<button class="cp-item" data-i="${i}"><b>${E(r.label || name)}</b><small>${r.ll.join(', ')}</small></button>`).join('') : '<p class="muted">找不到，換個寫法試試。</p>';
        box.onclick = e => {
          const b = e.target.closest('.cp-item'); if (!b) return;
          const r = list[+b.dataset.i];
          t.geo = t.geo || {}; t.geo[name] = { ll: r.ll, label: r.label };
          touch(); refreshChips('cities', false); m.close();
        };
      };
      U.$('#cp-go', m.el).onclick = run;
      U.$('#cp-q', m.el).addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
      run();
    }
    function refreshChips(f, focus = true) {
      const box = U.$(`[data-chips="${f}"]`, el);
      const inp = U.$('input', box);
      const tmp = document.createElement('div');
      tmp.innerHTML = chipsHtml(f, t[f], inp.placeholder, inp.getAttribute('list'), t);
      box.replaceWith(tmp.firstElementChild);
      if (focus) U.$(`[data-chips="${f}"] input`, el).focus();
    }

    el.addEventListener('click', async e => {
      const cd = e.target.closest('[data-chip-del]');
      if (cd) { const f = cd.closest('.chips').dataset.chips; t[f].splice(+cd.dataset.chipDel, 1); touch(); refreshChips(f, false); return; }
      const cc = e.target.closest('.chip-x[data-city]');
      if (cc) { pickCity(cc.dataset.city); return; }
      const j = e.target.closest('[data-jump]');
      if (j) { e.preventDefault(); document.getElementById(j.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      const a = e.target.closest('[data-act]');
      if (!a) return;
      const i = +a.dataset.i, k = +a.dataset.k, act = a.dataset.act;
      switch (act) {
        case 'save': return save();
        case 'delete':
          if (await U.confirm(`確定刪除「${t.title}」？刪除後無法復原。`, { ok: '刪除', danger: true })) { dirty = false; localStorage.removeItem(draftKey); S.remove(t.id); location.hash = '#/'; }
          return;
        case 'toggle-day': { const id = t.days[i].id; open.has(id) ? open.delete(id) : open.add(id); paint(); return; }
        case 'expand-all': if (open.size) open.clear(); else t.days.forEach(d => open.add(d.id)); paint(); return;
        case 'day-add': {
          const last = t.days[t.days.length - 1];
          const date = last?.date ? U.addDays(last.date, 1) : (t.startDate || '');
          const d = newDay(date, last?.hotel || ''); d.hotelUrl = last?.hotelUrl || ''; d.stops.push(newStop());
          t.days.push(d); open.add(d.id);
          if (date && (!t.endDate || date > t.endDate)) t.endDate = date;
          if (!t.startDate) t.startDate = date;
          touch(); paint();
          setTimeout(() => document.getElementById('ed-day-' + (t.days.length - 1))?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
          return;
        }
        case 'gen-days': {
          if (!t.startDate || !t.endDate) return U.toast('請先填寫出發日與回程日', 'err');
          const n = U.diffDays(t.startDate, t.endDate) + 1;
          if (n > 90 || n < 1) return U.toast('日期範圍不正確', 'err');
          let added = 0;
          for (let x = 0; x < n; x++) { const date = U.addDays(t.startDate, x); if (!t.days.some(d => d.date === date)) { t.days.push(newDay(date)); added++; } }
          t.days.sort((p, q) => (p.date || '').localeCompare(q.date || ''));
          touch(); paint(); U.toast(added ? `新增了 ${added} 天` : '天數已經齊全');
          return;
        }
        case 'shift-days': {
          const off = U.diffDays(t.days[0].date, t.startDate);
          t.days.forEach(d => { if (d.date) d.date = U.addDays(d.date, off); });
          t.endDate = t.days[t.days.length - 1].date;
          touch(); paint(); U.toast(`日期已${off > 0 ? '往後' : '往前'}移動 ${Math.abs(off)} 天`);
          return;
        }
        case 'day-up': case 'day-down': {
          const to = act === 'day-up' ? i - 1 : i + 1;
          if (to < 0 || to >= t.days.length) return;
          const dates = t.days.map(d => d.date);
          [t.days[i], t.days[to]] = [t.days[to], t.days[i]];
          t.days.forEach((d, x) => (d.date = dates[x]));
          touch(); paint(); return;
        }
        case 'day-dup': {
          const c = U.clone(t.days[i]); c.id = U.uid('d'); c.blocks.forEach(b => (b.id = U.uid('b'))); c.stops.forEach(p => (p.id = U.uid('p')));
          c.date = c.date ? U.addDays(c.date, 1) : '';
          t.days.splice(i + 1, 0, c); open.add(c.id); touch(); paint(); return;
        }
        case 'day-del':
          if (await U.confirm(`刪除第 ${i + 1} 天（${UI.dot(t.days[i].date, false)}）的所有內容？`, { ok: '刪除', danger: true })) { t.days.splice(i, 1); touch(); paint(); }
          return;
        case 'stop-add': t.days[i].stops.push(newStop()); touch(); paint(); U.$$(`.stop-name[data-i="${i}"]`, el).pop()?.focus(); return;
        case 'stop-del': t.days[i].stops.splice(k, 1); touch(); paint(); return;
        case 'blk-add': t.days[i].blocks.push({ id: U.uid('b'), title: a.dataset.title, body: '', open: false }); touch(); paint(); return;
        case 'blk-del': if (await U.confirm('刪除這個區塊？', { ok: '刪除', danger: true })) { t.days[i].blocks.splice(+a.dataset.j, 1); touch(); paint(); } return;
        case 'sec-add': {
          const tp = SECTION_TEMPLATES[k];
          t.sections.push({ id: U.uid('s'), title: tp.title, body: tp.body }); touch(); paint();
          setTimeout(() => U.$$('.ed-sec', el).pop()?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); return;
        }
        case 'sec-del': if (await U.confirm(`刪除「${t.sections[k].title}」分頁？`, { ok: '刪除', danger: true })) { t.sections.splice(k, 1); touch(); paint(); } return;
        case 'sec-up': case 'sec-down': {
          const to = act === 'sec-up' ? k - 1 : k + 1;
          if (to < 0 || to >= t.sections.length) return;
          [t.sections[k], t.sections[to]] = [t.sections[to], t.sections[k]]; touch(); paint(); return;
        }
        case 'fact-add': t.facts = t.facts || []; t.facts.push({ label: a.dataset.label, value: '' }); touch(); paint(); return;
        case 'fact-del': t.facts.splice(k, 1); touch(); paint(); return;
        // ---- 訂位 ----
        case 'bk-add': {
          const b = { id: U.uid('k'), type: a.dataset.type };
          if (b.type === 'hotel') { b.checkin = t.startDate || ''; b.checkout = t.startDate ? U.addDays(t.startDate, 1) : ''; b.checkinTime = '15:00'; b.checkoutTime = '11:00'; }
          if (b.type === 'train') b.kind = '火車';
          t.bookings.push(b); bkOpen.add(b.id); touch(); paint();
          setTimeout(() => U.$$('.bk-ed', el).pop()?.querySelector('input,select')?.focus(), 50);
          return;
        }
        case 'bk-toggle': { const id = t.bookings[i].id; bkOpen.has(id) ? bkOpen.delete(id) : bkOpen.add(id); paint(); return; }
        case 'bk-dup': { const c = U.clone(t.bookings[i]); c.id = U.uid('k'); c.code = ''; t.bookings.splice(i + 1, 0, c); bkOpen.add(c.id); touch(); paint(); return; }
        case 'bk-del':
          if (await U.confirm(`刪除「${TA.bookings.titleOf(t.bookings[i])}」？`, { ok: '刪除', danger: true })) { t.bookings.splice(i, 1); touch(); paint(); }
          return;
        case 'bk-from-days': {
          const add = TA.bookings.hotelsFromDays(t);
          if (!add.length) return U.toast('每日行程的住宿都已經有訂房了');
          t.bookings.push(...add); touch(); paint(); U.toast(`新增了 ${add.length} 筆訂房，記得補上訂位代號與取消期限`);
          return;
        }
      }
    });

    function save() {
      if (el.querySelector('img.uploading')) return U.toast('圖片還在上傳中，請稍候', 'err');
      if (!t.title.trim()) t.title = t.cities.join('・') || t.countries.join('・') || '未命名旅程';
      // 整理：清掉空白的站點、淨化圖文內容
      t.days.forEach(d => {
        d.stops = (d.stops || []).filter(p => p.name.trim() || p.time || p.url);
        d.notes = R.sanitize(d.notes);
        d.blocks.forEach(b => (b.body = R.sanitize(b.body)));
      });
      t.intro = R.sanitize(t.intro);
      t.sections.forEach(s => (s.body = R.sanitize(s.body)));
      t.facts = (t.facts || []).filter(f => f.label.trim() || f.value.trim());
      // 訂位：去掉完全空白的、依日期排序
      (t.bookings || []).forEach(b => { if (b.note) b.note = R.isEmpty(TA.bookings.noteHtml(b.note)) ? '' : R.sanitize(TA.bookings.noteHtml(b.note)); });
      t.bookings = TA.bookings.sorted((t.bookings || []).filter(b => Object.keys(b).some(k => !['id', 'type', 'kind', 'checkinTime', 'checkoutTime'].includes(k) && String(b[k] || '').trim())));
      t.days.sort((p, q) => (p.date || '9').localeCompare(q.date || '9'));
      if (!t.startDate && t.days[0]?.date) t.startDate = t.days[0].date;
      if (!t.endDate && t.days.length) t.endDate = t.days[t.days.length - 1].date || t.startDate;
      t.v = 2;
      S.upsert(t);
      dirty = false;
      localStorage.removeItem(draftKey);
      U.toast('已儲存');
      if (isNew) { location.hash = `#/trip/${t.id}/edit`; return; }
      el.querySelector('.ed-state')?.classList.remove('dirty');
    }
    const onKey = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
    document.addEventListener('keydown', onKey);
    const onUnload = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onUnload);

    paint(false);

    return {
      cleanup() { document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); sortables.forEach(s => s.destroy()); uninstall(); },
      canLeave() { return !dirty || window.confirm('有尚未儲存的變更，確定要離開嗎？（草稿已暫存，下次打開可以還原）'); },
    };
  }

  TA.views = TA.views || {};
  TA.views.editor = render;
})();
