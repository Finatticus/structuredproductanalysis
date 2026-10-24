// 擊球畫面 HUD（DOM 疊在 3D 畫面上）
import { toYd, clamp, fmtToPar, escapeHtml, MPH } from './util.js';
import { SURF_NAME } from './physics.js';
import { CLUBS } from './clubs.js';

const $ = id => document.getElementById(id);
const ICON = { driver: 'i-driver', wood: 'i-wood', iron: 'i-iron', wedge: 'i-wedge', putter: 'i-putter' };

export class Hud {
  constructor() {
    this.root = $('hud');
    this.toastTimer = null;
    this.mini = $('minimap');
    this.miniCtx = this.mini.getContext('2d');
    // 風向羅盤刻度、球位圖示的草葉
    const NS = 'http://www.w3.org/2000/svg';
    const ticks = $('w-ticks');
    for (let a = 0; a < 360; a += 15) {
      const r = a * Math.PI / 180, r1 = a % 90 ? 40 : 36;
      const l = document.createElementNS(NS, 'line');
      [['x1', 50 + Math.sin(r) * r1], ['y1', 50 - Math.cos(r) * r1], ['x2', 50 + Math.sin(r) * 44], ['y2', 50 - Math.cos(r) * 44], ['stroke-width', a % 90 ? 1 : 2]].forEach(([k, v]) => l.setAttribute(k, v));
      ticks.appendChild(l);
    }
    const blades = document.getElementById('lieBlades');
    if (blades && !blades.childNodes.length) {
      let s = 5;
      const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 30; i++) {
        const x = 8 + i * 3.6 + rnd() * 2, h = 18 + rnd() * 22, lean = (rnd() - 0.5) * 14, base = 104 + rnd() * 8;
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', `M${x - 1.6} ${base} Q${x + lean * 0.4} ${base - h * 0.6} ${x + lean} ${base - h} Q${x + lean * 0.4 + 1} ${base - h * 0.55} ${x + 1.6} ${base}Z`);
        blades.appendChild(p);
      }
    }
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  setHole(hole, holeNo, teeYd, courseName) {
    $('h-hole').textContent = holeNo;
    $('h-course').textContent = courseName;
    $('h-par').textContent = hole.par;
    $('h-yards').textContent = teeYd;
    $('h-hcp').textContent = hole.hcp;
    this.hole = hole;
  }

  setPlayer(p, strokes, isMine, multi) {
    $('h-stroke').textContent = strokes + 1;
    const tb = $('turn-banner');
    tb.innerHTML = multi ? `<b>${escapeHtml(p.user)}</b>${isMine ? '　輪到你了' : '　擊球中…'}` : '';
    tb.classList.toggle('hidden', !multi);
    tb.classList.toggle('mine', multi && isMine);
    // 連線時剛輪到自己：先在畫面中間放大彈出 1 秒，再縮回上方；輪到對方就只顯示在上方
    const key = `${$('h-hole').textContent}:${p.user}:${strokes}`;
    if (multi && isMine && key !== this.turnKey) {
      tb.classList.remove('pop'); void tb.offsetWidth; tb.classList.add('pop');
      clearTimeout(this.turnTimer);
      this.turnTimer = setTimeout(() => tb.classList.remove('pop'), 1000);
    }
    this.turnKey = multi && isMine ? key : null;
  }

  setPlayers(players, par, mode) {
    const box = $('h-players');
    if (players.length < 2) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = players.map(p => {
      const tot = p.scores.reduce((s, v, i) => s + (v ? v - p.pars[i] : 0), 0);
      return `<div class="pl ${p.current ? 'on' : ''}"><span>${escapeHtml(p.user)}</span><b class="num">${fmtToPar(tot)}</b></div>`;
    }).join('') + (mode === 'match' && players.matchText ? `<div class="pl match">${players.matchText}</div>` : '');
  }

  setWind(wind, aimYaw, temp, elevDiff, stimp, firm) {
    const mph = Math.hypot(wind[0], wind[1]) / MPH;
    const d = [Math.sin(aimYaw), -Math.cos(aimYaw)], r = [Math.cos(aimYaw), Math.sin(aimYaw)];
    const along = wind[0] * d[0] + wind[1] * d[1], cross = wind[0] * r[0] + wind[1] * r[1];
    const ang = Math.atan2(cross, along) * 180 / Math.PI;
    $('w-arrow').setAttribute('transform', `rotate(${ang.toFixed(1)} 50 50)`);
    $('w-speed').textContent = mph.toFixed(0);
    let txt = '無風';
    if (mph >= 1) {
      const a = Math.abs(ang);
      const head = a < 30 ? '順風' : a > 150 ? '逆風' : a < 60 ? '順側風' : a > 120 ? '逆側風' : '側風';
      const side = a < 20 || a > 160 ? '' : cross > 0 ? '（左→右）' : '（右→左）';
      txt = head + side;
    }
    $('w-text').textContent = txt;
    $('e-elev').textContent = (elevDiff >= 0 ? '+' : '') + Math.round(elevDiff / 0.3048) + ' FT';
    $('e-temp').textContent = Math.round(temp) + '°C';
    $('e-stimp').textContent = 'STIMP ' + stimp.toFixed(1);
    $('e-firm').textContent = firm > 1.1 ? 'FIRM' : firm < 0.95 ? 'SOFT' : 'MEDIUM';
  }

  setClub(club, table, mine) {
    $('c-icon').setAttribute('href', '#' + ICON[club.icon]);
    $('c-name').textContent = club.name;
    const t = table[club.id];
    $('c-sub').textContent = club.putter ? '推桿' : `平均 ${Math.round(toYd(t.carry))} Y`;
    $('hud-club').classList.toggle('disabled', !mine);
  }

  // 完整選桿視窗：每支桿的平均 Carry / Total、桿面角度，點一下選擇
  openClubs(table, currentId, onPick) {
    const icon = c => `<svg viewBox="0 0 120 120"><use href="#${ICON[c.icon]}"/></svg>`;
    $('cl-note').textContent = '平均距離依你的素質計算（球道、無風）';
    $('cl-list').innerHTML = CLUBS.map(c => {
      const t = table[c.id];
      const dist = c.putter ? '<span class="cl-d">推桿</span>' : `<span class="cl-d"><b class="num">${Math.round(toYd(t.carry))}</b><small>Carry</small></span><span class="cl-d"><b class="num">${Math.round(toYd(t.total))}</b><small>Total</small></span>`;
      return `<button class="cl-row ${c.id === currentId ? 'on' : ''}" data-id="${c.id}">${icon(c)}<span class="cl-n"><b class="num">${c.name}</b><small>${c.zh}${c.putter ? '' : ' · ' + c.loft + '°'}</small></span>${dist}</button>`;
    }).join('');
    $('cl-list').querySelectorAll('[data-id]').forEach(b => b.onclick = () => { $('dlg-clubs').classList.remove('open'); onPick(b.dataset.id); });
    $('dlg-clubs').classList.add('open');
  }

  // puttElev：推桿時球到洞的高低差（公尺，正 = 上坡）；不是推桿傳 null
  setLie(lie, distPin, landing, puttElev) {
    $('l-lie').textContent = SURF_NAME[lie];
    $('l-pin').textContent = distPin < 27 ? toYd(distPin).toFixed(1) + ' Y' : Math.round(toYd(distPin)) + ' Y';
    const putt = puttElev !== null && puttElev !== undefined;
    $('l-land').textContent = putt ? (Math.abs(puttElev) < 0.01 ? '平' : (puttElev > 0 ? '上坡 ' : '下坡 ') + toYd(Math.abs(puttElev)).toFixed(2) + ' Y') : Math.round(toYd(landing)) + ' Y';
    $('l-land-lbl').textContent = putt ? '高低差' : '預估落點';
    $('l-icon').setAttribute('href', lie === 3 ? '#i-green' : '#i-lie');
  }

  setPower(p, label, land) {
    const pct = Math.round(p * 100);
    $('p-val').textContent = label || pct + '%';
    // 100% 在力道條 75% 的位置，100~110% 佔下面 25%（和手指要多拉的距離一致）
    const f = p <= 1 ? p * 0.75 : 0.75 + clamp((p - 1) / 0.1, 0, 1) * 0.25;
    $('p-fill').style.height = f * 100 + '%';
    $('p-fill').classList.toggle('over', p > 1);
    $('p-needle').style.top = f * 100 + '%';
    // 落點碼數 = 球桿平均距離，沒有算風，所以加小字提醒
    $('p-land').innerHTML = land ? `${land}<small>未含風速</small>` : '';
  }

  placeSwingUI(pos) {
    const e = $('swing-ui');
    if (!pos || !pos.visible) { e.classList.add('off'); return; }
    e.classList.remove('off');
    e.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`;
  }

  setAdjust(text, pct = 0) {
    const e = $('p-adj');
    e.textContent = text;
    e.classList.toggle('more', pct > 0);
  }

  // 力道條上方的「落點 xxx Y」碰到旗桿距離標籤時，自動往上 / 左 / 右移開（選移動最少的方向）
  avoidPinTag() {
    // 「落點」和上面的「(預計少 xx%)」一起移動
    const els = [$('p-land'), $('p-adj')].filter(e => e.textContent);
    const pin = $('tag-pin');
    els.forEach(e => (e.style.transform = ''));
    if (!els.length || pin.style.display === 'none' || $('swing-ui').classList.contains('off')) return;
    const rs = els.map(e => e.getBoundingClientRect());
    const a = { left: Math.min(...rs.map(r => r.left)), right: Math.max(...rs.map(r => r.right)), top: Math.min(...rs.map(r => r.top)), bottom: Math.max(...rs.map(r => r.bottom)) };
    const b = pin.getBoundingClientRect(), pad = 4;
    if (a.right < b.left - pad || a.left > b.right + pad || a.bottom < b.top - pad || a.top > b.bottom + pad) return;
    const up = a.bottom - b.top + pad, left = a.right - b.left + pad, right = b.right - a.left + pad;
    const m = Math.min(up, left, right);
    const tf = m === up ? `translateY(${-up}px)` : m === left ? `translateX(${-left}px)` : `translateX(${right}px)`;
    els.forEach(e => (e.style.transform = tf));
  }

  swingHint(text) { $('swing-hint').textContent = text; }

  enableControls(v) {
    this.root.classList.toggle('waiting', !v);
  }

  tag(id, pos, text) {
    const e = $(id);
    if (!pos || !pos.visible) { e.style.display = 'none'; return; }
    e.style.display = '';
    e.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -100%)`;
    if (text !== undefined) e.textContent = text;
  }

  toast(html, ms = 2200, cls = '') {
    const t = $('toast');
    t.innerHTML = html;
    t.className = 'toast show ' + cls;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.className = 'toast'; }, ms);
  }

  // 老鷹 / 信天翁 / 一桿進洞：全畫面金色慶祝動畫 3 秒（金色紙花從上方灑下、中間大字放大彈出）
  celebrate(title, sub, name) {
    const box = $('celebrate');
    box.querySelector('.cb-name').textContent = name || '';
    box.querySelector('.cb-title').textContent = title;
    box.querySelector('.cb-sub').textContent = sub;
    box.classList.remove('show'); void box.offsetWidth; box.classList.add('show');
    const cv = box.querySelector('canvas'), x = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const COLS = ['#e7c477', '#f6e3ae', '#c49a4c', '#fff6dc', '#2f6b45', '#b2332b'];
    const bits = Array.from({ length: Math.round(Math.min(220, W * 0.25)) }, () => ({
      x: Math.random() * W, y: -Math.random() * H * 0.6 - 10, vx: (Math.random() - 0.5) * 60, vy: 90 + Math.random() * 160,
      w: 5 + Math.random() * 7, h: 3 + Math.random() * 4, r: Math.random() * 6, vr: (Math.random() - 0.5) * 10, sway: Math.random() * 6,
      c: COLS[Math.floor(Math.random() * COLS.length)],
    }));
    const t0 = performance.now();
    cancelAnimationFrame(this.cbRaf);
    let last = t0;
    const step = now => {
      const t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      x.clearRect(0, 0, W, H);
      // 中間放射金光
      const glow = x.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.6);
      const a = Math.min(1, t * 3) * Math.max(0, 1 - Math.max(0, t - 2.4) / 0.6);
      glow.addColorStop(0, `rgba(240,205,120,${0.45 * a})`);
      glow.addColorStop(1, 'rgba(240,205,120,0)');
      x.fillStyle = glow; x.fillRect(0, 0, W, H);
      x.save(); x.translate(W / 2, H * 0.42); x.rotate(t * 0.25);
      x.fillStyle = `rgba(255,236,180,${0.16 * a})`;
      for (let i = 0; i < 12; i++) { x.rotate(Math.PI / 6); x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.max(W, H), -40); x.lineTo(Math.max(W, H), 40); x.fill(); }
      x.restore();
      for (const b of bits) {
        b.vy += 30 * dt; b.x += (b.vx + Math.sin(t * 3 + b.sway) * 40) * dt; b.y += b.vy * dt; b.r += b.vr * dt;
        x.save(); x.translate(b.x, b.y); x.rotate(b.r); x.scale(1, Math.abs(Math.cos(b.r * 1.3)) + 0.2);
        x.globalAlpha = a; x.fillStyle = b.c; x.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); x.restore();
      }
      if (t < 3) this.cbRaf = requestAnimationFrame(step);
      else { x.clearRect(0, 0, W, H); box.classList.remove('show'); }
    };
    this.cbRaf = requestAnimationFrame(step);
    clearTimeout(this.cbTimer);
    this.cbTimer = setTimeout(() => box.classList.remove('show'), 3100);   // 背景分頁不跑動畫時也會關掉
  }

  // autoHideMs = 0：一直顯示到玩家點一下；連線模式傳 3000，3 秒自動關閉
  shotData(club, info, res, autoHideMs = 0) {
    const box = $('shot-data');
    const m = (label, val, unit, hero) => `<div class="${hero ? 'hero' : ''}"><span>${label}</span><b class="num">${val}<small>${unit}</small></b></div>`;
    const off = toYd(res.offline);
    box.querySelector('.metrics').innerHTML = [
      m('擊球初速 Ball Speed', info.ballMph.toFixed(1), 'mph', true),
      m('桿頭速度 Club Speed', info.clubMph.toFixed(1), 'mph'),
      m('擊球效率 Smash', info.smash.toFixed(2), ''),
      m('發射角 Launch', info.launchDeg.toFixed(1), '°'),
      m('後旋 Back Spin', Math.round(info.spin).toLocaleString(), 'rpm'),
      m('旋轉軸 Spin Axis', (info.axisDeg < 0 ? 'L ' : info.axisDeg > 0 ? 'R ' : '') + Math.abs(info.axisDeg).toFixed(1), '°'),
      m('飛行距離 Carry', Math.round(toYd(res.carry)), 'Y', true),
      m('總距離 Total', Math.round(toYd(res.total)), 'Y', true),
      m('偏移 Offline', (off < -0.5 ? 'L ' : off > 0.5 ? 'R ' : '') + Math.abs(off).toFixed(0), 'Y'),
      m('最高點 Apex', Math.round(toYd(res.apex)), 'Y'),
      m('落地角 Descent', res.descent.toFixed(0), '°'),
      m('滯空 Hang Time', res.flightTime.toFixed(1), 's'),
    ].join('');
    box.querySelector('h3').innerHTML = `SHOT DATA · ${club.name}<small>點一下關閉</small>`;
    box.classList.add('show');
    clearTimeout(this.sdTimer);
    if (autoHideMs) this.sdTimer = setTimeout(() => box.classList.remove('show'), autoHideMs);
    if (!box.dataset.bound) {
      box.dataset.bound = '1';
      // 面板上或面板外任何地方點一下都關閉；這一下只用來關面板，不會開始揮桿
      window.addEventListener('pointerdown', e => {
        if (!this.shotDataOpen()) return;
        this.hideShotData();
        e.stopPropagation();
        e.preventDefault();
      }, true);
    }
  }

  hideShotData() { clearTimeout(this.sdTimer); $('shot-data').classList.remove('show'); }
  shotDataOpen() { return $('shot-data').classList.contains('show'); }

  // 果嶺高低色階：比果嶺平均高 → 紅、低 → 藍、差不多 → 綠（漸層）
  setGreenHeat(hole) {
    const g = hole.green, st = hole.greenStats();
    const R = Math.max(g.rx, g.ry) * 1.35, res = 0.25;
    const n = Math.ceil(2 * R / res);
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const x = c.getContext('2d'), img = x.createImageData(n, n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const u = g.u - R + (i + 0.5) * res, v = g.v + R - (j + 0.5) * res;
      if (hole.greenR(u, v) >= 1) continue;
      const [r, gg, bb] = heatColor((hole.heightUV(u, v) - st.h0) / st.range);
      const o = (j * n + i) * 4;
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = bb; img.data[o + 3] = 235;
    }
    x.putImageData(img, 0, 0);
    this.heat = { canvas: c, minU: g.u - R, maxU: g.u + R, minV: g.v - R, maxV: g.v + R };
  }

  // 小地圖：上方 = 果嶺方向；球在果嶺附近時自動放大到果嶺
  drawMini(hole, colorCanvas, ball, target, players) {
    this.mapArgs = [hole, colorCanvas, ball, target, players];
    this.miniBox = this.drawMap(this.mini, ...this.mapArgs);
    if ($('dlg-map').classList.contains('open')) this.redrawBig();
  }

  openBigMap() {
    $('dlg-map').classList.add('open');
    this.bigView = { z: 1, pu: 0, pv: 0 };
    this.redrawBig();
    if (!this.bigBound) { this.bigBound = true; this.bindBigMap(); }
  }

  redrawBig() {
    if (this.mapArgs) this.bigBox = this.drawMap($('map-big'), ...this.mapArgs, this.bigView);
  }

  // 大地圖手勢：一指拖曳、兩指縮放、滑鼠滾輪縮放、點一下（沒移動）回呼 onBigMapTap
  bindBigMap() {
    const c = $('map-big');
    const pts = new Map();
    let last = null, moved = 0, downT = 0;
    const zoomBy = (k) => { const v = this.bigView; v.z = clamp(v.z * k, 1, 14); this.redrawBig(); };
    const pan = (dx, dy) => {
      const sc = this.bigBox ? this.bigBox.sc : 1;
      this.bigView.pu -= dx * 2 / sc;
      this.bigView.pv += dy * 2 / sc;
      this.redrawBig();
    };
    const state = () => {
      const a = [...pts.values()];
      if (a.length === 1) return { x: a[0].x, y: a[0].y, d: 0 };
      return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) };
    };
    c.addEventListener('pointerdown', e => {
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* 某些瀏覽器不支援，忽略 */ }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = state();
      if (pts.size === 1) { moved = 0; downT = performance.now(); }
      e.preventDefault();
    });
    c.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const s = state();
      if (pts.size >= 2 && last.d > 0) zoomBy(s.d / last.d);
      pan(s.x - last.x, s.y - last.y);
      moved += Math.hypot(s.x - last.x, s.y - last.y);
      last = s;
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size === 0 && moved < 8 && performance.now() - downT < 500 && this.onBigMapTap) {
        const r = c.getBoundingClientRect();
        const w = this.mapToWorld(e.clientX - r.left, e.clientY - r.top, true);
        if (w) this.onBigMapTap(w);
      }
      if (pts.size) last = state();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    $('map-zin').onclick = () => zoomBy(1.6);
    $('map-zout').onclick = () => zoomBy(1 / 1.6);
    $('map-reset').onclick = () => { this.bigView = { z: 1, pu: 0, pv: 0 }; this.redrawBig(); };
  }

  // view：大地圖的縮放與平移 { z 倍率, pu/pv 平移公尺 }
  drawMap(c, hole, colorCanvas, ball, target, players, view) {
    if (!colorCanvas) return null;
    const x = c.getContext('2d');
    const W = c.width = c.clientWidth * 2, H = c.height = c.clientHeight * 2;
    const b = hole.bbox;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    const nearGreen = hole.distToPin(ball[0], ball[2]) < 45;
    if (nearGreen) {
      const g = hole.green, R = Math.max(g.rx, g.ry) * 1.3;
      minU = Math.min(g.u - R, ball[0] - 4); maxU = Math.max(g.u + R, ball[0] + 4);
      minV = Math.min(g.v - R, -ball[2] - 4); maxV = Math.max(g.v + R, -ball[2] + 4);
    } else {
      for (const [u, v] of hole.path) { minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
      minU -= 70; maxU += 70; minV -= 30; maxV += 30;
    }
    if (view && (view.z !== 1 || view.pu || view.pv)) {
      const cu = (minU + maxU) / 2 + view.pu, cv = (minV + maxV) / 2 + view.pv;
      const hw = (maxU - minU) / 2 / view.z, hh = (maxV - minV) / 2 / view.z;
      minU = cu - hw; maxU = cu + hw; minV = cv - hh; maxV = cv + hh;
    }
    const sc = Math.min(W / (maxU - minU), H / (maxV - minV));
    const ox = (W - (maxU - minU) * sc) / 2, oy = (H - (maxV - minV) * sc) / 2;
    const toPx = (u, v) => [ox + (u - minU) * sc, oy + (maxV - v) * sc];
    x.fillStyle = '#2c4426';
    x.fillRect(0, 0, W, H);
    // 底圖：整張顏色圖照比例貼上（超出範圍的部分自然被裁掉）
    const [ax, ay] = toPx(b.minU, b.maxV);
    x.imageSmoothingEnabled = true;
    x.drawImage(colorCanvas, ax, ay, (b.maxU - b.minU) * sc, (b.maxV - b.minV) * sc);
    if (this.heat) {
      const h = this.heat, [hx, hy] = toPx(h.minU, h.maxV);
      x.drawImage(h.canvas, hx, hy, (h.maxU - h.minU) * sc, (h.maxV - h.minV) * sc);
    }
    const [bx, by] = toPx(ball[0], -ball[2]);
    if (target) {
      const [tx, ty] = toPx(target[0], -target[1]);
      x.strokeStyle = 'rgba(255,255,255,0.95)'; x.lineWidth = 2; x.setLineDash([6, 6]);
      x.beginPath(); x.moveTo(bx, by); x.lineTo(tx, ty); x.stroke(); x.setLineDash([]);
      x.fillStyle = '#fff'; x.beginPath(); x.arc(tx, ty, 5, 0, Math.PI * 2); x.fill();
    }
    const [fx, fy] = toPx(hole.pin[0], -hole.pin[1]);
    const fl = Math.max(16, W / 28);   // 旗子大小跟著地圖放大
    x.fillStyle = '#111'; x.beginPath(); x.arc(fx, fy, fl * 0.2, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#f2ead0'; x.lineWidth = Math.max(2, fl / 8);
    x.beginPath(); x.moveTo(fx, fy); x.lineTo(fx, fy - fl); x.stroke();
    x.fillStyle = '#b73a31'; x.beginPath(); x.moveTo(fx, fy - fl); x.lineTo(fx + fl * 0.65, fy - fl * 0.8); x.lineTo(fx, fy - fl * 0.6); x.fill();
    for (const p of players || []) {
      if (!p.ball || p.holed) continue;
      const [qx, qy] = toPx(p.ball[0], -p.ball[2]);
      x.fillStyle = p.current ? '#ffffff' : '#d6bb82';
      x.strokeStyle = '#111'; x.lineWidth = 1.5;
      x.beginPath(); x.arc(qx, qy, Math.max(5, W / 110), 0, Math.PI * 2); x.fill(); x.stroke();
    }
    return { minU, maxV, sc, ox, oy };
  }

  // 畫面座標（CSS px）→ 世界座標
  mapToWorld(px, py, big) {
    const m = big ? this.bigBox : this.miniBox;
    if (!m) return null;
    const u = m.minU + (px * 2 - m.ox) / m.sc, v = m.maxV - (py * 2 - m.oy) / m.sc;
    return [u, -v];
  }

  miniToWorld(px, py) { return this.mapToWorld(px, py, false); }

  // 頭頂提醒（黃底黑字），ms 毫秒後消失
  lieWarn(text, ms = 5000) {
    const e = $('lie-warn');
    e.textContent = text;
    e.classList.add('show');
    clearTimeout(this.warnTimer);
    this.warnTimer = setTimeout(() => e.classList.remove('show'), ms);
  }

  hideLieWarn() { clearTimeout(this.warnTimer); $('lie-warn').classList.remove('show'); }

  // 指向落點白點的紅色小箭頭；白點在畫面外時貼著邊緣指過去
  pointTarget(pos) {
    const e = $('tgt-arrow');
    if (!pos) { e.style.display = 'none'; return; }
    const W = this.root.clientWidth, H = this.root.clientHeight, m = 40;
    let x = pos.x, y = pos.y, ang = 0;
    const inside = pos.visible && x > m && x < W - m && y > m && y < H - m;
    if (!inside) {
      const cx = W / 2, cy = H / 2;
      let dx = x - cx, dy = y - cy;
      if (!pos.visible) { dx = -dx; dy = -dy; }
      const k = Math.min((W / 2 - m) / Math.abs(dx || 1e-6), (H / 2 - m) / Math.abs(dy || 1e-6));
      x = cx + dx * k; y = cy + dy * k;
      ang = Math.atan2(dy, dx) * 180 / Math.PI - 90;
    }
    e.style.display = '';
    e.classList.toggle('edge', !inside);
    e.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${ang.toFixed(1)}deg)`;
  }
}

// t: −1（最低）~ 0（平均）~ 1（最高）→ 藍 ~ 綠 ~ 紅
export function heatColor(t) {
  t = Math.max(-1, Math.min(1, t));
  const hue = t >= 0 ? 120 - t * 120 : 120 - t * 110;
  return hslToRgb(hue / 360, 0.78, 0.5);
}

function hslToRgb(h, s, l) {
  const f = n => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}
