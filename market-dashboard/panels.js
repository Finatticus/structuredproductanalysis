/* =========================================================
 * 字卡頁面引擎（總經與板塊分析、財金日曆共用）
 *  - 第一次進入此頁自動抓，之後按「↻ 重新整理」；各字卡獨立載入、獨立顯示錯誤
 *  - 背景請求排隊（app.js 的 apiBg，全站共用上限），不會一次把後端塞滿
 *  - 失敗或拿到後端備援資料時自動重試（5→10→20→30→60 秒，10 次後每 5 分鐘），只在停留此頁時重試
 *  - 成功的資料存在瀏覽器（localStorage），重新整理網頁後先顯示上次資料，再在背景更新
 *  - 版面（順序／寬度／隱藏）存在試算表個人設定
 * 頁面元素 id 依前綴命名：#{id}Grid、#{id}Status、#{id}Stale、#{id}Refresh、#{id}Edit、#{id}Reset、#{id}EditHint、#section-{id}
 * 依賴 app.js（$, $$, apiBg, esc, store, state, toast）
 * ========================================================= */
const SPAN_OPTS = [[4, '1/3 寬'], [5, '5/12 寬'], [6, '1/2 寬'], [7, '7/12 寬'], [8, '2/3 寬'], [12, '全寬']];
const PANEL_RETRY_S = [5, 10, 20, 30, 60];
const PANEL_CACHE_MAX_AGE = 3 * 86400000; // 超過 3 天的瀏覽器快取不顯示
const PANEL_PAGES = [];

class PanelPage {
  /**
   * cfg.id：頁面前綴（macro、cal）；cfg.parts：[{ key, title, span }]；cfg.action：後端 action
   * cfg.layoutKey：版面設定名稱；cfg.cachePrefix：localStorage 前綴；cfg.renderers：{ key: (d, body, tools, key) => {} }
   * cfg.apiPart(key)：字卡 → 後端區塊（例如上市／上櫃切換）；cfg.variants(key)：瀏覽器快取要還原的所有區塊名稱
   * cfg.staleMs：資料超過多久顯示提醒
   * cfg.direct(part, force)：可在瀏覽器引擎計算時回傳 Promise（見 engine.js），失敗或不支援時改走後端
   */
  constructor(cfg) {
    this.cfg = Object.assign({ apiPart: k => k, variants: k => [k], staleMs: 3600000 }, cfg);
    this.data = {};
    this.charts = {};
    this.retry = new Map();   // 字卡 → { n, at, timer, msg, waiting }
    this.inflight = new Set();
    this.loadedAt = 0;
    this.fromCache = 0;
    this.editing = false;
    this.layoutObj = null;
    this.sortable = null;
    PANEL_PAGES.push(this);
  }

  $(name) { return $('#' + this.cfg.id + name); }
  panel(key) { return $(`.panel[data-part="${key}"]`, this.$('Grid')); }
  apiPart(key) { return this.cfg.apiPart(key); }
  active() { return !document.hidden && !$('#section-' + this.cfg.id).classList.contains('hidden'); }
  hidden(key) { return this.layout().hide.includes(key); }
  visibleParts() { return this.cfg.parts.filter(p => !this.hidden(p.key)); }

  /* ---------- 初始化 ---------- */
  init() {
    const grid = this.$('Grid');
    grid.innerHTML = this.cfg.parts.map(p => `
      <section class="panel" data-part="${p.key}" style="--span:${p.span}">
        <div class="panel-head">
          <h2 class="panel-title">${p.title}</h2>
          <div class="panel-tools"></div>
          <span class="panel-time"></span>
          <button class="icon-btn panel-refresh" data-refresh title="只更新這張字卡">↻</button>
          <div class="panel-edit">
            <select data-w title="字卡寬度">${SPAN_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
            <label class="chk"><input type="checkbox" data-show checked> 顯示</label>
          </div>
        </div>
        <div class="panel-body"><div class="panel-msg">尚未載入</div></div>
      </section>`).join('');
    $(`.nav-btn[data-section="${this.cfg.id}"]`).addEventListener('click', () => this.load(false));
    this.$('Refresh').addEventListener('click', () => this.load(true));
    grid.addEventListener('click', e => {
      const b = e.target.closest('[data-refresh]');
      if (!b) return;
      b.disabled = true;
      this.loadPart(b.closest('.panel').dataset.part, true).finally(() => { b.disabled = false; });
    });
    setInterval(() => this.staleCheck(), 60000);
    setInterval(() => this.tick(), 1000);
    document.addEventListener('visibilitychange', () => this.resumeRetries());
    $$('.nav-btn').forEach(b => b.addEventListener('click', () => setTimeout(() => this.resumeRetries(), 0)));
    $('#colorSel').addEventListener('change', () => this.cfg.parts.forEach(p => this.renderPart(p.key)));

    this.$('Edit').addEventListener('click', () => this.setEditing(!this.editing));
    this.$('Reset').addEventListener('click', () => {
      if (!confirm('確定要還原預設的字卡順序與寬度？')) return;
      this.layoutObj = { order: [], w: {}, hide: [] };
      this.applyLayout();
      this.saveLayout();
    });
    grid.addEventListener('change', e => {
      const panel = e.target.closest('.panel');
      if (!panel) return;
      const key = panel.dataset.part, L = this.layout();
      if (e.target.matches('[data-w]')) L.w[key] = +e.target.value;
      if (e.target.matches('[data-show]')) {
        L.hide = L.hide.filter(k => k !== key);
        if (!e.target.checked) L.hide.push(key);
      }
      this.applyLayout();
      this.saveLayout();
    });
    if (window.Sortable) {
      this.sortable = Sortable.create(grid, {
        draggable: '.panel', handle: '.panel-head', filter: 'select, input, label', preventOnFilter: false,
        animation: 180, ghostClass: 'sortable-ghost', disabled: true,
        onEnd: e => {
          if (e.oldIndex === e.newIndex) return;
          this.layout().order = $$('.panel', grid).map(x => x.dataset.part);
          this.saveLayout();
        },
      });
    }
  }

  /** 資料超過指定時間：顯示提醒（只看時間，不會自動更新） */
  staleCheck() {
    const el = this.$('Stale');
    if (!el) return;
    const old = this.loadedAt && Date.now() - this.loadedAt > this.cfg.staleMs;
    el.classList.toggle('hidden', !old);
    if (old) {
      const mins = Math.floor((Date.now() - this.loadedAt) / 60000);
      el.textContent = `⚠ 資料已是 ${mins >= 120 ? Math.floor(mins / 60) + ' 小時' : mins + ' 分鐘'}前，記得按「↻ 重新整理」`;
    }
  }

  /* ---------- 版面 ---------- */
  layout() {
    if (!this.layoutObj) {
      let L = {};
      try { L = JSON.parse((state.settings && state.settings[this.cfg.layoutKey]) || '{}'); } catch { L = {}; }
      this.layoutObj = { order: L.order || [], w: L.w || {}, hide: L.hide || [] };
    }
    return this.layoutObj;
  }

  applyLayout() {
    const L = this.layout(), grid = this.$('Grid');
    const def = this.cfg.parts.map(p => p.key);
    const order = L.order.filter(k => def.includes(k));
    def.forEach((k, i) => { if (!order.includes(k)) order.splice(Math.min(i, order.length), 0, k); });
    order.forEach(k => grid.appendChild(this.panel(k)));
    this.cfg.parts.forEach(p => {
      const panel = this.panel(p.key);
      const span = L.w[p.key] || p.span;
      panel.style.setProperty('--span', span);
      $('[data-w]', panel).value = String(span);
      const hidden = L.hide.includes(p.key);
      panel.classList.toggle('is-hidden', hidden);
      $('[data-show]', panel).checked = !hidden;
    });
  }

  async saveLayout() {
    const value = JSON.stringify(this.layout());
    state.settings = Object.assign(state.settings || {}, { [this.cfg.layoutKey]: value });
    try { await api('saveSetting', { key: this.cfg.layoutKey, value }); }
    catch (err) { toast('版面儲存失敗：' + err.message); }
  }

  setEditing(on) {
    this.editing = on;
    this.$('Grid').classList.toggle('editing', on);
    this.$('EditHint').classList.toggle('hidden', !on);
    this.$('Reset').classList.toggle('hidden', !on);
    const b = this.$('Edit');
    b.classList.toggle('on', on);
    b.textContent = on ? '✓ 完成' : '✎ 編輯版面';
    if (this.sortable) this.sortable.option('disabled', !on);
    if (!on) {
      // 結束編輯：重新顯示的字卡若還沒資料就載入；圖表依新寬度重畫
      this.visibleParts().forEach(p => this.refreshIfNeeded(p.key));
    }
  }

  /** 已有資料就重畫；沒有資料或只是瀏覽器快取時向後端要 */
  refreshIfNeeded(key) {
    const d = this.data[this.apiPart(key)];
    if (d) this.renderPart(key);
    if (!d || d.cached) this.loadPart(key, false);
  }

  /* ---------- 瀏覽器快取 ---------- */
  cacheKey(part) { return `${this.cfg.cachePrefix}${state.account || ''}_${part}`; }

  cacheSave(part, data) {
    if (!data || data.stale) return;
    const k = this.cacheKey(part);
    try { localStorage.setItem(k, JSON.stringify(data)); }
    catch {
      // 空間不足：清掉其他帳號的同類快取後再試一次
      try {
        Object.keys(localStorage).filter(x => x.startsWith(this.cfg.cachePrefix) && !x.startsWith(`${this.cfg.cachePrefix}${state.account || ''}_`)).forEach(x => localStorage.removeItem(x));
        localStorage.setItem(k, JSON.stringify(data));
      } catch { /* 放棄，不影響使用 */ }
    }
  }

  cacheRestore(parts) {
    let n = 0;
    parts.forEach(p => {
      this.cfg.variants(p.key).forEach(part => {
        if (this.data[part]) return;
        let d = null;
        try { d = JSON.parse(store.get(this.cacheKey(part)) || 'null'); } catch { d = null; }
        if (!d || !d.updated || Date.now() - d.updated > PANEL_CACHE_MAX_AGE) return;
        d.cached = true;
        this.data[part] = d;
        if (part === this.apiPart(p.key)) { this.renderPart(p.key); n++; }
      });
    });
    return n;
  }

  /* ---------- 載入 ---------- */
  async load(force) {
    if (!state.token) return;
    if (!force && this.loadedAt) { this.staleCheck(); this.resumeRetries(); return; }
    const first = !this.loadedAt;
    this.loadedAt = Date.now();
    this.staleCheck();
    this.applyLayout();
    this.retry.forEach(r => clearTimeout(r.timer));
    this.retry.clear();
    const visible = this.visibleParts(); // 隱藏的字卡不抓，省額度
    if (first) this.fromCache = this.cacheRestore(visible);
    this.updateStatus();
    await Promise.all(visible.map(p => this.loadPart(p.key, force)));
    this.fromCache = 0;
    this.updateStatus();
  }

  async loadPart(key, force) {
    if (this.inflight.has(key)) return true;
    const panel = this.panel(key);
    const part = this.apiPart(key);
    const old = this.retry.get(key);
    if (old) clearTimeout(old.timer);
    this.inflight.add(key);
    panel.classList.add('loading');
    if (!this.data[part]) $('.panel-body', panel).innerHTML = `<div class="panel-msg">${old ? `重新載入中…（第 ${old.n + 1} 次）` : '載入中…'}</div>`;
    this.updateStatus();
    try {
      const r = await this.fetchPart(part, force);
      if (r.data.stale) {
        // 後端來源失敗，回傳的是之前成功的資料：先顯示，背景繼續重試
        if (!this.data[part] || (this.data[part].updated || 0) <= r.data.updated) this.data[part] = r.data;
        this.scheduleRetry(key, '資料來源暫時無法取得，先顯示之前的資料（' + r.data.stale + '）');
        this.renderPart(key);
        return false;
      }
      this.data[part] = r.data;
      this.retry.delete(key);
      this.renderPart(key);
      this.cacheSave(part, r.data);
      return true;
    } catch (err) {
      if (!state.token) return false; // 已登出（登入逾時）就不再重試
      this.scheduleRetry(key, err.message);
      if (this.data[part]) this.renderPart(key); // 保留上次成功的內容
      else $('.panel-body', panel).innerHTML =
        `<div class="panel-msg err">載入失敗：${esc(err.message)}<br><span data-countdown></span><br><button class="btn btn-ghost btn-sm" data-retry>立即重試</button></div>`;
      this.tick();
      const b = $('[data-retry]', panel);
      if (b) b.addEventListener('click', () => this.loadPart(key, false));
      return false;
    } finally {
      this.inflight.delete(key);
      panel.classList.remove('loading');
      this.updateStatus();
    }
  }

  /** 先試瀏覽器引擎（不經 Google），失敗再走後端 */
  async fetchPart(part, force) {
    const d = this.cfg.direct ? this.cfg.direct(part, !!force) : null;
    if (d) {
      try { return { data: await d }; } catch { /* 改走後端 */ }
    }
    return apiBg(this.cfg.action, { part, force: !!force });
  }

  scheduleRetry(key, msg) {
    const prev = this.retry.get(key);
    const n = (prev ? prev.n : 0) + 1;
    const sec = n > 10 ? 300 : PANEL_RETRY_S[Math.min(n, PANEL_RETRY_S.length) - 1];
    const r = { n, msg, at: Date.now() + sec * 1000, timer: null };
    r.timer = setTimeout(() => this.retryNow(key), sec * 1000);
    this.retry.set(key, r);
  }

  retryNow(key) {
    const r = this.retry.get(key);
    if (!r) return;
    if (this.hidden(key)) { this.retry.delete(key); this.updateStatus(); return; }
    if (!this.active()) { r.waiting = true; this.tick(); return; } // 回到此頁時再做
    this.loadPart(key, false); // 非強制：後端若已有新快取就直接用，不多耗額度
  }

  /** 切回此頁或分頁回到前景：已到期（或等待中）的重試立即執行 */
  resumeRetries() {
    if (!this.active()) return;
    this.retry.forEach((r, key) => { if (r.waiting || r.at <= Date.now()) { r.waiting = false; this.retryNow(key); } });
  }

  /** 每秒更新倒數文字 */
  tick() {
    this.retry.forEach((r, key) => {
      const panel = this.panel(key);
      if (!panel || this.inflight.has(key)) return;
      const s = Math.max(0, Math.ceil((r.at - Date.now()) / 1000));
      const txt = r.waiting ? '更新失敗，回到此頁時重試' : `更新失敗，${s} 秒後重試（第 ${r.n} 次）`;
      $$('[data-countdown]', panel).forEach(el => { el.textContent = txt; });
    });
  }

  updateStatus() {
    const st = this.$('Status');
    if (!st || !this.loadedAt) return;
    const total = this.visibleParts().length;
    const fail = [...this.retry.keys()].filter(k => !this.hidden(k)).length;
    const busy = this.inflight.size;
    if (fail) {
      st.className = 'status err';
      st.innerHTML = `<span class="dot"></span>${fail} 個區塊載入失敗 · 自動重試中${busy ? `（${busy} 個請求進行中）` : ''}`;
    } else if (busy) {
      st.className = 'status';
      st.innerHTML = `<span class="dot"></span>${this.fromCache ? '先顯示上次資料，背景更新中' : '更新中'}…（${total - busy}/${total}）`;
    } else {
      st.className = 'status live';
      st.innerHTML = '<span class="dot"></span>已更新 · ' + new Date().toLocaleTimeString('zh-TW', { hour12: false });
    }
  }

  renderPart(key) {
    const d = this.data[this.apiPart(key)];
    const panel = this.panel(key);
    if (!d || !panel) return;
    (this.charts[key] || []).forEach(c => c.remove());
    this.charts[key] = [];
    const pt = $('.panel-time', panel);
    const ut = d.updated ? new Date(d.updated) : null;
    const old = ut && Date.now() - d.updated > 12 * 3600000;
    pt.textContent = ut ? (d.cached ? '上次資料 ' : d.stale ? '資料 ' : '更新 ') +
      (old ? `${ut.getMonth() + 1}/${ut.getDate()} ` : '') + ut.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '';
    pt.classList.remove('warn');
    pt.title = '';
    if (this.retry.has(key)) {
      // 失敗但有舊資料：時間後面接倒數
      pt.classList.add('warn');
      pt.title = this.retry.get(key).msg || '';
      pt.innerHTML = `${esc(pt.textContent)} · <span data-countdown></span>`;
    }
    const tools = $('.panel-tools', panel), body = $('.panel-body', panel);
    tools.innerHTML = '';
    try {
      this.cfg.renderers[key](d, body, tools, key);
    } catch (err) {
      console.error(err);
      body.innerHTML = `<div class="panel-msg err">顯示失敗：${esc(err.message)}</div>`;
    }
  }
}

/** 字卡內的圖表：記在所屬頁面，重畫時一併移除 */
function newChart(key, el, opts = {}) {
  const LWC = window.LightweightCharts;
  const chart = LWC.createChart(el, Object.assign({
    autoSize: true,
    layout: { background: { type: 'solid', color: '#ffffff' }, textColor: '#5b6778', fontSize: 11, fontFamily: 'Inter, "Noto Sans TC", sans-serif' },
    grid: { vertLines: { color: '#f2f4f7' }, horzLines: { color: '#f2f4f7' } },
    rightPriceScale: { borderColor: '#e3e8ef' },
    timeScale: { borderColor: '#e3e8ef' },
    localization: { locale: 'zh-TW', dateFormat: 'yyyy-MM-dd' },
    handleScale: { mouseWheel: false }, // 避免捲動頁面時誤觸縮放
  }, opts));
  const page = PANEL_PAGES.find(p => p.cfg.parts.some(x => x.key === key));
  if (page) (page.charts[key] = page.charts[key] || []).push(chart);
  return chart;
}
