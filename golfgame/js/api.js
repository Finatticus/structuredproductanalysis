// 後端呼叫：有 GAS 網址就打 GAS，沒有就用瀏覽器本機模擬（同一套動作）
import { gasUrl, ADMIN_USER } from './config.js';
import { START_POINTS, START_RESPECS } from './stats.js';

export const session = { user: null, pass: null, isAdmin: false, profile: null };

export async function call(action, payload = {}) {
  const body = { action, user: session.user, pass: session.pass, ...payload };
  const url = gasUrl();
  if (!url) return local(body);
  let res;
  try {
    // text/plain 避免 CORS 預檢，GAS 才收得到
    res = await fetch(url, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' });
  } catch (e) {
    throw new Error('連不到伺服器，請檢查網路或 GAS 網址');
  }
  const j = await res.json().catch(() => ({ ok: false, error: '伺服器回應格式錯誤' }));
  if (!j.ok) throw new Error(j.error || '發生錯誤');
  return j.data;
}

export const isLocalMode = () => !gasUrl();

// ---------------- 本機模式 ----------------
const DBK = 'dixen.localdb';
function db() {
  let d;
  try { d = JSON.parse(localStorage.getItem(DBK)); } catch (e) { d = null; }
  if (!d) d = { accounts: [{ user: ADMIN_USER, pass: '1220', active: true }], profiles: {}, rounds: {}, rooms: {}, msgs: {} };
  return d;
}
function save(d) { localStorage.setItem(DBK, JSON.stringify(d)); }
function prof(d, u) {
  if (!d.profiles[u]) d.profiles[u] = { user: u, points: START_POINTS, respecs: START_RESPECS, stats: {}, look: {}, rounds: 0, best: null, spent: 0, earned: START_POINTS };
  return d.profiles[u];
}
function auth(d, b) {
  const a = d.accounts.find(x => x.user === b.user);
  if (!a || a.pass !== String(b.pass)) throw new Error('帳號或密碼錯誤');
  if (!a.active) throw new Error('帳號尚未啟用，請等待管理員核准');
  return a;
}
function admin(d, b) { const a = auth(d, b); if (a.user !== ADMIN_USER) throw new Error('需要管理員權限'); }

async function local(b) {
  await new Promise(r => setTimeout(r, 60));
  const d = db();
  const out = (() => {
    switch (b.action) {
      case 'ping': return 'pong';
      case 'register': {
        const u = String(b.user || '').trim();
        if (!/^[A-Za-z0-9_\-一-鿿]{2,20}$/.test(u)) throw new Error('帳號限 2~20 字（中英數字、_ -）');
        if (d.accounts.some(a => a.user.toLowerCase() === u.toLowerCase())) throw new Error('帳號已存在');
        if (!b.pass) throw new Error('請輸入密碼');
        d.accounts.push({ user: u, pass: String(b.pass), active: u === ADMIN_USER });
        prof(d, u);
        return { user: u };
      }
      case 'login': { const a = auth(d, b); return { user: a.user, isAdmin: a.user === ADMIN_USER, profile: prof(d, a.user) }; }
      case 'getProfile': auth(d, b); return prof(d, b.user);
      case 'saveProfile': {
        auth(d, b);
        const cur = prof(d, b.user), p = b.profile;
        const respecs = Math.max(0, Math.min(cur.respecs, p.respecs));
        const cap = respecs < cur.respecs ? cur.earned : cur.points;
        Object.assign(cur, { stats: p.stats, look: p.look, respecs, points: Math.max(0, Math.min(cap, p.points)), spent: p.spent });
        return cur;
      }
      case 'saveRound': {
        auth(d, b);
        const r = b.round, cur = prof(d, b.user);
        (d.rounds[b.user] = d.rounds[b.user] || []).push({ ...r, date: new Date().toISOString() });
        const earned = Math.floor(r.holes / 9);
        cur.rounds++; cur.points += earned; cur.earned += earned;
        if (r.holes === 18 && (!cur.best || r.strokes < cur.best)) cur.best = r.strokes;
        return { earned, profile: cur };
      }
      case 'getRounds': auth(d, b); return (d.rounds[b.user] || []).slice(-40).reverse();
      case 'listAccounts': admin(d, b); return d.accounts.map(a => ({ ...a, ...pick(prof(d, a.user)) }));
      case 'setActive': {
        admin(d, b);
        if (b.target === ADMIN_USER) throw new Error('管理員帳號不能停用');
        d.accounts.find(a => a.user === b.target).active = !!b.value;
        return true;
      }
      case 'grantPoints': { admin(d, b); const p = prof(d, b.target); p.points = Math.max(0, p.points + b.amount); if (b.amount > 0) p.earned += b.amount; return p; }
      case 'grantRespecs': { admin(d, b); const p = prof(d, b.target); p.respecs = Math.max(0, p.respecs + b.amount); return p; }
      // 遊戲間：本機模式下只能在同一台電腦的兩個分頁之間測試
      case 'createRoom': {
        auth(d, b);
        const code = String(Math.floor(100000 + Math.random() * 900000));
        d.rooms[code] = { code, host: b.user, offer: b.offer || null, answer: null, guest: null, config: b.config || null };
        d.msgs[code] = [];
        return d.rooms[code];
      }
      case 'getRoom': { auth(d, b); const r = d.rooms[b.code]; if (!r) throw new Error('驗證碼錯誤或遊戲間已關閉'); return r; }
      case 'joinRoom': {
        auth(d, b);
        const r = d.rooms[b.code];
        if (!r) throw new Error('驗證碼錯誤或遊戲間已關閉');
        if (r.guest && r.guest !== b.user) throw new Error('遊戲間已滿');
        r.guest = b.user; if (b.answer) r.answer = b.answer;
        return r;
      }
      case 'updateRoom': { auth(d, b); const r = d.rooms[b.code]; if (!r) throw new Error('遊戲間已關閉'); ['offer', 'answer', 'config'].forEach(k => { if (b[k] !== undefined) r[k] = b[k]; }); return r; }
      case 'sendMsg': {
        auth(d, b);
        const l = d.msgs[b.code]; if (!l) throw new Error('遊戲間已關閉');
        const seq = l.length ? l[l.length - 1].seq + 1 : 1;
        l.push({ seq, from: b.user, msg: b.msg });
        while (l.length > 40) l.shift();
        return seq;
      }
      case 'getMsgs': { auth(d, b); const l = d.msgs[b.code]; if (!l) throw new Error('遊戲間已關閉'); return l.filter(m => m.seq > (b.since || 0) && m.from !== b.user); }
      case 'closeRoom': delete d.rooms[b.code]; delete d.msgs[b.code]; return true;
      default: throw new Error('未知動作');
    }
  })();
  save(d);
  return JSON.parse(JSON.stringify(out));
}
const pick = p => ({ points: p.points, respecs: p.respecs, rounds: p.rounds });
