/**
 * Dixen Golf — Google Apps Script 後端
 *
 * 部署：擴充功能 → Apps Script → 貼上本檔 → 執行一次 setup() → 部署 → 新增部署作業
 *       類型「網頁應用程式」、執行身分「我」、存取權「所有人」→ 複製網址貼到 js/config.js
 *
 * 工作頁
 *   Account      A 帳號 / B 密碼 / C 啟用(Y/N)，第 1 列為標題
 *   <帳號名稱>    每位玩家一頁：上半部是個人資料（鍵/值），第 14 列起是回合紀錄
 * 遊戲間（驗證碼、連線資料、訊息）放在 CacheService，6 小時自動清除，不佔工作頁。
 */

const ADMIN = 'Michael';
const ADMIN_PASS = '1220';
const START_POINTS = 30;
const START_RESPECS = 10;
const RESERVED = ['Account'];

// 玩家頁上半部的欄位（第 1~11 列，A=名稱 B=值）
const PROFILE_KEYS = ['帳號', '能力點', '剩餘重新分配次數', '素質', '外觀', '總回合數', '最佳18洞', '建立時間', '最後登入', '已用能力點', '累計獲得點數'];
const ROUND_HEADER_ROW = 14;
const ROUND_HEADER = ['日期', '球場', '洞數', '梯台', '桿數', '對標準桿', '推桿數', '上球道', '標準桿上果嶺', '模式', '同組', '每洞桿數'];

function setup() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName('Account');
  if (!sh) sh = ss.insertSheet('Account', 0);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, 3).setValues([['帳號', '密碼', '啟用']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (!findAccountRow_(ADMIN)) sh.appendRow([ADMIN, ADMIN_PASS, 'Y']);
  sh.getRange('B:B').setNumberFormat('@');
  ensurePlayerSheet_(ADMIN);
}

function doGet() {
  return json_({ ok: true, data: 'Dixen Golf API' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: '格式錯誤' });
  }
  try {
    const fn = ACTIONS[req.action];
    if (!fn) return json_({ ok: false, error: '未知動作 ' + req.action });
    return json_({ ok: true, data: fn(req) });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

const ACTIONS = {
  ping: () => 'pong',

  register(req) {
    const user = String(req.user || '').trim();
    const pass = String(req.pass || '');
    if (!/^[A-Za-z0-9_\-一-鿿]{2,20}$/.test(user)) throw new Error('帳號限 2~20 字（中英數字、_ -）');
    if (RESERVED.indexOf(user) >= 0) throw new Error('這個名稱不能使用');
    if (pass.length < 1) throw new Error('請輸入密碼');
    return withLock_(() => {
      if (findAccountRow_(user, true)) throw new Error('帳號已存在');
      const sh = accountSheet_();
      sh.appendRow([user, pass, user === ADMIN ? 'Y' : 'N']);
      sh.getRange(sh.getLastRow(), 2).setNumberFormat('@').setValue(pass);
      ensurePlayerSheet_(user);
      return { user: user, active: user === ADMIN };
    });
  },

  login(req) {
    const acc = auth_(req);
    const p = readProfile_(acc.user);
    writeProfileField_(acc.user, '最後登入', new Date());
    return { user: acc.user, isAdmin: acc.user === ADMIN, profile: p };
  },

  getProfile(req) {
    const acc = auth_(req);
    return readProfile_(acc.user);
  },

  saveProfile(req) {
    const acc = auth_(req);
    const p = req.profile || {};
    const cur = readProfile_(acc.user);
    // 能力點與重新分配次數只能往下用；用掉一次重新分配時，點數最多退回到累計獲得的總數
    const respecs = Math.max(0, Math.min(cur.respecs, Number(p.respecs)));
    const cap = respecs < cur.respecs ? cur.earned : cur.points;
    const points = Math.max(0, Math.min(cap, Number(p.points)));
    writeProfile_(acc.user, {
      '能力點': points,
      '剩餘重新分配次數': respecs,
      '素質': JSON.stringify(p.stats || cur.stats),
      '外觀': JSON.stringify(p.look || cur.look),
      '已用能力點': Number(p.spent || 0),
    });
    return readProfile_(acc.user);
  },

  saveRound(req) {
    const acc = auth_(req);
    const r = req.round;
    return withLock_(() => {
      const sh = ensurePlayerSheet_(acc.user);
      sh.appendRow([new Date(), r.course, r.holes, r.tee, r.strokes, r.toPar, r.putts, r.fairways, r.gir, r.mode, r.partners || '', JSON.stringify(r.scores)]);
      const cur = readProfile_(acc.user);
      const earned = Math.floor(r.holes / 9);
      const upd = { '總回合數': cur.rounds + 1, '能力點': cur.points + earned, '累計獲得點數': cur.earned + earned };
      if (r.holes === 18 && (!cur.best || r.strokes < cur.best)) upd['最佳18洞'] = r.strokes;
      writeProfile_(acc.user, upd);
      return { earned: earned, profile: readProfile_(acc.user) };
    });
  },

  getRounds(req) {
    const acc = auth_(req);
    const sh = ensurePlayerSheet_(acc.user);
    const last = sh.getLastRow();
    if (last <= ROUND_HEADER_ROW) return [];
    const n = Math.min(40, last - ROUND_HEADER_ROW);
    const rows = sh.getRange(last - n + 1, 1, n, ROUND_HEADER.length).getValues();
    return rows.reverse().map(r => ({
      date: r[0] instanceof Date ? r[0].toISOString() : r[0], course: r[1], holes: r[2], tee: r[3], strokes: r[4],
      toPar: r[5], putts: r[6], fairways: r[7], gir: r[8], mode: r[9], partners: r[10], scores: safeParse_(r[11], []),
    }));
  },

  // ---------- 管理員 ----------
  listAccounts(req) {
    admin_(req);
    const sh = accountSheet_();
    const last = sh.getLastRow();
    if (last < 2) return [];
    return sh.getRange(2, 1, last - 1, 3).getValues().filter(r => r[0] !== '').map(r => {
      const prof = readProfile_(String(r[0]));
      return { user: String(r[0]), pass: String(r[1]), active: String(r[2]).toUpperCase() === 'Y', points: prof.points, respecs: prof.respecs, rounds: prof.rounds };
    });
  },

  setActive(req) {
    admin_(req);
    if (req.target === ADMIN) throw new Error('管理員帳號不能停用');
    const row = findAccountRow_(req.target);
    if (!row) throw new Error('找不到帳號');
    accountSheet_().getRange(row, 3).setValue(req.value ? 'Y' : 'N');
    return true;
  },

  grantPoints(req) {
    admin_(req);
    const amt = Math.round(Number(req.amount) || 0);
    const cur = readProfile_(req.target);
    writeProfile_(req.target, { '能力點': Math.max(0, cur.points + amt), '累計獲得點數': cur.earned + Math.max(0, amt) });
    return readProfile_(req.target);
  },

  grantRespecs(req) {
    admin_(req);
    const cur = readProfile_(req.target);
    writeProfile_(req.target, { '剩餘重新分配次數': Math.max(0, cur.respecs + Math.round(Number(req.amount) || 0)) });
    return readProfile_(req.target);
  },

  // ---------- 遊戲間（CacheService） ----------
  createRoom(req) {
    const acc = auth_(req);
    const cache = CacheService.getScriptCache();
    return withLock_(() => {
      let code;
      for (let i = 0; i < 30; i++) {
        code = String(Math.floor(100000 + Math.random() * 900000));
        if (!cache.get('room_' + code)) break;
      }
      const room = { code: code, host: acc.user, offer: req.offer || null, answer: null, guest: null, created: Date.now(), config: req.config || null };
      cache.put('room_' + code, JSON.stringify(room), 21600);
      cache.put('msgs_' + code, '[]', 21600);
      return room;
    });
  },

  getRoom(req) {
    auth_(req);
    const room = getRoom_(req.code);
    if (!room) throw new Error('驗證碼錯誤或遊戲間已關閉');
    return room;
  },

  joinRoom(req) {
    const acc = auth_(req);
    return withLock_(() => {
      const room = getRoom_(req.code);
      if (!room) throw new Error('驗證碼錯誤或遊戲間已關閉');
      if (room.guest && room.guest !== acc.user) throw new Error('遊戲間已滿');
      room.guest = acc.user;
      if (req.answer) room.answer = req.answer;
      putRoom_(room);
      return room;
    });
  },

  updateRoom(req) {
    const acc = auth_(req);
    return withLock_(() => {
      const room = getRoom_(req.code);
      if (!room) throw new Error('遊戲間已關閉');
      if (room.host !== acc.user && room.guest !== acc.user) throw new Error('不在此遊戲間');
      ['offer', 'answer', 'config'].forEach(k => { if (req[k] !== undefined) room[k] = req[k]; });
      putRoom_(room);
      return room;
    });
  },

  sendMsg(req) {
    const acc = auth_(req);
    return withLock_(() => {
      const cache = CacheService.getScriptCache();
      const key = 'msgs_' + req.code;
      const list = safeParse_(cache.get(key), null);
      if (!list) throw new Error('遊戲間已關閉');
      const seq = list.length ? list[list.length - 1].seq + 1 : 1;
      list.push({ seq: seq, from: acc.user, msg: req.msg });
      while (list.length > 40 || JSON.stringify(list).length > 90000) list.shift();
      cache.put(key, JSON.stringify(list), 21600);
      return seq;
    });
  },

  getMsgs(req) {
    const acc = auth_(req);
    const list = safeParse_(CacheService.getScriptCache().get('msgs_' + req.code), null);
    if (!list) throw new Error('遊戲間已關閉');
    const since = Number(req.since || 0);
    return list.filter(m => m.seq > since && m.from !== acc.user);
  },

  closeRoom(req) {
    auth_(req);
    const cache = CacheService.getScriptCache();
    cache.remove('room_' + req.code);
    cache.remove('msgs_' + req.code);
    return true;
  },
};

// ---------- helpers ----------
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function safeParse_(s, dflt) {
  try { return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; }
}

function accountSheet_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Account');
  if (!sh) throw new Error('請先在 Apps Script 執行 setup()');
  return sh;
}

// 帳號比對分大小寫；caseInsensitive 只用在註冊時防止 michael / Michael 重複
function findAccountRow_(user, caseInsensitive) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Account');
  if (!sh || sh.getLastRow() < 2) return 0;
  const names = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < names.length; i++) {
    const n = String(names[i][0]);
    if (n === user || (caseInsensitive && n.toLowerCase() === String(user).toLowerCase())) return i + 2;
  }
  return 0;
}

function auth_(req) {
  const row = findAccountRow_(String(req.user || ''));
  if (!row) throw new Error('帳號或密碼錯誤');
  const r = accountSheet_().getRange(row, 1, 1, 3).getValues()[0];
  if (String(r[1]) !== String(req.pass)) throw new Error('帳號或密碼錯誤');
  if (String(r[2]).toUpperCase() !== 'Y') throw new Error('帳號尚未啟用，請等待管理員核准');
  return { user: String(r[0]) };
}

function admin_(req) {
  const acc = auth_(req);
  if (acc.user !== ADMIN) throw new Error('需要管理員權限');
  return acc;
}

function ensurePlayerSheet_(user) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(user);
  if (sh) return sh;
  sh = ss.insertSheet(user);
  const init = {
    '帳號': user, '能力點': START_POINTS, '剩餘重新分配次數': START_RESPECS, '素質': '{}', '外觀': '{}',
    '總回合數': 0, '最佳18洞': '', '建立時間': new Date(), '最後登入': '', '已用能力點': 0, '累計獲得點數': START_POINTS,
  };
  sh.getRange(1, 1, PROFILE_KEYS.length, 2).setValues(PROFILE_KEYS.map(k => [k, init[k]]));
  sh.getRange(1, 1, PROFILE_KEYS.length, 1).setFontWeight('bold').setBackground('#f1ebdc');
  sh.getRange(ROUND_HEADER_ROW, 1, 1, ROUND_HEADER.length).setValues([ROUND_HEADER]).setFontWeight('bold').setBackground('#1d3a2a').setFontColor('#f2ead8');
  sh.setColumnWidth(1, 130);
  sh.setColumnWidth(2, 220);
  return sh;
}

function readProfile_(user) {
  const sh = ensurePlayerSheet_(user);
  const vals = sh.getRange(1, 1, PROFILE_KEYS.length, 2).getValues();
  const m = {};
  vals.forEach(r => { m[String(r[0])] = r[1]; });
  return {
    user: user,
    points: Number(m['能力點']) || 0,
    respecs: m['剩餘重新分配次數'] === '' ? START_RESPECS : Number(m['剩餘重新分配次數']) || 0,
    stats: safeParse_(m['素質'], {}),
    look: safeParse_(m['外觀'], {}),
    rounds: Number(m['總回合數']) || 0,
    best: m['最佳18洞'] === '' ? null : Number(m['最佳18洞']),
    spent: Number(m['已用能力點']) || 0,
    earned: Number(m['累計獲得點數']) || 0,
  };
}

function writeProfileField_(user, key, value) {
  const o = {};
  o[key] = value;
  writeProfile_(user, o);
}

function writeProfile_(user, obj) {
  const sh = ensurePlayerSheet_(user);
  Object.keys(obj).forEach(k => {
    const idx = PROFILE_KEYS.indexOf(k);
    if (idx >= 0) sh.getRange(idx + 1, 2).setValue(obj[k]);
  });
}

function getRoom_(code) {
  return safeParse_(CacheService.getScriptCache().get('room_' + code), null);
}

function putRoom_(room) {
  CacheService.getScriptCache().put('room_' + room.code, JSON.stringify(room), 21600);
}
