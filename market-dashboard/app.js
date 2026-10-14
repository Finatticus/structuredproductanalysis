/* =========================================================
 * 金融市場監控儀表板 — 前端
 * 部署 GAS 後，把「網頁應用程式網址」貼到下方 API_URL
 * （或在登入頁「後端網址設定」輸入，會存在瀏覽器）
 * ========================================================= */
const API_URL = 'https://script.google.com/macros/s/AKfycby718OpZDRd_VyDRPCUTt0mXsapnPj7UBLpdkhFVJvza-mkgjPfq4PTTdzSHtrL6NsS/exec';

/* ---------- 類別設定（含輸入規則說明） ---------- */
const CATS = [
  {
    key: 'fx', title: '匯率', accent: '#2c6bc4', placeholder: '例：USD/TWD',
    help: `<b>格式：</b>基準幣/報價幣（ISO 三碼幣別）
      <ul><li><code>USD/TWD</code> 1 美元兌台幣</li><li><code>EUR/USD</code>、<code>JPY/TWD</code>、<code>AUD/JPY</code></li>
      <li>斜線可省略：<code>USDTWD</code></li></ul>`,
  },
  {
    key: 'tw', title: '台股', accent: '#c0392b', placeholder: '例：2330',
    help: `<b>格式：</b>台灣股票代號（4–6 碼）
      <ul><li>上市/上櫃：<code>2330</code>、<code>6488</code>（證交所即時行情）</li>
      <li>ETF：<code>0050</code>、<code>00878</code></li>
      <li>興櫃：<code>3595</code>（自動改用 Yahoo 報價）</li></ul>系統會自動判斷市場別。`,
  },
  {
    key: 'global', title: '國外', accent: '#6d4bc4', placeholder: '例：NVDA 或 7011 JP',
    help: `<b>美股：</b>直接輸入代號 <code>NVDA</code>、<code>BRK-B</code><br>
      <b>其他市場：</b>代號 + 空格 + 市場碼
      <ul><li><code>7011 JP</code> 日本　<code>0700 HK</code> 香港</li>
      <li><code>005930 KS</code> 韓國　<code>SAP GR</code> 德國</li>
      <li><code>HSBA LN</code> 英國　<code>BHP AU</code> 澳洲</li></ul>
      市場碼：US JP HK KS KQ CH SZ LN GR FP NA SW AU CN SP IN<br>
      也可直接輸入 Yahoo 代碼，如 <code>7011.T</code>。`,
  },
  {
    key: 'index', title: '指數 / 商品', accent: '#d08a00', placeholder: '例：SOX 或 ^N225',
    help: `<b>別名：</b><code>SPX</code> <code>NDX</code> <code>DJI</code> <code>SOX</code> <code>VIX</code>
      <code>TWII</code> <code>N225</code> <code>HSI</code> <code>KOSPI</code> <code>DAX</code> <code>DXY</code>
      <code>US10Y</code> <code>GOLD</code> <code>SILVER</code> <code>WTI</code> <code>BRENT</code> <code>NG</code> <code>COPPER</code><br>
      中文別名：<code>黃金</code> <code>白銀</code> <code>原油</code> <code>加權</code> <code>日經</code><br>
      <b>或 Yahoo 代碼：</b>指數以 <code>^</code> 開頭（<code>^GSPC</code>），期貨以 <code>=F</code> 結尾（<code>GC=F</code>）`,
  },
  {
    key: 'crypto', title: '虛擬貨幣', accent: '#e8a317', placeholder: '例：BTCUSDT',
    help: `<b>格式：</b>Binance 交易對（不含斜線）
      <ul><li>現貨：<code>BTCUSDT</code>、<code>ETHUSDT</code>、<code>DOGEUSDT</code></li>
      <li>美股永續合約：<code>TSMUSDT</code>、<code>NVDAUSDT</code></li></ul>
      系統會先找現貨，找不到再找 U 本位永續合約。漲跌幅為 24 小時滾動。`,
  },
];

/* ---------- 狀態 ---------- */
const state = {
  token: null,
  account: null,
  items: [],          // [{category, symbol, name, source}]
  quotes: {},         // source -> {price, prev, pct, ...}
  pollTimer: null,
  sockets: [],
  cryptoPollTimer: null,
  lastUpdate: null,
  intraday: {},       // source -> {c:[收盤價...], prev}
  intradayTimer: null,
  cardOrder: null,    // ['fx','tw',...]
  paused: new Set(),  // 停止更新的區塊
  feedsOn: false,     // 是否正在抓報價
  editing: false,
  sortables: [],
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

/* =========================================================
 * 後端 API
 * ========================================================= */
function apiUrl() { return store.get('mw_api') || API_URL; }

async function api(action, data = {}) {
  const url = apiUrl();
  if (!url) throw new Error('尚未設定後端網址（登入頁下方「後端網址設定」）');
  // 不帶自訂 header → text/plain 簡單請求，避免 CORS 預檢
  let res, j;
  try {
    res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ action, token: state.token, ...data }),
    });
    j = await res.json();
  } catch (err) {
    // 網路中斷，或 GAS 部署存取權不是「所有人」（請求被導向 Google 登入頁）
    throw Object.assign(new Error('無法連線後端（請確認網路，或 GAS 部署存取權為「所有人」）'), { retry: true });
  }
  if (j.usage) updateUsage(j.usage);
  if (!j.ok) {
    if (j.code === 'AUTH') { logout(true); }
    throw Object.assign(new Error(cleanMsg(j.error || '伺服器錯誤')), { retry: j.code === 'RETRY' });
  }
  return j;
}

/** 去掉錯誤訊息中冗長的網址（例如 GAS 的「無法開啟網址：https://…」） */
function cleanMsg(m) {
  return String(m).replace(/無法開啟網址[:：]?\s*\S*/g, '資料來源連線失敗').replace(/\s*https?:\/\/\S+/g, '').trim();
}

/** 遇到暫時性錯誤自動重試（最多 3 次，間隔 2、4、6 秒） */
async function apiRetry(action, data, onRetry) {
  for (let i = 1; ; i++) {
    try { return await api(action, data); }
    catch (err) {
      if (!err.retry || i > 3) throw err;
      if (onRetry) onRetry(i);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
}

/* =========================================================
 * 登入 / 註冊
 * ========================================================= */
function initAuth() {
  $$('.auth-tab').forEach(t => t.addEventListener('click', () => {
    $$('.auth-tab').forEach(x => x.classList.toggle('active', x === t));
    $('#loginForm').classList.toggle('hidden', t.dataset.tab !== 'login');
    $('#registerForm').classList.toggle('hidden', t.dataset.tab !== 'register');
    authMsg('');
  }));

  $('#apiUrlInput').value = apiUrl();
  if (!apiUrl()) $('.api-setting').open = true;
  $('#saveApiUrl').addEventListener('click', () => {
    store.set('mw_api', $('#apiUrlInput').value.trim() || null);
    authMsg('後端網址已儲存', 'ok');
  });

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    await withBusy(f, async () => {
      const r = await api('login', { account: f.account.value.trim(), password: f.password.value });
      onLoggedIn(r.token, r.account);
    });
  });

  $('#registerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    const account = f.account.value.trim();
    if (!/^[A-Za-z0-9_.\-]{3,30}$/.test(account)) return authMsg('帳號需為 3–30 個英文、數字或 _ . -', 'err');
    if (f.password.value.length < 6) return authMsg('密碼至少 6 個字元', 'err');
    if (f.password.value !== f.confirm.value) return authMsg('兩次輸入的密碼不一致', 'err');
    await withBusy(f, async () => {
      const reg = await api('register', { account, password: f.password.value });
      if (reg.pending) {
        // 一般帳號需等管理員審核：切回登入頁並提示
        $$('.auth-tab').forEach(x => x.classList.toggle('active', x.dataset.tab === 'login'));
        $('#loginForm').classList.remove('hidden');
        $('#registerForm').classList.add('hidden');
        $('#loginForm').account.value = account;
        throw Object.assign(new Error('註冊成功！帳號需等待管理員審核通過後才能登入。'), { notice: true });
      }
      const r = await api('login', { account, password: f.password.value });
      onLoggedIn(r.token, r.account);
    });
  });
}

async function withBusy(form, fn) {
  const btn = $('button[type=submit]', form);
  btn.disabled = true;
  authMsg('處理中…');
  try { await fn(); authMsg(''); form.reset(); }
  catch (err) { authMsg(err.message, err.notice ? 'ok' : 'err'); if (err.notice) form.reset(); }
  finally { btn.disabled = false; }
}

function authMsg(text, cls = '') {
  const el = $('#authMsg');
  el.textContent = text;
  el.className = 'auth-msg ' + cls;
}

function onLoggedIn(token, account) {
  state.token = token;
  state.account = account;
  store.set('mw_token', token);
  store.set('mw_account', account);
  showApp();
}

function logout(expired = false) {
  if (state.token && !expired) api('logout').catch(() => {});
  state.token = null;
  state.account = null;
  store.set('mw_token', null);
  store.set('mw_account', null);
  stopFeeds();
  $('#appView').classList.add('hidden');
  $('#authView').classList.remove('hidden');
  if (expired) authMsg('登入已逾時，請重新登入', 'err');
}

/* =========================================================
 * 主畫面
 * ========================================================= */
async function showApp() {
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#userName').textContent = state.account;
  renderGrid();
  setStatus('載入清單中…');
  try {
    const r = await api('watchlist');
    state.items = r.items;
    state.settings = r.settings || {};
    state.admin = !!r.admin;
    state.paused = new Set(String(state.settings.pausedCats || '').split(',').filter(Boolean));
    const order = (r.settings && r.settings.cardOrder) || '';
    state.cardOrder = order ? order.split(',') : null;
    renderGrid();
    startFeeds();
  } catch (err) {
    setStatus(err.message, 'err');
  }
}

function initApp() {
  $$('.nav-btn').forEach(b => b.addEventListener('click', () => {
    $$('.nav-btn').forEach(x => x.classList.toggle('active', x === b));
    $$('.section').forEach(s => s.classList.toggle('hidden', s.id !== 'section-' + b.dataset.section));
    syncFeeds();
  }));
  $('#pauseAllBtn').addEventListener('click', togglePauseAll);
  $('#logoutBtn').addEventListener('click', () => logout());
  $('#refreshBtn').addEventListener('click', () => { pollQuotes(); loadIntraday(); });
  $('#editBtn').addEventListener('click', () => setEditing(!state.editing));
  $('#usageBox .help-btn').addEventListener('click', e => e.currentTarget.parentElement.classList.toggle('open'));
  window.addEventListener('resize', () => $$('#marketGrid .card').forEach(sizeCard));
  initChartModal();

  const iv = store.get('mw_interval');
  if (iv) $('#intervalSel').value = iv;
  $('#intervalSel').addEventListener('change', e => {
    store.set('mw_interval', e.target.value);
    restartPolling();
  });

  const color = store.get('mw_color') || 'tw';
  $('#colorSel').value = color;
  document.body.classList.toggle('color-us', color === 'us');
  $('#colorSel').addEventListener('change', e => {
    store.set('mw_color', e.target.value);
    document.body.classList.toggle('color-us', e.target.value === 'us');
  });

  document.addEventListener('visibilitychange', syncFeeds);
  document.addEventListener('click', e => {
    if (!e.target.closest('.help')) $$('.help.open').forEach(h => h.classList.remove('open'));
  });

  setInterval(() => {
    $('#clock').textContent = new Date().toLocaleTimeString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' }) + ' 台北';
  }, 1000);
}

/* ---------- 卡片渲染 ---------- */
function renderGrid() {
  const grid = $('#marketGrid');
  grid.innerHTML = '';
  orderedCats().forEach(cat => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.cat = cat.key;
    card.style.setProperty('--accent', cat.accent);
    card.innerHTML = `
      <div class="card-head">
        <div class="card-title">${cat.title}<span class="card-meta" data-meta></span></div>
        <div class="card-btns">
          <button class="icon-btn" data-act="pause" title="停止更新此區塊">⏸</button>
          <button class="icon-btn" data-act="add" title="新增標的">+</button>
        </div>
      </div>
      <form class="add-form hidden">
        <div class="add-row">
          <input name="symbol" placeholder="${cat.placeholder}" autocomplete="off" required>
          <div class="help">
            <button type="button" class="help-btn" aria-label="輸入規則">?</button>
            <div class="help-pop">${cat.help}</div>
          </div>
        </div>
        <div class="add-row">
          <input name="name" placeholder="顯示名稱（選填）" autocomplete="off">
          <button class="btn btn-primary" type="submit">新增</button>
        </div>
        <div class="add-err"></div>
      </form>
      <ul class="rows"></ul>`;
    grid.appendChild(card);

    $('[data-act=add]', card).addEventListener('click', e => {
      const form = $('.add-form', card);
      form.classList.toggle('hidden');
      e.currentTarget.classList.toggle('on', !form.classList.contains('hidden'));
      if (!form.classList.contains('hidden')) form.symbol.focus();
    });
    $('.help-btn', card).addEventListener('click', e => e.currentTarget.parentElement.classList.toggle('open'));
    $('[data-act=pause]', card).addEventListener('click', () => togglePause(cat.key));
    $('.add-form', card).addEventListener('submit', e => onAdd(e, cat.key));

    renderRows(cat.key);
  });
  grid.classList.toggle('editing', state.editing);
  applyPauseUI();
  initSortables();
  initMasonry();
}

/* ---------- 瀑布流：卡片依高度跨列，下一行往上貼齊 ---------- */
const MASONRY_ROW = 4, MASONRY_GAP = 16;
let masonryObserver = null;

function initMasonry() {
  if (masonryObserver) masonryObserver.disconnect();
  const cards = $$('#marketGrid .card');
  if (window.ResizeObserver) {
    masonryObserver = new ResizeObserver(entries => entries.forEach(e => sizeCard(e.target)));
    cards.forEach(c => masonryObserver.observe(c));
  }
  cards.forEach(sizeCard);
}

function sizeCard(card) {
  const h = card.getBoundingClientRect().height;
  card.style.gridRowEnd = 'span ' + Math.ceil((h + MASONRY_GAP) / MASONRY_ROW);
}

function orderedCats() {
  if (!state.cardOrder) return CATS;
  const rank = k => { const i = state.cardOrder.indexOf(k); return i < 0 ? 99 : i; };
  return [...CATS].sort((a, b) => rank(a.key) - rank(b.key));
}

function renderRows(catKey) {
  const ul = $(`.card[data-cat="${catKey}"] .rows`);
  if (!ul) return;
  const list = state.items.filter(i => i.category === catKey);
  ul.innerHTML = list.length ? '' : '<li class="empty">尚無標的，點右上「+」新增</li>';
  list.forEach(it => {
    const li = document.createElement('li');
    li.className = 'row';
    li.dataset.source = it.source;
    li.dataset.key = it.category + '|' + it.symbol;
    const showCode = it.name && it.name !== it.symbol;
    li.innerHTML = `
      <button class="del" title="刪除">×</button>
      <div style="min-width:0">
        <div class="name" title="${esc(it.name)}">${esc(it.name || it.symbol)}</div>
        ${showCode ? `<div class="code">${esc(it.symbol)}${it.source.startsWith('binancef:') ? ' · 永續' : ''}</div>` : ''}
      </div>
      <svg class="spark" viewBox="0 0 76 28" preserveAspectRatio="none"></svg>
      <div class="price">—</div>
      <div class="pct">—</div>`;
    $('.del', li).addEventListener('click', e => { e.stopPropagation(); onRemove(it); });
    li.addEventListener('click', () => { if (!state.editing) openChart(it); });
    ul.appendChild(li);
    paintQuote(it.source, false);
  });
}

/* ---------- 價格更新 ---------- */
function setQuote(source, q) {
  if (!q || q.price == null) return;
  state.quotes[source] = q;
  paintQuote(source, true);
}

function paintQuote(source, animate) {
  const q = state.quotes[source];
  if (!q) return;
  $$(`.row[data-source="${cssEsc(source)}"]`).forEach(li => {
    const it = state.items.find(i => i.source === source);
    const priceEl = $('.price', li);
    const pctEl = $('.pct', li);
    const oldPrice = parseFloat(priceEl.dataset.raw);
    const dir = q.pct > 0 ? 'up' : q.pct < 0 ? 'down' : '';

    priceEl.textContent = fmtPrice(q.price, it ? it.category : '');
    priceEl.dataset.raw = q.price;
    priceEl.className = 'price ' + dir;
    pctEl.textContent = q.pct == null ? '—' : (q.pct > 0 ? '+' : '') + q.pct.toFixed(2) + '%';
    pctEl.className = 'pct ' + dir;
    li.title = q.time ? '最後成交：' + new Date(q.time).toLocaleString('zh-TW', { hour12: false }) : '';

    if (animate && isFinite(oldPrice) && oldPrice !== q.price) {
      const cls = q.price > oldPrice ? 'flash-up' : 'flash-down';
      priceEl.classList.add(cls);
      setTimeout(() => priceEl.classList.remove(cls), 450);
    }
  });
  drawSpark(source);
  if (chartState.item && chartState.item.source === source) paintModalQuote();
}

function priceDecimals(p, cat) {
  const a = Math.abs(p);
  if (cat === 'fx') return a >= 100 ? 2 : a >= 10 ? 3 : 4;
  if (a >= 1) return 2;
  return a >= 0.01 ? 4 : 6;
}

function fmtPrice(p, cat) {
  const d = priceDecimals(p, cat);
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/* =========================================================
 * 資料來源
 * ========================================================= */
/** 只有「正在看市場監控頁」時才抓報價：沒開網頁、分頁在背景、切到其他頁都不呼叫 */
function marketActive() {
  return !!state.token && !document.hidden && !$('#section-market').classList.contains('hidden');
}

function isPaused(cat) { return state.paused.has(cat); }
function activeItems() { return state.items.filter(i => !isPaused(i.category)); }

function startFeeds() {
  stopFeeds();
  restartPolling();
  state.intradayTimer = setInterval(() => { if (marketActive()) loadIntraday(); }, 180000);
  syncFeeds();
}

/** 依目前是否在市場監控頁，開始或停止所有報價（含虛擬貨幣連線） */
function syncFeeds() {
  if (!state.token) return;
  if (marketActive()) {
    if (state.feedsOn) return;
    state.feedsOn = true;
    pollQuotes();
    loadIntraday();
    connectCrypto();
  } else if (state.feedsOn) {
    state.feedsOn = false;
    closeSockets();
    setStatus('已暫停（離開市場監控頁時不更新）');
  }
}

function closeSockets() {
  clearInterval(state.cryptoPollTimer);
  state.cryptoPollTimer = null;
  state.sockets.forEach(ws => { ws.onclose = null; ws.close(); });
  state.sockets = [];
}

function stopFeeds() {
  clearInterval(state.pollTimer);
  clearInterval(state.intradayTimer);
  closeSockets();
  state.feedsOn = false;
}

function restartPolling() {
  clearInterval(state.pollTimer);
  const sec = parseInt($('#intervalSel').value, 10) || 10;
  state.pollTimer = setInterval(() => { if (marketActive()) pollQuotes(); }, sec * 1000);
}

/* --- 各區塊暫停／繼續（存在帳號設定 pausedCats） --- */
function applyPauseUI() {
  CATS.forEach(c => {
    const card = $(`.card[data-cat="${c.key}"]`);
    if (!card) return;
    const p = isPaused(c.key);
    card.classList.toggle('paused', p);
    const b = $('[data-act=pause]', card);
    b.textContent = p ? '▶' : '⏸';
    b.title = p ? '繼續更新此區塊' : '停止更新此區塊';
    b.classList.toggle('on', p);
    $('[data-meta]', card).textContent = p ? '已停止更新' : '';
  });
  const all = CATS.every(c => isPaused(c.key));
  const btn = $('#pauseAllBtn');
  btn.textContent = all ? '▶ 全部繼續' : '⏸ 全部停止';
  btn.classList.toggle('on', all);
  requestAnimationFrame(() => $$('#marketGrid .card').forEach(sizeCard));
}

function setPaused(cats, paused) {
  const resumed = [];
  cats.forEach(k => {
    if (paused) state.paused.add(k);
    else if (state.paused.delete(k)) resumed.push(k);
  });
  applyPauseUI();
  const value = [...state.paused].join(',');
  state.settings = Object.assign(state.settings || {}, { pausedCats: value });
  api('saveSetting', { key: 'pausedCats', value }).catch(() => {});
  if (cats.includes('crypto') && marketActive()) connectCrypto();
  if (!paused && resumed.length && marketActive()) {
    pollQuotes();
    loadIntraday(state.items.filter(i => resumed.includes(i.category)));
  }
  if (paused && !activeItems().length) setStatus('已全部停止更新');
}

function togglePause(cat) { setPaused([cat], !isPaused(cat)); }

function togglePauseAll() {
  const all = CATS.every(c => isPaused(c.key));
  setPaused(CATS.map(c => c.key), !all);
}

/* --- 匯率 / 台股 / 國外 / 指數：透過 GAS 代抓 --- */
let polling = false;
async function pollQuotes() {
  if (polling || !marketActive()) return;
  const sources = [...new Set(activeItems().map(i => i.source).filter(s => /^(yahoo|mis):/.test(s)))];
  if (!sources.length) {
    if (!activeItems().length) setStatus('已全部停止更新');
    return;
  }
  polling = true;
  const now = () => new Date().toLocaleTimeString('zh-TW', { hour12: false });
  try {
    const r = await api('quotes', { sources });
    Object.entries(r.quotes).forEach(([src, q]) => setQuote(src, q));
    state.lastUpdate = new Date();
    // 個別失敗只列名稱，下一輪自動再試，不額外重試
    const failed = (r.failed || []).map(src => (state.items.find(i => i.source === src) || {}).name || src);
    const tail = failed.length ? ` · 失敗：${failed.slice(0, 3).join('、')}${failed.length > 3 ? ` 等 ${failed.length} 檔` : ''}` : '';
    setStatus('即時更新中 · ' + now() + tail, failed.length ? 'warn' : 'live');
  } catch (err) {
    setStatus('更新失敗 · ' + now() + '（下一輪自動更新）', 'err');
  } finally {
    polling = false;
  }
}

/* --- 虛擬貨幣：瀏覽器直連 Binance WebSocket --- */
function cryptoGroups() {
  const spot = [], fut = [];
  state.items.forEach(i => {
    if (i.source.startsWith('binance:')) spot.push(i.source.slice(8));
    else if (i.source.startsWith('binancef:')) fut.push(i.source.slice(9));
  });
  return { spot: [...new Set(spot)], fut: [...new Set(fut)] };
}

function connectCrypto() {
  closeSockets();
  if (!marketActive() || isPaused('crypto')) return; // 不在市場監控頁或已暫停：不連線
  const { spot, fut } = cryptoGroups();
  fetchCryptoRest(); // 先抓一次快照，避免等待 WebSocket 首筆
  if (spot.length) openSocket('wss://stream.binance.com:9443/stream?streams=', spot, 'binance:');
  if (fut.length) openSocket('wss://fstream.binance.com/stream?streams=', fut, 'binancef:');
}

function openSocket(base, syms, prefix) {
  const ws = new WebSocket(base + syms.map(s => s.toLowerCase() + '@ticker').join('/'));
  ws.onmessage = ev => {
    const d = JSON.parse(ev.data).data;
    if (!d || !d.s) return;
    setQuote(prefix + d.s, { price: +d.c, prev: +d.o, pct: +d.P, time: d.E });
  };
  ws.onopen = () => {
    clearInterval(state.cryptoPollTimer);
    state.cryptoPollTimer = null;
  };
  ws.onclose = () => {
    // 斷線：改用 REST 輪詢，5 秒後重連
    if (!state.cryptoPollTimer) state.cryptoPollTimer = setInterval(fetchCryptoRest, 5000);
    setTimeout(() => { if (marketActive() && state.sockets.includes(ws)) connectCrypto(); }, 5000);
  };
  state.sockets.push(ws);
}

async function fetchCryptoRest() {
  const { spot, fut } = cryptoGroups();
  const tasks = [];
  if (spot.length) {
    tasks.push(fetch('https://api.binance.com/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(spot)))
      .then(r => r.json())
      .then(arr => Array.isArray(arr) && arr.forEach(t =>
        setQuote('binance:' + t.symbol, { price: +t.lastPrice, prev: +t.openPrice, pct: +t.priceChangePercent, time: t.closeTime }))));
  }
  fut.forEach(s => tasks.push(
    fetch('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=' + s)
      .then(r => r.json())
      .then(t => t.symbol && setQuote('binancef:' + t.symbol,
        { price: +t.lastPrice, prev: +t.openPrice, pct: +t.priceChangePercent, time: t.closeTime }))));
  await Promise.allSettled(tasks);
}

/** 新增虛擬貨幣時判斷是現貨或永續合約 */
async function detectBinanceMarket(sym) {
  const ok = async url => {
    try { const r = await fetch(url); const j = await r.json(); return !!j.price; } catch { return false; }
  };
  if (await ok('https://api.binance.com/api/v3/ticker/price?symbol=' + sym)) return 'binance:' + sym;
  if (await ok('https://fapi.binance.com/fapi/v1/ticker/price?symbol=' + sym)) return 'binancef:' + sym;
  throw new Error('Binance 查無交易對：' + sym);
}

/* =========================================================
 * 新增 / 刪除標的
 * ========================================================= */
/** 供個股研究、選股篩選器呼叫：加入自選清單並立即開始報價 */
async function addToWatchlist(category, symbol, name) {
  const r = await apiRetry('add', { category, symbol, name: name || '' });
  state.items.push(r.item);
  if (r.item.quote) state.quotes[r.item.source] = r.item.quote;
  renderRows(category);
  if (category === 'crypto') connectCrypto();
  loadIntraday([r.item]);
  toast(`已加入自選：${r.item.name}`);
  return r.item;
}

function inWatchlist(category, symbol) {
  return state.items.some(i => i.category === category && i.symbol === String(symbol).toUpperCase());
}

async function onAdd(e, catKey) {
  e.preventDefault();
  const form = e.target;
  const errEl = $('.add-err', form);
  const btn = $('button[type=submit]', form);
  const symbol = form.symbol.value.trim();
  const name = form.name.value.trim();
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = '驗證中…';
  try {
    let source;
    if (catKey === 'crypto') source = await detectBinanceMarket(symbol.toUpperCase().replace(/[\/\-\s]/g, ''));
    const r = await apiRetry('add', { category: catKey, symbol, name, source }, n => { btn.textContent = `重試中（${n}/3）…`; });
    state.items.push(r.item);
    if (r.item.quote) state.quotes[r.item.source] = r.item.quote;
    renderRows(catKey);
    if (catKey === 'crypto') connectCrypto();
    loadIntraday([r.item]);
    form.reset();
    toast(`已新增 ${r.item.name}`);
  } catch (err) {
    errEl.textContent = `新增失敗：${symbol.toUpperCase()}（${err.message}）`;
  } finally {
    btn.disabled = false;
    btn.textContent = '新增';
  }
}

async function onRemove(it) {
  if (!confirm(`確定要刪除「${it.name}」(${it.symbol})？`)) return;
  try {
    await api('remove', { category: it.category, symbol: it.symbol });
    state.items = state.items.filter(x => x !== it);
    renderRows(it.category);
    if (it.category === 'crypto') connectCrypto();
    toast(`已刪除 ${it.name}`);
  } catch (err) {
    toast('刪除失敗：' + err.message);
  }
}

/* =========================================================
 * 當日走勢小圖
 * ========================================================= */
async function loadIntraday(items = state.items) {
  if (!marketActive()) return;
  items = items.filter(i => !isPaused(i.category));
  const gas = [...new Set(items.map(i => i.source).filter(s => /^(yahoo|mis):/.test(s)))];
  const tasks = [];
  if (gas.length) {
    tasks.push(api('intraday', { sources: gas }).then(r => {
      Object.entries(r.data || {}).forEach(([src, d]) => { state.intraday[src] = d; drawSpark(src); });
    }));
  }
  // 虛擬貨幣 24 小時不間斷，取近 24 小時 15 分 K
  items.filter(i => /^binancef?:/.test(i.source)).forEach(it => tasks.push(
    fetchBinanceKlines(it.source, '15m', 96).then(k => {
      if (!k.length) return;
      state.intraday[it.source] = { c: k.map(x => x.c), prev: k[0].o };
      drawSpark(it.source);
    })));
  await Promise.allSettled(tasks);
}

function drawSpark(source) {
  const d = state.intraday[source];
  if (!d || !d.c || !d.c.length) return;
  const q = state.quotes[source];
  const pts = d.c.slice();
  if (q && q.price != null) pts.push(q.price); // 接上最新即時價
  const prev = d.prev != null ? d.prev : pts[0];
  const W = 76, H = 28, P = 2;
  let min = Math.min(prev, ...pts), max = Math.max(prev, ...pts);
  if (max === min) { max += 1; min -= 1; }
  const x = i => (pts.length === 1 ? W / 2 : (i * W) / (pts.length - 1));
  const y = v => P + (H - 2 * P) * (1 - (v - min) / (max - min));
  const line = pts.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  const dir = last > prev ? 'up' : last < prev ? 'down' : '';
  const yb = y(prev).toFixed(1);
  const html =
    `<line class="base" x1="0" x2="${W}" y1="${yb}" y2="${yb}" vector-effect="non-scaling-stroke"/>` +
    `<polygon class="area" points="0,${yb} ${line} ${W},${yb}"/>` +
    `<polyline class="line" points="${line}" vector-effect="non-scaling-stroke"/>` +
    `<circle class="dot" r="2" cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}"/>`;
  $$(`.row[data-source="${cssEsc(source)}"] .spark`).forEach(svg => {
    svg.setAttribute('class', 'spark ' + dir);
    svg.innerHTML = html;
  });
}

/** Binance K 線（自動分頁往前抓），回傳 [{t,o,h,l,c,v}] 由舊到新 */
async function fetchBinanceKlines(source, interval, total) {
  const fut = source.startsWith('binancef:');
  const sym = source.split(':')[1];
  const base = fut ? 'https://fapi.binance.com/fapi/v1/klines' : 'https://api.binance.com/api/v3/klines';
  const max = fut ? 1500 : 1000;
  let out = [], endTime = null;
  while (out.length < total) {
    const limit = Math.min(max, total - out.length);
    const url = `${base}?symbol=${sym}&interval=${interval}&limit=${limit}` + (endTime ? `&endTime=${endTime}` : '');
    const arr = await (await fetch(url)).json();
    if (!Array.isArray(arr) || !arr.length) break;
    out = arr.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).concat(out);
    if (arr.length < limit) break;
    endTime = arr[0][0] - 1;
  }
  return out;
}

/* =========================================================
 * 編輯模式：拖曳排序
 * ========================================================= */
function setEditing(on) {
  state.editing = on;
  $('#marketGrid').classList.toggle('editing', on);
  $('#editHint').classList.toggle('hidden', !on);
  const b = $('#editBtn');
  b.classList.toggle('on', on);
  b.textContent = on ? '✓ 完成' : '✎ 編輯';
  state.sortables.forEach(s => s.option('disabled', !on));
}

function initSortables() {
  state.sortables.forEach(s => s.destroy());
  state.sortables = [];
  if (!window.Sortable) return;
  const grid = $('#marketGrid');
  state.sortables.push(Sortable.create(grid, {
    draggable: '.card', handle: '.card-title', animation: 180, ghostClass: 'sortable-ghost',
    disabled: !state.editing,
    onEnd: e => { if (e.oldIndex !== e.newIndex) saveCardOrder(); },
  }));
  $$('.rows', grid).forEach(ul => state.sortables.push(Sortable.create(ul, {
    draggable: '.row', filter: '.del', preventOnFilter: false, animation: 150, ghostClass: 'sortable-ghost',
    disabled: !state.editing,
    onEnd: e => { if (e.oldIndex !== e.newIndex) saveItemOrder(); },
  })));
}

async function saveCardOrder() {
  state.cardOrder = $$('#marketGrid .card').map(c => c.dataset.cat);
  try { await api('saveSetting', { key: 'cardOrder', value: state.cardOrder.join(',') }); }
  catch (err) { toast('區塊順序儲存失敗：' + err.message); }
}

async function saveItemOrder() {
  const keys = $$('#marketGrid .row[data-key]').map(li => li.dataset.key);
  const byKey = new Map(state.items.map(i => [i.category + '|' + i.symbol, i]));
  state.items = keys.map(k => byKey.get(k)).filter(Boolean)
    .concat(state.items.filter(i => !keys.includes(i.category + '|' + i.symbol)));
  try { await api('reorder', { keys }); }
  catch (err) { toast('排序儲存失敗：' + err.message); }
}

/* =========================================================
 * 走勢圖視窗（歷史 K 線 + 技術分析）
 * ========================================================= */
const SMA_LIST = [5, 10, 20, 60, 120];
const SMA_COLORS = { 5: '#e67e22', 10: '#2c6bc4', 20: '#8e44ad', 60: '#16a085', 120: '#7f8c8d' };
const chartState = {
  item: null, data: null, chart: null, series: {}, calc: {}, reqId: 0,
  interval: '1d', range: 36, type: 'candle', vol: true, tech: false,
  ind: { sma5: true, sma10: true, sma20: true, sma60: true, sma120: true, kd: true, macd: true },
};

function initChartModal() {
  try { Object.assign(chartState, JSON.parse(store.get('mw_chart') || '{}')); } catch {}
  const segment = (sel, key, fn) => {
    $$(sel + ' button').forEach(b => {
      b.classList.toggle('on', String(chartState[key]) === b.dataset.v);
      b.addEventListener('click', () => {
        $$(sel + ' button').forEach(x => x.classList.toggle('on', x === b));
        chartState[key] = key === 'range' ? +b.dataset.v : b.dataset.v;
        saveChartPrefs();
        fn();
      });
    });
  };
  segment('#segInterval', 'interval', loadHistory);
  segment('#segRange', 'range', applyRange);
  segment('#segType', 'type', () => buildChart(true));

  $('#chkVol').checked = chartState.vol;
  $('#chkVol').addEventListener('change', e => { chartState.vol = e.target.checked; saveChartPrefs(); buildChart(true); });

  const syncTech = () => {
    $('#techBtn').classList.toggle('on', chartState.tech);
    $('#techBar').classList.toggle('hidden', !chartState.tech);
  };
  syncTech();
  $('#techBtn').addEventListener('click', () => { chartState.tech = !chartState.tech; syncTech(); saveChartPrefs(); buildChart(true); });
  $$('#techBar input').forEach(inp => {
    inp.checked = chartState.ind[inp.dataset.ind] !== false;
    inp.addEventListener('change', () => { chartState.ind[inp.dataset.ind] = inp.checked; saveChartPrefs(); buildChart(true); });
  });

  $('#mClose').addEventListener('click', closeChart);
  $('#chartModal').addEventListener('mousedown', e => { if (e.target.id === 'chartModal') closeChart(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && chartState.item) closeChart(); });
  $('#colorSel').addEventListener('change', () => { if (chartState.data) buildChart(true); });
}

function saveChartPrefs() {
  const { interval, range, type, vol, tech, ind } = chartState;
  store.set('mw_chart', JSON.stringify({ interval, range, type, vol, tech, ind }));
}

function openChart(it) {
  chartState.item = it;
  chartState.data = null;
  $('#mName').textContent = it.name || it.symbol;
  $('#mCode').textContent = it.symbol + (it.source.startsWith('binancef:') ? ' · 永續' : '');
  paintModalQuote();
  $('#chartModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  loadHistory();
}

function closeChart() {
  $('#chartModal').classList.add('hidden');
  document.body.style.overflow = '';
  if (chartState.chart) { chartState.chart.remove(); chartState.chart = null; }
  chartState.item = null;
  chartState.data = null;
  chartState.reqId++;
}

function paintModalQuote() {
  const it = chartState.item;
  const q = it && state.quotes[it.source];
  const dir = q && q.pct > 0 ? 'up' : q && q.pct < 0 ? 'down' : '';
  $('#mPrice').textContent = q ? fmtPrice(q.price, it.category) : '';
  $('#mPrice').className = 'm-price ' + dir;
  $('#mPct').textContent = q && q.pct != null ? (q.pct > 0 ? '+' : '') + q.pct.toFixed(2) + '%' : '';
  $('#mPct').className = 'pct ' + dir;
}

function chartMsg(text) {
  const el = $('#chartMsg');
  el.classList.toggle('hidden', !text);
  el.textContent = text || '';
}

async function loadHistory() {
  const it = chartState.item;
  if (!it) return;
  const id = ++chartState.reqId;
  chartMsg('載入中…');
  try {
    let d;
    if (/^binancef?:/.test(it.source)) {
      const [iv, n] = { '1d': ['1d', 1830], '1wk': ['1w', 520], '1mo': ['1M', 200] }[chartState.interval];
      const k = await fetchBinanceKlines(it.source, iv, n);
      d = k.map(x => ({ time: new Date(x.t).toISOString().slice(0, 10), open: x.o, high: x.h, low: x.l, close: x.c, volume: x.v }));
    } else {
      const r = (await api('history', { source: it.source, interval: chartState.interval })).data;
      d = r.t.map((t, i) => {
        const o = r.o[i], c = r.c[i];
        return { time: t, open: o, close: c, high: r.h[i] ?? Math.max(o, c), low: r.l[i] ?? Math.min(o, c), volume: r.v[i] || 0 };
      });
    }
    if (id !== chartState.reqId) return;
    if (!d.length) throw new Error('查無歷史資料');
    chartState.data = d;
    buildChart(false);
    chartMsg(null);
  } catch (err) {
    if (id === chartState.reqId) chartMsg('載入失敗：' + err.message);
  }
}

function buildChart(keepRange) {
  const d = chartState.data;
  const LWC = window.LightweightCharts;
  if (!d || !LWC) return;
  let range = null;
  if (chartState.chart) {
    if (keepRange) range = chartState.chart.timeScale().getVisibleLogicalRange();
    chartState.chart.remove();
  }
  const css = getComputedStyle(document.body);
  const up = css.getPropertyValue('--up').trim();
  const down = css.getPropertyValue('--down').trim();
  const chart = LWC.createChart($('#chartBox'), {
    autoSize: true,
    layout: {
      background: { type: 'solid', color: '#ffffff' }, textColor: '#5b6778', fontSize: 11,
      fontFamily: 'Inter, "Noto Sans TC", sans-serif',
      panes: { separatorColor: '#e3e8ef', separatorHoverColor: '#c9d6ea', enableResize: true },
    },
    grid: { vertLines: { color: '#f2f4f7' }, horzLines: { color: '#f2f4f7' } },
    rightPriceScale: { borderColor: '#e3e8ef' },
    timeScale: { borderColor: '#e3e8ef', rightOffset: 4 },
    crosshair: { mode: LWC.CrosshairMode.Normal },
    localization: { locale: 'zh-TW', dateFormat: 'yyyy-MM-dd' },
  });
  chartState.chart = chart;

  const dec = priceDecimals(d[d.length - 1].close, chartState.item.category);
  const pf = { type: 'price', precision: dec, minMove: Math.pow(10, -dec) };
  const plain = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
  const S = chartState.series = {};
  const closes = d.map(x => x.close);

  // 主圖
  if (chartState.type === 'candle') {
    S.main = chart.addSeries(LWC.CandlestickSeries, {
      upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceFormat: pf,
    });
    S.main.setData(d.map(x => ({ time: x.time, open: x.open, high: x.high, low: x.low, close: x.close })));
  } else {
    S.main = chart.addSeries(LWC.AreaSeries, {
      lineColor: '#1f4e8c', topColor: 'rgba(31,78,140,.18)', bottomColor: 'rgba(31,78,140,0)', lineWidth: 2, priceFormat: pf,
    });
    S.main.setData(d.map(x => ({ time: x.time, value: x.close })));
  }

  // 成交量
  const hasVol = d.some(x => x.volume > 0);
  $('#chkVol').disabled = !hasVol;
  $('#chkVol').parentElement.title = hasVol ? '' : '此標的無成交量資料';
  if (chartState.vol && hasVol) {
    S.vol = chart.addSeries(LWC.HistogramSeries, { ...plain, priceScaleId: 'vol', priceFormat: { type: 'volume' } }, 0);
    S.vol.setData(d.map((x, i) => ({
      time: x.time, value: x.volume,
      color: (x.close >= (i ? d[i - 1].close : x.open) ? up : down) + '59',
    })));
    chart.priceScale('vol', 0).applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    S.main.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.24 } });
  } else {
    S.main.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.06 } });
  }

  // 技術分析
  const C = chartState.calc = {};
  if (chartState.tech) {
    SMA_LIST.forEach(n => {
      if (!chartState.ind['sma' + n]) return;
      C['sma' + n] = sma(closes, n);
      S['sma' + n] = chart.addSeries(LWC.LineSeries, { ...plain, color: SMA_COLORS[n], lineWidth: 1, priceFormat: pf });
      S['sma' + n].setData(toLine(d, C['sma' + n]));
    });
    let pane = 1;
    const ipf = { type: 'price', precision: 2, minMove: 0.01 };
    if (chartState.ind.kd) {
      Object.assign(C, kd(d));
      S.k = chart.addSeries(LWC.LineSeries, { ...plain, lastValueVisible: true, color: '#e67e22', lineWidth: 1.5, priceFormat: ipf }, pane);
      S.d = chart.addSeries(LWC.LineSeries, { ...plain, lastValueVisible: true, color: '#2c6bc4', lineWidth: 1.5, priceFormat: ipf }, pane);
      S.k.setData(toLine(d, C.K));
      S.d.setData(toLine(d, C.D));
      [80, 20].forEach(p => S.k.createPriceLine({ price: p, color: '#c3cad5', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false }));
      pane++;
    }
    if (chartState.ind.macd) {
      Object.assign(C, macd(closes));
      const mpf = { type: 'price', precision: dec + 1, minMove: Math.pow(10, -(dec + 1)) };
      S.osc = chart.addSeries(LWC.HistogramSeries, { ...plain, priceFormat: mpf }, pane);
      S.osc.setData(d.map((x, i) => (C.OSC[i] == null ? { time: x.time }
        : { time: x.time, value: C.OSC[i], color: (C.OSC[i] >= 0 ? up : down) + '99' })));
      S.dif = chart.addSeries(LWC.LineSeries, { ...plain, lastValueVisible: true, color: '#2c6bc4', lineWidth: 1.5, priceFormat: mpf }, pane);
      S.dea = chart.addSeries(LWC.LineSeries, { ...plain, lastValueVisible: true, color: '#e67e22', lineWidth: 1.5, priceFormat: mpf }, pane);
      S.dif.setData(toLine(d, C.DIF));
      S.dea.setData(toLine(d, C.DEA));
      pane++;
    }
    const panes = chart.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 3.2 : 1));
  }

  chart.subscribeCrosshairMove(p => {
    const i = p && p.logical != null && p.point ? Math.round(p.logical) : null;
    updateLegend(i != null && i >= 0 && i < d.length ? i : null);
  });
  updateLegend(null);

  // autoSize 會在下一個畫格才取得容器尺寸，延後設定可視範圍
  const setRange = () => {
    if (chartState.chart !== chart) return;
    if (range) chart.timeScale().setVisibleLogicalRange(range);
    else applyRange();
  };
  setRange();
  requestAnimationFrame(() => requestAnimationFrame(setRange));
}

function applyRange() {
  const ch = chartState.chart, d = chartState.data;
  if (!ch || !d) return;
  const months = chartState.range;
  if (!months) { ch.timeScale().fitContent(); return; }
  const cut = new Date(d[d.length - 1].time);
  cut.setMonth(cut.getMonth() - months);
  const cs = cut.toISOString().slice(0, 10);
  let from = d.findIndex(x => x.time >= cs);
  if (from < 0) from = 0;
  ch.timeScale().setVisibleLogicalRange({ from, to: d.length - 1 + 4 });
}

function updateLegend(i) {
  const d = chartState.data;
  if (!d) return;
  if (i == null) i = d.length - 1;
  const x = d[i], C = chartState.calc, cat = chartState.item.category;
  const f = v => (v == null || !isFinite(v) ? '—' : fmtPrice(v, cat));
  const f2 = v => (v == null || !isFinite(v) ? '—' : v.toFixed(2));
  const prevClose = i ? d[i - 1].close : x.open;
  const chg = prevClose ? ((x.close - prevClose) / prevClose) * 100 : 0;
  const color = chg > 0 ? 'var(--up)' : chg < 0 ? 'var(--down)' : 'var(--text)';
  let html = `<div><span><b>${x.time}</b></span>
    <span>開 <b>${f(x.open)}</b></span><span>高 <b>${f(x.high)}</b></span>
    <span>低 <b>${f(x.low)}</b></span><span>收 <b style="color:${color}">${f(x.close)}</b></span>
    <span style="color:${color}">${chg > 0 ? '+' : ''}${chg.toFixed(2)}%</span>
    ${x.volume ? `<span>量 <b>${fmtVol(x.volume)}</b></span>` : ''}</div>`;
  if (chartState.tech) {
    const smas = SMA_LIST.filter(n => C['sma' + n])
      .map(n => `<span style="color:${SMA_COLORS[n]}">SMA${n} ${f(C['sma' + n][i])}</span>`).join('');
    if (smas) html += `<div>${smas}</div>`;
    if (C.K) html += `<div><span style="color:#e67e22">K ${f2(C.K[i])}</span><span style="color:#2c6bc4">D ${f2(C.D[i])}</span></div>`;
    if (C.DIF) {
      const fm = v => (v == null || !isFinite(v) ? '—' : v.toFixed(priceDecimals(x.close, cat) + 1));
      html += `<div><span style="color:#2c6bc4">DIF ${fm(C.DIF[i])}</span><span style="color:#e67e22">MACD ${fm(C.DEA[i])}</span><span>OSC ${fm(C.OSC[i])}</span></div>`;
    }
  }
  $('#chartLegend').innerHTML = html;
}

/* ---------- 指標計算 ---------- */
function sma(v, n) {
  const o = new Array(v.length).fill(null);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= n) s -= v[i - n];
    if (i >= n - 1) o[i] = s / n;
  }
  return o;
}

function ema(v, n) {
  const k = 2 / (n + 1);
  let p = null;
  return v.map(x => {
    if (x == null) return null;
    p = p == null ? x : x * k + p * (1 - k);
    return p;
  });
}

/** MACD(12,26,9)：DIF = EMA12 − EMA26，MACD(DEA) = DIF 的 EMA9，OSC = DIF − MACD */
function macd(c) {
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const DIF = c.map((_, i) => (i < 25 ? null : e12[i] - e26[i]));
  const DEA = ema(DIF, 9).map((x, i) => (i < 33 ? null : x));
  const OSC = DIF.map((x, i) => (x == null || DEA[i] == null ? null : x - DEA[i]));
  return { DIF, DEA, OSC };
}

/** KD(9,3,3)（台灣慣用算法）：RSV 9 日，K = 2/3 前K + 1/3 RSV，D = 2/3 前D + 1/3 K */
function kd(d, n = 9) {
  const K = [], D = [];
  let k = 50, dd = 50;
  for (let i = 0; i < d.length; i++) {
    if (i < n - 1) { K.push(null); D.push(null); continue; }
    let hh = -Infinity, ll = Infinity;
    for (let j = i - n + 1; j <= i; j++) { hh = Math.max(hh, d[j].high); ll = Math.min(ll, d[j].low); }
    const rsv = hh === ll ? 50 : ((d[i].close - ll) / (hh - ll)) * 100;
    k = (k * 2) / 3 + rsv / 3;
    dd = (dd * 2) / 3 + k / 3;
    K.push(k);
    D.push(dd);
  }
  return { K, D };
}

function toLine(d, arr) {
  return d.map((x, i) => (arr[i] == null || !isFinite(arr[i]) ? { time: x.time } : { time: x.time, value: arr[i] }));
}

function fmtVol(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(Math.round(v));
}

/* =========================================================
 * 今日 API 呼叫次數
 * ========================================================= */
function updateUsage(u) {
  const pct = u.limit ? (u.count / u.limit) * 100 : 0;
  $('#usageNum').textContent = u.count.toLocaleString('en-US') + ' / ' + u.limit.toLocaleString('en-US');
  $('#usageBar').style.width = Math.min(100, pct).toFixed(1) + '%';
  const box = $('#usageBox');
  box.classList.toggle('warn', pct >= 70 && pct < 90);
  box.classList.toggle('danger', pct >= 90);
  box.title = `今日（${u.date}）已用 ${pct.toFixed(1)}%`;
}

/* =========================================================
 * 小工具
 * ========================================================= */
function setStatus(text, cls = '') {
  const el = $('#statusText');
  el.className = 'status ' + cls;
  el.innerHTML = '<span class="dot"></span>' + esc(text);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'); }

/* ---------- 啟動 ---------- */
initAuth();
initApp();
(function resume() {
  const token = store.get('mw_token');
  if (token && apiUrl()) {
    state.token = token;
    state.account = store.get('mw_account');
    showApp();
  }
})();
