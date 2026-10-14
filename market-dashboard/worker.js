/**
 * Market Watch 資料中繼站（Cloudflare Workers）
 * ------------------------------------------------------------
 * 為什麼需要：Google Apps Script 的對外請求共用 Google 的 IP，Yahoo、證交所常常限流或封鎖，
 * 而且一般帳號每天只有 20,000 次。報價改由瀏覽器經這裡抓（不經 Google、不吃 Google 額度），
 * 後端其他資料也經這裡轉送（不會被擋）。
 *
 * 部署（免費方案每天 100,000 次請求）：見 README「十五、資料中繼站」
 *  1. Cloudflare 後台 → Workers & Pages → Create → Create Worker → 取名（例如 mw-proxy）→ Deploy
 *  2. Edit code → 把這個檔案全部貼上 → Deploy
 *  3. Settings → Variables and Secrets → 新增 Secret：KEY = 自訂一串密碼（避免被別人拿去用）
 *  4. 把網址（https://mw-proxy.<你的帳號>.workers.dev）與 KEY 填到 Code.gs 的 PROXY_URL、PROXY_KEY
 *
 * 用法：GET https://<worker>/?key=<KEY>&url=<編碼後的目標網址>（期交所即時行情另可用 POST，內容原樣轉送）
 *  - 只轉送白名單內的網站（不是公開代理）
 *  - 依網址類型做邊緣快取（報價 5 秒、當日走勢 30 秒、其他 1–10 分鐘），多人同時查同一檔只向來源抓一次
 *  - 自動加上各網站需要的 User-Agent／Referer；Cookie 由呼叫端帶入（Yahoo 認證用）
 */
const ALLOW = [
  'query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'fc.yahoo.com', 'finance.yahoo.com', 'login.yahoo.com',
  'mis.twse.com.tw', 'www.twse.com.tw', 'openapi.twse.com.tw', 'www.tpex.org.tw',
  'fred.stlouisfed.org', 'api.finmindtrade.com', 'api.nasdaq.com', 'api.cnyes.com', 'news.cnyes.com',
  'www.moneydj.com', 'www.federalreserve.gov', 'www.cnbc.com', 'www.cbc.gov.tw', 'ws.ndc.gov.tw', 'data.gov.tw',
  'nfs.faireconomy.media', 'markets.newyorkfed.org', 'api.alternative.me', 'home.treasury.gov', 'api.stlouisfed.org',
  'openapi.taifex.com.tw', 'www.taifex.com.tw', 'mis.taifex.com.tw', 'publicreporting.cftc.gov',
];
// 允許 POST 轉送的網站（期交所即時行情只接受 POST JSON）
const POST_ALLOW = ['mis.taifex.com.tw'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Cookie',
  'Access-Control-Expose-Headers': 'X-Set-Cookie, X-Proxy-Ms, X-Upstream-Status',
  'Access-Control-Max-Age': '86400', // 預檢結果快取一天（瀏覽器帶 X-Cookie 時不必每次預檢）
};

/** 邊緣快取秒數（0 = 不快取） */
function ttlOf(u) {
  const s = u.href;
  if (u.hostname === 'mis.twse.com.tw') return 5;
  if (/\/v1\/test\/getcrumb|fc\.yahoo\.com|login\.yahoo|quoteSummary|crumb=/.test(s)) return 0; // 認證相關不快取
  if (/\/v7\/finance\/spark/.test(s)) return /interval=5m/.test(s) ? 30 : 5;
  if (/\/v8\/finance\/chart\//.test(s)) return /range=1d/.test(s) ? 15 : 300;
  if (/api\.cnyes|cnbc|faireconomy/.test(s)) return 120;
  if (u.hostname === 'api.nasdaq.com') {
    // 已經過去的日期資料不會再變：快取 6 小時；今天以後 10 分鐘
    const d = u.searchParams.get('date'), today = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
    return d && d < today ? 21600 : 600;
  }
  if (u.hostname === 'home.treasury.gov') return 3600;
  if (u.hostname === 'openapi.taifex.com.tw') return 300;
  if (u.hostname === 'www.taifex.com.tw') return 600;
  if (u.hostname === 'publicreporting.cftc.gov') return 3600;
  return 60;
}

function extraHeaders(u) {
  const h = {};
  if (u.hostname === 'mis.twse.com.tw') h.Referer = 'https://mis.twse.com.tw/stock/index.jsp';
  if (u.hostname === 'api.nasdaq.com') { h.Origin = 'https://www.nasdaq.com'; h.Referer = 'https://www.nasdaq.com/'; }
  if (/twse\.com\.tw|tpex\.org\.tw|taifex\.com\.tw/.test(u.hostname)) h['Accept-Language'] = 'zh-TW,zh;q=0.9';
  if (u.hostname === 'mis.taifex.com.tw') { h.Origin = 'https://mis.taifex.com.tw'; h.Referer = 'https://mis.taifex.com.tw/futures/'; }
  return h;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const t0 = Date.now();
    const q = new URL(request.url).searchParams;
    if (env.KEY && q.get('key') !== env.KEY) return new Response('forbidden', { status: 403, headers: CORS });
    let target;
    try { target = new URL(q.get('url') || ''); } catch (e) { return new Response('bad url', { status: 400, headers: CORS }); }
    if (!/^https?:$/.test(target.protocol) || !ALLOW.includes(target.hostname)) return new Response('host not allowed', { status: 403, headers: CORS });

    const headers = { 'User-Agent': UA, Accept: request.headers.get('Accept') || 'application/json, text/plain, */*', ...extraHeaders(target) };
    // Cookie：Apps Script 直接帶 Cookie；瀏覽器不能帶跨站 Cookie，改用 X-Cookie
    const cookie = request.headers.get('X-Cookie') || request.headers.get('Cookie');
    if (cookie) headers.Cookie = cookie;
    const post = request.method === 'POST' && POST_ALLOW.includes(target.hostname);
    const ttl = cookie ? 0 : ttlOf(target);
    let up;
    try {
      if (post) {
        // POST：瀏覽器以 text/plain 送出（避免預檢），這裡改回 JSON 轉送；相同內容 5 秒內共用（Cache API）
        const body = await request.text();
        const ck = new Request('https://post-cache.local/?u=' + encodeURIComponent(target.href) + '&b=' + encodeURIComponent(body));
        const hit = await caches.default.match(ck);
        if (hit) {
          const h2 = new Headers(hit.headers);
          Object.entries(CORS).forEach(([k, v]) => h2.set(k, v));
          h2.set('X-Proxy-Ms', String(Date.now() - t0));
          return new Response(hit.body, { status: hit.status, headers: h2 });
        }
        up = await fetch(target.href, { method: 'POST', body, headers: { ...headers, 'Content-Type': 'application/json' } });
        if (up.ok) {
          const copy = new Response(up.clone().body, { status: up.status, headers: { 'Content-Type': up.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'public, max-age=5' } });
          ctx.waitUntil(caches.default.put(ck, copy));
        }
      } else {
        // 轉址由中繼站處理（瀏覽器端無法跟隨跨站轉址），最終回應的 Set-Cookie 照樣傳回
        up = await fetch(target.href, {
          headers, redirect: 'follow',
          cf: ttl ? { cacheTtl: ttl, cacheEverything: true } : { cacheTtl: 0 },
        });
      }
    } catch (e) {
      return new Response('upstream error: ' + e.message, { status: 502, headers: { ...CORS, 'X-Proxy-Ms': String(Date.now() - t0) } });
    }
    const out = new Headers(CORS);
    // 期交所下載檔是 MS950（Big5）編碼：瀏覽器不認得 MS950 這個名稱，改標成 big5 才能正確解碼
    out.set('Content-Type', (up.headers.get('Content-Type') || 'text/plain; charset=utf-8').replace(/charset=(ms950|cp950|x-windows-950)/i, 'charset=big5'));
    out.set('X-Proxy-Ms', String(Date.now() - t0));
    out.set('X-Upstream-Status', String(up.status));
    // 多個 Set-Cookie 要逐一保留（Yahoo 認證需要 A3 等 cookie）
    const sc = typeof up.headers.getSetCookie === 'function' ? up.headers.getSetCookie() : (up.headers.get('Set-Cookie') ? [up.headers.get('Set-Cookie')] : []);
    sc.forEach(c => out.append('Set-Cookie', c));
    if (sc.length) out.set('X-Set-Cookie', sc.map(c => c.split(';')[0]).join('; '));
    if (ttl) out.set('Cache-Control', 'public, max-age=' + ttl);
    return new Response(up.body, { status: up.status, headers: out });
  },
};
