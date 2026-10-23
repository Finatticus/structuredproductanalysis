// 回合流程：洞 → 輪到誰 → 瞄準/選桿/揮桿 → 物理模擬 → 播放 → 判定（罰桿、OK 推、撿球）→ 下一位/下一洞
// 單人時本機就是「權威端」；雙人時主機是權威端，客人只送揮桿輸入、接收結果。
import * as THREE from 'three';
import { buildHole } from './terrain.js';
import { simulate, makeLaunch, distanceTable, airDensity, SURF } from './physics.js';
import { CLUBS, clubById, clubIndex } from './clubs.js';
import { courseById, teeYards } from './courses.js';
import { makeRng, hashStr, toYd, YD, MPH, FT, clamp, lerp, rad, smooth, fmtToPar, escapeHtml } from './util.js';
import { ProceduralGolfer, MixamoGolfer } from './character.js';
import { CONFIG } from './config.js';
import { SwingInput } from './input.js';
import * as sfx from './audio.js';

const WIND = { calm: [0, 0], light: [2, 6], normal: [6, 12], strong: [12, 22] };
const UPV = new THREE.Vector3(0, 1, 0);
const $ = id => document.getElementById(id);
// 推桿刻度（碼）：拉到底 = 平地滾這麼遠。一般最長 15 碼，超過才用 20 / 25 碼
const PUTT_SCALES = [3, 5, 8, 10, 12, 15, 20, 25].map(y => y * YD);
const SCORE_NAME = { '-4': '信天翁 Condor', '-3': '信天翁 Albatross', '-2': '老鷹 Eagle', '-1': '小鳥 Birdie', '0': '平標準桿 Par', '1': '柏忌 Bogey', '2': '雙柏忌 Double Bogey', '3': '三柏忌 Triple Bogey' };

export class Game {
  constructor(world, hud, ui) {
    this.world = world;
    this.hud = hud;
    this.ui = ui;
    this.cam = { pos: new THREE.Vector3(0, 30, 30), look: new THREE.Vector3(), dpos: new THREE.Vector3(), dlook: new THREE.Vector3(), k: 3, mode: 'address' };
    this.input = new SwingInput($('game-layer'), {
      onStart: () => this.hud.hideShotData(),
      onAim: dx => this.nudgeAim(dx * 0.05),
      onBack: p => this.onBack(p),
      onThrough: c => this.hud.setPower(this.power, c),
      onSwing: s => this.onSwing(s),
      onCancel: () => this.onCancel(),
    });
    this.bindButtons();
    this.running = false;
    this.last = performance.now();
    const loop = now => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      requestAnimationFrame(loop);
      // 洞還在載入時不更新；單一幀出錯也不能讓整個迴圈停掉
      if (this.running && this.ready) {
        try { this.update(dt); } catch (e) { console.error(e); }
      }
    };
    requestAnimationFrame(loop);
  }

  bindButtons() {
    const hold = (id, fn) => {
      const b = $(id);
      let t = null;
      const start = e => { e.preventDefault(); e.stopPropagation(); fn(); t = setInterval(fn, 90); };
      const stop = () => clearInterval(t);
      b.addEventListener('pointerdown', start);
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, stop));
    };
    hold('btn-aim-l', () => this.nudgeAim(-0.5));
    hold('btn-aim-r', () => this.nudgeAim(0.5));
    $('btn-club-prev').onclick = () => this.cycleClub(-1);
    $('btn-club-next').onclick = () => this.cycleClub(1);
    $('c-rail').onclick = e => { const id = e.target.dataset && e.target.dataset.club; if (id) this.selectClub(id); };
    $('btn-view').onclick = () => { if (this.canControl()) this.cam.mode = this.cam.mode === 'overview' ? 'address' : 'overview'; };
    $('btn-mulligan').onclick = () => this.mulligan();
    $('minimap').addEventListener('click', e => {
      if (!this.canControl()) return;
      const r = e.currentTarget.getBoundingClientRect();
      const w = this.hud.miniToWorld(e.clientX - r.left, e.clientY - r.top);
      if (w) this.aimAt(w[0], w[1]);
    });
    $('game-layer').addEventListener('click', () => { if (this.flight) this.flight.speed = 3; if (this.intro) this.intro.t = 99; });
  }

  // ---------------- 回合開始 ----------------
  async start(cfg, players, net = null, isHost = true) {
    this.cfg = cfg;
    this.net = net;
    this.authority = !net || isHost;
    this.isHost = isHost;
    const base = courseById(cfg.courseId);
    this.course = { ...base, stimp: Number(cfg.stimp) > 0 ? Number(cfg.stimp) : base.stimp };
    this.holeList = cfg.practice ? [cfg.startHole || 0] : cfg.holes === 'front' ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : cfg.holes === 'back' ? [9, 10, 11, 12, 13, 14, 15, 16, 17] : [...Array(18).keys()];
    this.seed = cfg.seed;
    const rng = makeRng(cfg.seed);
    const range = cfg.wind === 'course' || !WIND[cfg.wind] ? this.course.wind : WIND[cfg.wind];
    this.windBase = { dir: rng() * Math.PI * 2, mph: lerp(range[0], range[1], rng()) };
    this.temp = this.course.temp + (rng() - 0.5) * 6;
    this.rho = airDensity(this.course.altitude, this.temp);
    this.players = players.map((p, i) => {
      const golfer = this.makeGolfer(p.look);
      this.world.scene.add(golfer.object);
      golfer.setVisible(false);
      return {
        ...p, idx: i, golfer, table: distanceTable(p.stats, CLUBS, this.course, this.rho),
        scores: [], putts: [], pars: [], fwHit: 0, fwTotal: 0, gir: 0, mulligans: cfg.mulligans || 0,
      };
    });
    this.matchStatus = 0;
    this.k = 0;
    this.shotNo = 0;
    // 重置上一回合留下的狀態（離開後再進來不能沿用）
    this.ready = false;
    this.cur = undefined;
    this.intro = null;
    this.flight = null;
    this.swingAnim = false;
    this.holeDone = false;
    this.lastShotUndo = null;
    this.running = true;
    this.hud.show(true);
    this.pendingState = null;
    if (net) net.on(m => this.onNet(m));
    await this.loadHole(0);
  }

  makeGolfer(look) {
    if (CONFIG.CHARACTER.mode === 'mixamo') {
      const g = new MixamoGolfer(look, CONFIG.CHARACTER.mixamo);
      g.load().catch(err => {
        console.warn('Mixamo 角色載入失敗，改用內建角色', err);
        this.hud.toast('Mixamo 角色載入失敗，已改用內建角色', 3500);
        g.object.add(g.fallback.object);
        g.ready = false;
      });
      // 載入完成前先用內建角色
      const proxy = {
        object: g.object,
        setLook: l => g.setLook(l),
        setup: (...a) => (g.ready ? g.setup(...a) : (g.object.add(g.fallback.object), g.fallback.object.position.set(0, 0, 0), g.fallback.setup(...a))),
        setBackswing: (...a) => (g.ready ? g.setBackswing(...a) : g.fallback.setBackswing(...a)),
        swing: cb => (g.ready ? g.swing(cb) : g.fallback.swing(cb)),
        update: dt => (g.ready ? g.update(dt) : g.fallback.update(dt)),
        setVisible: v => { g.object.visible = v; },
      };
      return proxy;
    }
    return new ProceduralGolfer(look);
  }

  get holeNo() { return this.holeList[this.k] + 1; }

  async loadHole(k) {
    this.ready = false;
    this.k = k;
    const idx = this.holeList[k];
    this.ui.loading(true, `第 ${idx + 1} 洞 準備中…`);
    this.hud.hideShotData();
    await new Promise(r => setTimeout(r, 30));
    this.hole = buildHole(this.course, idx, { pinSeed: this.seed + idx * 31 });
    await this.world.loadHole(this.hole);
    const rng = makeRng(this.seed + idx * 977);
    const dir = this.windBase.dir + (rng() - 0.5) * rad(70);
    const mph = Math.max(0, this.windBase.mph * (0.75 + rng() * 0.5));
    this.wind = [Math.sin(dir) * mph * MPH, -Math.cos(dir) * mph * MPH];
    const tee = this.hole.teePos(this.cfg.tee);
    for (const p of this.players) {
      Object.assign(p, { ball: tee.slice(), lie: SURF.TEE, strokes: 0, holed: false, holePutts: 0, girDone: false, prev: null, picked: false });
      p.pars[k] = this.hole.par;
    }
    const yd = teeYards(this.course, idx, this.cfg.tee);
    this.hud.setHole(this.hole, idx + 1, yd, this.course.name);
    this.ui.loading(false);
    this.ready = true;
    this.world.clearTracer();
    this.flight = null;
    this.holeDone = false;
    this.honor = this.honorOrder();
    // 開場：從果嶺上空飛回發球台
    const pin = this.hole.pin, ph = this.hole.height(pin[0], pin[1]);
    const t0 = new THREE.Vector3(...tee);
    const back = new THREE.Vector3(pin[0] - t0.x, 0, pin[1] - t0.z).normalize();
    this.intro = {
      t: 0, dur: 3.4,
      p0: new THREE.Vector3(pin[0], ph, pin[1]).addScaledVector(back, 45).add(new THREE.Vector3(0, 38, 0)),
      l0: new THREE.Vector3(pin[0], ph, pin[1]).addScaledVector(back, -60),
    };
    this.hud.toast(`<small>第 ${idx + 1} 洞</small><b>PAR ${this.hole.par} · ${yd} Y</b>`, 2600, 'big');
    if (this.authority) this.nextTurn();
  }

  honorOrder() {
    const order = this.players.map(p => p.idx);
    if (this.k > 0) order.sort((a, b) => (this.players[a].scores[this.k - 1] || 99) - (this.players[b].scores[this.k - 1] || 99));
    return order;
  }

  // 權威端決定下一位
  pickNext() {
    const live = this.players.filter(p => !p.holed);
    if (!live.length) return -1;
    const onTee = live.filter(p => p.strokes === 0);
    if (onTee.length) return this.honor.find(i => onTee.includes(this.players[i]));
    let best = null, bd = -1;
    for (const p of live) { const d = this.hole.distToPin(p.ball[0], p.ball[2]); if (d > bd) { bd = d; best = p; } }
    return best.idx;
  }

  nextTurn() {
    const n = this.pickNext();
    const state = this.serialize(n);
    if (this.net) this.net.send({ t: 'state', state });
    this.applyState(state);
  }

  serialize(turn) {
    return {
      k: this.k, turn, shotNo: this.shotNo, matchStatus: this.matchStatus,
      players: this.players.map(p => ({ ball: p.ball, lie: p.lie, strokes: p.strokes, holed: p.holed, holePutts: p.holePutts, girDone: p.girDone, prev: p.prev, scores: p.scores, putts: p.putts, fwHit: p.fwHit, fwTotal: p.fwTotal, gir: p.gir, mulligans: p.mulligans, picked: p.picked })),
    };
  }

  applyState(s) {
    if (this.flight || this.swingAnim) { this.pendingState = s; return; }
    this.shotNo = s.shotNo;
    this.matchStatus = s.matchStatus;
    s.players.forEach((q, i) => Object.assign(this.players[i], q));
    if (s.turn < 0) { this.endHole(); return; }
    this.beginTurn(s.turn);
  }

  // ---------------- 一桿的準備 ----------------
  beginTurn(i) {
    this.cur = i;
    const p = this.players[i];
    for (const q of this.players) q.golfer.setVisible(q === p);
    this.world.clearTracer();
    this.world.setBall(p.ball[0], p.ball[1], p.ball[2]);
    p.lie = this.hole.surface(p.ball[0], p.ball[2]);
    const dist = this.distPin(p);
    this.club = this.autoClub(p, dist);
    this.aim = this.defaultAim(p, this.club);
    this.power = 0;
    this.curve = 0;
    this.puttScale = this.calcPuttScale(p);
    this.setupGolfer();
    this.cam.mode = 'address';
    this.world.greenGrid.visible = p.lie === SURF.GREEN || (this.club.putter && p.lie === SURF.FRINGE);
    this.refreshHud();
    const mine = this.canControl();
    this.input.enabled = mine;
    this.hud.enableControls(mine);
    this.input.putt = !!this.club.putter;
    this.hud.swingHint(mine ? '往下拉上桿（決定力道），快速往上滑出桿；左右滑調方向' : `等待 ${p.user} 擊球…`);
    $('btn-mulligan').classList.toggle('hidden', !(mine && !this.net && p.mulligans > 0 && this.lastShotUndo));
  }

  canControl() {
    const p = this.players && this.players[this.cur];
    return !!p && p.local && !this.flight && !this.swingAnim && !this.holeDone && !this.intro;
  }

  distPin(p) { return this.hole.distToPin(p.ball[0], p.ball[2]); }

  autoClub(p, dist) {
    const lie = p.lie;
    if (lie === SURF.GREEN || (lie === SURF.FRINGE && dist < 20)) return clubById('PT');
    if (lie === SURF.SAND && dist < 55) return clubById('SW');
    const elev = this.hole.height(...this.hole.pin) - p.ball[1];
    const need = dist + elev * 0.9;
    const keep = lie === SURF.ROUGH ? 0.9 : lie === SURF.DEEP ? 0.7 : lie === SURF.SAND ? 0.8 : 1;
    if (p.strokes === 0 && this.hole.par >= 4 && need > p.table.D.total * 0.85) return clubById('D');
    const cands = CLUBS.filter(c => !c.putter && (c.id !== 'D' || p.strokes === 0));
    for (let i = cands.length - 1; i >= 0; i--) {
      const c = cands[i];
      if (p.table[c.id].carry * keep >= need - 3) return c;
    }
    return lie === SURF.TEE ? clubById('D') : lie === SURF.ROUGH || lie === SURF.DEEP ? clubById('4H') : clubById('3W');
  }

  expectedTotal(p, club) {
    if (club.putter) return this.distPin(p);
    const t = p.table[club.id];
    const keep = p.lie === SURF.ROUGH ? 0.88 : p.lie === SURF.DEEP ? 0.65 : p.lie === SURF.SAND ? 0.75 : 1;
    return t.total * keep;
  }

  defaultAim(p, club) {
    const [bx, , bz] = p.ball;
    const [px, pz] = this.hole.pin;
    const dPin = Math.hypot(px - bx, pz - bz);
    const tot = this.expectedTotal(p, club);
    let tx = px, tz = pz;
    if (!club.putter && dPin > tot + 12) {
      // 打不到果嶺時瞄球道中線上、預估總距離的位置
      const s0 = this.hole.near(bx, -bz).s;
      let best = null;
      for (let s = Math.max(0, s0); s <= this.hole.L; s += 2) {
        const c = this.hole.centerAt(s);
        const d = Math.hypot(c[0] - bx, c[1] - bz);
        if (d >= tot) { best = c; break; }
      }
      if (best) { tx = best[0]; tz = best[1]; }
    }
    if (club.putter) return this.puttAim(p, tx, tz);
    return Math.atan2(tx - bx, -(tz - bz));
  }

  // 推桿預設：對準洞口（不幫玩家讀線，讀果嶺是素質的一部分）
  puttAim(p, tx, tz) { return Math.atan2(tx - p.ball[0], -(tz - p.ball[2])); }

  calcPuttScale(p) {
    const d = this.distPin(p);
    const elev = this.hole.height(...this.hole.pin) - p.ball[1];
    const eff = d * 1.2 + Math.max(0, elev) * 8;
    return PUTT_SCALES.find(s => s >= eff) || PUTT_SCALES[PUTT_SCALES.length - 1];
  }

  setupGolfer() {
    const p = this.players[this.cur];
    const pos = new THREE.Vector3(...p.ball);
    p.golfer.setup(pos, this.aim, this.club.icon);
    p.golfer.setVisible(true);
  }

  refreshHud() {
    const p = this.players[this.cur];
    const dist = this.distPin(p);
    this.hud.setPlayer(p, p.strokes, this.canControl(), this.players.length > 1);
    this.hud.setClub(this.club, p.table, this.canControl());
    const pinH = this.hole.height(...this.hole.pin);
    this.hud.setWind(this.wind, this.aim, this.temp, pinH - p.ball[1], this.course.stimp, this.course.firm);
    const carry = this.estCarry(p, Math.max(this.power, 1));
    this.hud.setLie(p.lie, dist, carry, this.club.putter ? Math.round(toYd(this.puttScale)) : 0);
    this.hud.setPower(this.power, this.curve, this.club.putter ? toYd(this.power * this.puttScale).toFixed(1) + ' Y' : null);
    this.updateTarget();
    this.updatePlayersHud();
  }

  updatePlayersHud() {
    const list = this.players.map(p => ({ user: p.user, scores: p.scores, pars: p.pars, current: p.idx === this.cur }));
    if (this.cfg.mode === 'match' && this.players.length === 2) {
      const m = this.matchStatus;
      list.matchText = m === 0 ? 'ALL SQUARE' : `${escapeHtml(this.players[m > 0 ? 0 : 1].user)} ${Math.abs(m)} UP`;
    }
    this.hud.setPlayers(list, this.hole.par, this.cfg.mode);
  }

  estCarry(p, power) {
    if (this.club.putter) return 0;
    const t = p.table[this.club.id];
    const keep = p.lie === SURF.ROUGH ? 0.88 : p.lie === SURF.DEEP ? 0.65 : p.lie === SURF.SAND ? 0.75 : 1;
    return t.carry * keep * Math.pow(clamp(power, 0.05, 1.1), 1.08);
  }

  updateTarget() {
    const p = this.players[this.cur];
    if (!p) return;
    const d = [Math.sin(this.aim), -Math.cos(this.aim)];
    if (this.club.putter) {
      this.world.setTarget(0, 0, 1, false);
      this.updatePuttLine();
      this.targetPt = [p.ball[0] + d[0] * this.puttScale * Math.max(this.power, 0.5), p.ball[2] + d[1] * this.puttScale * Math.max(this.power, 0.5)];
    } else {
      this.world.setPuttLine(null);
      const c = this.estCarry(p, this.power > 0.02 ? this.power : 1);
      const tx = p.ball[0] + d[0] * c, tz = p.ball[2] + d[1] * c;
      this.world.setTarget(tx, tz, clamp(c / 60, 0.6, 3.5), true);
      this.targetPt = [tx, tz];
    }
    this.hud.drawMini(this.hole, this.world.colorCanvas, p.ball, this.targetPt, this.players.map(q => ({ ball: q.ball, holed: q.holed, current: q.idx === this.cur })));
  }

  // 推桿預測線：無誤差模擬，只顯示「讀果嶺」素質允許的長度
  updatePuttLine() {
    const p = this.players[this.cur];
    if (!this.club.putter || !this.canControl()) { this.world.setPuttLine(null); return; }
    const pw = this.power > 0.02 ? this.power : clamp(this.distPin(p) / this.puttScale, 0.1, 1);
    const zero = Object.assign(() => 0.5, { normal: () => 0 });
    const l = makeLaunch({ power: pw, curve: 0, aimYaw: this.aim }, { club: this.club, lie: p.lie, stats: { ...p.stats, touch: 99, line: 99, mental: 99 }, rng: zero, stimp: this.course.stimp, puttScale: this.puttScale, distToPin: 0 });
    const r = simulate({ ...l, pos: p.ball }, { rho: this.rho, wind: [0, 0], rng: zero }, this.hole);
    const maxLen = 1 + (p.stats.reading || 50) * 0.08;
    const pts = [];
    let acc = 0;
    for (let i = 1; i < r.frames.length; i++) {
      const a = r.frames[i - 1], b = r.frames[i];
      acc += Math.hypot(b[1] - a[1], b[3] - a[3]);
      if (acc > maxLen) break;
      if (i % 2 === 0) pts.push([b[1], b[2] - 0.02, b[3]]);
    }
    this.world.setPuttLine(pts);
  }

  // ---------------- 操作 ----------------
  nudgeAim(degDelta) {
    if (!this.canControl()) return;
    this.aim += rad(degDelta) * (this.club.putter ? 0.4 : 1);
    this.afterAimChange();
  }

  aimAt(x, z) {
    const p = this.players[this.cur];
    this.aim = Math.atan2(x - p.ball[0], -(z - p.ball[2]));
    this.afterAimChange();
  }

  afterAimChange() {
    this.setupGolfer();
    this.refreshHud();
    this.sendAimPreview();
  }

  sendAimPreview() {
    if (!this.net) return;
    const now = performance.now();
    if (now - (this.lastAimSend || 0) < 200) return;
    this.lastAimSend = now;
    this.net.send({ t: 'aim', p: this.cur, yaw: this.aim, club: this.club.id, power: this.power }, { volatile: true });
  }

  cycleClub(dir) {
    if (!this.canControl()) return;
    let i = clubIndex(this.club.id) + dir;
    i = (i + CLUBS.length) % CLUBS.length;
    this.selectClub(CLUBS[i].id);
  }

  selectClub(id) {
    if (!this.canControl()) return;
    const prevPutt = this.club.putter;
    this.club = clubById(id);
    if (this.club.putter !== prevPutt) this.aim = this.defaultAim(this.players[this.cur], this.club);
    this.world.greenGrid.visible = this.club.putter;
    this.input.putt = !!this.club.putter;
    this.afterAimChange();
  }

  onBack(p) {
    if (!this.canControl()) return;
    this.power = p;
    this.players[this.cur].golfer.setBackswing(p, p);
    this.hud.setPower(p, 0, this.club.putter ? toYd(p * this.puttScale).toFixed(1) + ' Y' : null);
    const now = performance.now();
    if (now - (this.lastTargetUpd || 0) > 60) { this.lastTargetUpd = now; this.updateTarget(); }
    this.sendAimPreview();
  }

  onCancel() {
    this.power = 0;
    if (this.players[this.cur]) this.setupGolfer();
    this.refreshHud();
  }

  onSwing({ power, curve }) {
    if (!this.canControl() || power < 0.03) { this.onCancel(); return; }
    sfx.unlockAudio();
    this.input.enabled = false;
    this.hud.enableControls(false);
    const input = { power, curve, aimYaw: this.aim, club: this.club.id };
    if (this.authority) this.executeShot(this.cur, input);
    else { this.swingAnim = true; this.net.send({ t: 'swing', p: this.cur, input }); this.players[this.cur].golfer.swing(() => {}); }
  }

  mulligan() {
    const u = this.lastShotUndo;
    if (!u || this.net) return;
    const p = this.players[u.p];
    if (p.mulligans <= 0) return;
    Object.assign(p, JSON.parse(u.state));
    p.mulligans--;
    this.lastShotUndo = null;
    this.hud.toast(`重打 Mulligan（剩 ${p.mulligans} 次）`);
    this.beginTurn(u.p);
  }

  // ---------------- 權威端：計算一桿 ----------------
  executeShot(pi, input) {
    const p = this.players[pi];
    this.shotNo++;
    const rng = makeRng((this.seed ^ hashStr(this.holeList[this.k] + ':' + this.shotNo + ':' + pi)) >>> 0);
    const club = clubById(input.club);
    const lie = this.hole.surface(p.ball[0], p.ball[2]);
    const n = this.hole.normal(p.ball[0], p.ball[2]);
    const dist = this.distPin(p);
    const pressure = (lie === SURF.GREEN && p.strokes + 1 <= this.hole.par) || this.holeNo >= 16 || this.cfg.mode === 'match';
    const launch = makeLaunch(input, { club, lie, stats: p.stats, rng, pressure, distToPin: dist, slope: Math.acos(clamp(n[1], 0, 1)), stimp: this.course.stimp, puttScale: this.puttScale });
    const gust = 1 + rng.normal() * 0.12;
    const res = simulate({ ...launch, pos: p.ball.slice() }, { rho: this.rho, wind: [this.wind[0] * gust, this.wind[1] * gust], rng }, this.hole);
    const msg = {
      t: 'shot', p: pi, input,
      launch: { launchDeg: launch.launchDeg, spin: launch.spin, axisDeg: launch.axisDeg, ...launch.info },
      res: {
        frames: res.frames.filter((_, i) => i % 2 === 0 || i === res.frames.length - 1).map(f => f.map(v => Math.round(v * 1000) / 1000)),
        events: res.events.filter(e => e.type !== 'bounce' || e.speed > 1.5).slice(0, 12), result: res.result, end: res.end, carry: res.carry, total: res.total,
        offline: res.offline, apex: res.apex, descent: res.descent, flightTime: res.flightTime, duration: res.duration,
      },
    };
    if (!this.net) this.lastShotUndo = { p: pi, state: JSON.stringify({ ball: p.ball, lie: p.lie, strokes: p.strokes, holePutts: p.holePutts, girDone: p.girDone, prev: p.prev, holed: false, picked: false }) };
    if (this.net) this.net.send(msg);
    this.playShot(msg);
  }

  // ---------------- 兩端：播放一桿 ----------------
  playShot(msg) {
    const p = this.players[msg.p];
    this.cur = msg.p;
    this.hud.enableControls(false);
    this.input.enabled = false;
    const club = clubById(msg.input.club);
    this.club = club;
    this.aim = msg.input.aimYaw;
    this.world.setTarget(0, 0, 1, false);
    this.world.setPuttLine(null);
    $('btn-mulligan').classList.add('hidden');
    const startFlight = () => {
      sfx.playHit(club.icon, clamp(msg.input.power, 0.3, 1));
      const f = msg.res.frames;
      this.flight = { msg, frames: f, t: 0, i: 0, speed: 1, events: msg.res.events.slice(), start: new THREE.Vector3(f[0][1], f[0][2], f[0][3]), putt: !!club.putter, short: msg.res.total < 45, landed: false, endHold: 0 };
      this.world.clearTracer();
      if (!club.putter && !this.flight.short) this.cam.mode = 'flight';
      else this.cam.mode = 'follow';
      this.cam.cut = !club.putter && !this.flight.short;
    };
    if (this.swingAnim && !this.authority) {
      // 客人自己的揮桿動畫已經在播，等它擊球後直接開始飛行
      this.swingAnim = false;
      startFlight();
      return;
    }
    p.golfer.setup(new THREE.Vector3(...p.ball), this.aim, club.icon);
    p.golfer.setBackswing(msg.input.power, msg.input.power);
    this.swingAnim = true;
    p.golfer.swing(() => { this.swingAnim = false; startFlight(); });
  }

  update(dt) {
    const p = this.players[this.cur];
    for (const q of this.players) q.golfer.update(dt);
    // 球的飛行播放
    const f = this.flight;
    if (f) {
      f.t += dt * f.speed;
      const fr = f.frames;
      while (f.i < fr.length - 2 && fr[f.i + 1][0] < f.t) f.i++;
      const a = fr[f.i], b = fr[Math.min(f.i + 1, fr.length - 1)];
      const k = clamp((f.t - a[0]) / ((b[0] - a[0]) || 1), 0, 1);
      const x = lerp(a[1], b[1], k), y = lerp(a[2], b[2], k), z = lerp(a[3], b[3], k);
      this.world.setBall(x, y, z);
      if (!f.putt) this.world.pushTracer(x, y, z);
      while (f.events.length && f.events[0].t <= f.t) {
        const e = f.events.shift();
        if (e.type === 'bounce') { sfx.playThud(Math.min(1, e.speed / 15)); f.landed = true; }
        else if (e.type === 'tree') sfx.playLeaves();
        else if (e.type === 'splash') sfx.playSplash();
        else if (e.type === 'cup') sfx.playCup();
      }
      f.vel = new THREE.Vector3(b[1] - a[1], b[2] - a[2], b[3] - a[3]).divideScalar((b[0] - a[0]) || 1);
      if (f.t >= fr[fr.length - 1][0]) {
        f.endHold += dt;
        if (f.endHold > (f.msg.res.result === 'holed' ? 1.4 : 1.0)) this.finishShot();
      }
    }
    this.updateCamera(dt);
    this.updateTags();
    this.world.frame(dt, this.wind);
  }

  finishShot() {
    const msg = this.flight.msg;
    this.flight = null;
    const club = clubById(msg.input.club);
    if (!club.putter && msg.res.result !== 'ob') this.hud.shotData(club, msg.launch, msg.res, this.wind);
    if (this.authority) this.resolve(msg);
    else if (this.pendingState) { const s = this.pendingState; this.pendingState = null; this.applyState(s); }
  }

  // ---------------- 權威端：判定 ----------------
  resolve(msg) {
    const p = this.players[msg.p];
    const r = msg.res;
    const club = clubById(msg.input.club);
    const lieBefore = p.lie;
    const firstShot = p.strokes === 0;
    const toasts = [];
    p.strokes++;
    if (club.putter && lieBefore === SURF.GREEN) p.holePutts++;
    const prevBall = p.ball.slice();
    if (r.result === 'holed') {
      p.holed = true;
      p.ball = r.end;
    } else if (r.result === 'water' || r.result === 'chasm') {
      p.strokes++;
      p.ball = this.dropPoint(r.frames, prevBall);
      toasts.push(r.result === 'water' ? '水障礙　罰 1 桿' : '掉進峽谷　罰 1 桿');
    } else if (r.result === 'ob') {
      p.strokes++;
      p.ball = prevBall;
      toasts.push('出界 OB　罰 1 桿，原地重打');
    } else {
      p.ball = r.end;
    }
    p.lie = this.hole.surface(p.ball[0], p.ball[2]);
    if (firstShot && this.hole.par >= 4) { p.fwTotal++; if (p.lie === SURF.FAIRWAY && r.result === 'rest') p.fwHit++; }
    if (!p.girDone && (p.lie === SURF.GREEN || p.holed) && p.strokes <= this.hole.par - 2) { p.girDone = true; p.gir++; }
    const gimme = (this.cfg.gimme || 0) * YD;
    if (!p.holed && gimme > 0 && p.lie === SURF.GREEN && this.distPin(p) <= gimme) {
      p.holed = true; p.strokes++; p.holePutts++;
      toasts.push('OK！　給推');
    }
    if (!p.holed && !this.cfg.practice && p.strokes >= this.hole.par * 2) {
      p.holed = true; p.picked = true; p.strokes = this.hole.par * 2;
      toasts.push(`已達 ${this.hole.par * 2} 桿，撿球`);
    }
    if (p.holed) {
      const diff = p.strokes - this.hole.par;
      if (!p.picked) toasts.push(p.strokes === 1 ? '一桿進洞！HOLE IN ONE!' : (SCORE_NAME[diff] || `+${diff}`));
      p.scores[this.k] = p.strokes;
      p.putts[this.k] = p.holePutts;
    }
    if (this.cfg.practice && p.holed) {
      toasts.push('練習模式：回到發球台');
      const tee = this.hole.teePos(this.cfg.tee);
      Object.assign(p, { ball: tee, lie: SURF.TEE, strokes: 0, holed: false, holePutts: 0, girDone: false, picked: false });
    }
    if (toasts.length) { if (this.net) this.net.send({ t: 'toast', text: toasts.join('<br>') }); this.hud.toast(toasts.join('<br>'), 2600, p.holed ? 'big' : ''); }
    setTimeout(() => this.nextTurn(), toasts.length ? 1400 : 500);
  }

  // 落水：找到球最後一次在陸地上的位置，往回退 2 公尺抛球
  dropPoint(frames, prev) {
    let x = prev[0], z = prev[2];
    for (let i = frames.length - 1; i >= 0; i--) {
      const fx = frames[i][1], fz = frames[i][3];
      const s = this.hole.surface(fx, fz);
      if (s !== SURF.WATER && s !== SURF.CHASM && s !== SURF.OB) { x = fx; z = fz; break; }
    }
    const dx = prev[0] - x, dz = prev[2] - z, l = Math.hypot(dx, dz) || 1;
    for (let back = 2; back < 60; back += 1.5) {
      const qx = x + dx / l * back, qz = z + dz / l * back;
      const s = this.hole.surface(qx, qz);
      if (s !== SURF.WATER && s !== SURF.CHASM && s !== SURF.OB) return [qx, this.hole.height(qx, qz) + 0.0213, qz];
    }
    return prev.slice();
  }

  // ---------------- 洞結束 / 回合結束 ----------------
  endHole() {
    if (this.holeDone) return;
    this.holeDone = true;
    this.input.enabled = false;
    if (this.cfg.mode === 'match' && this.players.length === 2) {
      const [a, b] = this.players.map(p => p.scores[this.k]);
      if (a < b) this.matchStatus++; else if (b < a) this.matchStatus--;
    }
    this.updatePlayersHud();
    const last = this.k >= this.holeList.length - 1;
    this.ui.showHoleResult(this, last).then(() => {
      if (last) this.endRound();
      else if (this.authority) { if (this.net) this.net.send({ t: 'next' }); this.loadHole(this.k + 1); }
    });
  }

  endRound() {
    this.running = false;
    this.ui.showRoundResult(this);
  }

  roundSummary(p) {
    const holes = this.holeList.length;
    const strokes = p.scores.reduce((s, v) => s + (v || 0), 0);
    const par = p.pars.reduce((s, v) => s + (v || 0), 0);
    return {
      course: this.course.name, holes, tee: this.cfg.tee, strokes, toPar: strokes - par,
      putts: p.putts.reduce((s, v) => s + (v || 0), 0), fairways: `${p.fwHit}/${p.fwTotal}`, gir: `${p.gir}/${holes}`,
      mode: this.players.length > 1 ? (this.cfg.mode === 'match' ? '比洞賽' : '比桿賽') : '單人',
      partners: this.players.filter(q => q !== p).map(q => q.user).join(','), scores: p.scores,
    };
  }

  quit() {
    this.running = false;
    this.ready = false;
    this.input.enabled = false;
    this.flight = null;
    this.swingAnim = false;
    if (this.players) for (const p of this.players) this.world.scene.remove(p.golfer.object);
    this.world.disposeHole();
    this.hud.show(false);
    if (this.net) { this.net.close(); this.net = null; }
  }

  // ---------------- 連線訊息 ----------------
  onNet(m) {
    if (!this.running) return;
    switch (m.t) {
      case 'swing':
        if (this.authority && m.p === this.cur && !this.players[m.p].local) this.executeShot(m.p, m.input);
        break;
      case 'shot':
        if (!this.authority) this.playShot(m);
        break;
      case 'state':
        if (!this.authority) {
          if (m.state.k !== this.k) { this.pendingState = m.state; return; }
          this.applyState(m.state);
        }
        break;
      case 'aim':
        if (m.p === this.cur && !this.players[m.p].local && !this.flight && !this.swingAnim) {
          this.aim = m.yaw;
          this.club = clubById(m.club);
          const p = this.players[m.p];
          p.golfer.setup(new THREE.Vector3(...p.ball), this.aim, this.club.icon);
          if (m.power > 0.02) p.golfer.setBackswing(m.power, m.power);
          this.updateTarget();
        }
        break;
      case 'toast':
        this.hud.toast(m.text, 2600);
        break;
      case 'next':
        if (!this.authority) {
          this.ui.closeHoleResult();
          this.loadHole(this.k + 1).then(() => { if (this.pendingState) { const s = this.pendingState; this.pendingState = null; this.applyState(s); } });
        }
        break;
      case 'leave':
        this.hud.toast('對方已離開遊戲', 4000);
        break;
    }
  }

  // ---------------- 鏡頭 ----------------
  updateCamera(dt) {
    const cam = this.cam, world = this.world, camera = world.camera;
    const p = this.players[this.cur];
    if (!p) return;
    const ball = world.ball.position;
    const d = new THREE.Vector3(Math.sin(this.aim), 0, -Math.cos(this.aim));
    const r = new THREE.Vector3(Math.cos(this.aim), 0, Math.sin(this.aim));
    let k = 3;
    if (this.intro) {
      const it = this.intro;
      it.t += dt;
      const addr = this.addressCam(p, d, r);
      const s = smooth(clamp(it.t / it.dur, 0, 1));
      cam.pos.copy(it.p0).lerp(addr.pos, s);
      cam.look.copy(it.l0).lerp(addr.look, s);
      camera.position.copy(cam.pos);
      camera.lookAt(cam.look);
      world.shadowFocus = cam.look.clone().lerp(ball, s);
      if (it.t >= it.dur) { this.intro = null; this.beginTurn(this.cur); }
      return;
    }
    const f = this.flight;
    if (cam.mode === 'address' || (!f && cam.mode !== 'overview')) {
      const a = this.addressCam(p, d, r);
      cam.dpos.copy(a.pos); cam.dlook.copy(a.look);
      k = 4;
    } else if (cam.mode === 'overview') {
      const tgt = this.targetPt ? new THREE.Vector3(this.targetPt[0], ball.y, this.targetPt[1]) : ball.clone().addScaledVector(d, 100);
      const D = Math.max(30, tgt.distanceTo(ball));
      cam.dpos.copy(ball).addScaledVector(d, -D * 0.25).add(new THREE.Vector3(0, D * 0.75 + 15, 0));
      cam.dlook.copy(ball).lerp(tgt, 0.6);
      k = 3;
    } else if (cam.mode === 'flight' && f) {
      if (f.t < 0.6) {
        // 擊球瞬間切到模擬器式「球後視角」
        cam.dpos.copy(f.start).addScaledVector(d, -4.2).add(new THREE.Vector3(0, 1.4, 0));
        cam.dlook.copy(ball);
        k = 30;
      } else {
        const v = f.vel ? f.vel.clone() : d.clone();
        v.y = 0;
        const sp = v.length();
        if (sp < 0.5) v.copy(d); else v.normalize();
        const hgt = ball.y - this.hole.height(ball.x, ball.z);
        const back = f.landed ? 9 : 15;
        cam.dpos.copy(ball).addScaledVector(v, -back).add(new THREE.Vector3(0, (f.landed ? 3.5 : 4.5) + hgt * 0.25, 0));
        cam.dlook.copy(ball);
        k = f.landed ? 1.6 : 2.4;
      }
    } else if (f) {
      // 推桿 / 短切：鏡頭留在後方，視線跟球
      cam.dpos.copy(f.start).addScaledVector(d, -2.8).addScaledVector(r, -0.4).add(new THREE.Vector3(0, f.putt ? 1.3 : 2.2, 0));
      const dd = ball.distanceTo(f.start);
      if (dd > 6) cam.dpos.lerp(ball.clone().addScaledVector(d, -3).add(new THREE.Vector3(0, 1.6, 0)), clamp((dd - 6) / 12, 0, 0.8));
      cam.dlook.copy(ball);
      k = 2;
    }
    if (cam.cut) { cam.pos.copy(cam.dpos); cam.look.copy(cam.dlook); cam.cut = false; }
    const a = 1 - Math.exp(-k * dt);
    cam.pos.lerp(cam.dpos, a);
    cam.look.lerp(cam.dlook, Math.min(1, a * 1.6));
    const gh = this.hole.height(cam.pos.x, cam.pos.z);
    if (cam.pos.y < gh + 0.6) cam.pos.y = gh + 0.6;
    camera.position.copy(cam.pos);
    camera.lookAt(cam.look);
    world.shadowFocus = f ? ball : p.golfer.object.position;
  }

  addressCam(p, d, r) {
    const b = new THREE.Vector3(...p.ball);
    const cam = this.world.camera;
    // 視角越窄鏡頭退越遠，讓角色在直式/橫式畫面裡大小差不多
    const k = Math.tan(31 * Math.PI / 180) / Math.tan(cam.fov / 2 * Math.PI / 180);
    const portrait = cam.aspect < 1;
    const at = (back, side, up, lookFwd, lookSide, lookUp) => ({
      pos: b.clone().addScaledVector(d, -back).addScaledVector(r, side).add(new THREE.Vector3(0, up, 0)),
      look: b.clone().addScaledVector(d, lookFwd).addScaledVector(r, lookSide).add(new THREE.Vector3(0, lookUp, 0)),
    });
    if (this.club.putter) return portrait ? at(2.6, 0.35, 1.3, 3.5, -0.2, 0) : at(2.4 * k, 0.5, 1.15 + 0.15 * k, 3.5, -0.3, 0);
    return portrait ? at(5.2, 0.1, 1.8, 30, -0.6, 1.2) : at(3.8 * k, 0.55 * k, 1.55 + 0.1 * k, 30, -1.5, 1.2);
  }

  updateTags() {
    const p = this.players[this.cur];
    if (!p || !this.hole) return;
    const [px, pz] = this.hole.pin;
    const ph = this.hole.height(px, pz);
    const dist = this.hole.distToPin(this.world.ball.position.x, this.world.ball.position.z);
    const txt = dist < 27 ? toYd(dist).toFixed(1) + ' Y' : Math.round(toYd(dist)) + ' Y';
    this.hud.tag('tag-pin', this.world.project(px, ph + 2.6, pz), txt);
    if (this.targetPt && !this.flight && !this.club.putter && this.canControl()) {
      const [tx, tz] = this.targetPt;
      const c = Math.hypot(tx - p.ball[0], tz - p.ball[2]);
      this.hud.tag('tag-land', this.world.project(tx, this.hole.height(tx, tz) + 0.5, tz), '落點 ' + Math.round(toYd(c)) + ' Y');
    } else this.hud.tag('tag-land', null);
  }
}
