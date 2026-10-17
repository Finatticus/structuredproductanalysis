/* 工具箱、世界時鐘與匯率、設定、登入 */
(function () {
  const U = TA.u, S = TA.store, E = TA.u.esc, UI = TA.ui;
  TA.views = TA.views || {};

  // ---------- 工具箱 ----------
  TA.views.tools = function (el) {
    let sorting = false, sortable = null;
    function paint() {
      el.innerHTML = `<header class="page-head"><div class="eyebrow">Toolkit</div><h1 class="display">旅行工具箱</h1>
        <p class="lede">讓出發前與旅途中更順手的小工具，陸續開發中。</p>
        <div class="add-row"><button class="btn ${sorting ? 'primary' : 'ghost'} tools-reorder" data-act="sort">${sorting ? '完成排序' : '調整順序'}</button>
        ${sorting ? '<span class="muted">拖曳左側把手調整順序，完成後自動儲存</span>' : ''}</div></header>
        <div class="tool-list${sorting ? ' sorting' : ''}">${TA.tools.ordered().map(t => `
          <a class="tool" href="#/tool/${t.id}" data-id="${t.id}">
            ${sorting ? `<span class="handle">${UI.icon('drag', 18)}</span>` : `<span class="tool-ico">${UI.icon(t.id, 26)}</span>`}
            <span class="tool-txt"><b>${E(t.name)}</b><span>${E(t.desc)}</span></span>
            <span class="tool-st">${t.status === 'ready' ? '開啟' : '規劃中'}</span>
          </a>`).join('')}</div>`;
      sortable?.destroy(); sortable = null;
      if (sorting && window.Sortable) sortable = Sortable.create(U.$('.tool-list', el), {
        animation: 150, onEnd: () => TA.tools.saveOrder(U.$$('.tool', el).map(a => a.dataset.id)),
      });
    }
    paint();
    el.addEventListener('click', e => {
      if (e.target.closest('[data-act="sort"]')) { sorting = !sorting; paint(); if (!sorting) U.toast('順序已儲存'); return; }
      if (sorting && e.target.closest('.tool')) e.preventDefault();
    });
    return () => sortable?.destroy();
  };
  TA.views.tool = function (el, { id, tripId }) {
    const tool = TA.tools.get(id);
    if (!tool) { el.innerHTML = `<div class="empty-box">找不到這個工具<br><a class="btn" href="#/tools">回工具箱</a></div>`; return; }
    if (tool.status === 'ready' && tool.render) return tool.render(el, { trip: tripId ? S.get(tripId) : null, sub: tripId });
    el.innerHTML = `<div class="narrow">
      <a class="back" href="#/tools">${UI.icon('back', 16)}旅行工具箱</a>
      <header class="page-head"><span class="tool-ico big">${UI.icon(tool.id, 40)}</span><h1 class="display">${E(tool.name)}</h1><p class="lede">${E(tool.desc)}</p></header>
      <section class="panel"><h3>規劃中的功能</h3><ul class="plan-list">${tool.plan.map(p => `<li>${E(p)}</li>`).join('')}</ul>
      ${tool.perTrip ? '<p class="hint">完成後會在每段旅程頁面加上入口，資料跟著旅程保存。</p>' : ''}</section>
    </div>`;
  };

  // ---------- 世界時鐘與匯率 ----------
  TA.views.world = function (el) {
    el.innerHTML = `<header class="page-head"><div class="eyebrow">World Clock & Rates</div><h1 class="display">世界時鐘與匯率</h1>
      <p class="lede">依旅程中出現過的國家自動列出，新增旅程時會自動加入。</p></header>
      <div class="world-board"></div>`;
    const board = U.$('.world-board', el);
    const paint = () => TA.ticker.renderBoard(board);
    paint();
    TA.ticker.loadRates().then(paint);
    const timer = setInterval(paint, 20000);
    return () => clearInterval(timer);
  };

  // ---------- 設定 ----------
  TA.views.settings = function (el, { tab } = {}) {
    const tabs = `<nav class="tabs set-tabs"><a href="#/settings" class="${tab ? '' : 'on'}">設定</a>${S.isGuest() ? '' : `<a href="#/settings/health" class="${tab === 'health' ? 'on' : ''}">資料健檢</a>`}<a href="#/settings/help" class="${tab === 'help' ? 'on' : ''}">網站說明</a></nav>`;
    if (tab === 'health' && !S.isGuest()) {
      el.innerHTML = `<div class="narrow"><header class="page-head"><div class="eyebrow">Settings</div><h1 class="display">資料健檢</h1>
        <p class="lede">找出需要整理的地方，點「前往修改」直接跳到編輯頁的那個位置。</p></header>${tabs}<div class="hc"></div></div>`;
      TA.health.render(U.$('.hc', el));
      return;
    }
    if (tab === 'help') {
      el.innerHTML = `<div class="narrow"><header class="page-head"><div class="eyebrow">Settings</div><h1 class="display">網站說明</h1>
        <p class="lede">每個區塊怎麼用、資料怎麼存、數字怎麼算。</p></header>${tabs}${TA.views.helpHtml()}</div>`;
      el.addEventListener('click', e => { const ft = e.target.closest('.fold-title'); if (ft) ft.parentElement.classList.toggle('open'); });
      return;
    }
    const st = S.settings();
    const ext = S.externalImages().length;
    el.innerHTML = `<div class="narrow">
      <header class="page-head"><div class="eyebrow">Settings</div><h1 class="display">設定</h1></header>
      ${tabs}

      <section class="panel" id="theme-panel">
        <h3>網頁配色</h3>
        <p class="hint">只會改變這台裝置的顯示，每個人可以選自己喜歡的配色。</p>
        <div class="theme-grid">${UI.theme.list.map(t => `<button type="button" class="theme-opt${UI.theme.get() === t.id ? ' on' : ''}" data-theme-id="${t.id}"
          style="--sw-paper:${t.paper};--sw-surface:${t.surface};--sw-line:${t.line};--sw-primary:${t.primary};--sw-accent:${t.accent}"><span class="theme-sw"></span>${t.name}</button>`).join('')}</div>
        <label class="mini-check"><input type="checkbox" id="theme-auto" ${UI.theme.autoDark() ? 'checked' : ''} ${UI.theme.get() === 'dark' ? 'disabled' : ''}>手機或電腦切到深色模式時，自動改用深色</label>
      </section>

      <section class="panel admin-only">
        <h3>雲端資料</h3>
        <p class="hint">所有旅程存在你的 Google 試算表，圖片存在你的 Google Drive。</p>
        <dl class="kv">
          <div><dt>上次同步</dt><dd>${st.lastSync ? new Date(st.lastSync).toLocaleString('zh-TW') : '—'}</dd></div>
          <div><dt>旅程數</dt><dd>${S.all().length}</dd></div>
        </dl>
        <div class="add-row"><button class="btn" data-act="sync">${UI.icon('sync', 16)}立即同步</button></div>
      </section>

      <section class="panel admin-only" id="img-panel">
        <h3>圖片保存</h3>
        ${ext ? `<p>還有 <b>${ext}</b> 張圖片放在外部網站。搬到你自己的 Google Drive 後，就算原網站關閉，圖片也會一直保留。</p>
          <p class="hint">需要幾分鐘，過程中請保持此頁開啟；中斷了再按一次會接續進行。</p>
          <div class="progress" hidden><div class="bar"><i></i></div><span class="ptxt"></span></div>
          <button class="btn primary" data-act="images">開始搬移圖片</button>`
        : '<p>所有圖片都已存放在你的 Google Drive。</p>'}
      </section>

      <section class="panel admin-only" id="guest-panel">
        <h3>訪客密碼</h3>
        <p class="hint">用這些密碼登入的人只能瀏覽，不能修改任何內容。刪除後，使用該密碼的裝置下次開啟網站就會被登出。</p>
        <div class="gp-list"><p class="muted">讀取中…</p></div>
        <form class="gp-add">
          <input type="text" id="gp-token" placeholder="訪客密碼（至少 4 個字）" autocomplete="off">
          <input type="text" id="gp-label" placeholder="備註，例如：爸媽、同事" autocomplete="off">
          <button type="button" class="btn ghost" data-act="gp-rand">隨機產生</button>
          <button type="submit" class="btn">${UI.icon('plus', 16)}新增</button>
        </form>
      </section>

      <section class="panel" id="off-panel">
        <h3>離線資料</h3>
        <p class="hint">存到這台裝置的旅程，沒有網路也能打開。在旅程頁按「離線下載」新增。</p>
        ${(() => {
          const rec = TA.offline.records();
          const ids = Object.keys(rec).filter(id => S.get(id));
          return ids.length ? `<div class="off-rows">${ids.map(id => `<div class="off-row"><span><b>${E(S.get(id).title)}</b><small>${new Date(rec[id].at).toLocaleString('zh-TW')}・${rec[id].files} 張圖片${rec[id].bytes ? '・約 ' + TA.offline.fmtBytes(rec[id].bytes) : ''}</small></span>
            <button class="btn sm ghost" data-act="off-update" data-id="${id}">更新</button><button class="btn sm ghost" data-act="off-rm" data-id="${id}">移除</button></div>`).join('')}</div>`
            : '<p class="muted">目前沒有存到這台裝置的旅程。</p>';
        })()}
        <p class="hint off-usage"></p>
      </section>

      <section class="panel">
        <h3>地區</h3>
        <div class="row2">
          <label class="fld"><span>本國貨幣（匯率基準）</span><input type="text" id="baseCurrency" value="${E(st.baseCurrency)}" maxlength="3"></label>
          <label class="fld"><span>所在時區（時差基準）</span><input type="text" id="homeTz" value="${E(st.homeTz)}"></label>
        </div>
        <button class="btn" data-act="save-region">儲存</button>
      </section>

      <section class="panel admin-only">
        <h3>備份</h3>
        <p class="hint">下載一份完整備份檔，需要時可以再匯入。</p>
        <div class="add-row">
          <button class="btn" data-act="export">下載備份</button>
          <label class="btn ghost">匯入備份<input type="file" accept=".json,application/json" id="importFile" hidden></label>
        </div>
      </section>

      <section class="panel">
        <h3>登出</h3>
        <p class="hint">${S.isGuest() ? '目前是訪客模式（只能瀏覽）。登出後可以用管理者密碼重新登入。' : '登出後這台裝置會清除暫存資料，下次需要重新輸入密碼。雲端資料不受影響。'}</p>
        <button class="btn danger" data-act="logout">登出</button>
      </section>
    </div>`;

    // ---- 網頁配色 ----
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-theme-id]'); if (!b) return;
      UI.theme.set(b.dataset.themeId);
      U.$$('.theme-opt', el).forEach(x => x.classList.toggle('on', x === b));
      const cb = U.$('#theme-auto', el); if (cb) cb.disabled = b.dataset.themeId === 'dark';
    });
    U.$('#theme-auto', el)?.addEventListener('change', e => UI.theme.set(UI.theme.get(), e.target.checked));
    el.addEventListener('click', async e => {
      const a = e.target.closest('[data-act]');
      if (!a) return;
      const act = a.dataset.act;
      if (act === 'sync') {
        try { const r = await S.sync(); U.toast(`同步完成：雲端 ${r.pulled} 筆，上傳 ${r.pushed} 筆`); TA.app.rerender(); }
        catch (err) { U.toast('同步失敗：' + err.message, 'err'); }
      }
      if (act === 'images') {
        a.disabled = true; a.textContent = '搬移中…';
        const pg = U.$('.progress', el); pg.hidden = false;
        const bar = U.$('.bar i', el), txt = U.$('.ptxt', el);
        try {
          const t0 = Date.now();
          const r = await S.migrateImages((done, total, failed, working) => {
            bar.style.width = (done / total * 100).toFixed(1) + '%';
            const eta = done ? Math.ceil((Date.now() - t0) / done * (total - done) / 60000) : null;
            txt.textContent = `已完成 ${done} / ${total} 張${failed ? `（${failed} 張失敗）` : ''}`
              + (working ? `　正在處理第 ${done + 1}–${Math.min(done + 12, total)} 張…` : '')
              + (eta ? `　約剩 ${eta} 分鐘` : '');
          });
          U.toast(r.failed ? `完成，有 ${r.failed} 張無法下載（原網址可能已失效）` : '圖片已全部搬移完成');
          TA.app.rerender();
        } catch (err) {
          a.disabled = false; a.textContent = '繼續搬移';
          U.toast('搬移中斷：' + err.message + (/未知動作/.test(err.message) ? '（請先更新 Apps Script 程式）' : ''), 'err');
        }
      }
      if (act === 'save-region') {
        const tz = U.$('#homeTz', el).value.trim();
        try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { return U.toast('時區格式不正確，例如 Asia/Taipei', 'err'); }
        S.setSettings({ baseCurrency: U.$('#baseCurrency', el).value.trim().toUpperCase() || 'TWD', homeTz: tz });
        localStorage.removeItem('ta.rates.v1');
        TA.ticker.loadRates(true).then(() => TA.app.paintTicker());
        U.toast('已儲存');
      }
      if (act === 'off-update') { TA.offline.dialog(S.get(a.dataset.id), () => TA.app.rerender()); return; }
      if (act === 'off-rm') { await TA.offline.remove(a.dataset.id); U.toast('已移除離線資料'); TA.app.rerender(); return; }
      if (act === 'export') U.download(`旅行誌備份-${U.todayStr()}.json`, S.exportJSON());
      if (act === 'logout' && await U.confirm('確定要登出這台裝置？', { ok: '登出', danger: true })) { S.logout(); location.hash = '#/'; location.reload(); }
    });
    // ---- 訪客密碼 ----
    let guests = [];
    const gpBox = U.$('.gp-list', el);
    const fmtT = s => s ? new Date(s).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' }) : '尚未使用';
    const paintGuests = () => {
      gpBox.innerHTML = guests.length ? `<div class="gp-head"><span>密碼</span><span>備註</span><span>最後使用</span><span></span></div>` + guests.map((g, i) => `<div class="gp-row">
        <code>${E(g.token)}</code><span>${E(g.label || '—')}</span><span class="muted">${fmtT(g.lastUsed)}</span>
        <button class="icon-btn" data-act="gp-del" data-i="${i}" title="刪除這組密碼">${UI.icon('trash', 16)}</button></div>`).join('')
        : '<p class="muted">目前沒有訪客密碼，訪客無法登入。</p>';
    };
    const saveGuests = async list => {
      try { guests = await S.setGuests(list); paintGuests(); U.toast('訪客密碼已更新'); }
      catch (err) { U.toast('更新失敗：' + err.message + (/未知動作/.test(err.message) ? '（請先更新 Apps Script）' : ''), 'err'); }
    };
    if (!S.isGuest()) S.guests().then(g => { guests = g; paintGuests(); }).catch(err => {
      gpBox.innerHTML = `<p class="muted">${/未知動作/.test(err.message) ? '請先更新 Apps Script 程式並部署新版本，才能在這裡管理訪客密碼。' : '讀取失敗：' + E(err.message)}</p>`;
    });
    U.$('.gp-add', el).addEventListener('submit', e => {
      e.preventDefault();
      const token = U.$('#gp-token', el).value.trim(), label = U.$('#gp-label', el).value.trim();
      if (token.length < 4) return U.toast('訪客密碼至少 4 個字', 'err');
      if (token === S.settings().gasToken) return U.toast('不能和管理者密碼相同', 'err');
      if (guests.some(g => g.token === token)) return U.toast('這組密碼已經存在', 'err');
      saveGuests([...guests, { token, label, createdAt: new Date().toISOString() }]);
      U.$('#gp-token', el).value = ''; U.$('#gp-label', el).value = '';
    });
    el.addEventListener('click', async e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'gp-rand') {
        const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
        U.$('#gp-token', el).value = Array.from(crypto.getRandomValues(new Uint32Array(8)), n => chars[n % chars.length]).join('');
      }
      if (a.dataset.act === 'gp-del') {
        const g = guests[+a.dataset.i];
        if (await U.confirm(`刪除訪客密碼「${g.token}」${g.label ? `（${g.label}）` : ''}？使用這組密碼的人將無法再登入。`, { ok: '刪除', danger: true }))
          saveGuests(guests.filter((_, i) => i !== +a.dataset.i));
      }
    });

    // 手機上已用的儲存空間
    navigator.storage?.estimate?.().then(s => {
      const box = U.$('.off-usage', el);
      if (box && s?.usage) box.textContent = `這個網站目前在這台裝置使用約 ${TA.offline.fmtBytes(s.usage)}${s.quota ? `（可用上限約 ${TA.offline.fmtBytes(s.quota)}）` : ''}。`;
    }).catch(() => { });
    U.$('#importFile', el).addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { const n = S.importJSON(await f.text()); await S.migrate(); U.toast(`已匯入 ${n} 段旅程`); }
      catch (err) { U.toast('匯入失敗：' + err.message, 'err'); }
    });
  };

  // ---------- 登入 ----------
  TA.views.login = function (el, onDone) {
    const needUrl = !S.gasUrl();
    el.innerHTML = `<div class="login">
      <div class="login-box">
        <div class="eyebrow">${E((window.TA_CONFIG && TA_CONFIG.siteNameEn) || 'Travel Journal')}</div>
        <h1 class="display">${E(UI.name())}</h1>
        <p class="lede">請輸入密碼</p>
        <form id="login-f" autocomplete="on">
          ${needUrl ? `<label class="fld"><span>雲端網址（第一次使用需要）</span><input type="url" id="lg-url" required placeholder="https://script.google.com/macros/s/.../exec"></label>` : ''}
          <label class="fld"><span>密碼</span><input type="password" id="lg-pw" required autocomplete="current-password" autofocus></label>
          <button class="btn primary block" type="submit">進入</button>
          <p class="login-err" hidden></p>
        </form>
      </div>
    </div>`;
    U.$('#login-f', el).addEventListener('submit', async e => {
      e.preventDefault();
      const btn = U.$('button', e.target), err = U.$('.login-err', el);
      btn.disabled = true; btn.textContent = '驗證中…'; err.hidden = true;
      try {
        await S.login(needUrl ? U.$('#lg-url', el).value.trim() : S.gasUrl(), U.$('#lg-pw', el).value);
        onDone();
      } catch (ex) {
        err.hidden = false;
        err.textContent = /密碼錯誤/.test(ex.message) ? '密碼不正確' : '無法連線：' + ex.message;
        btn.disabled = false; btn.textContent = '進入';
      }
    });
  };

  // ---------- 編輯足跡 ----------
  TA.views.footprintDialog = function (onSaved) {
    const prof = U.clone(S.profile());
    prof.extras = prof.extras || [];
    const row = (x = {}) => `<div class="fp-row">
      <input type="text" class="fp-c" list="dl-fp-countries" value="${E(x.country || '')}" placeholder="國家，例如：中國">
      <input type="text" class="fp-city" value="${E((x.cities || []).join('、'))}" placeholder="城市，多個用、分隔（可空白）">
      <input type="number" class="fp-times" min="1" value="${E(x.times || 1)}" title="去過幾次">
      <input type="number" class="fp-days" min="0" value="${E(x.days || '')}" placeholder="天數" title="總共待了幾天（選填，會加進在外的天數）">
      <button type="button" class="icon-btn fp-del" title="移除">${UI.icon('x', 14)}</button>
    </div>`;
    const m = U.modal(`
      <p class="hint">沒有排行程、但去過的地方，會一起算進統計並標在地圖上。</p>
      <datalist id="dl-fp-countries">${TA.countries.list.map(c => `<option value="${c.zh}">`).join('')}</datalist>
      <label class="fld"><span>居住地 <em class="hint">地圖上用深色標示，不算進「國家與地區」</em></span>
        <input type="text" id="fp-home" list="dl-fp-countries" value="${E(prof.home || '')}" placeholder="台灣"></label>
      <div class="fld"><span>其他去過的地方</span>
        <div class="fp-head"><span>國家</span><span>城市</span><span>次數</span><span>天數</span><span></span></div>
        <div class="fp-list">${(prof.extras.length ? prof.extras : [{}]).map(row).join('')}</div>
        <div class="add-row"><button type="button" class="btn sm ghost" id="fp-add">${UI.icon('plus', 14)}新增一筆</button></div>
      </div>
      <div class="modal-actions"><button class="btn ghost" data-close>取消</button><button class="btn primary" id="fp-save">儲存</button></div>
    `, { title: '編輯足跡', wide: true });
    const list = U.$('.fp-list', m.el);
    U.$('#fp-add', m.el).onclick = () => { list.insertAdjacentHTML('beforeend', row()); U.$$('.fp-c', list).pop().focus(); };
    list.addEventListener('click', e => { if (e.target.closest('.fp-del')) e.target.closest('.fp-row').remove(); });
    U.$('#fp-save', m.el).onclick = () => {
      const extras = U.$$('.fp-row', list).map(r => ({
        country: U.$('.fp-c', r).value.trim(),
        cities: U.$('.fp-city', r).value.split(/[、,，]/).map(x => x.trim()).filter(Boolean),
        times: Math.max(1, parseInt(U.$('.fp-times', r).value) || 1),
        days: Math.max(0, parseInt(U.$('.fp-days', r).value) || 0),
      })).filter(x => x.country);
      const unknown = [U.$('#fp-home', m.el).value.trim(), ...extras.map(x => x.country)].filter(c => c && !TA.countries.find(c));
      S.saveProfile({ ...prof, home: U.$('#fp-home', m.el).value.trim(), extras });
      m.close();
      U.toast(unknown.length ? `已儲存（${unknown.join('、')} 不在國家清單中，地圖上不會標示）` : '已儲存');
      onSaved && onSaved();
      TA.geo.backfill(onSaved);
    };
  };
})();
