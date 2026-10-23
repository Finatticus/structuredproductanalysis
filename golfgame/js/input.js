// 揮桿手勢（比照真實揮桿：上桿可以慢，下桿要快）
//   往下拉 = 上桿，手指離起點越遠力道越大；慢慢往上移只是把力道收小，不會擊球。
//   要「快速」往上滑（下桿）才會出桿；放開或只是慢慢移動都不會擊球。
//   出桿那一段的方向決定曲球：直直往上 = 直球、偏右 = 右曲、偏左 = 左曲。
//   一開始就左右滑 = 調整瞄準方向。
// 擊球後在畫面上留下手指軌跡 2.5 秒（灰色 = 上桿、金色 = 出桿、虛線 = 正上方參考線）。
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
    while (s.samples.length > 2 && t - s.samples[0][0] > 400) s.samples.shift();
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
        // 出桿起點 = 最近 300ms 內最低（最深）的那一點，力道鎖定在那裡
        let bottom = s.samples[0];
        for (const p of s.samples) if (t - p[0] < 300 && p[2] > bottom[2]) bottom = p;
        const depth = Math.max(0, bottom[2] - s.y0);
        s.mode = 'strike';
        s.strike = { x: bottom[1], y: bottom[2], power: clamp(depth / this.maxDrag, 0, 1.1), depth, pathStart: s.path.length - 1 };
        this.cb.onBack && this.cb.onBack(s.strike.power);
      } else {
        // 上桿中：力道 = 目前手指往下的深度（往上移就變小）
        s.power = clamp((y - s.y0) / this.maxDrag, 0, 1.1);
        this.cb.onBack && this.cb.onBack(s.power);
        this.drawTrail(false);
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

  curveFrom(st, x, y) {
    const dy = st.y - y, dx = x - st.x;
    if (dy < 8) return 0;
    let ang = Math.atan2(dx, dy) * 180 / Math.PI;
    if (Math.abs(ang) < 4) ang = 0;             // 偏 4° 以內視為直球
    else ang -= Math.sign(ang) * 4;
    return clamp(ang / 24, -1, 1);
  }

  fire(x, y) {
    const s = this.state;
    if (!s) return;
    const st = s.strike;
    const curve = this.curveFrom(st, x, y);
    this.state = null;
    this.drawTrail(true, s, x, y, curve);
    this.cb.onSwing && this.cb.onSwing({ power: st.power, curve });
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

  drawTrail(final, s = this.state, ex, ey, curve) {
    if (!s) return;
    const [ox, oy] = this.sizeTrail();
    const x = this.tctx;
    x.clearRect(0, 0, this.trail.width, this.trail.height);
    x.lineCap = x.lineJoin = 'round';
    const pts = s.path.map(([px, py]) => [px - ox, py - oy]);
    const split = final && s.strike ? s.strike.pathStart : pts.length - 1;
    // 起點
    x.fillStyle = 'rgba(255,255,255,.6)';
    x.beginPath(); x.arc(s.x0 - ox, s.y0 - oy, 5, 0, Math.PI * 2); x.fill();
    // 上桿
    x.strokeStyle = 'rgba(255,255,255,.55)';
    x.lineWidth = 3;
    x.setLineDash([]);
    x.beginPath();
    pts.slice(0, split + 1).forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
    x.stroke();
    if (!final || !s.strike) return;
    const sx = s.strike.x - ox, sy = s.strike.y - oy;
    // 正上方參考線
    x.strokeStyle = 'rgba(255,255,255,.45)';
    x.lineWidth = 1.5;
    x.setLineDash([6, 6]);
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx, sy - Math.max(80, s.strike.depth + 40)); x.stroke();
    x.setLineDash([]);
    // 出桿軌跡
    x.strokeStyle = '#e7c46e';
    x.lineWidth = 5;
    x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 6;
    x.beginPath();
    x.moveTo(sx, sy);
    pts.slice(split + 1).forEach(([px, py]) => x.lineTo(px, py));
    x.lineTo(ex - ox, ey - oy);
    x.stroke();
    x.shadowBlur = 0;
    // 箭頭
    const ang = Math.atan2((ey - oy) - sy, (ex - ox) - sx);
    x.fillStyle = '#e7c46e';
    x.beginPath();
    x.moveTo(ex - ox, ey - oy);
    x.lineTo(ex - ox - 14 * Math.cos(ang - 0.45), ey - oy - 14 * Math.sin(ang - 0.45));
    x.lineTo(ex - ox - 14 * Math.cos(ang + 0.45), ey - oy - 14 * Math.sin(ang + 0.45));
    x.fill();
    // 標示偏角
    const deg = Math.atan2(ex - s.strike.x, s.strike.y - ey) * 180 / Math.PI;
    const label = Math.abs(curve) < 0.01 ? `直球　偏 ${Math.abs(deg).toFixed(0)}°` : `${curve > 0 ? '右曲' : '左曲'}　偏 ${deg > 0 ? '右' : '左'} ${Math.abs(deg).toFixed(0)}°`;
    x.font = '600 15px "Noto Sans TC", sans-serif';
    x.fillStyle = 'rgba(10,20,15,.75)';
    const w = x.measureText(label).width + 18;
    x.fillRect(sx + 14, sy - 30, w, 26);
    x.fillStyle = '#fff';
    x.fillText(label, sx + 23, sy - 12);
    this.fadeTimer = setTimeout(() => this.trail.classList.add('fade'), 2500);
  }
}
