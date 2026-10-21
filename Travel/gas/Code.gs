/**
 * 旅行誌 — Google Apps Script 後端
 * 功能：行程資料存在 Google 試算表、圖片存在 Google Drive、網站登入密碼驗證
 * 部署方式見 gas/README.md
 * ⚠ 這個檔案含有密碼，不要放進公開的網站資料夾或 GitHub
 */

// ★ 管理者密碼（可瀏覽與編輯）
const TOKEN = '1220';
// 訪客密碼改在網站「設定 → 訪客密碼」管理（存在這個專案的指令碼屬性 GUEST_TOKENS）
// 第一次使用時會預設建立一組 guest
const DEFAULT_GUESTS = [{ token: 'guest', label: '預設訪客' }];
// 訪客可以使用的動作（只有讀取）
const GUEST_ACTIONS = ['list', 'ping'];
// 被指定「可以新增願望」的訪客，另外可以用這些動作（只限指定的旅程，見 addWish）
const WISH_ACTIONS = ['addWish', 'meta'];

const SHEET_NAME = 'trips';
const FOLDER_NAME = 'TravelAtlas Images';
const IMAGE_SHEET = 'images'; // 外部圖片搬移紀錄（原網址 → Drive 網址）
const CHUNK = 45000; // 試算表單格上限 50,000 字元，大行程拆成多欄

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const guest = req.token === TOKEN ? null : findGuest(req.token);
    const role = req.token === TOKEN ? 'admin' : (guest ? 'guest' : '');
    if (!role) return out({ ok: false, error: '密碼錯誤' });
    const perms = guest ? { wishTrips: guest.wishTrips || [], guestId: guest.id } : null;
    const canWish = perms && perms.wishTrips.length > 0;
    if (role === 'admin' && req.action === 'guests') return out({ ok: true, guests: getGuests() });
    if (role === 'admin' && req.action === 'setGuests') return out({ ok: true, guests: setGuests(req.guests || []) });
    if (role === 'guest' && GUEST_ACTIONS.indexOf(req.action) < 0 && !(canWish && WISH_ACTIONS.indexOf(req.action) >= 0)) return out({ ok: false, error: '訪客模式只能瀏覽' });
    switch (req.action) {
      case 'list': return listResponse(role, perms, req.ver, guest);
      case 'save': return out(Object.assign({ ok: true }, saveTrips(req.trips || [])));
      case 'ping': return out({ ok: true, role: role, perms: perms });
      case 'addWish': return out(Object.assign({ ok: true }, addWish(guest, req.tripId, req.item || {})));
      case 'upload': return out({ ok: true, url: uploadImage(req.name, req.data) });
      case 'meta': return out(Object.assign({ ok: true }, linkMeta(req.url)));
      case 'checkLinks': return out({ ok: true, results: checkLinks(req.urls || []) });
      case 'importImages': return out(Object.assign({ ok: true }, importImages(req.urls || [])));
      default: return out({ ok: false, error: '未知動作 ' + req.action });
    }
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function doGet() {
  return out({ ok: true, app: 'travel-journal', hint: '請用 POST 呼叫' });
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['id', 'updatedAt', 'title', 'startDate', 'deleted', 'json…']);
    sh.setFrozenRows(1);
  }
  return sh;
}

// ---------- 加速：資料版本號 + 快取 ----------
// 每次寫入資料，版本號 +1。網站同步時帶上它知道的版本號，沒有變就只回一句「沒變」，不用整份下載。
// 整份清單另外放在 CacheService（6 小時），版本號沒變時不必重新讀試算表。
function dataVer() { return Number(PropertiesService.getScriptProperties().getProperty('DATA_VER') || 0); }
function bumpVer() {
  const v = dataVer() + 1;
  PropertiesService.getScriptProperties().setProperty('DATA_VER', String(v));
  try { CacheService.getScriptCache().remove('LIST_META'); } catch (e) { }
  return v;
}
function listJson(ver) {
  const c = CacheService.getScriptCache();
  try {
    const meta = JSON.parse(c.get('LIST_META') || 'null');
    if (meta && meta.ver === ver) {
      const keys = [];
      for (let i = 0; i < meta.n; i++) keys.push('LIST_' + i);
      const got = c.getAll(keys);
      if (keys.every(k => typeof got[k] === 'string')) return keys.map(k => got[k]).join('');
    }
  } catch (e) { }
  const json = JSON.stringify(listTrips());
  try {
    const parts = {}; let n = 0;
    for (let i = 0; i < json.length; i += 30000) parts['LIST_' + (n++)] = json.slice(i, i + 30000);   // 每格上限 100KB
    if (n <= 200) { c.putAll(parts, 21600); c.put('LIST_META', JSON.stringify({ ver: ver, n: n }), 21600); }
  } catch (e) { }
  return json;
}
function listResponse(role, perms, clientVer, guest) {
  const ver = dataVer();
  const head = { ok: true, role: role, perms: perms, ver: ver };
  if (clientVer !== undefined && clientVer !== null && Number(clientVer) === ver) { head.unchanged = true; return out(head); }
  const json = guest ? guestView(listJson(ver), guest) : listJson(ver);
  const text = JSON.stringify(head).slice(0, -1) + ',"trips":' + json + '}';
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

// ---------- 訪客看到的版本 ----------
// 訂位代號只留頭尾（例如 V****X）；設定成「只有我」或沒有指定這位訪客的分頁，整個不送出去
function maskCode(v) {
  const s = String(v || '');
  return s.length <= 2 ? s.replace(/./g, '*') : s[0] + s.slice(1, -1).replace(/./g, '*') + s.slice(-1);
}
function guestView(json, guest) {
  // 在回收桶的旅程：訪客只收到「已刪除」的標記（他手機裡的舊副本也會一起消失；救回後會再送完整的）
  const list = JSON.parse(json).map(t => t && !t.kind && t.trashedAt ? { id: t.id, deleted: true, updatedAt: t.updatedAt } : t);
  list.forEach(t => {
    if (!t || t.kind || t.deleted) return;
    if (Array.isArray(t.sections)) t.sections = t.sections.filter(sec => !Array.isArray(sec.visibleTo) || sec.visibleTo.indexOf(guest.id) >= 0).map(sec => { const c = Object.assign({}, sec); delete c.visibleTo; return c; });
    if (Array.isArray(t.bookings)) t.bookings.forEach(b => { if (b.code) b.code = maskCode(b.code); });
    if (Array.isArray(t.facts)) t.facts.forEach(f => { if (/代號|訂位|confirmation|booking/i.test(f.label || '')) f.value = maskCode(f.value); });
  });
  return JSON.stringify(list);
}

function listTrips() {
  const sh = sheet();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  // 某一列壞掉時跳過，不讓整份清單讀不到（網站下次同步會用本機那份補回去）
  const out = [];
  rows.forEach(r => { if (!r[0]) return; try { out.push(JSON.parse(r.slice(5).join(''))); } catch (e) { console.warn('第 ' + r[0] + ' 列資料無法讀取'); } });
  return out;
}

function saveTrips(trips) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const prev = dataVer();
    if (!trips.length) return { ver: prev, prev: prev };
    const sh = sheet();
    const last = sh.getLastRow();
    const ids = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => r[0]) : [];
    let width = sh.getLastColumn();
    trips.forEach(t => {
      const json = JSON.stringify(t);
      const chunks = [];
      for (let i = 0; i < json.length; i += CHUNK) chunks.push(json.slice(i, i + CHUNK));
      // 開頭是 = + - @ 的字串會被試算表當成公式，前面加 ' 強制存成文字（讀取時 ' 不會出現）
      const txt = v => /^[=+\-@']/.test(String(v)) ? "'" + v : v;
      const row = [t.id, t.updatedAt || '', txt(t.title || ''), t.startDate || '', t.deleted ? 'Y' : ''].concat(chunks.map(txt));
      const idx = ids.indexOf(t.id);
      const r = idx >= 0 ? idx + 2 : sh.getLastRow() + 1;
      if (idx >= 0) {
        // 只清掉這次寫不到的多餘欄位（舊資料比較長時）
        if (width > row.length) sh.getRange(r, row.length + 1, 1, width - row.length).clearContent();
      } else ids.push(t.id);
      sh.getRange(r, 1, 1, row.length).setValues([row]);
      width = Math.max(width, row.length);
    });
    return { ver: bumpVer(), prev: prev };
  } finally {
    lock.releaseLock();
  }
}

function folder() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function saveBlob(blob) {
  const file = folder().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://lh3.googleusercontent.com/d/' + file.getId();
}

function uploadImage(name, base64) {
  return saveBlob(Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', name || 'image.jpg'));
}

/** 把外部網址的圖片下載存到 Drive；已搬過的直接回傳紀錄 */
function importImages(urls) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(IMAGE_SHEET);
  if (!sh) { sh = ss.insertSheet(IMAGE_SHEET); sh.appendRow(['source', 'driveUrl', 'at']); sh.setFrozenRows(1); }
  const last = sh.getLastRow();
  const known = {};
  if (last >= 2) sh.getRange(2, 1, last - 1, 2).getValues().forEach(r => { known[r[0]] = r[1]; });

  const map = {}, failed = [], todo = [];
  urls.forEach(u => { if (known[u]) map[u] = known[u]; else todo.push(u); });
  if (todo.length) {
    const res = UrlFetchApp.fetchAll(todo.map(u => ({ url: u, muteHttpExceptions: true, followRedirects: true })));
    const rows = [];
    res.forEach((r, i) => {
      const u = todo[i];
      try {
        if (r.getResponseCode() !== 200) throw new Error('HTTP ' + r.getResponseCode());
        const blob = r.getBlob();
        const name = u.split('/').pop().split('?')[0] || 'image';
        blob.setName(name);
        const url = saveBlob(blob);
        map[u] = url;
        rows.push([u, url, new Date()]);
      } catch (err) { failed.push({ url: u, error: String(err) }); }
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  }
  return { map: map, failed: failed };
}

/** 讀取網址的標題（願望清單用），並展開短網址（例如 Google 地圖分享連結） */
function linkMeta(url) {
  let final = url, res = null;
  for (let i = 0; i < 6; i++) {
    res = UrlFetchApp.fetch(final, { followRedirects: false, muteHttpExceptions: true, headers: { 'Accept-Language': 'zh-TW,zh;q=0.9' } });
    const code = res.getResponseCode();
    const h = res.getHeaders();
    const loc = h.Location || h.location;
    if (code >= 300 && code < 400 && loc) { final = loc.startsWith('http') ? loc : final.replace(/^(https?:\/\/[^/]+).*/, '$1') + loc; continue; }
    break;
  }
  const html = String(res ? res.getContentText() : '').slice(0, 300000);
  const meta = p => {
    const a = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']og:' + p + '["\'][^>]*content=["\']([^"\']*)', 'i'))
      || html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']og:' + p, 'i'));
    return a ? a[1] : '';
  };
  const dec = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const title = meta('title') || ((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '');
  return { url: final, title: dec(title).trim(), image: meta('image'), description: dec(meta('description')) };
}

// ---------- 訪客密碼清單 ----------
function getGuests() {
  const p = PropertiesService.getScriptProperties();
  const raw = p.getProperty('GUEST_TOKENS');
  if (raw === null) { const d = DEFAULT_GUESTS.map(g => Object.assign({ id: newGuestId() }, g)); p.setProperty('GUEST_TOKENS', JSON.stringify(d)); return d; }
  let list = [];
  try { list = JSON.parse(raw) || []; } catch (e) { return []; }
  // 每組訪客密碼有一個不會變的編號（分頁權限用這個記，不會把密碼本身存進旅程資料）
  if (list.some(g => !g.id)) { list.forEach(g => { if (!g.id) g.id = newGuestId(); }); p.setProperty('GUEST_TOKENS', JSON.stringify(list)); }
  return list;
}
function newGuestId() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function setGuests(list) {
  const clean = list
    .filter(g => g && typeof g.token === 'string' && g.token.trim().length >= 4 && g.token !== TOKEN)
    .map(g => ({ id: typeof g.id === 'string' && g.id ? g.id.slice(0, 40) : newGuestId(), token: g.token.trim(), label: String(g.label || '').slice(0, 40), createdAt: g.createdAt || new Date().toISOString(), lastUsed: g.lastUsed || '',
      wishTrips: (Array.isArray(g.wishTrips) ? g.wishTrips : []).filter(id => typeof id === 'string' && id.length < 80).slice(0, 200) }));
  PropertiesService.getScriptProperties().setProperty('GUEST_TOKENS', JSON.stringify(clean));
  return clean;
}
/** 找出這組訪客密碼；找不到回傳 null */
function findGuest(token) {
  if (!token) return null;
  const list = getGuests();
  const g = list.find(x => x.token === token);
  if (!g) return null;
  // 記錄最後使用時間（每小時最多寫一次）
  const now = new Date();
  if (!g.lastUsed || now - new Date(g.lastUsed) > 3600000) {
    g.lastUsed = now.toISOString();
    PropertiesService.getScriptProperties().setProperty('GUEST_TOKENS', JSON.stringify(list));
  }
  return g;
}

/** 訪客新增一筆願望：只能加到管理者開放的旅程，存成獨立一列（不會和管理者的願望清單互相覆蓋） */
function addWish(g, tripId, x) {
  if (!g || (g.wishTrips || []).indexOf(tripId) < 0) throw new Error('這段旅程沒有開放你新增願望');
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const url = v => /^https?:\/\//i.test(String(v || '')) ? str(v, 2000) : '';
  const title = str(x.title, 200).trim();
  if (!title) throw new Error('請填寫名稱');
  const now = new Date().toISOString();
  const id = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const ll = Array.isArray(x.ll) && x.ll.length === 2 && x.ll.every(n => typeof n === 'number' && isFinite(n)) ? x.ll : null;
  const item = {
    id: id, title: title, type: ['sight', 'food', 'activity', 'shop', 'stay', 'other'].indexOf(x.type) >= 0 ? x.type : 'other',
    url: url(x.url), mapUrl: url(x.mapUrl), ll: ll, country: str(x.country, 60), city: str(x.city, 60), note: str(x.note, 3000),
    stars: [1, 2, 3].indexOf(x.stars) >= 0 ? x.stars : 2, tripId: tripId, dayId: null, done: false,
    addedBy: g.label || '訪客', createdAt: now, updatedAt: now,
  };
  saveTrips([{ id: '__wishg_' + id, kind: 'wishg', v: 2, title: '訪客新增的願望（非旅程）', item: item, updatedAt: now }]);
  return { item: item };
}

/** 資料健檢：檢查網址是否還能開（最多一次 30 個） */
function checkLinks(urls) {
  const list = urls.slice(0, 30);
  const reqs = list.map(u => ({ url: u, muteHttpExceptions: true, followRedirects: true, validateHttpsCertificates: false,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TravelJournalLinkCheck/1.0)' } }));
  let res = [];
  try { res = UrlFetchApp.fetchAll(reqs); }
  catch (e) {
    // 有一個網址連不上就整批失敗，改成一個一個檢查
    res = reqs.map(r => { try { return UrlFetchApp.fetch(r.url, r); } catch (err) { return { error: String(err) }; } });
  }
  return list.map((u, i) => {
    const r = res[i];
    if (!r || r.error) return { url: u, status: 0, error: r && r.error ? r.error.slice(0, 120) : '連不上' };
    return { url: u, status: r.getResponseCode() };
  });
}

/** 如果直接在試算表手動改了資料，執行一次這個函式，網站下次同步就會重新讀取 */
function refreshCache() { bumpVer(); }
