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

const SHEET_NAME = 'trips';
const FOLDER_NAME = 'TravelAtlas Images';
const IMAGE_SHEET = 'images'; // 外部圖片搬移紀錄（原網址 → Drive 網址）
const CHUNK = 45000; // 試算表單格上限 50,000 字元，大行程拆成多欄

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const role = req.token === TOKEN ? 'admin' : (isGuest(req.token) ? 'guest' : '');
    if (!role) return out({ ok: false, error: '密碼錯誤' });
    if (role === 'admin' && req.action === 'guests') return out({ ok: true, guests: getGuests() });
    if (role === 'admin' && req.action === 'setGuests') return out({ ok: true, guests: setGuests(req.guests || []) });
    if (role === 'guest' && GUEST_ACTIONS.indexOf(req.action) < 0) return out({ ok: false, error: '訪客模式只能瀏覽' });
    switch (req.action) {
      case 'list': return out({ ok: true, role: role, trips: listTrips() });
      case 'save': saveTrips(req.trips || []); return out({ ok: true });
      case 'ping': return out({ ok: true, role: role });
      case 'upload': return out({ ok: true, url: uploadImage(req.name, req.data) });
      case 'meta': return out(Object.assign({ ok: true }, linkMeta(req.url)));
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

function listTrips() {
  const sh = sheet();
  const last = sh.getLastRow();
  if (last < 2) return [];
  const rows = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  return rows.filter(r => r[0]).map(r => JSON.parse(r.slice(5).join('')));
}

function saveTrips(trips) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet();
    const last = sh.getLastRow();
    const ids = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => r[0]) : [];
    trips.forEach(t => {
      const json = JSON.stringify(t);
      const chunks = [];
      for (let i = 0; i < json.length; i += CHUNK) chunks.push(json.slice(i, i + CHUNK));
      const row = [t.id, t.updatedAt || '', t.title || '', t.startDate || '', t.deleted ? 'Y' : ''].concat(chunks);
      const idx = ids.indexOf(t.id);
      const r = idx >= 0 ? idx + 2 : sh.getLastRow() + 1;
      if (idx >= 0) {
        const width = sh.getLastColumn();
        if (width > 0) sh.getRange(r, 1, 1, width).clearContent();
      } else ids.push(t.id);
      sh.getRange(r, 1, 1, row.length).setValues([row]);
    });
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
  if (raw === null) { p.setProperty('GUEST_TOKENS', JSON.stringify(DEFAULT_GUESTS)); return DEFAULT_GUESTS; }
  try { return JSON.parse(raw) || []; } catch (e) { return []; }
}
function setGuests(list) {
  const clean = list
    .filter(g => g && typeof g.token === 'string' && g.token.trim().length >= 4 && g.token !== TOKEN)
    .map(g => ({ token: g.token.trim(), label: String(g.label || '').slice(0, 40), createdAt: g.createdAt || new Date().toISOString(), lastUsed: g.lastUsed || '' }));
  PropertiesService.getScriptProperties().setProperty('GUEST_TOKENS', JSON.stringify(clean));
  return clean;
}
function isGuest(token) {
  if (!token) return false;
  const list = getGuests();
  const g = list.find(x => x.token === token);
  if (!g) return false;
  // 記錄最後使用時間（每小時最多寫一次）
  const now = new Date();
  if (!g.lastUsed || now - new Date(g.lastUsed) > 3600000) {
    g.lastUsed = now.toISOString();
    PropertiesService.getScriptProperties().setProperty('GUEST_TOKENS', JSON.stringify(list));
  }
  return true;
}
