// Mixamo 寫實角色：載入壓縮過的 model.glb + 共用動作（anims/*.fbx），自動校正揮桿時間點與球的位置
// 動作：preshot（走到球旁準備，播一次停在準備姿勢，點螢幕可跳過）、drive（所有全揮桿與切桿）、putt（推桿，直接從準備姿勢開始）
import * as THREE from 'three';
import { clamp, lerp } from './util.js';
import { ProceduralGolfer } from './character.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const ANIMS = ['preshot', 'drive', 'putt'];
const BALL_R = 0.021335;
const GRIP_TOP = 0.06;     // 握把頂端在兩手中心上方 6 公分
// 準備姿勢時球到腳尖連線的距離（公分）；動作是開球木桿的動作、雙手位置固定，所以靠這個決定球桿長度與傾斜角
const TOE_DIST = { driver: 92, wood: 87, iron: 78, wedge: 73, putter: 48 };

let GLTFLoaderC = null, FBXLoaderC = null, SkeletonUtilsM = null;
async function loaders() {
  if (!GLTFLoaderC) {
    GLTFLoaderC = (await import('three/addons/loaders/GLTFLoader.js')).GLTFLoader;
    FBXLoaderC = (await import('three/addons/loaders/FBXLoader.js')).FBXLoader;
    SkeletonUtilsM = await import('three/addons/utils/SkeletonUtils.js');
  }
}

// 動作檔所有角色共用，只載一次
let animPromise = null;
function loadAnims(base) {
  if (animPromise) return animPromise;
  animPromise = (async () => {
    await loaders();
    const ld = new FBXLoaderC();
    const clips = {};
    for (const k of ANIMS) {
      try {
        const f = await new Promise((res, rej) => ld.load(`${base}/${k}.fbx`, res, undefined, rej));
        if (f.animations && f.animations[0]) { clips[k] = f.animations[0]; clips[k].name = k; }
      } catch (e) { console.info('[Dixen] 沒有動作檔', k); }
    }
    if (!clips.drive) throw new Error('缺少 drive.fbx');
    return clips;
  })();
  return animPromise;
}

// 每個角色的模型與校正資料只做一次；多位玩家用同一角色時複製骨架
const modelCache = new Map();
function loadModel(def, animBase) {
  if (modelCache.has(def.id)) return modelCache.get(def.id);
  const p = (async () => {
    await loaders();
    const [gltf, clips] = await Promise.all([
      new Promise((res, rej) => new GLTFLoaderC().load(def.file, res, undefined, rej)),
      loadAnims(animBase),
    ]);
    const scene = gltf.scene;
    scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    // Mixamo 不同角色的骨頭名稱前綴可能是 mixamorig7、mixamorig10…，動作檔用的是 mixamorig，統一改名才對得上
    let prefix = null;
    scene.traverse(o => { if (!prefix && o.isBone && /Hips(_\d+)?$/.test(o.name)) prefix = o.name.replace(/Hips(_\d+)?$/, ''); });
    if (prefix && prefix !== 'mixamorig') scene.traverse(o => { if (o.name.startsWith(prefix)) o.name = 'mixamorig' + o.name.slice(prefix.length); });
    // 動作的腰部高度換算成這個角色的比例（高矮不同的角色腳才不會浮起來或陷進地裡）
    const hips = scene.getObjectByName('mixamorigHips');
    const hipsRest = hips ? hips.position.y : 99;
    const scaled = {};
    for (const k in clips) {
      const c = clips[k].clone();
      const animHips = c.tracks.find(t => t.name === 'mixamorigHips.position');
      if (animHips) {
        const k0 = hipsRest / (animHips.values[1] || hipsRest);
        for (let i = 0; i < animHips.values.length; i++) animHips.values[i] *= k0;
      }
      scaled[k] = c;
    }
    // 身高用原始網格的範圍量（蒙皮網格用 Box3.setFromObject 量會不準）
    let y0 = Infinity, y1 = -Infinity;
    scene.traverse(o => { if (o.isMesh) { o.geometry.computeBoundingBox(); y0 = Math.min(y0, o.geometry.boundingBox.min.y); y1 = Math.max(y1, o.geometry.boundingBox.max.y); } });
    const heightCm = y1 - y0;
    const calib = calibrate(scene, scaled);
    return { scene, clips: scaled, calib, heightCm };
  })();
  modelCache.set(def.id, p);
  return p;
}

// 握桿點 = 拳頭中心：指根四個關節 + 食指、中指彎起來的指節取平均（動作檔的手是握拳的，桿子要穿過這裡才像握住）
const GRIP_BONES = ['Index1', 'Middle1', 'Ring1', 'Pinky1', 'Index3', 'Middle3'];
const gripBones = (root, side) => GRIP_BONES.map(f => root.getObjectByName(`mixamorig${side}Hand${f}`)).filter(Boolean);
const _gp = V();
function gripOf(bones, out) {
  out.set(0, 0, 0);
  for (const b of bones) out.add(b.getWorldPosition(_gp));
  return out.multiplyScalar(1 / bones.length);
}

// 依手的軌跡找出每個揮桿動作的「準備 / 上桿頂點 / 擊球」時間，以及面向與目標方向
function calibrate(scene, clips) {
  const mixer = new THREE.AnimationMixer(scene);
  const R = scene.getObjectByName('mixamorigRightHand'), L = scene.getObjectByName('mixamorigLeftHand'), H = scene.getObjectByName('mixamorigHips');
  const FL = scene.getObjectByName('mixamorigLeftFoot'), FR = scene.getObjectByName('mixamorigRightFoot');
  const TL = scene.getObjectByName('mixamorigLeftToeBase'), TR = scene.getObjectByName('mixamorigRightToeBase');
  const GR = gripBones(scene, 'Right'), GL = gripBones(scene, 'Left');
  const out = {};
  const pr = V(), pl = V(), ph = V(), pfl = V(), pfr = V(), ptl = V(), ptr = V();
  for (const k in clips) {
    const clip = clips[k];
    const a = mixer.clipAction(clip);
    mixer.stopAllAction();
    a.reset().play();
    const dt = 1 / 60, S = [];
    for (let t = 0; t <= clip.duration + 1e-6; t += dt) {
      a.time = Math.min(t, clip.duration);
      mixer.update(0);
      scene.updateMatrixWorld(true);
      gripOf(GR, pr); gripOf(GL, pl); H.getWorldPosition(ph);
      const ql = new THREE.Quaternion(); L.getWorldQuaternion(ql);
      FL.getWorldPosition(pfl); FR.getWorldPosition(pfr); TL.getWorldPosition(ptl); TR.getWorldPosition(ptr);
      S.push({ t: a.time, hand: pr.clone().add(pl).multiplyScalar(0.5), r: pr.clone(), l: pl.clone(), hips: ph.clone(), ql, stance: pfl.clone().sub(pfr), toe: ptl.clone().add(ptr).multiplyScalar(0.5) });
    }
    const n = S.length;
    const speed = i => S[Math.min(n - 1, i + 1)].hand.distanceTo(S[Math.max(0, i - 1)].hand) / (2 * dt);
    const info = { duration: clip.duration };
    if (k === 'preshot') {
      const e = S[n - 1];
      info.endHips = e.hips; info.facing = facingOf(e);
      out[k] = info; a.stop(); continue;
    }
    // 擊球 = 手速最快的那一刻
    let iImp = 0, vmax = 0;
    for (let i = 1; i < n - 1; i++) { const s = speed(i); if (s > vmax) { vmax = s; iImp = i; } }
    // 頂點 = 擊球前 2.5 秒內手離擊球位置最遠的時刻
    let iTop = iImp, dmax = 0;
    for (let i = Math.max(0, iImp - Math.round(2.5 / dt)); i < iImp; i++) { const d = S[i].hand.distanceTo(S[iImp].hand); if (d > dmax) { dmax = d; iTop = i; } }
    // 準備 = 頂點前、手幾乎不動的最後一刻（找不到就取頂點前 1.5 秒）
    let iAddr = Math.max(0, iTop - Math.round(1.5 / dt));
    for (let i = iTop - 1; i > 0; i--) { if (speed(i) < 6) { iAddr = i; break; } if (S[iTop].t - S[i].t > 3) break; }
    // 擊球再修正：頂點之後 1 秒內、雙手回到準備位置最近的那一格（手速最快那格常常還在下桿途中，切桿特別明顯）
    let best = Infinity;
    for (let i = iTop + 1; i < Math.min(n, iTop + Math.round(1 / dt)); i++) { const d = S[i].hand.distanceTo(S[iAddr].hand); if (d < best) { best = d; iImp = i; } }
    // 收桿 = 擊球之後雙手停下來（連續 0.3 秒手速 < 12 cm/s）；動作檔後面常接走路或看球，不播
    let iFin = n - 1;
    for (let i = iImp + Math.round(0.3 / dt); i < n - 1; i++) {
      let still = true;
      for (let j = i; j < Math.min(n - 1, i + Math.round(0.3 / dt)); j++) if (speed(j) >= 12) { still = false; break; }
      if (still) { iFin = i; break; }
    }
    const ad = S[iAddr], im = S[iImp];
    info.addr = ad.t; info.top = S[iTop].t; info.impact = im.t; info.finish = S[iFin].t;
    info.facing = facingOf(ad);                                         // 面向球的方向
    info.target = UP.clone().cross(info.facing).normalize();             // 右手打者的目標 = 面向的左手邊
    info.addrHips = ad.hips; info.addrH = ad.hand; info.addrQL = ad.ql; info.addrToe = ad.toe;
    // 擊球瞬間的兩手位置（模型座標，公分），之後用來算桿頭位置 = 球的位置
    info.impR = im.r; info.impL = im.l; info.impH = im.hand; info.impQL = im.ql;
    out[k] = info;
    a.stop();
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  return out;
}

const horiz = v => { v.y = 0; return v.lengthSq() > 1e-6 ? v.normalize() : V(0, 0, 1); };
// 面向 = 兩腳連線（右腳 → 左腳 = 目標方向，跟目標線平行）轉 90 度；切桿時雙手會壓向目標，不能用「手 - 腰」判斷
function facingOf(f) {
  const tgt = horiz(f.stance.clone());
  const fc = tgt.clone().cross(UP).normalize();
  if (fc.dot(horiz(f.hand.clone().sub(f.hips))) < 0) fc.negate();   // 保險：一定是朝雙手那一側
  return fc;
}

export class MixamoGolfer {
  constructor(def, opts) {
    this.def = def;
    this.opts = opts;             // { animBase }
    this.clubMaker = new ProceduralGolfer({});   // 借用內建角色的球桿模型
    this.object = new THREE.Group();
    this.inner = new THREE.Group();      // 播放走位動作時用來對齊
    this.object.add(this.inner);
    this.ready = false;
    this.state = 'idle';
    this.finished = false;
  }

  async load() {
    const m = await loadModel(this.def, this.opts.animBase);
    await loaders();
    this.model = SkeletonUtilsM.clone(m.scene);
    this.clips = m.clips;
    this.calib = m.calib;
    this.inner.add(this.model);
    // 角色身高統一換算成 1.78 公尺左右（女生角色 def.height 可另外設定）
    this.scale = (this.def.height || 1.78) / (m.heightCm / 100) * 0.01;
    this.model.scale.setScalar(this.scale);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const k in this.clips) {
      const a = this.mixer.clipAction(this.clips[k]);
      a.clampWhenFinished = true;
      a.setLoop(THREE.LoopOnce, 1);
      this.actions[k] = a;
    }
    this.bR = this.model.getObjectByName('mixamorigRightHand');
    this.bL = this.model.getObjectByName('mixamorigLeftHand');
    this.gR = gripBones(this.model, 'Right'); this.gL = gripBones(this.model, 'Left');
    this.ready = true;
  }

  setLook() { /* 寫實角色的外觀由模型決定 */ }
  setVisible(v) { this.object.visible = v; }

  swingClipFor(power) {
    if (this.isPutt) return this.actions.putt ? 'putt' : 'drive';
    return 'drive';
  }

  // 球桿校正：準備姿勢那一格，球放在「腳尖往前 TOE_DIST」的地方，桿身從雙手拳頭中心伸到球（長度、傾斜角依此決定）；
  // 擊球那一格，桿身從雙手指向球。兩個方向各記在「左手的本地座標」裡，之後每一格跟著左手轉（像真的握在手上），
  // 下桿途中兩者平滑過渡，收桿再慢慢轉回準備時的握法
  clubCal(k) {
    const key = k + ':' + this.clubType;
    this.cc = this.cc || {};
    if (this.cc[key]) return this.cc[key];
    const c = this.calib[k];
    const u = 1 / this.scale;                       // 校正資料是模型原始單位；1 公尺 = u 個模型單位（模型不一定是 1.8 公尺高）
    const H = c.addrH.clone();
    const dy = H.y - BALL_R * u;
    const ahead = H.clone().sub(c.addrToe).dot(c.facing);                 // 雙手在腳尖前面多遠
    const d = Math.max(0.1 * u, (TOE_DIST[this.clubType] || 78) / 100 * u - ahead);
    const G = H.clone().addScaledVector(c.facing, d); G.y = BALL_R * u;
    const local = (D, q) => { const inv = q.clone().invert(); return { Dl: D.clone().applyQuaternion(inv), Zl: D.clone().cross(c.target).normalize().applyQuaternion(inv) }; };
    const A = local(G.clone().sub(H).normalize(), c.addrQL);
    const I = local(G.clone().sub(c.impH).normalize(), c.impQL);
    const ball = G.clone().addScaledVector(c.target, (BALL_R + 0.012) * u); ball.y = 0;
    // 球桿總長 = 拳頭中心到桿頭 + 握把頂端多出 6 公分；桿頭底部的傾斜角跟著桿身角度，才會平貼地面
    this.cc[key] = { A, I, ball, addr: c.addr, down: G.clone().sub(H).normalize(), len: Math.hypot(dy, d) / u + GRIP_TOP, lie: Math.atan2(dy, d) };
    return this.cc[key];
  }

  ballModel(k) { return this.clubCal(k).ball.clone(); }

  // 把角色放到球旁邊、面向球，讓這個揮桿動作的擊球位置剛好在球上
  place(k) {
    const c = this.calib[k];
    const d = V(Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r = V(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const world = new THREE.Matrix4().makeBasis(d, UP, r);
    const model = new THREE.Matrix4().makeBasis(c.target, UP, c.facing);
    const q = new THREE.Quaternion().setFromRotationMatrix(world.multiply(model.invert()));
    this.object.quaternion.copy(q);
    const b = this.ballModel(k).multiplyScalar(this.scale).applyQuaternion(q);
    this.object.position.copy(this.ballPos).sub(b);
    this.object.position.y = this.ballPos.y - BALL_R;
    this.placedFor = k;
  }

  setup(ballPos, yaw, clubIcon) {
    if (!this.ready) return;
    const newShot = !this.ballPos || this.ballPos.distanceTo(ballPos) > 0.01 || this.clubType !== clubIcon || this.state === 'done';
    this.ballPos = ballPos.clone();
    this.yaw = yaw;
    this.clubType = clubIcon;
    this.isPutt = clubIcon === 'putter';
    if (!this.club) { this.club = this.clubMaker.club; this.clubMaker.rig.remove(this.club); this.object.add(this.club); }
    const swingK = this.isPutt ? 'putt' : 'drive';
    const cal = this.clubCal(swingK);
    this.clubMaker.lie = cal.lie;
    this.clubMaker.buildClub(clubIcon, cal.len);      // 同樣的球桿不會重建
    if (newShot) {
      this.swinging = null;
      this.finished = false;
      this.mixer.stopAllAction();
      this.inner.position.set(0, 0, 0); this.inner.quaternion.identity();
      const preK = this.isPutt ? null : 'preshot';
      if (this.actions[preK]) {
        this.state = 'pre';
        this.preK = preK;
        this.alignPre(preK, swingK);
        this.actions[preK].reset().play();
      } else {
        this.state = 'address';
        this.preK = null;
        this.holdAddress(swingK);
      }
    }
    this.place(this.state === 'pre' ? swingK : (this.curK || swingK));
    this.mixer.update(0);
  }

  // 走位動作的最後一格對齊揮桿動作的準備姿勢（位置與面向）
  alignPre(preK, swingK) {
    const p = this.calib[preK], s = this.calib[swingK];
    const ang = Math.atan2(s.facing.x, s.facing.z) - Math.atan2(p.facing.x, p.facing.z);
    this.inner.quaternion.setFromAxisAngle(UP, ang);
    const end = p.endHips.clone(); end.y = 0;
    end.applyAxisAngle(UP, ang).multiplyScalar(this.scale);
    const tgt = s.addrHips.clone(); tgt.y = 0; tgt.multiplyScalar(this.scale);
    this.inner.position.copy(tgt.sub(end));
  }

  holdAddress(k) {
    this.curK = k;
    const a = this.actions[k];
    a.reset().play();
    a.paused = true;
    a.time = this.clubCal(k).addr;
  }

  // 點螢幕跳過走位，直接停在準備姿勢
  skipPre() {
    if (this.state !== 'pre') return;
    const a = this.actions[this.preK];
    a.time = a.getClip().duration;
    this.mixer.update(0);
    this.toAddress();
  }

  toAddress() {
    const k = this.isPutt ? 'putt' : 'drive';
    const pre = this.actions[this.preK];
    this.state = 'address';
    this.inner.position.set(0, 0, 0); this.inner.quaternion.identity();
    this.holdAddress(k);
    // 直接切換、不交叉淡入：走位最後一格本來就對齊準備姿勢；淡入時走位動作少了對齊位移，角色會滑一下
    if (pre) pre.stop();
    this.place(k);
    this.mixer.update(0);      // 同一格就套用準備姿勢，不然會先畫出一格「沒對齊的走位姿勢」
  }

  setBackswing(p) {
    if (!this.ready || this.swinging) return;
    if (this.state === 'pre') this.toAddress();
    const k = this.swingClipFor(p);
    if (k !== this.curK) {
      const old = this.actions[this.curK];
      this.holdAddress(k);
      if (old && old !== this.actions[k]) { old.stop(); }
      this.place(k);
    }
    const c = this.calib[k];
    const a = this.actions[k];
    a.paused = true;
    // 推桿的上桿幅度縮小（動作檔的推桿上桿很大，短推看起來不自然）
    a.time = lerp(this.clubCal(k).addr, c.top, clamp(p, 0, 1) * (this.isPutt ? 0.7 : 1));
    this.mixer.update(0);
  }

  swing(onImpact) {
    if (!this.ready) { onImpact && onImpact(); return; }
    if (this.state === 'pre') this.toAddress();
    const k = this.curK;
    const a = this.actions[k];
    if (a.time < this.clubCal(k).addr) a.time = this.clubCal(k).addr;
    a.paused = false;
    a.setEffectiveTimeScale(1);
    this.swinging = { k, onImpact, fired: false };
    this.state = 'swing';
  }

  update(dt) {
    if (!this.ready) return;
    this.mixer.update(dt);
    if (this.state === 'pre') {
      const a = this.actions[this.preK];
      if (a.time >= a.getClip().duration - 1e-3) this.toAddress();
    }
    const s = this.swinging;
    if (s) {
      const a = this.actions[s.k];
      if (!s.fired && a.time >= this.calib[s.k].impact) { s.fired = true; s.onImpact && s.onImpact(); }
      if (a.time >= Math.min(this.calib[s.k].finish, a.getClip().duration - 1e-3)) { a.paused = true; this.swinging = null; this.finished = true; this.state = 'done'; }
    }
    this.updateClub();
  }

  // 球桿跟著雙手：左手在上（握把端）、右手在下，方向 = 左手 → 右手
  updateClub() {
    if (!this.club || !this.bR) return;
    this.object.updateMatrixWorld(true);
    const pr = gripOf(this.gR, V()), pl = gripOf(this.gL, V());     // 兩手拳頭中心（世界座標，公尺）
    const k = this.curK || (this.isPutt ? 'putt' : 'drive');
    const cal = this.clubCal(k), c = this.calib[k], act = this.actions[k];
    const w = act ? clamp((act.time - c.top) / Math.max(0.05, c.impact - c.top), 0, 1) : 0;   // 上桿 0 → 擊球 1
    const qw = new THREE.Quaternion(); this.bL.getWorldQuaternion(qw);
    const dir = cal.A.Dl.clone().lerp(cal.I.Dl, w).applyQuaternion(qw).normalize();
    let Z = cal.A.Zl.clone().lerp(cal.I.Zl, w).applyQuaternion(qw);
    // 收桿：動作檔的手腕角度到收桿時不太對，桿子會朝天或朝目標；擊球後慢慢把桿身轉到真實收桿的方向
    // 全揮桿：桿身繞過脖子後面、跟地面平行、跟身體垂直，桿頭朝右（從背後看）
    // 推桿：桿身維持往下（像鐘擺），桿頭往目標方向送出一點
    if (act && act.time > c.impact) {
      const u = clamp((act.time - c.impact) / Math.max(0.15, (c.finish - c.impact) * (this.isPutt ? 0.6 : 0.45)), 0, 1);
      const e = u * u * (3 - 2 * u);
      const F = (this.isPutt ? cal.down.clone().addScaledVector(c.target, 0.35)
        : c.facing.clone().addScaledVector(c.target, -0.15)).normalize().applyQuaternion(this.object.quaternion);
      const turn = new THREE.Quaternion().slerp(new THREE.Quaternion().setFromUnitVectors(dir, F), e);
      dir.applyQuaternion(turn); Z.applyQuaternion(turn);
    }
    const X = dir.clone().cross(Z).normalize();
    Z = X.clone().cross(dir).normalize();
    // 球桿是角色的子物件：世界座標換成角色本地座標
    const wq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, dir, Z));
    this.club.quaternion.copy(this.object.quaternion).invert().multiply(wq);
    const mid = pr.clone().add(pl).multiplyScalar(0.5);
    this.club.position.copy(this.object.worldToLocal(mid.addScaledVector(dir, -GRIP_TOP)));
  }

  // 角色腳的大概位置（腰部正下方）
  feetCenter() {
    const h = this.model.getObjectByName('mixamorigHips');
    const p = V();
    h.getWorldPosition(p);
    return p;
  }
}

export function preloadCharacter(def, animBase) { return loadModel(def, animBase); }
