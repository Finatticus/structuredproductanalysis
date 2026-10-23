// 介面流程：登入/註冊 → 大廳 → 單人 / 建立遊戲間 / 加入遊戲間 / 練習場；角色素質、紀錄、管理員
import * as THREE from 'three';
import { session, call, isLocalMode } from './api.js';
import { gasUrl, getSetting, setSetting, ADMIN_USER } from './config.js';
import { STATS, BASE, MAX, costFor, spentFor, normalizeStats, DEFAULT_LOOK, LOOK_OPTIONS, START_RESPECS } from './stats.js';
import { COURSES, TEE_SETS, courseYards, teeYards, courseById } from './courses.js';
import { World } from './render.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { Net } from './net.js';
import { ProceduralGolfer } from './character.js';
import { escapeHtml, fmtToPar } from './util.js';
import { setSound, unlockAudio } from './audio.js';

const $ = id => document.getElementById(id);
const screens = ['scr-login', 'scr-register', 'scr-lobby', 'scr-setup', 'scr-room', 'scr-join', 'scr-char', 'scr-records', 'scr-admin', 'scr-game'];
function show(id) {
  screens.forEach(s => $(s).classList.toggle('active', s === id));
  document.body.dataset.screen = id;
  if (id !== 'scr-char') stopPreview();
}

function msg(el, text, ok) { const e = $(el); e.textContent = text || ''; e.classList.toggle('ok', !!ok); }
async function busy(btn, fn) {
  const b = typeof btn === 'string' ? $(btn) : btn;
  if (b) { b.disabled = true; b.dataset.label = b.dataset.label || b.textContent; b.textContent = '處理中…'; }
  try { return await fn(); } finally { if (b) { b.disabled = false; b.textContent = b.dataset.label; } }
}

// ---------------- 登入 / 註冊 ----------------
function initAuth() {
  const saved = getSetting('login', null);
  if (saved) { $('li-user').value = saved.user; $('li-pass').value = saved.pass; }
  $('btn-login').onclick = () => busy('btn-login', async () => {
    msg('li-msg', '');
    const user = $('li-user').value.trim(), pass = $('li-pass').value;
    if (!user || !pass) return msg('li-msg', '請輸入帳號與密碼');
    session.user = user; session.pass = pass;
    try {
      const r = await call('login');
      session.isAdmin = r.isAdmin;
      session.profile = r.profile;
      setSetting('login', { user, pass });
      unlockAudio();
      enterLobby();
    } catch (e) { session.user = null; msg('li-msg', e.message); }
  });
  $('li-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-login').click(); });
  $('btn-to-register').onclick = () => { msg('rg-msg', ''); show('scr-register'); };
  $('btn-back-login').onclick = () => show('scr-login');
  $('btn-register').onclick = () => busy('btn-register', async () => {
    const user = $('rg-user').value.trim(), pass = $('rg-pass').value, pass2 = $('rg-pass2').value;
    if (pass !== pass2) return msg('rg-msg', '兩次密碼不一樣');
    try {
      await call('register', { user, pass });
      msg('rg-msg', user === ADMIN_USER ? '註冊完成，可以登入了' : '註冊完成！等管理員核准後就能登入', true);
      $('li-user').value = user; $('li-pass').value = '';
    } catch (e) { msg('rg-msg', e.message); }
  });
  $('btn-settings').onclick = openSettings;
  updateModeBadge();
}

function updateModeBadge() {
  $('mode-badge').textContent = isLocalMode() ? '本機模式（尚未設定 GAS）' : '';
}

// ---------------- 設定 ----------------
function openSettings() {
  $('set-gas').value = gasUrl();
  $('set-quality').value = getSetting('quality', 'high');
  $('set-sound').checked = getSetting('sound', true);
  $('dlg-settings').classList.add('open');
}
function initSettings() {
  $('set-save').onclick = () => {
    const url = $('set-gas').value.trim();
    try { if (url) localStorage.setItem('dixen.gas', url); else localStorage.removeItem('dixen.gas'); } catch (e) { /* 忽略 */ }
    const q = $('set-quality').value;
    const needReload = world && q !== getSetting('quality', 'high');
    setSetting('quality', q);
    setSetting('sound', $('set-sound').checked);
    setSound($('set-sound').checked);
    $('dlg-settings').classList.remove('open');
    updateModeBadge();
    if (needReload) alert('畫質會在重新開啟遊戲後套用');
  };
  $('set-cancel').onclick = () => $('dlg-settings').classList.remove('open');
  setSound(getSetting('sound', true));
}

// ---------------- 大廳 ----------------
function enterLobby() {
  const h = new Date().getHours();
  $('lb-greet').textContent = h < 11 ? 'GOOD MORNING' : h < 18 ? 'GOOD AFTERNOON' : 'GOOD EVENING';
  $('lb-name').innerHTML = escapeHtml(session.user) + (session.isAdmin ? '<span class="badge">管理員</span>' : '');
  document.querySelectorAll('.admin-only').forEach(e => e.classList.toggle('hidden', !session.isAdmin));
  const p = session.profile;
  $('lb-stats').innerHTML = `能力點 <b>${p.points}</b>　回合數 <b>${p.rounds}</b>　最佳 18 洞 <b>${p.best ?? '—'}</b>`;
  show('scr-lobby');
}

function initLobby() {
  $('mode-single').onclick = () => openSetup('single');
  $('mode-host').onclick = () => openSetup('host');
  $('mode-join').onclick = () => { $('jn-code').value = ''; msg('jn-msg', ''); $('jn-wait').classList.add('hidden'); $('jn-form').classList.remove('hidden'); show('scr-join'); };
  $('mode-practice').onclick = () => openSetup('practice');
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    const t = b.dataset.tab;
    if (t === 'lobby') enterLobby();
    if (t === 'char') openChar();
    if (t === 'records') openRecords();
    if (t === 'admin') openAdmin();
  });
  $('btn-logout').onclick = () => { session.user = null; setSetting('login', null); $('li-pass').value = ''; show('scr-login'); };
}

// ---------------- 回合設定 ----------------
const setup = { kind: 'single', courseId: 'maple', holes: 'all', tee: 'blue', mode: 'stroke', wind: 'course', stimp: null, gimme: 1, mulligans: 2, startHole: 0 };
function openSetup(kind) {
  setup.kind = kind;
  $('st-title').textContent = { single: '單人回合', host: '建立遊戲間', practice: '練習場' }[kind];
  $('st-go').textContent = kind === 'host' ? '建立遊戲間' : kind === 'practice' ? '開始練習' : '開始回合';
  document.querySelectorAll('.only-host').forEach(e => e.classList.toggle('hidden', kind !== 'host'));
  document.querySelectorAll('.only-round').forEach(e => e.classList.toggle('hidden', kind === 'practice'));
  document.querySelectorAll('.only-practice').forEach(e => e.classList.toggle('hidden', kind !== 'practice'));
  renderSetup();
  show('scr-setup');
}

function renderSetup() {
  $('st-courses').innerHTML = COURSES.map(c => `
    <button class="course-card ${c.id === setup.courseId ? 'on' : ''}" data-course="${c.id}">
      <canvas class="cthumb" data-thumb="${c.id}"></canvas>
      <div class="txt"><b>${c.name}</b><em>${c.en}</em><span>${courseYards(c, 'black').toLocaleString()} Y · Par 72 · Stimp ${c.stimp}</span></div>
    </button>`).join('');
  document.querySelectorAll('.course-card').forEach(b => b.onclick = () => { setup.courseId = b.dataset.course; setup.stimp = null; renderSetup(); });
  drawThumbs();
  const seg = (id, key, opts) => {
    $(id).innerHTML = opts.map(([v, l]) => `<button class="${setup[key] === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('');
    $(id).querySelectorAll('button').forEach(b => b.onclick = () => { setup[key] = isNaN(b.dataset.v) ? b.dataset.v : Number(b.dataset.v); renderSetup(); });
  };
  const c = courseById(setup.courseId);
  seg('st-holes', 'holes', [['all', '18 洞'], ['front', '前 9'], ['back', '後 9']]);
  seg('st-tee', 'tee', TEE_SETS.map(t => [t.id, `${t.name} ${courseYards(c, t.id).toLocaleString()}`]));
  seg('st-mode', 'mode', [['stroke', '比桿賽'], ['match', '比洞賽']]);
  seg('st-wind', 'wind', [['course', '球場預設'], ['calm', '無風'], ['light', '微風'], ['normal', '一般'], ['strong', '強風']]);
  // 果嶺速度：數字可調（Stimp 6.0~13.0，每次 0.5），預設為球場標準
  const stimp = setup.stimp ?? c.stimp;
  $('st-greens').innerHTML = `<button data-d="-0.5">−</button><b class="stimp num">${stimp.toFixed(1)}</b><button data-d="0.5">＋</button>` +
    `<button class="${setup.stimp === null ? 'on' : ''}" data-std="1">標準 ${c.stimp.toFixed(1)}</button>` +
    `<span class="small">台灣一般球場約 8，數字越大越快</span>`;
  $('st-greens').querySelectorAll('button').forEach(b => b.onclick = () => {
    if (b.dataset.std) setup.stimp = null;
    else setup.stimp = Math.min(13, Math.max(6, Math.round((stimp + Number(b.dataset.d)) * 2) / 2));
    if (setup.stimp === c.stimp) setup.stimp = null;
    renderSetup();
  });
  seg('st-gimme', 'gimme', [[0, '無'], [1, '1 碼'], [2, '2 碼'], [3, '3 碼']]);
  seg('st-mull', 'mulligans', [[0, '0'], [1, '1'], [2, '2'], [4, '4']]);
  $('st-hole').innerHTML = c.holes.map((h, i) => `<option value="${i}" ${setup.startHole === i ? 'selected' : ''}>第 ${i + 1} 洞 · Par ${h[0]} · ${teeYards(c, i, setup.tee)} Y</option>`).join('');
  $('st-hole').onchange = e => { setup.startHole = Number(e.target.value); };
}

function drawThumbs() {
  // 球場縮圖：用第一洞的顏色圖
  import('./terrain.js').then(({ buildHole, paintMaps }) => {
    document.querySelectorAll('canvas[data-thumb]').forEach(cv => {
      const id = cv.dataset.thumb;
      if (thumbCache[id]) { draw(cv, thumbCache[id]); return; }
      setTimeout(() => {
        const course = courseById(id);
        const h = buildHole(course, { maple: 6, heron: 15, canyon: 11 }[id] || 0, { pinSeed: 1 });
        const m = paintMaps(h);
        thumbCache[id] = m.color;
        document.querySelectorAll(`canvas[data-thumb="${id}"]`).forEach(c2 => draw(c2, m.color));
      }, 20);
    });
  });
  function draw(cv, src) {
    cv.width = 320; cv.height = 180;
    const x = cv.getContext('2d');
    x.save();
    x.translate(160, 90);
    x.rotate(-Math.PI / 2);
    const s = Math.max(180 / src.width, 320 / src.height) * 1.05;
    x.drawImage(src, -src.width * s / 2, -src.height * s / 2, src.width * s, src.height * s);
    x.restore();
  }
}
const thumbCache = {};

function roundCfg() {
  return {
    courseId: setup.courseId, holes: setup.holes, tee: setup.tee, mode: setup.kind === 'host' ? setup.mode : 'stroke',
    wind: setup.wind, stimp: setup.stimp ?? courseById(setup.courseId).stimp, gimme: setup.gimme, mulligans: setup.kind === 'single' ? setup.mulligans : 0,
    practice: setup.kind === 'practice', startHole: setup.startHole, seed: Math.floor(Math.random() * 2 ** 31),
  };
}

const me = () => ({ user: session.user, stats: normalizeStats(session.profile.stats), look: { ...DEFAULT_LOOK, ...session.profile.look } });

function initSetup() {
  $('st-back').onclick = enterLobby;
  $('st-go').onclick = () => {
    if (setup.kind === 'host') return hostRoom();
    startGame(roundCfg(), [{ ...me(), local: true }]);
  };
}

// ---------------- 遊戲間 ----------------
let net = null, guestInfo = null;
async function hostRoom() {
  const cfg = roundCfg();
  show('scr-room');
  $('rm-code').innerHTML = '<span class="small">建立中…</span>';
  $('rm-guest').innerHTML = '<div class="avatar wait">?</div><div><b class="small">等待玩家加入…</b></div><span class="st wt">等待中</span>';
  $('rm-host').innerHTML = `<div class="avatar">${escapeHtml(session.user[0])}</div><div><b>${escapeHtml(session.user)}</b><div class="small">主機</div></div><span class="st ok">已就緒</span>`;
  const c = courseById(cfg.courseId);
  $('rm-set').innerHTML = `<dt>球場</dt><dd>${c.name}</dd><dt>洞數</dt><dd>${{ all: '18 洞', front: '前 9', back: '後 9' }[cfg.holes]}</dd><dt>梯台</dt><dd>${TEE_SETS.find(t => t.id === cfg.tee).name}</dd><dt>賽制</dt><dd>${cfg.mode === 'match' ? '比洞賽' : '比桿賽'}</dd><dt>OK 推</dt><dd>${cfg.gimme ? cfg.gimme + ' 碼內' : '無'}</dd>`;
  $('rm-start').disabled = true;
  guestInfo = null;
  if (net) net.close();
  net = new Net();
  net.on(m => {
    if (m.t === '_guest') $('rm-guest').querySelector('.st').textContent = '連線中';
    if (m.t === 'hello' && !m.host) {
      guestInfo = m.player;
      $('rm-guest').innerHTML = `<div class="avatar">${escapeHtml(m.player.user[0])}</div><div><b>${escapeHtml(m.player.user)}</b><div class="small">已加入</div></div><span class="st ok">已就緒</span>`;
      $('rm-start').disabled = false;
      net.send({ t: 'hello', host: true, player: me(), cfg });
    }
    if (m.t === '_status') $('rm-link').textContent = m.mode === 'p2p' ? '直連（WebRTC）' : 'GAS 轉送';
    if (m.t === '_error') $('rm-link').textContent = m.error;
  });
  try {
    const code = await net.host(cfg);
    $('rm-code').innerHTML = code.split('').map((d, i) => (i === 3 ? '<span class="gap"></span>' : '') + `<span>${d}</span>`).join('');
  } catch (e) {
    $('rm-code').innerHTML = `<span class="small err">${escapeHtml(e.message)}</span>`;
  }
  $('rm-start').onclick = () => {
    const players = [{ ...me(), local: true }, { ...guestInfo, local: false }];
    net.send({ t: 'start', cfg, players: players.map(p => ({ user: p.user, stats: p.stats, look: p.look })) });
    startGame(cfg, players, net, true);
  };
}

function initRooms() {
  $('rm-back').onclick = () => { if (net) { net.close(); net = null; } enterLobby(); };
  $('jn-back').onclick = () => { if (net) { net.close(); net = null; } enterLobby(); };
  $('jn-go').onclick = () => busy('jn-go', async () => {
    const code = $('jn-code').value.replace(/\D/g, '');
    if (code.length !== 6) return msg('jn-msg', '請輸入 6 位數驗證碼');
    if (net) net.close();
    net = new Net();
    try {
      const room = await net.join(code);
      $('jn-form').classList.add('hidden');
      $('jn-wait').classList.remove('hidden');
      $('jn-host').textContent = room.host;
      net.send({ t: 'hello', player: me() });
      const resend = setInterval(() => { if (!net || net.closed || started) return clearInterval(resend); net.send({ t: 'hello', player: me() }); }, 8000);
      let started = false;
      net.on(m => {
        if (m.t === '_status') $('jn-link').textContent = m.mode === 'p2p' ? '直連（WebRTC）' : 'GAS 轉送';
        if (m.t === 'hello' && m.host) $('jn-info').textContent = `${courseById(m.cfg.courseId).name} · ${m.cfg.mode === 'match' ? '比洞賽' : '比桿賽'}`;
        if (m.t === 'start' && !started) {
          started = true;
          clearInterval(resend);
          const players = m.players.map(p => ({ ...p, local: p.user === session.user }));
          startGame(m.cfg, players, net, false);
        }
        if (m.t === '_closed' && !started) { msg('jn-msg', '遊戲間已關閉'); $('jn-form').classList.remove('hidden'); $('jn-wait').classList.add('hidden'); }
      });
    } catch (e) { msg('jn-msg', e.message); }
  });
}

// ---------------- 開始遊戲 ----------------
let world = null, hud = null, game = null;
const ui = {
  loading(on, text, progress) {
    $('loading').classList.toggle('show', on);
    if (text) $('ld-text').textContent = text;
    if (progress !== undefined) $('ld-bar').style.width = Math.round(progress * 100) + '%';
  },
  showHoleResult(g, last) {
    return new Promise(res => {
      const box = $('dlg-hole');
      const k = g.k;
      $('hr-title').textContent = `第 ${g.holeNo} 洞 · PAR ${g.hole.par}`;
      $('hr-body').innerHTML = g.players.map(p => {
        const s = p.scores[k], d = s - g.hole.par;
        const tot = p.scores.reduce((a, v, i) => a + (v ? v - p.pars[i] : 0), 0);
        const name = p.picked ? '撿球' : s === 1 ? '一桿進洞' : ({ '-3': '信天翁', '-2': '老鷹', '-1': '小鳥', 0: '平標準桿', 1: '柏忌', 2: '雙柏忌' }[d] ?? `+${d}`);
        return `<div class="hr-row"><b>${escapeHtml(p.user)}</b><span class="hr-score ${d < 0 ? 'under' : d > 0 ? 'over' : ''}">${s}</span><span>${name}</span><span class="num">總計 ${fmtToPar(tot)}</span></div>`;
      }).join('') + (g.cfg.mode === 'match' && g.players.length === 2 ? `<div class="hr-match">${g.matchStatus === 0 ? 'ALL SQUARE' : escapeHtml(g.players[g.matchStatus > 0 ? 0 : 1].user) + ' ' + Math.abs(g.matchStatus) + ' UP'}</div>` : '');
      $('hr-card').innerHTML = scorecardHtml(g);
      const btn = $('hr-next');
      const canGo = last || g.authority;
      btn.disabled = !canGo;
      btn.textContent = last ? '查看成績' : canGo ? '下一洞' : '等待主機…';
      btn.onclick = () => { box.classList.remove('open'); res(); };
      box.classList.add('open');
    });
  },
  closeHoleResult() { $('dlg-hole').classList.remove('open'); },
  async showRoundResult(g) {
    show('scr-game');
    const box = $('dlg-round');
    $('rr-card').innerHTML = scorecardHtml(g);
    const mine = g.players.find(p => p.local);
    const sum = g.roundSummary(mine);
    $('rr-sum').innerHTML = `<div><span>總桿數</span><b class="num">${sum.strokes}</b></div><div><span>對標準桿</span><b class="num">${fmtToPar(sum.toPar)}</b></div><div><span>推桿</span><b class="num">${sum.putts}</b></div><div><span>上球道</span><b class="num">${sum.fairways}</b></div><div><span>標準桿上果嶺</span><b class="num">${sum.gir}</b></div>`;
    $('rr-save').textContent = '儲存成績中…';
    box.classList.add('open');
    try {
      const r = await call('saveRound', { round: sum });
      session.profile = r.profile;
      $('rr-save').textContent = r.earned ? `成績已儲存，獲得 ${r.earned} 能力點！` : '成績已儲存';
    } catch (e) { $('rr-save').textContent = '儲存失敗：' + e.message; }
  },
};

async function ensureWorld() {
  if (world) return;
  ui.loading(true, '載入球場材質…', 0);
  let n = 0;
  world = new World($('gl'), getSetting('quality', 'high'));
  await world.init(() => ui.loading(true, '載入球場材質…', ++n / 7));
  hud = new Hud();
  game = new Game(world, hud, ui);
}

async function startGame(cfg, players, netObj = null, isHost = true) {
  show('scr-game');
  document.body.toggleAttribute('data-practice', !!cfg.practice);
  await ensureWorld();
  await game.start(cfg, players, netObj, isHost);
}

function initGameMenu() {
  $('btn-menu').onclick = () => { $('gm-card').innerHTML = game ? scorecardHtml(game) : ''; $('dlg-menu').classList.add('open'); };
  $('gm-close').onclick = () => $('dlg-menu').classList.remove('open');
  $('gm-quit').onclick = () => {
    if (!confirm('確定離開這一回合？目前成績不會儲存。')) return;
    $('dlg-menu').classList.remove('open');
    if (game.net) game.net.send({ t: 'leave' });
    game.quit();
    net = null;
    enterLobby();
  };
  $('gm-tee').onclick = () => {
    if (!game.cfg.practice) return;
    const p = game.players[0];
    Object.assign(p, { ball: game.hole.teePos(game.cfg.tee), strokes: 0, holed: false });
    $('dlg-menu').classList.remove('open');
    game.beginTurn(0);
  };
  $('gm-nexthole').onclick = () => {
    if (!game.cfg.practice) return;
    $('dlg-menu').classList.remove('open');
    game.holeList = [(game.holeList[0] + 1) % 18];
    game.loadHole(0);
  };
  $('rr-done').onclick = () => { $('dlg-round').classList.remove('open'); game.quit(); net = null; enterLobby(); };
}

function scorecardHtml(g) {
  const idx = g.holeList;
  const c = g.course;
  const nines = [];
  for (let i = 0; i < idx.length; i += 9) nines.push(idx.slice(i, i + 9).map((h, j) => ({ h, k: i + j })));
  const mark = (s, par) => {
    if (!s) return '';
    const d = s - par;
    return `<span class="s ${d <= -2 ? 'ea' : d === -1 ? 'bi' : d === 1 ? 'bo' : d >= 2 ? 'db' : ''}">${s}</span>`;
  };
  let html = '';
  for (const nine of nines) {
    const label = nine[0].h < 9 ? 'OUT' : 'IN';
    html += '<table class="sc"><thead><tr><th class="l">HOLE</th>' + nine.map(x => `<th>${x.h + 1}</th>`).join('') + `<th>${label}</th></tr></thead><tbody>`;
    html += '<tr class="yd"><td class="l">碼數</td>' + nine.map(x => `<td>${teeYards(c, x.h, g.cfg.tee)}</td>`).join('') + `<td class="tot">${nine.reduce((s, x) => s + teeYards(c, x.h, g.cfg.tee), 0)}</td></tr>`;
    html += '<tr class="par"><td class="l">PAR</td>' + nine.map(x => `<td>${c.holes[x.h][0]}</td>`).join('') + `<td class="tot">${nine.reduce((s, x) => s + c.holes[x.h][0], 0)}</td></tr>`;
    html += '<tr class="hcp"><td class="l">HCP</td>' + nine.map(x => `<td>${c.holes[x.h][4]}</td>`).join('') + '<td class="tot"></td></tr>';
    for (const p of g.players) {
      const tot = nine.reduce((s, x) => s + (p.scores[x.k] || 0), 0);
      html += `<tr><td class="l"><b>${escapeHtml(p.user)}</b></td>` + nine.map(x => `<td>${mark(p.scores[x.k], c.holes[x.h][0])}</td>`).join('') + `<td class="tot num">${tot || ''}</td></tr>`;
    }
    html += '</tbody></table>';
  }
  return html;
}

// ---------------- 角色與素質 ----------------
let draft = null, preview = null;
function openChar() {
  const p = session.profile;
  draft = { stats: normalizeStats(p.stats), base: normalizeStats(p.stats), look: { ...DEFAULT_LOOK, ...p.look }, points: p.points, respecs: p.respecs ?? START_RESPECS, respecUsed: false };
  renderChar();
  show('scr-char');
  startPreview();
}

function renderChar() {
  $('ch-points').textContent = draft.points;
  $('ch-respecs').textContent = draft.respecs;
  let html = '', group = '';
  for (const s of STATS) {
    if (s.group !== group) { group = s.group; html += `<h4>${group}</h4>`; }
    const v = draft.stats[s.key];
    const cost = v < MAX ? costFor(v) : 0;
    html += `<div class="stat">
      <div class="sn"><b>${s.name}</b><span>${s.en}</span></div>
      <div class="sbar"><i style="width:${(v - 0) / MAX * 100}%"></i><em style="left:${BASE / MAX * 100}%"></em></div>
      <b class="sv num">${v}</b>
      <button class="sb" data-k="${s.key}" data-d="-1" ${v <= draft.base[s.key] ? 'disabled' : ''}>−</button>
      <button class="sb" data-k="${s.key}" data-d="1" ${v >= MAX || cost > draft.points ? 'disabled' : ''}>＋<small>${cost || ''}</small></button>
      <p>${s.desc}</p></div>`;
  }
  $('ch-stats').innerHTML = html;
  $('ch-stats').querySelectorAll('.sb').forEach(b => b.onclick = () => {
    const k = b.dataset.k, d = Number(b.dataset.d);
    const v = draft.stats[k];
    if (d > 0) { const c = costFor(v); if (c <= draft.points && v < MAX) { draft.stats[k]++; draft.points -= c; } }
    else if (v > draft.base[k]) { draft.stats[k]--; draft.points += costFor(v - 1); }
    renderChar();
  });
  const look = draft.look;
  const sw = (key, list) => `<div class="look-row"><span>${{ skin: '膚色', hair: '髮色', shirt: '上衣', pants: '褲子', cap: '帽子' }[key]}</span>${list.map(c => `<button class="swatch ${look[key] === c ? 'on' : ''}" style="background:${c}" data-lk="${key}" data-lv="${c}"></button>`).join('')}</div>`;
  $('ch-look').innerHTML = `<div class="look-row"><span>體型</span>${LOOK_OPTIONS.body.map(([v, l]) => `<button class="chip ${look.body === v ? 'on' : ''}" data-lk="body" data-lv="${v}">${l}</button>`).join('')}</div>` +
    ['skin', 'hair', 'shirt', 'pants', 'cap'].map(k => sw(k, LOOK_OPTIONS[k])).join('');
  $('ch-look').querySelectorAll('[data-lk]').forEach(b => b.onclick = () => { draft.look[b.dataset.lk] = b.dataset.lv; renderChar(); if (preview) preview.golfer.setLook(draft.look); });
}

function initChar() {
  $('ch-respec').onclick = () => {
    if (draft.respecs <= 0) return alert('重新分配次數已用完，請找管理員');
    if (!confirm(`重新分配會把所有素質重設為 ${BASE}、退回全部已用能力點，並消耗 1 次機會（剩 ${draft.respecs} 次）。確定？`)) return;
    const spent = spentFor(draft.base);
    const pendingSpent = spentFor(draft.stats) - spent;
    draft.points += spent + pendingSpent;
    draft.stats = normalizeStats({});
    draft.base = normalizeStats({});
    draft.respecs--;
    draft.respecUsed = true;
    renderChar();
  };
  $('ch-save').onclick = () => busy('ch-save', async () => {
    try {
      const p = await call('saveProfile', { profile: { stats: draft.stats, look: draft.look, points: draft.points, respecs: draft.respecs, spent: spentFor(draft.stats) } });
      session.profile = p;
      draft.base = normalizeStats(p.stats);
      draft.points = p.points;
      msg('ch-msg', '已儲存', true);
      renderChar();
    } catch (e) { msg('ch-msg', e.message); }
  });
}

function startPreview() {
  if (preview) return;
  const cv = $('ch-canvas');
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2, 4, 3);
  sun.castShadow = true;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), new THREE.MeshStandardMaterial({ color: 0x5f8f45, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const golfer = new ProceduralGolfer(draft.look);
  golfer.setup(new THREE.Vector3(0, 0.021, 0), 0, 'iron');
  scene.add(golfer.object);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0213, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  ball.position.set(0, 0.021, 0);
  scene.add(ball);
  let t = 0, last = performance.now(), swingT = 0;
  preview = { r, golfer, alive: true };
  const loop = now => {
    if (!preview || !preview.alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * r.getPixelRatio()) { r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    const a = t * 0.35;
    const c = golfer.object.position.clone().add(new THREE.Vector3(0, 0.9, 0));
    cam.position.set(c.x + Math.sin(a) * 4.2, 1.5, c.z + Math.cos(a) * 4.2);
    cam.lookAt(c);
    // 每 6 秒示範一次揮桿
    swingT += dt;
    if (swingT > 6) { swingT = 0; golfer.setup(new THREE.Vector3(0, 0.021, 0), 0, 'iron'); }
    else if (swingT > 2 && swingT < 3) golfer.setBackswing((swingT - 2) / 1);
    else if (swingT >= 3 && !golfer.anim && !golfer.finished) golfer.swing(() => {});
    golfer.update(dt);
    r.render(scene, cam);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function stopPreview() {
  if (!preview) return;
  preview.alive = false;
  preview.r.dispose();
  preview = null;
}

// ---------------- 紀錄 ----------------
async function openRecords() {
  show('scr-records');
  $('rc-list').innerHTML = '<p class="small">讀取中…</p>';
  try {
    const list = await call('getRounds');
    $('rc-list').innerHTML = list.length ? list.map(r => `
      <div class="rec"><div><b>${escapeHtml(r.course)}</b><span>${new Date(r.date).toLocaleDateString()} · ${r.holes} 洞 · ${escapeHtml(r.mode)}${r.partners ? ' · 與 ' + escapeHtml(r.partners) : ''}</span></div>
      <div class="rs"><b class="num">${r.strokes}</b><span class="num">${fmtToPar(Number(r.toPar))}</span></div>
      <div class="rx">推桿 ${r.putts} · 上球道 ${r.fairways} · GIR ${r.gir}</div></div>`).join('') : '<p class="small">還沒有紀錄，去打一場吧！</p>';
  } catch (e) { $('rc-list').innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`; }
}

// ---------------- 管理員 ----------------
async function openAdmin() {
  if (!session.isAdmin) return;
  show('scr-admin');
  $('ad-list').innerHTML = '<p class="small">讀取中…</p>';
  try {
    const list = await call('listAccounts');
    const pending = list.filter(a => !a.active).length;
    $('ad-pending').textContent = pending ? `● 有 ${pending} 個帳號等待核准` : '所有帳號都已處理';
    $('ad-pending').classList.toggle('none', !pending);
    $('ad-list').innerHTML = `<div class="row h"><span>帳號 A</span><span>密碼 B</span><span>啟用 C</span></div>` + list.map(a => `
      <div class="row"><b>${escapeHtml(a.user)}</b><code>${escapeHtml(a.pass)}</code>
        <button class="toggle ${a.active ? 'on' : ''} ${a.user === ADMIN_USER ? 'lock' : ''}" data-u="${escapeHtml(a.user)}" data-v="${a.active ? 1 : 0}"></button>
        <div class="ad-extra">能力點 <b>${a.points}</b> <button class="mini" data-pt="${escapeHtml(a.user)}" data-a="5">+5</button><button class="mini" data-pt="${escapeHtml(a.user)}" data-a="-5">−5</button>
        　重新分配 <b>${a.respecs}</b> <button class="mini" data-rs="${escapeHtml(a.user)}">+1</button>　回合 ${a.rounds}</div></div>`).join('');
    $('ad-list').querySelectorAll('.toggle').forEach(b => b.onclick = async () => {
      if (b.dataset.u === ADMIN_USER) return;
      try { await call('setActive', { target: b.dataset.u, value: b.dataset.v !== '1' }); openAdmin(); } catch (e) { alert(e.message); }
    });
    $('ad-list').querySelectorAll('[data-pt]').forEach(b => b.onclick = async () => { try { await call('grantPoints', { target: b.dataset.pt, amount: Number(b.dataset.a) }); openAdmin(); } catch (e) { alert(e.message); } });
    $('ad-list').querySelectorAll('[data-rs]').forEach(b => b.onclick = async () => { try { await call('grantRespecs', { target: b.dataset.rs, amount: 1 }); openAdmin(); } catch (e) { alert(e.message); } });
  } catch (e) { $('ad-list').innerHTML = `<p class="err">${escapeHtml(e.message)}</p>`; }
}

// ---------------- 啟動 ----------------
initAuth();
initSettings();
initLobby();
initSetup();
initRooms();
initGameMenu();
initChar();
autoLogin();

// 記住上次登入的帳號：打開就直接進大廳（帳號被停用或密碼被改才回到登入畫面）
async function autoLogin() {
  const saved = getSetting('login', null);
  if (!saved || !saved.user) { show('scr-login'); return; }
  ui.loading(true, '登入中…', 0);
  session.user = saved.user; session.pass = saved.pass;
  try {
    const r = await call('login');
    session.isAdmin = r.isAdmin;
    session.profile = r.profile;
    enterLobby();
  } catch (e) {
    session.user = null;
    show('scr-login');
    msg('li-msg', e.message);
  } finally {
    ui.loading(false);
  }
}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__dixen = { get game() { return game; }, get world() { return world; }, session };
