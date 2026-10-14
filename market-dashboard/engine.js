/* =========================================================
 * 瀏覽器資料引擎 — 主執行緒（見 engine-worker.js）
 * 有資料中繼站、且網站以 http(s) 開啟時，總經與財金日曆的部分字卡改在瀏覽器背景執行緒算，不經 Google：
 *  - 沒有 Apps Script 的啟動時間、不吃 Google 每日額度、不會因 Google 主機被擋而失敗
 *  - 計算用的是同一份後端程式，結果與後端一致；瀏覽器執行失敗時自動改走後端（後端還有 6 小時備援資料）
 * 同時最多 ENGINE_POOL 個背景執行緒，各自處理一張字卡。
 * 依賴 app.js（state, proxyOn, logApi, store）
 * ========================================================= */
const ENGINE_POOL = 3;
const ENGINE_VERSION = '20261015';
const ENGINE_PROPS_KEY = 'mw_eng_props';
const engine = { workers: [], queue: [], seq: 0, pending: new Map(), failed: false, ctxExtra: {} };
// 會擋 Cloudflare 主機、但不擋 Google 的網站：經中繼站抓不到時改請後端代抓（後端白名單見 Code.gs RELAY_ALLOW）
const RELAY_HOSTS = ['nfs.faireconomy.media'];

/** 可用條件：有中繼站、瀏覽器支援 Worker、不是直接開檔案（file:// 無法載入背景程式） */
function engineOn() {
  return proxyOn() && !engine.failed && typeof Worker === 'function' && /^https?:$/.test(location.protocol);
}

function engineProps() {
  try { return JSON.parse(store.get(ENGINE_PROPS_KEY) || '{}'); } catch { return {}; }
}

function engineSaveProps(props) {
  const keep = {};
  Object.keys(props || {}).forEach(k => { if (k !== 'fetchUsage' && k !== 'FRED_KEY') keep[k] = props[k]; }); // 用量計數、金鑰不用存
  try { localStorage.setItem(ENGINE_PROPS_KEY, JSON.stringify(keep)); } catch { /* 空間不足就不存 */ }
}

function engineWorker() {
  let w = engine.workers.find(x => !x.busy);
  if (!w && engine.workers.length < ENGINE_POOL) {
    const worker = new Worker('engine-worker.js?v=' + ENGINE_VERSION);
    w = { worker, busy: false, init: false };
    worker.onmessage = e => {
      const m = e.data, p = engine.pending.get(m.id);
      engine.pending.delete(m.id);
      w.busy = false;
      if (m.props) engineSaveProps(m.props);
      if (p) {
        const hosts = {};
        (m.log || []).forEach(x => {
          const h = hosts[x[0]] = hosts[x[0]] || [0, 0, 0];
          h[0]++; h[1] = Math.max(h[1], x[1]);
          if (x[2] === 'err' || x[2] === 'skip' || x[2] >= 500 || x[2] === 429) h[2]++;
        });
        logApi({ at: p.t0, action: '瀏覽器 ' + p.label, total: Date.now() - p.t0, server: m.ms, hosts, ok: m.ok, err: m.ok ? '' : String(m.error || '').slice(0, 60) });
        if (m.ok) p.resolve(m.data); else p.reject(new Error(m.error));
      }
      enginePump();
    };
    worker.onerror = e => {
      // 背景程式無法載入（例如檔案沒有上傳）：之後都改走後端
      engine.failed = true;
      e.preventDefault();
      engine.pending.forEach(p => p.reject(new Error('瀏覽器引擎無法啟動')));
      engine.pending.clear();
      engine.queue.splice(0).forEach(j => j.reject(new Error('瀏覽器引擎無法啟動')));
    };
    engine.workers.push(w);
  }
  return w || null;
}

function enginePump() {
  while (engine.queue.length) {
    const w = engineWorker();
    if (!w) return;
    const job = engine.queue.shift();
    w.busy = true;
    engine.pending.set(job.id, job);
    const ctx = { watchlist: state.items, ...engine.ctxExtra, prefetched: job.prefetched || {} };
    if (!w.init) {
      ctx.proxy = state.proxy;
      ctx.props = Object.assign(engineProps(), state.fredKey ? { FRED_KEY: state.fredKey } : {});
      w.init = true;
    }
    w.worker.postMessage({ id: job.id, fn: job.fn, args: job.args, ctx, version: ENGINE_VERSION });
  }
}

/** 在瀏覽器執行後端函式（macro_、cal_），回傳 Promise；prefetched = { 網址: { status, text } } */
function engineCall(fn, args, label, prefetched) {
  return new Promise((resolve, reject) => {
    engine.queue.push({ id: ++engine.seq, fn, args, label: label || fn, t0: Date.now(), resolve, reject, prefetched });
    enginePump();
  });
}

/**
 * 需要逐日查很多網址的區塊（經濟日曆、美股財報）：先請引擎列出網址，主執行緒同時抓 6 個，
 * 再把內容交給引擎計算（引擎在背景執行緒只能一個一個同步請求，19 天要逐一等）。
 */
async function engineCallPlanned(fn, args, label, planPart) {
  let pre = {};
  try {
    const urls = await engineCall('calPlan_', [planPart], label + ' 規劃');
    const queue = urls.slice();
    const one = async () => {
      while (queue.length) {
        const u = queue.shift();
        try { pre[u] = { status: 200, text: await pget(u, 15000) }; } catch {
          // 擋 Cloudflare 主機的網站（例如 Forex Factory）：請後端代抓（後端快取 30 分鐘，幾乎不耗額度）
          if (RELAY_HOSTS.some(h => u.includes(h))) {
            try { const r = (await api('relay', { url: u })).data; if (r.status === 200) pre[u] = r; } catch { /* 讓引擎自己處理 */ }
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, urls.length) }, one));
  } catch { pre = {}; }
  return engineCall(fn, args, label, pre);
}

/** 除權息字卡要標示持股：投資組合還沒開過時，先向後端讀一次交易紀錄（不耗外部請求額度） */
async function engineEnsureTxns() {
  if (typeof pf !== 'undefined' && pf.loaded) { engine.ctxExtra.txns = pf.txns; return; } // 投資組合已載入：用最新的
  if (engine.ctxExtra.txns) return;
  try { engine.ctxExtra.txns = (await api('portfolio', { op: 'load' })).data.txns || []; } catch { engine.ctxExtra.txns = []; }
}
