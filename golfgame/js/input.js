// 揮桿手勢：在下半部「揮桿區」往下拉（上桿，拉越長越大力），再往上推（下桿擊球）。
// 往上推的方向偏右 → 右曲球、偏左 → 左曲球。上半部左右拖曳 = 調整瞄準方向。
import { clamp } from './util.js';

export class SwingInput {
  constructor(el, cb) {
    this.el = el;
    this.cb = cb;
    this.enabled = false;
    this.state = null;
    el.addEventListener('pointerdown', e => this.down(e));
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    window.addEventListener('pointercancel', e => this.cancel(e));
  }

  get maxDrag() { return clamp(window.innerHeight * 0.34, 140, 300); }

  down(e) {
    if (!this.enabled || this.state) return;
    if (e.target.closest('.hud-btn, .hud-panel, button, .minimap')) return;
    const rect = this.el.getBoundingClientRect();
    const inPad = e.clientY > rect.top + rect.height * 0.45;
    this.state = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, mode: inPad ? 'back' : 'aim', bottomY: e.clientY, bottomX: e.clientX, power: 0 };
    if (inPad) this.cb.onStart && this.cb.onStart(e.clientX, e.clientY);
    e.preventDefault();
  }

  move(e) {
    const s = this.state;
    if (!s || e.pointerId !== s.id) return;
    if (s.mode === 'aim') {
      this.cb.onAim && this.cb.onAim((e.clientX - s.lastX));
      s.lastX = e.clientX;
      return;
    }
    if (s.mode === 'back') {
      if (e.clientY >= s.bottomY) { s.bottomY = e.clientY; s.bottomX = e.clientX; }
      s.power = clamp((s.bottomY - s.y0) / this.maxDrag, 0, 1.1);
      this.cb.onBack && this.cb.onBack(s.power, e.clientX, e.clientY);
      // 從最低點往上推超過 14px → 進入下桿
      if (s.power > 0.04 && s.bottomY - e.clientY > 14) s.mode = 'through';
    }
    if (s.mode === 'through') {
      const curve = this.curveFrom(s, e.clientX, e.clientY);
      this.cb.onThrough && this.cb.onThrough(curve, e.clientX, e.clientY);
      // 推回起點上方就立刻擊球（不用等放開）
      if (e.clientY < s.y0 - 10) this.fire(e.clientX, e.clientY);
    }
  }

  curveFrom(s, x, y) {
    const dy = s.bottomY - y, dx = x - s.bottomX;
    if (dy < 8) return 0;
    let ang = Math.atan2(dx, dy) * 180 / Math.PI;
    if (Math.abs(ang) < 4) ang = 0;                     // 死區：小偏差視為直球
    else ang -= Math.sign(ang) * 4;
    return clamp(ang / 24, -1, 1);
  }

  fire(x, y) {
    const s = this.state;
    if (!s) return;
    const curve = this.curveFrom(s, x, y);
    // 推得太短（不到拉桿的 35%）會打不足
    const push = (s.bottomY - y) / Math.max(1, s.bottomY - s.y0);
    const power = s.power * clamp(0.75 + push * 0.7, 0.75, 1);
    this.state = null;
    this.cb.onSwing && this.cb.onSwing({ power, curve });
  }

  up(e) {
    const s = this.state;
    if (!s || e.pointerId !== s.id) return;
    if (s.mode === 'through') this.fire(e.clientX, e.clientY);
    else this.cancel(e);
  }

  cancel(e) {
    const s = this.state;
    if (!s || (e && e.pointerId !== s.id)) return;
    this.state = null;
    if (s.mode !== 'aim') this.cb.onCancel && this.cb.onCancel();
  }
}
