// 音效：全部用 WebAudio 即時合成，不需要音效檔
let ctx = null;
let enabled = true;

function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export const setSound = v => { enabled = v; };
export const unlockAudio = () => ac();

function noise(c, dur) {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = b;
  return s;
}

function env(c, node, t0, a, peak, dec) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
  node.connect(g);
  g.connect(c.destination);
  return g;
}

export function playHit(kind = 'iron', strength = 1) {
  const c = enabled && ac();
  if (!c) return;
  const t = c.currentTime;
  const n = noise(c, 0.25);
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = kind === 'driver' ? 2600 : kind === 'putter' ? 1800 : 3600;
  f.Q.value = kind === 'driver' ? 1.2 : 2.5;
  n.connect(f);
  env(c, f, t, 0.001, 0.9 * strength, kind === 'putter' ? 0.05 : 0.14);
  n.start(t);
  const o = c.createOscillator();
  o.frequency.setValueAtTime(kind === 'driver' ? 900 : kind === 'putter' ? 1200 : 1500, t);
  o.frequency.exponentialRampToValueAtTime(300, t + 0.08);
  env(c, o, t, 0.001, 0.25 * strength, 0.08);
  o.start(t); o.stop(t + 0.2);
}

export function playCup() {
  const c = enabled && ac();
  if (!c) return;
  [0, 0.09, 0.16].forEach((dt, i) => {
    const t = c.currentTime + dt;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 520 - i * 60;
    env(c, o, t, 0.002, 0.25 / (i + 1), 0.12);
    o.start(t); o.stop(t + 0.2);
  });
}

export function playSplash() {
  const c = enabled && ac();
  if (!c) return;
  const t = c.currentTime;
  const n = noise(c, 0.9);
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(2000, t);
  f.frequency.exponentialRampToValueAtTime(300, t + 0.7);
  n.connect(f);
  env(c, f, t, 0.01, 0.6, 0.7);
  n.start(t);
}

export function playThud(strength = 0.5) {
  const c = enabled && ac();
  if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(60, t + 0.1);
  env(c, o, t, 0.002, 0.3 * strength, 0.12);
  o.start(t); o.stop(t + 0.2);
}

export function playLeaves() {
  const c = enabled && ac();
  if (!c) return;
  const t = c.currentTime;
  const n = noise(c, 0.5);
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 3000;
  n.connect(f);
  env(c, f, t, 0.02, 0.35, 0.4);
  n.start(t);
}

// 老鷹 / 信天翁慶祝：觀眾歡呼（濾波雜訊慢慢升起再退）+ 上行和弦鐘聲
export function playCheer() {
  const c = enabled && ac();
  if (!c) return;
  const t = c.currentTime;
  const n = noise(c, 3);
  const f = c.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.6;
  n.connect(f);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.9);
  f.connect(g); g.connect(c.destination);
  n.start(t);
  [523, 659, 784, 1047].forEach((hz, i) => {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz;
    env(c, o, t + i * 0.12, 0.005, 0.18, 0.9);
    o.start(t + i * 0.12); o.stop(t + i * 0.12 + 1);
  });
}
