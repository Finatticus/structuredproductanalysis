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
    $('turn-banner').innerHTML = multi ? `<b>${escapeHtml(p.user)}</b>${isMine ? '　輪到你了' : '　擊球中…'}` : '';
    $('turn-banner').classList.toggle('hidden', !multi);
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
    $('c-sub').textContent = club.putter ? '推桿' : `平均 Carry ${Math.round(toYd(t.carry))} Y · Total ${Math.round(toYd(t.total))} Y`;
    $('c-rail').innerHTML = CLUBS.map(c => `<i class="${c.id === club.id ? 'on' : ''}" data-club="${c.id}">${c.short}</i>`).join('');
    $('hud-club').classList.toggle('disabled', !mine);
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
    $('p-fill').style.height = clamp(p / 1.1, 0, 1) * 100 + '%';
    $('p-fill').classList.toggle('over', p > 1);
    $('p-needle').style.top = clamp(p / 1.1, 0, 1) * 100 + '%';
    $('p-land').textContent = land || '';
  }

  placeSwingUI(pos) {
    const e = $('swing-ui');
    if (!pos || !pos.visible) { e.classList.add('off'); return; }
    e.classList.remove('off');
    e.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`;
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

  // autoHideMs = 0：一直顯示到玩家點一下；連線模式傳 10000，最多 10 秒
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
    const big = $('map-big');
    if ($('dlg-map').classList.contains('open')) this.bigBox = this.drawMap(big, ...this.mapArgs);
  }

  openBigMap() {
    $('dlg-map').classList.add('open');
    if (this.mapArgs) this.bigBox = this.drawMap($('map-big'), ...this.mapArgs);
  }

  drawMap(c, hole, colorCanvas, ball, target, players) {
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
