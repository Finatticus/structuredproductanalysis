/* 旅行工具箱：記帳與分帳
 * #/tool/expense            所有旅程的花費總覽
 * #/tool/expense/<tripId>   這趟的記帳：快速新增、每人分攤、誰該給誰
 * 每趟資料存在雲端紀錄 __exp_<tripId>：
 *   { tripId, people: [{id, name}], rates: {JPY: 0.21}（只存手動鎖定的匯率，其餘用即時匯率）, curs: [額外幣別],
 *     items: [{ id, date, title, amount, cur, who: [personId], payer, note, createdAt }] }
 * 只有管理者能新增修改，訪客只能看。 */
(function () {
  const U = TA.u, S = TA.store, E = TA.u.esc, UI = TA.ui;
  const ME = 'me';
  const recId = tripId => '__exp_' + tripId;

  const load = trip => {
    const r = S.record(recId(trip.id));
    const d = U.clone(r ? { people: r.people, rates: r.rates, curs: r.curs, items: r.items } : {});
    d.people = d.people?.length ? d.people : [{ id: ME, name: '我' }];
    d.rates = d.rates || {}; d.curs = d.curs || []; d.items = d.items || [];
    return d;
  };
  const save = (trip, d) => S.saveRecord(recId(trip.id), 'expense', `記帳：${trip.title}（非旅程）`, { tripId: trip.id, ...d });

  // ---------- 幣別與匯率 ----------
  /** 這趟可用的幣別：台幣 + 旅程國家的貨幣 + 手動加的 */
  function currencies(trip, d) {
    const set = new Set(['TWD']);
    (trip.countries || []).forEach(n => { const c = TA.countries.find(n); if (c?.cur) set.add(c.cur); });
    d.curs.forEach(c => set.add(c));
    return [...set];
  }
  const localCur = (trip, d) => currencies(trip, d).find(c => c !== 'TWD') || 'TWD';
  /** 1 單位外幣 = ? 台幣；手動鎖定的優先 */
  function twdPer(cur, d) {
    if (cur === 'TWD') return 1;
    if (d.rates[cur]) return d.rates[cur];
    const r = TA.ticker.rates();
    return r?.rates?.[cur] && r.rates.TWD ? r.rates.TWD / r.rates[cur] : null;
  }
  const rateText = v => v == null ? '—' : v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(3) : v.toPrecision(4);
  const DIGITS = { TWD: 0, JPY: 0, KRW: 0, VND: 0, IDR: 0, HUF: 0, CLP: 0, ISK: 0 };
  function money(v, cur) {
    const dg = DIGITS[cur] ?? 2;
    const num = Number(v || 0);
    const txt = Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dg });
    let sym = cur;
    try { sym = new Intl.NumberFormat('zh-TW', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(p => p.type === 'currency')?.value || cur; } catch { }
    if (cur === 'TWD') sym = 'NT$';
    return `${num < 0 ? '−' : ''}${sym}${/^[A-Z]{3}$/.test(sym) ? ' ' : ''}${txt}`;
  }

  // ---------- 計算 ----------
  function compute(trip, d) {
    const per = {};
    d.people.forEach(p => (per[p.id] = { share: 0, paid: 0, orig: {} }));
    let total = 0, missing = false;
    const byCur = {};
    for (const x of d.items) {
      const r = twdPer(x.cur, d);
      if (r == null) { missing = true; continue; }
      const twd = x.amount * r;
      total += twd;
      byCur[x.cur] = (byCur[x.cur] || 0) + x.amount;
      const who = x.who.filter(id => per[id]);
      if (who.length) who.forEach(id => { per[id].share += twd / who.length; per[id].orig[x.cur] = (per[id].orig[x.cur] || 0) + x.amount / who.length; });
      if (per[x.payer]) per[x.payer].paid += twd;
    }
    return { per, total, byCur, missing };
  }
  /** 誰該給誰：欠錢最多的先還給被欠最多的 */
  function settle(per) {
    const bal = Object.entries(per).map(([id, p]) => ({ id, v: p.paid - p.share })).filter(b => Math.abs(b.v) >= 1);
    const debt = bal.filter(b => b.v < 0).sort((a, b) => a.v - b.v), cred = bal.filter(b => b.v > 0).sort((a, b) => b.v - a.v);
    const out = [];
    let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      const n = Math.min(-debt[i].v, cred[j].v);
      if (n >= 1) out.push({ from: debt[i].id, to: cred[j].id, v: n });
      debt[i].v += n; cred[j].v -= n;
      if (debt[i].v > -1) i++;
      if (cred[j].v < 1) j++;
    }
    return out;
  }

  // ---------- 這趟的記帳 ----------
  function renderTrip(el, trip) {
    const guest = S.isGuest();
    const LAST = 'ta.exp.last.' + trip.id;
    let last = {};
    try { last = JSON.parse(localStorage.getItem(LAST) || '{}'); } catch { }
    let d = load(trip);
    let sign = 1;
    let setupOpen = !guest && d.people.length < 2 && !d.items.length;
    const nameOf = id => d.people.find(p => p.id === id)?.name || '（已移除）';
    const dayOf = date => { const i = (trip.days || []).findIndex(x => x.date === date); return i >= 0 ? `Day ${i + 1}` : date && trip.startDate && date < trip.startDate ? '行前' : ''; };

    function formHtml() {
      const curs = currencies(trip, d), lc = localCur(trip, d);
      const cur = curs.includes(last.cur) ? last.cur : lc;
      const who = (last.who || d.people.map(p => p.id)).filter(id => d.people.some(p => p.id === id));
      const payer = d.people.some(p => p.id === last.payer) ? last.payer : ME;
      return `<form class="ex-add panel" autocomplete="off">
        <div class="ex-line">
          <input type="text" id="ex-title" placeholder="項目，例如：晚餐、地鐵票、門票" enterkeyhint="next">
        </div>
        <div class="ex-line ex-amt">
          <button type="button" class="ex-sign${sign < 0 ? ' neg' : ''}" data-act="sign" title="切換支出／退款">${sign < 0 ? '−' : '+'}</button>
          <input type="text" id="ex-amount" inputmode="decimal" placeholder="金額" enterkeyhint="done">
          <div class="seg ex-cur">${curs.map(c => `<button type="button" data-cur="${c}" class="${c === cur ? 'on' : ''}">${c === 'TWD' ? '台幣' : E(TA.countries.curName(c))}</button>`).join('')}</div>
        </div>
        ${d.people.length > 1 ? `<div class="ex-line ex-who"><span class="ex-lbl">分攤</span>
          ${d.people.map(p => `<button type="button" class="chip-tg${who.includes(p.id) ? ' on' : ''}" data-who="${p.id}">${E(p.name)}</button>`).join('')}
          <span class="ex-lbl ex-payer-l">付款</span><select id="ex-payer">${d.people.map(p => `<option value="${p.id}" ${p.id === payer ? 'selected' : ''}>${E(p.name)}</option>`).join('')}</select></div>` : ''}
        <div class="ex-line ex-more">
          <input type="date" id="ex-date" value="${U.todayStr()}">
          <input type="text" id="ex-note" placeholder="備註（選填）">
          <button class="btn primary" type="submit">${UI.icon('plus', 16)}記一筆</button>
        </div>
        <p class="hint ex-preview"></p>
      </form>`;
    }

    function setupHtml() {
      const curs = currencies(trip, d).filter(c => c !== 'TWD');
      const live = TA.ticker.rates();
      return `<section class="ex-setup${setupOpen ? ' open' : ''}">
        <button class="ex-setup-h" data-act="setup">
          <span><b>同行</b>${d.people.map(p => E(p.name)).join('、')}</span>
          ${curs.map(c => `<span><b>${c}</b>${rateText(twdPer(c, d))}${d.rates[c] ? `<i class="ex-lock">${UI.icon('lock', 12)}</i>` : ''}</span>`).join('')}
          ${guest ? '' : `<em>${setupOpen ? '收起' : '設定'}</em>`}
        </button>
        ${setupOpen && !guest ? `<div class="ex-setup-b">
          <div class="ex-sh">同行的人</div>
          <div class="ex-people">${d.people.map(p => `<span class="ex-person"><input type="text" value="${E(p.name)}" data-pid="${p.id}" aria-label="名稱">${p.id === ME ? '' : `<button class="icon-btn" data-act="p-del" data-pid="${p.id}" title="移除">${UI.icon('x', 14)}</button>`}</span>`).join('')}
            <form class="ex-p-add"><input type="text" id="ex-p-new" placeholder="新增同行者"><button class="btn sm" type="submit">${UI.icon('plus', 14)}加入</button></form></div>
          <div class="ex-sh">匯率 <em class="hint">預設跟著即時匯率浮動；手動修改後會鎖定</em></div>
          ${curs.length ? curs.map(c => `<div class="ex-rate"><span>1 ${c}（${E(TA.countries.curName(c))}）＝</span>
            <input type="text" inputmode="decimal" data-rate="${c}" value="${rateText(twdPer(c, d))}"><span>台幣</span>
            ${d.rates[c] ? `<span class="ex-st locked">${UI.icon('lock', 12)}已鎖定</span><button class="btn sm ghost" data-act="unlock" data-cur="${c}">改回即時</button>` : `<span class="ex-st">即時${live?.updated ? '・' + new Date(live.updated).toLocaleDateString('zh-TW') : ''}</span>`}
            ${d.curs.includes(c) ? `<button class="icon-btn" data-act="cur-del" data-cur="${c}" title="移除幣別">${UI.icon('x', 14)}</button>` : ''}</div>`).join('') : '<p class="muted">這趟旅程沒有外幣。</p>'}
          <form class="ex-cur-add"><input type="text" id="ex-cur-new" maxlength="3" placeholder="其他幣別代碼，例如 USD、EUR"><button class="btn sm" type="submit">${UI.icon('plus', 14)}加入幣別</button></form>
        </div>` : ''}
      </section>`;
    }

    function summaryHtml() {
      if (!d.items.length) return `<div class="empty-box">${guest ? '這趟還沒有記帳。' : '還沒有花費。上面填項目和金額就能記一筆，每個人要分攤多少會自動算好。'}</div>`;
      const { per, total, byCur, missing } = compute(trip, d);
      const lc = localCur(trip, d), lr = twdPer(lc, d);
      const alt = v => lc !== 'TWD' && lr ? `<small>≈ ${money(v / lr, lc)}</small>` : '';
      const multi = d.people.length > 1;
      const st = multi ? settle(per) : [];
      return `<section class="ex-sum">
        <div class="ex-total"><span class="ex-sh">總花費</span><b>${money(total, 'TWD')}</b>${alt(total)}
          <span class="ex-bycur">${Object.entries(byCur).map(([c, v]) => money(v, c)).join('　')}</span>
          ${missing ? '<p class="hint">有些幣別還沒取得匯率，沒算進台幣合計。</p>' : ''}</div>
        ${multi ? `<div class="ex-people-sum">${d.people.map(p => { const x = per[p.id]; return `<div class="ex-ps">
          <span class="ex-pn">${E(p.name)}</span>
          <b>${money(x.share, 'TWD')}</b>${alt(x.share)}
          ${Object.keys(x.orig).some(c => c !== lc) && Object.keys(x.orig).length > 1 || Object.keys(x.orig).some(c => c !== lc && c !== 'TWD') ? `<span class="ex-orig">原幣 ${Object.entries(x.orig).map(([c, v]) => money(v, c)).join(' + ')}</span>` : ''}
          <span class="ex-paid">已付 ${money(x.paid, 'TWD')}</span></div>`; }).join('')}</div>
        <div class="ex-settle"><span class="ex-sh">結算</span>${st.length ? st.map(s => `<div><b>${E(nameOf(s.from))}</b> 給 <b>${E(nameOf(s.to))}</b><span class="ex-sv">${money(s.v, 'TWD')}${lc !== 'TWD' && lr ? `<small>≈ ${money(s.v / lr, lc)}</small>` : ''}</span></div>`).join('') : '<div class="muted">大家都付清了</div>'}</div>` : ''}
      </section>`;
    }

    function listHtml() {
      if (!d.items.length) return '';
      const groups = new Map();
      d.items.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || '')).forEach(x => {
        const k = x.date || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x);
      });
      const all = d.people.length;
      return `<section class="ex-list">${[...groups].map(([date, list]) => {
        const sum = list.reduce((s, x) => s + x.amount * (twdPer(x.cur, d) || 0), 0);
        return `<div class="ex-day"><div class="pk-gh"><span>${date ? UI.dot(date) + '　' + UI.week(date) : '未填日期'}</span>${dayOf(date) ? `<small>${dayOf(date)}</small>` : ''}<span class="ex-dsum">${money(sum, 'TWD')}</span></div>
          ${list.map(x => `<button class="ex-item${x.amount < 0 ? ' neg' : ''}" data-id="${x.id}"${guest ? ' disabled' : ''}>
            <span class="ex-it"><b>${E(x.title)}</b>
              <small>${all > 1 ? (x.who.length === all ? '全部分攤' : x.who.map(nameOf).map(E).join('、')) + `・${E(nameOf(x.payer))}付` : ''}${x.note ? (all > 1 ? '・' : '') + E(x.note) : ''}</small></span>
            <span class="ex-am">${money(x.amount, x.cur)}${x.cur !== 'TWD' && twdPer(x.cur, d) ? `<small>${money(x.amount * twdPer(x.cur, d), 'TWD')}</small>` : ''}</span>
          </button>`).join('')}</div>`;
      }).join('')}</section>`;
    }

    function paint() {
      el.innerHTML = `<div class="narrow">
        <a class="back" href="#/trip/${trip.id}">${UI.icon('back', 16)}${E(trip.title)}</a>
        <header class="page-head slim"><div class="eyebrow">Expenses</div><h1 class="display">記帳與分帳</h1>
          <p class="lede">${E(trip.title)}　${UI.range(trip.startDate, trip.endDate)}</p></header>
        ${setupHtml()}
        ${guest ? '' : formHtml()}
        ${summaryHtml()}
        ${listHtml()}
      </div>`;
      preview();
    }
    function repaintKeep() {
      // 重畫但保留正在輸入的表單
      const f = U.$('.ex-add', el);
      const keep = f && { t: U.$('#ex-title', f).value, a: U.$('#ex-amount', f).value, n: U.$('#ex-note', f).value, dt: U.$('#ex-date', f).value };
      paint();
      if (keep) { U.$('#ex-title', el).value = keep.t; U.$('#ex-amount', el).value = keep.a; U.$('#ex-note', el).value = keep.n; U.$('#ex-date', el).value = keep.dt; }
    }
    const commit = () => { save(trip, d); d = load(trip); };
    const rememberForm = () => {
      const f = U.$('.ex-add', el); if (!f) return;
      last = {
        cur: U.$('.ex-cur .on', f)?.dataset.cur,
        who: U.$$('[data-who]', f).length ? U.$$('[data-who].on', f).map(b => b.dataset.who) : last.who,
        payer: U.$('#ex-payer', f)?.value || ME,
      };
      try { localStorage.setItem(LAST, JSON.stringify(last)); } catch { }
    };
    const parseAmt = s => { const v = parseFloat(String(s).replace(/[,，\s]/g, '').replace(/[－−]/g, '-')); return isFinite(v) ? v : NaN; };

    /** 輸入時即時顯示換算 */
    function preview() {
      const f = U.$('.ex-add', el); if (!f) return;
      const p = U.$('.ex-preview', f);
      const a = parseAmt(U.$('#ex-amount', f).value), cur = U.$('.ex-cur .on', f)?.dataset.cur || 'TWD';
      if (!isFinite(a) || !a) { p.textContent = ''; return; }
      const amt = Math.abs(a) * (a < 0 ? -1 : sign);
      const r = twdPer(cur, d);
      const n = U.$$('[data-who]', f).length ? U.$$('[data-who].on', f).length : 1;
      const twd = r ? amt * r : null;
      p.textContent = [cur !== 'TWD' && twd != null ? `≈ ${money(twd, 'TWD')}` : '', n > 1 && twd != null ? `每人 ${money(twd / n, 'TWD')}${cur !== 'TWD' ? `（${money(amt / n, cur)}）` : ''}` : '', amt < 0 ? '退款／收入' : ''].filter(Boolean).join('　');
    }

    function addItem() {
      const f = U.$('.ex-add', el);
      const title = U.$('#ex-title', f).value.trim();
      const a = parseAmt(U.$('#ex-amount', f).value);
      if (!isFinite(a) || !a) { U.$('#ex-amount', f).focus(); return U.toast('請輸入金額', 'err'); }
      const whoBtns = U.$$('[data-who]', f);
      const who = whoBtns.length ? whoBtns.filter(b => b.classList.contains('on')).map(b => b.dataset.who) : [ME];
      if (!who.length) return U.toast('至少勾選一個分攤的人', 'err');
      const now = new Date().toISOString();
      d.items.push({
        id: U.uid('x'), date: U.$('#ex-date', f).value, title: title || '未命名', amount: Math.abs(a) * (a < 0 ? -1 : sign),
        cur: U.$('.ex-cur .on', f)?.dataset.cur || 'TWD', who, payer: U.$('#ex-payer', f)?.value || ME, note: U.$('#ex-note', f).value.trim(), createdAt: now,
      });
      rememberForm(); commit();
      const dt = U.$('#ex-date', f).value;
      sign = 1; paint();
      U.$('#ex-date', el).value = dt;
      U.toast('已記一筆');
      U.$('#ex-title', el).focus();
    }

    function editDialog(x) {
      const curs = currencies(trip, d);
      if (!curs.includes(x.cur)) curs.push(x.cur);
      const m = U.modal(`
        <label class="fld"><span>項目</span><input type="text" id="xe-title" value="${E(x.title)}"></label>
        <div class="row2">
          <label class="fld"><span>金額 <em class="hint">負數代表退款或收入</em></span><input type="text" inputmode="decimal" id="xe-amount" value="${x.amount}"></label>
          <label class="fld"><span>幣別</span><select id="xe-cur">${curs.map(c => `<option value="${c}" ${c === x.cur ? 'selected' : ''}>${c === 'TWD' ? '台幣' : E(TA.countries.curName(c))}（${c}）</option>`).join('')}</select></label>
        </div>
        ${d.people.length > 1 ? `<div class="fld"><span>分攤的人</span><div class="ex-who">${d.people.map(p => `<button type="button" class="chip-tg${x.who.includes(p.id) ? ' on' : ''}" data-who="${p.id}">${E(p.name)}</button>`).join('')}</div></div>
        <label class="fld"><span>付款人</span><select id="xe-payer">${d.people.map(p => `<option value="${p.id}" ${p.id === x.payer ? 'selected' : ''}>${E(p.name)}</option>`).join('')}</select></label>` : ''}
        <div class="row2">
          <label class="fld"><span>日期</span><input type="date" id="xe-date" value="${E(x.date || '')}"></label>
          <label class="fld"><span>備註</span><input type="text" id="xe-note" value="${E(x.note || '')}"></label>
        </div>
        <div class="modal-actions"><button class="btn danger" id="xe-del">刪除</button><span style="flex:1"></span>
          <button class="btn ghost" data-close>取消</button><button class="btn primary" id="xe-save">儲存</button></div>`, { title: '編輯花費' });
      const $ = s => U.$(s, m.el);
      m.el.addEventListener('click', e => { const b = e.target.closest('[data-who]'); if (b) b.classList.toggle('on'); });
      $('#xe-save').onclick = () => {
        const a = parseAmt($('#xe-amount').value);
        if (!isFinite(a) || !a) return U.toast('請輸入金額', 'err');
        const btns = U.$$('[data-who]', m.el);
        const who = btns.length ? btns.filter(b => b.classList.contains('on')).map(b => b.dataset.who) : x.who;
        if (!who.length) return U.toast('至少勾選一個分攤的人', 'err');
        const it = d.items.find(i => i.id === x.id);
        Object.assign(it, { title: $('#xe-title').value.trim() || '未命名', amount: a, cur: $('#xe-cur').value, who, payer: $('#xe-payer')?.value || it.payer, date: $('#xe-date').value, note: $('#xe-note').value.trim() });
        commit(); m.close(); repaintKeep(); U.toast('已儲存');
      };
      $('#xe-del').onclick = async () => {
        if (!(await U.confirm(`刪除「${x.title}」？`, { ok: '刪除', danger: true }))) return;
        d.items = d.items.filter(i => i.id !== x.id); commit(); m.close(); repaintKeep();
      };
    }

    paint();
    // 即時匯率：先畫，拿到後再更新
    TA.ticker.loadRates().then(() => { if (el.isConnected) repaintKeep(); });

    el.addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      if (f.classList.contains('ex-add')) return addItem();
      if (f.classList.contains('ex-p-add')) {
        const name = U.$('#ex-p-new', f).value.trim(); if (!name) return;
        const id = U.uid('p');
        d.people.push({ id, name });
        if (last.who) { last.who.push(id); try { localStorage.setItem(LAST, JSON.stringify(last)); } catch { } }
        commit(); repaintKeep(); U.$('#ex-p-new', el)?.focus(); return;
      }
      if (f.classList.contains('ex-cur-add')) {
        const c = U.$('#ex-cur-new', f).value.trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(c)) return U.toast('請輸入三個英文字母的幣別代碼', 'err');
        const live = TA.ticker.rates();
        if (live?.rates && !live.rates[c]) return U.toast(`找不到 ${c} 的匯率`, 'err');
        if (!currencies(trip, d).includes(c)) d.curs.push(c);
        commit(); repaintKeep();
      }
    });
    el.addEventListener('input', e => { if (e.target.id === 'ex-amount') preview(); });
    el.addEventListener('keydown', e => {
      // 項目欄按 Enter 跳到金額，不要直接送出
      if (e.key === 'Enter' && e.target.id === 'ex-title') { e.preventDefault(); U.$('#ex-amount', el).focus(); }
    });
    el.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.pid) { const p = d.people.find(x => x.id === t.dataset.pid); const v = t.value.trim(); if (p && v) { p.name = v; commit(); repaintKeep(); } return; }
      if (t.dataset.rate) {
        const v = parseAmt(t.value);
        if (!(v > 0)) { t.value = rateText(twdPer(t.dataset.rate, d)); return U.toast('匯率要大於 0', 'err'); }
        d.rates[t.dataset.rate] = v; commit(); repaintKeep(); U.toast(`${t.dataset.rate} 匯率已鎖定`); return;
      }
      if (t.id === 'ex-payer') { rememberForm(); }
    });
    el.addEventListener('click', async e => {
      const cb = e.target.closest('[data-cur]');
      if (cb && cb.closest('.ex-cur')) { U.$$('.ex-cur button', el).forEach(b => b.classList.toggle('on', b === cb)); rememberForm(); preview(); return; }
      const wb = e.target.closest('[data-who]');
      if (wb && wb.closest('.ex-add')) { wb.classList.toggle('on'); rememberForm(); preview(); return; }
      const it = e.target.closest('.ex-item');
      if (it && !guest) return editDialog(d.items.find(x => x.id === it.dataset.id));
      const a = e.target.closest('[data-act]'); if (!a) return;
      switch (a.dataset.act) {
        case 'sign': sign = -sign; a.classList.toggle('neg', sign < 0); a.textContent = sign < 0 ? '−' : '+'; preview(); return;
        case 'setup': if (guest) return; setupOpen = !setupOpen; repaintKeep(); return;
        case 'unlock': delete d.rates[a.dataset.cur]; commit(); repaintKeep(); U.toast('已改回即時匯率'); return;
        case 'cur-del': {
          const c = a.dataset.cur;
          if (d.items.some(x => x.cur === c)) return U.toast(`還有用 ${c} 記的花費，不能移除`, 'err');
          d.curs = d.curs.filter(x => x !== c); delete d.rates[c]; commit(); repaintKeep(); return;
        }
        case 'p-del': {
          const id = a.dataset.pid, p = d.people.find(x => x.id === id);
          const used = d.items.filter(x => x.who.includes(id) || x.payer === id).length;
          if (!(await U.confirm(used ? `「${p.name}」出現在 ${used} 筆花費裡，移除後這些花費改由其他人分攤（他付的改成我付）。確定移除？` : `移除「${p.name}」？`, { ok: '移除', danger: true }))) return;
          d.people = d.people.filter(x => x.id !== id);
          d.items.forEach(x => { x.who = x.who.filter(w => w !== id); if (!x.who.length) x.who = [ME]; if (x.payer === id) x.payer = ME; });
          commit(); repaintKeep(); return;
        }
      }
    });
  }

  // ---------- 總覽 ----------
  function renderOverview(el) {
    const trips = S.all().slice().sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    const rows = trips.map(t => {
      const r = S.record(recId(t.id));
      const d = load(t);
      return { t, n: d.items.length, total: r ? compute(t, d).total : 0 };
    });
    const paint = () => {
      const row = ({ t, n, total }) => `<a class="pk-trip" href="#/tool/expense/${t.id}">
        <span class="c-date"><b>${UI.dot(t.startDate, false) || '—'}</b><span>${(t.startDate || '').slice(0, 4)}</span></span>
        <span class="c-title"><b>${E(t.title)}</b><span>${E((t.countries || []).join('、'))}　${UI.nDays(t)} 天</span></span>
        <span class="pk-st">${n ? `<b class="ex-ov">${money(total, 'TWD')}</b><small>${n} 筆</small>` : '<small class="muted">尚未記帳</small>'}</span>
      </a>`;
      const used = rows.filter(x => x.n), rest = rows.filter(x => !x.n);
      el.innerHTML = `<div class="narrow">
        <a class="back" href="#/tools">${UI.icon('back', 16)}旅行工具箱</a>
        <header class="page-head"><div class="eyebrow">Expenses</div><h1 class="display">記帳與分帳</h1>
          <p class="lede">選一段旅程，旅途中隨手記下花費，自動換算台幣、算出每個人要分攤多少。</p></header>
        ${used.length ? `<div class="group"><span>有記帳的旅程</span></div>${used.map(row).join('')}` : ''}
        ${rest.length ? `<div class="group"><span>${used.length ? '其他旅程' : '全部旅程'}</span></div>${rest.map(row).join('')}` : ''}
      </div>`;
    };
    paint();
    TA.ticker.loadRates().then(() => { if (!el.isConnected) return; rows.forEach(x => { if (x.n) x.total = compute(x.t, load(x.t)).total; }); paint(); });
  }

  const tool = TA.tools.get('expense');
  tool.status = 'ready';
  tool.render = (el, { trip, sub }) => {
    if (trip) return renderTrip(el, trip);
    if (sub) { el.innerHTML = `<div class="empty-box">找不到這段旅程<br><a class="btn" href="#/tool/expense">回記帳與分帳</a></div>`; return; }
    return renderOverview(el);
  };
  TA.expense = { load, compute, settle, money, count: id => S.record(recId(id))?.items?.length || 0 };
})();
