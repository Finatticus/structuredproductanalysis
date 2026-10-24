// 揮桿手勢（比照真實揮桿：上桿可以慢，下桿要快）
//   往下拉 = 上桿，手指離起點越遠力道越大；慢慢往上移只是把力道收小，不會擊球。
//   要「快速」往上滑（下桿）才會出桿；放開或只是慢慢移動都不會擊球。
//   出桿那一段的方向決定球路：Straight / Draw / Fade / Hook / Slice（見 classify）。
//   一開始就左右滑 = 調整瞄準方向。
// 揮完後在畫面上畫出平滑過的揮桿軌跡與球路名稱約 3 秒。
import { clamp } from './util.js';

const WINDOW_MS = 70;        // 計算速度用的時間窗
const DECIDE_PX = 10;        // 移動超過這個距離才判斷是瞄準還是揮桿

export class SwingInput {
  constructor(el, cb) {
    this.el = el;
    this.cb = cb;
    this.enabled = false;
    this.putt = false;
    this.state = null;
    this.trail = document.getElementById('swing-trail');
    this.tctx = this.trail.getContext('2d');
    this.fadeTimer = null;
    el.addEventListener('pointerdown', e => this.down(e));
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    window.addEventListener('pointercancel', e => this.cancel(e));
  }

  get maxDrag() { return clamp(window.innerHeight * 0.34, 140, 300); }

  // 手指往下的距離 → 力道。拉滿 maxDrag = 100%；超過之後要再多拉 40% 才會到 110%（超揮比較難不小心拉到）
  depthToPower(depth) {
    const md = this.maxDrag;
    if (depth <= md) return Math.max(0, depth / md);
    return 1 + Math.min(0.1, (depth - md) / (md * 0.4) * 0.1);
  }

  // 出桿判定速度（px/ms）。推桿的動作比較輕，門檻低一點
  get strikeSpeed() { return clamp(window.innerHeight * 0.0011, 0.55, 1.3) * (this.putt ? 0.6 : 1); }

  down(e) {
    if (!this.enabled || this.state) return;
    if (e.target.closest('.hud-btn, .hud-panel, button, .minimap')) return;
    const t = performance.now();
    this.state = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, mode: 'pending', samples: [[t, e.clientX, e.clientY]], path: [[e.clientX, e.clientY]], power: 0 };
    this.clearTrail();
    e.preventDefault();
  }

  move(e) {
    const s = this.state;
    if (!s || e.pointerId !== s.id) return;
    const t = performance.now(), x = e.clientX, y = e.clientY;
    s.samples.push([t, x, y]);
    while (s.samples.length > 2 && t - s.samples[0][0] > 900) s.samples.shift();
    if (s.mode === 'pending') {
      const dx = x - s.x0, dy = y - s.y0;
      if (Math.hypot(dx, dy) < DECIDE_PX) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.2) s.mode = 'aim';
      else if (dy > 0) { s.mode = 'back'; this.cb.onStart && this.cb.onStart(); }
      else s.mode = 'ignore';
    }
    if (s.mode === 'aim') {
      this.cb.onAim && this.cb.onAim(x - s.lastX);
      s.lastX = x;
      return;
    }
    if (s.mode === 'back') {
      s.path.push([x, y]);
      // 偵測快速往上：最近 70ms 往上的速度
      const old = s.samples.find(p => t - p[0] <= WINDOW_MS) || s.samples[0];
      const dt = Math.max(8, t - old[0]);
      const vUp = (old[2] - y) / dt;
      if (vUp > this.strikeSpeed && s.power > 0.03) {
        // 力道鎖定在「出桿前 0.7 秒內最深的位置」：出桿前手指不小心往上飄一點不會掉力道
        let bottom = s.samples[0];
        for (const p of s.samples) if (t - p[0] < 700 && p[2] > bottom[2]) bottom = p;
        const depth = Math.max(0, bottom[2] - s.y0);
        // 球路方向從最近 300ms 內的最低點開始算
        let start = s.samples[0];
        for (const p of s.samples) if (t - p[0] < 300 && p[2] > start[2]) start = p;
        s.mode = 'strike';
        s.strike = { x: start[1], y: start[2], power: this.depthToPower(depth), depth, pathStart: s.path.length - 1 };
        this.cb.onBack && this.cb.onBack(s.strike.power);
      } else {
        // 上桿中：力道 = 目前手指往下的深度（往上移就變小）
        s.power = this.depthToPower(y - s.y0);
        this.cb.onBack && this.cb.onBack(s.power);
      }
    }
    if (s.mode === 'strike') {
      if (s.path[s.path.length - 1][1] !== y) s.path.push([x, y]);
      this.cb.onThrough && this.cb.onThrough(this.curveFrom(s.strike, x, y));
      // 出桿推過一段距離就擊球（不用等放開）
      const need = Math.max(40, s.strike.depth * 0.6);
      if (s.strike.y - y >= need) this.fire(x, y);
    }
  }

  // 出桿方向 → 球路分級（偏角 = 出桿那一段相對正上方的角度，右正左負）
  //   全揮桿：< 4° Straight 直球；4~12° Draw 小左曲 / Fade 小右曲（旋轉軸 2~8°）；
  //           > 12° Hook 左曲 / Slice 右曲（旋轉軸 12~28°，偏 35° 以上封頂）
  //   推桿：  < 4° 直球；超過就是推偏（最多 ±1.5°）
  classify(st, x, y) {
    const dy = st.y - y, dx = x - st.x;
    const deg = dy < 8 ? 0 : Math.atan2(dx, dy) * 180 / Math.PI;
    const a = Math.abs(deg), sg = Math.sign(deg);
    if (a < 4) return { curve: 0, deg, shape: SHAPES.straight };
    if (this.putt) return { curve: sg * clamp((a - 4) / 20, 0, 1), deg, shape: sg > 0 ? SHAPES.push : SHAPES.pull };
    if (a < 12) return { curve: sg * (2 + (a - 4) / 8 * 6) / 30, deg, shape: sg > 0 ? SHAPES.fade : SHAPES.draw };
    return { curve: sg * (12 + Math.min(a - 12, 23) / 23 * 16) / 30, deg, shape: sg > 0 ? SHAPES.slice : SHAPES.hook };
  }

  curveFrom(st, x, y) { return this.classify(st, x, y).curve; }

  fire(x, y) {
    const s = this.state;
    if (!s) return;
    const c = this.classify(s.strike, x, y);
    this.state = null;
    this.drawTrail(s, x, y, c);
    this.cb.onSwing && this.cb.onSwing({ power: s.strike.power, curve: c.curve, shape: c.shape.key });
  }

  up(e) {
    const s = this.state;
    if (!s || e.pointerId !== s.id) return;
    if (s.mode === 'strike') this.fire(e.clientX, e.clientY);
    else this.cancel(e);
  }

  cancel(e) {
    const s = this.state;
    if (!s || (e && e.pointerId !== s.id)) return;
    this.state = null;
    this.clearTrail();
    if (s.mode === 'back' || s.mode === 'strike') this.cb.onCancel && this.cb.onCancel();
  }

  // ---------- 手指軌跡 ----------
  sizeTrail() {
    const c = this.trail, dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    this.tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = c.getBoundingClientRect();
    return [r.left, r.top];
  }

  clearTrail() {
    clearTimeout(this.fadeTimer);
    this.trail.classList.remove('fade');
    this.tctx.clearRect(0, 0, this.trail.width, this.trail.height);
  }

  // 揮完才畫：把手指軌跡重新取樣、平滑後畫出，並標示球路
  drawTrail(s, ex, ey, c) {
    const [ox, oy] = this.sizeTrail();
    const x = this.tctx;
    x.clearRect(0, 0, this.trail.width, this.trail.height);
    x.lineCap = x.lineJoin = 'round';
    const pts = s.path.map(([px, py]) => [px - ox, py - oy]);
    const split = s.strike.pathStart;
    const sx = s.strike.x - ox, sy = s.strike.y - oy;
    const back = smoothPath([[s.x0 - ox, s.y0 - oy], ...pts.slice(0, split + 1), [sx, sy]]);
    const down = smoothPath([[sx, sy], ...pts.slice(split + 1), [ex - ox, ey - oy]]);
    const curve = (line, color, width) => {
      x.strokeStyle = color; x.lineWidth = width;
      x.beginPath();
      x.moveTo(line[0][0], line[0][1]);
      for (let i = 1; i < line.length - 1; i++) {
        const mx = (line[i][0] + line[i + 1][0]) / 2, my = (line[i][1] + line[i + 1][1]) / 2;
        x.quadraticCurveTo(line[i][0], line[i][1], mx, my);
      }
      const l = line[line.length - 1];
      x.lineTo(l[0], l[1]);
      x.stroke();
    };
    // 上桿：細白線
    curve(back, 'rgba(255,255,255,.45)', 3);
    // 正上方參考線
    x.strokeStyle = 'rgba(255,255,255,.4)'; x.lineWidth = 1.5; x.setLineDash([6, 7]);
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx, sy - Math.max(90, s.strike.depth + 50)); x.stroke();
    x.setLineDash([]);
    // 出桿：依球路上色
    const col = c.shape.color;
    x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 8;
    curve(down, col, 7);
    x.shadowBlur = 0;
    const n = down.length, tip = down[n - 1], prev = down[Math.max(0, n - 3)];
    const ang = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
    x.fillStyle = col;
    x.beginPath();
    x.moveTo(tip[0] + 6 * Math.cos(ang), tip[1] + 6 * Math.sin(ang));
    x.lineTo(tip[0] - 16 * Math.cos(ang - 0.5), tip[1] - 16 * Math.sin(ang - 0.5));
    x.lineTo(tip[0] - 16 * Math.cos(ang + 0.5), tip[1] - 16 * Math.sin(ang + 0.5));
    x.fill();
    // 球路名稱放在畫面左側（不擋住畫面中間球飛行 / 滾動的動畫）；手指軌跡很快就淡掉
    const tag = document.getElementById('shape-tag');
    tag.innerHTML = `<b style="color:${col}">${c.shape.en.toUpperCase()}</b><span>${c.shape.zh}　${c.deg >= 0 ? '偏右' : '偏左'} ${Math.abs(c.deg).toFixed(0)}°</span>`;
    tag.classList.remove('show'); void tag.offsetWidth; tag.classList.add('show');
    clearTimeout(this.tagTimer);
    this.tagTimer = setTimeout(() => tag.classList.remove('show'), 2600);
    this.fadeTimer = setTimeout(() => this.trail.classList.add('fade'), 700);
  }
}

export const SHAPES = {
  straight: { key: 'straight', en: 'Straight', zh: '直球', color: '#9fd18a' },
  draw: { key: 'draw', en: 'Draw', zh: '小左曲', color: '#e7c46e' },
  fade: { key: 'fade', en: 'Fade', zh: '小右曲', color: '#e7c46e' },
  hook: { key: 'hook', en: 'Hook', zh: '左曲', color: '#e2786b' },
  slice: { key: 'slice', en: 'Slice', zh: '右曲', color: '#e2786b' },
  pull: { key: 'pull', en: 'Pull', zh: '推偏左', color: '#e7c46e' },
  push: { key: 'push', en: 'Push', zh: '推偏右', color: '#e7c46e' },
};

// 每 6px 重新取樣，再做 7 點移動平均（保留頭尾）
function smoothPath(raw) {
  const pts = [raw[0]];
  for (const p of raw) {
    const l = pts[pts.length - 1];
    const d = Math.hypot(p[0] - l[0], p[1] - l[1]);
    if (d >= 6) {
      const k = Math.floor(d / 6);
      for (let i = 1; i <= k; i++) pts.push([l[0] + (p[0] - l[0]) * i / k, l[1] + (p[1] - l[1]) * i / k]);
    }
  }
  const last = raw[raw.length - 1];
  if (pts.length === 1 || pts[pts.length - 1] !== last) pts.push(last);
  if (pts.length < 5) return pts;
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    let sx = 0, sy = 0, c = 0;
    for (let k = -3; k <= 3; k++) { const q = pts[Math.min(pts.length - 1, Math.max(0, i + k))]; sx += q[0]; sy += q[1]; c++; }
    return [sx / c, sy / c];
  });
}
