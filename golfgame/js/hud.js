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

  setLie(lie, distPin, landing, puttScaleFt) {
    $('l-lie').textContent = SURF_NAME[lie];
    $('l-pin').textContent = distPin < 30 && lie <= 3 ? (distPin / 0.3048).toFixed(0) + ' FT' : Math.round(toYd(distPin)) + ' Y';
    $('l-land').textContent = puttScaleFt ? '最大 ' + puttScaleFt + ' FT' : Math.round(toYd(landing)) + ' Y';
    $('l-land-lbl').textContent = puttScaleFt ? '推桿刻度' : '預估落點';
    $('l-icon').setAttribute('href', lie === 3 ? '#i-green' : '#i-lie');
  }

  setPower(p, curve, label) {
    const pct = Math.round(p * 100);
    $('p-val').textContent = label || pct + '%';
    $('p-fill').style.width = clamp(p / 1.1, 0, 1) * 100 + '%';
    $('p-fill').classList.toggle('over', p > 1);
    $('p-needle').style.left = clamp(p / 1.1, 0, 1) * 100 + '%';
    const c = curve || 0;
    document.querySelectorAll('#p-shape span').forEach(s => s.classList.remove('on'));
    $(c < -0.08 ? 'ps-draw' : c > 0.08 ? 'ps-fade' : 'ps-straight').classList.add('on');
    $('p-curve').style.left = (50 + c * 45) + '%';
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

  shotData(club, info, res, wind) {
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
    box.querySelector('h3').textContent = `SHOT DATA · ${club.name}`;
    box.classList.add('show');
    clearTimeout(this.sdTimer);
    this.sdTimer = setTimeout(() => box.classList.remove('show'), 5000);
  }

  hideShotData() { $('shot-data').classList.remove('show'); }

  // 小地圖：上方 = 果嶺方向
  drawMini(hole, colorCanvas, ball, target, players) {
    if (!colorCanvas) return;
    const c = this.mini, x = this.miniCtx;
    const W = c.width = c.clientWidth * 2, H = c.height = c.clientHeight * 2;
    const b = hole.bbox;
    // 只畫球道走廊的範圍
    const pad = 30;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [u, v] of hole.path) { minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
    minU -= pad + 40; maxU += pad + 40; minV -= pad; maxV += pad;
    const sc = Math.min(W / (maxU - minU), H / (maxV - minV));
    const ox = (W - (maxU - minU) * sc) / 2, oy = (H - (maxV - minV) * sc) / 2;
    const toPx = (u, v) => [ox + (u - minU) * sc, oy + (maxV - v) * sc];
    x.fillStyle = '#2c4426';
    x.fillRect(0, 0, W, H);
    const sx = (minU - b.minU) / (b.maxU - b.minU) * colorCanvas.width, sw = (maxU - minU) / (b.maxU - b.minU) * colorCanvas.width;
    const sy = (b.maxV - maxV) / (b.maxV - b.minV) * colorCanvas.height, sh = (maxV - minV) / (b.maxV - b.minV) * colorCanvas.height;
    x.drawImage(colorCanvas, sx, sy, sw, sh, ox, oy, (maxU - minU) * sc, (maxV - minV) * sc);
    // 水
    x.fillStyle = 'rgba(40,80,95,0.9)';
    this.miniBox = { toPx, minU, maxU, minV, maxV, sc, ox, oy, W, H };
    const [pu, pv] = [hole.pin[0], -hole.pin[1]];
    const [bx, by] = toPx(ball[0], -ball[2]);
    if (target) {
      const [tx, ty] = toPx(target[0], -target[1]);
      x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 2; x.setLineDash([6, 6]);
      x.beginPath(); x.moveTo(bx, by); x.lineTo(tx, ty); x.stroke(); x.setLineDash([]);
      x.beginPath(); x.arc(tx, ty, 7, 0, Math.PI * 2); x.stroke();
    }
    const [fx, fy] = toPx(pu, pv);
    x.strokeStyle = '#f2ead0'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(fx, fy); x.lineTo(fx, fy - 16); x.stroke();
    x.fillStyle = '#b73a31'; x.beginPath(); x.moveTo(fx, fy - 16); x.lineTo(fx + 10, fy - 13); x.lineTo(fx, fy - 10); x.fill();
    for (const p of players || []) {
      if (!p.ball || p.holed) continue;
      const [qx, qy] = toPx(p.ball[0], -p.ball[2]);
      x.fillStyle = p.current ? '#ffffff' : '#d6bb82';
      x.strokeStyle = '#111'; x.lineWidth = 1.5;
      x.beginPath(); x.arc(qx, qy, 5, 0, Math.PI * 2); x.fill(); x.stroke();
    }
  }

  miniToWorld(px, py) {
    const m = this.miniBox;
    if (!m) return null;
    const u = m.minU + (px * 2 - m.ox) / m.sc, v = m.maxV - (py * 2 - m.oy) / m.sc;
    return [u, -v];
  }
}
