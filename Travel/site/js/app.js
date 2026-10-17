/* 路由與外框
 * #/                     主頁
 * #/new                  新增旅程
 * #/trip/:id             旅程
 * #/trip/:id/edit        編輯
 * #/tools                旅行工具箱
 * #/tool/:id[/:tripId]   單一工具
 * #/world                世界時鐘與匯率
 * #/settings             設定 */
(function () {
  const U = TA.u, S = TA.store;
  const ROUTES = [
    [/^\/?$/, () => ['home', {}]],
    [/^\/new$/, () => ['editor', {}]],
    [/^\/trip\/([^/]+)$/, m => ['trip', { id: m[1] }]],
    [/^\/trip\/([^/]+)\/edit$/, m => ['editor', { id: m[1] }]],
    [/^\/tools$/, () => ['tools', {}]],
    [/^\/tool\/([^/]+)(?:\/([^/]+))?$/, m => ['tool', { id: m[1], tripId: m[2] }]],
    [/^\/world$/, () => ['world', {}]],
    [/^\/settings$/, () => ['settings', {}]],
    [/^\/settings\/help$/, () => ['settings', { tab: 'help' }]],
  ];
  const NAV = { home: '/', trip: '/', editor: '/', tools: '/tools', tool: '/tools', world: '/world', settings: '/settings' };

  let current = null, currentHash = location.hash, skipNext = false, started = false;

  function resolve() {
    const path = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
    for (const [re, fn] of ROUTES) { const m = path.match(re); if (m) return fn(m); }
    return ['home', {}];
  }

  function fresh(name) {
    const el = document.createElement('main');
    el.id = 'view'; el.className = 'view view-' + name;
    U.$('#view').replaceWith(el);
    return el;
  }

  function render() {
    if (!S.isAuthed()) return showLogin();
    const [name, params] = resolve();
    if (current?.cleanup) current.cleanup();
    U.$$('.modal-wrap').forEach(m => m.remove());
    applyRole();
    const el = fresh(name);
    // 訪客不能進入編輯類頁面
    if (S.isGuest() && (name === 'editor' || (name === 'tool' && params.tripId === 'templates'))) {
      el.innerHTML = `<div class="empty-box">訪客模式只能瀏覽，無法編輯<br><a class="btn" href="javascript:history.back()">返回</a></div>`;
      current = null; return;
    }
    const r = TA.views[name](el, params);
    current = typeof r === 'function' ? { cleanup: r } : (r || null);
    U.$$('.nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + NAV[name]));
    U.$$('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.nav === NAV[name]));
    document.body.dataset.view = name;
    const t = name === 'trip' || name === 'editor' ? S.get(params.id) : null;
    document.title = t ? `${t.title}｜${TA.ui.name()}` : TA.ui.name();
  }

  function applyRole() {
    const g = S.isGuest();
    document.body.classList.toggle('guest', g);
    let b = U.$('.role-badge');
    if (g && !b) { b = document.createElement('span'); b.className = 'role-badge'; b.textContent = '訪客瀏覽'; U.$('.brand').after(b); }
    if (!g && b) b.remove();
  }

  function showLogin() {
    document.body.classList.add('locked');
    TA.views.login(fresh('login'), () => { document.body.classList.remove('locked'); start(); });
  }

  window.addEventListener('hashchange', () => {
    if (skipNext) { skipNext = false; return; }
    if (current?.canLeave && !current.canLeave()) { skipNext = true; location.hash = currentHash; return; }
    currentHash = location.hash;
    window.scrollTo({ top: 0, behavior: 'instant' });
    render();
  });

  function paintTicker() { TA.ticker.renderMarquee(U.$('#ticker')); }
  function paintSync() {
    const b = U.$('#syncBtn');
    b.classList.toggle('spin', S.syncing);
    b.title = S.syncing ? '同步中…' : `同步（上次：${S.settings().lastSync ? new Date(S.settings().lastSync).toLocaleString('zh-TW') : '—'}）`;
  }

  // 圖片放大
  document.addEventListener('click', e => {
    const img = e.target.closest('.rich img');
    if (!img || e.target.closest('a') || e.target.closest('[contenteditable]')) return;
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `<img src="${img.src}" alt=""><a href="${img.src}" target="_blank" rel="noopener" class="lb-open">原始圖片</a>`;
    box.addEventListener('click', ev => { if (!ev.target.closest('.lb-open')) box.remove(); });
    document.body.appendChild(box);
  });

  async function syncAndMigrate() {
    try {
      const r = await S.sync();
      const n = await S.migrate();
      if ((r && (r.pulled || r.pushed)) || n) { if (!current?.canLeave) render(); paintTicker(); }
      if (n) U.toast(`已將 ${n} 段旅程更新為新版格式`);
      TA.geo.backfill(() => { if (!current?.canLeave) render(); });
    } catch (e) { U.toast('雲端同步失敗：' + e.message, 'err'); }
  }

  function start() {
    if (!started) {
      started = true;
      S.on(paintSync);
      S.on(U.debounce(paintTicker, 500));
      U.$('#syncBtn').addEventListener('click', async () => {
        try { const r = await S.sync(); await S.migrate(); U.toast(`同步完成（下載 ${r.pulled}、上傳 ${r.pushed}）`); render(); paintTicker(); }
        catch (e) { U.toast('同步失敗：' + e.message, 'err'); }
      });
      setInterval(TA.ticker.tick, 20000);
    }
    S.migrate().catch(() => { });
    render();
    paintTicker(); paintSync();
    TA.ticker.loadRates().then(paintTicker);
    syncAndMigrate();
  }

  TA.app = { rerender: render, paintTicker };

  // 可安裝成 App（需要 https 或 localhost）
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
  }
  U.$('.brand-name').textContent = TA.ui.name();
  if (S.isAuthed()) start(); else showLogin();
})();
