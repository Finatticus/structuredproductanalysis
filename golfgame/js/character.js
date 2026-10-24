// 第三人稱角色
// ProceduralGolfer：程式內建角色（不需外部檔案）。手臂與腿用兩段 IK 求解，球桿是剛體，雙手永遠握在桿上。
// 寫實角色（Mixamo）在 mixamo.js，兩者對外介面相同。
// 兩者對外介面相同：setup() / setBackswing() / swing() / update() / setLook() / object
import * as THREE from 'three';
import { clamp, lerp } from './util.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const D2R = Math.PI / 180;

// 揮桿關鍵影格：phase, 手臂角 θ, 球桿角, 骨盆轉, 胸轉, 重心左右, 前傾, 膝彎
const FULL = [
  [0.0, 6, 0, 0, 0, 0, 38, 1],
  [0.5, -48, -102, -18, -46, -0.03, 37, 1],
  [1.0, -118, -214, -42, -94, -0.05, 35, 1],
  [1.5, -62, -150, 14, -36, 0.06, 36, 1],
  [2.0, 4, -2, 38, 12, 0.08, 37, 0.95],
  [2.5, 78, 150, 64, 78, 0.12, 24, 0.6],
  [3.0, 138, 255, 88, 110, 0.14, 8, 0.35],
];

function sampleKeys(keys, ph) {
  ph = clamp(ph, keys[0][0], keys[keys.length - 1][0]);
  let i = 1;
  while (i < keys.length - 1 && keys[i][0] < ph) i++;
  const a = keys[i - 1], b = keys[i];
  const t = (ph - a[0]) / (b[0] - a[0] || 1);
  const s = t * t * (3 - 2 * t);
  return a.map((v, k) => lerp(v, b[k], s));
}

const CLUB_GEOM = {
  driver: { len: 1.12, beta: 62 }, wood: { len: 1.04, beta: 62 }, iron: { len: 0.95, beta: 63 },
  wedge: { len: 0.9, beta: 64 }, putter: { len: 0.86, beta: 72 },
};

function twoBoneIK(A, T, l1, l2, pole) {
  const AT = T.clone().sub(A);
  let d = AT.length();
  const dir = AT.normalize();
  d = clamp(d, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.9995);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const pd = pole.clone().sub(A);
  pd.sub(dir.clone().multiplyScalar(pd.dot(dir))).normalize();
  const mid = A.clone().addScaledVector(dir, a).addScaledVector(pd, h);
  const end = A.clone().addScaledVector(dir, d);
  return [mid, end];
}

function placeLimb(mesh, a, b) {
  const d = b.clone().sub(a);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, d.normalize());
}

export class ProceduralGolfer {
  constructor(look) {
    this.object = new THREE.Group();
    this.rig = new THREE.Group();          // 角色本地座標：x=目標方向，z=面向球，y=上
    this.object.add(this.rig);
    this.mats = {};
    this.phase = 0;
    this.anim = null;
    this.time = 0;
    this.build();
    this.setLook(look);
  }

  mat(name, rough = 0.75) {
    if (!this.mats[name]) this.mats[name] = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: 0 });
    return this.mats[name];
  }

  mesh(geo, matName, rough) {
    const m = new THREE.Mesh(geo, this.mat(matName, rough));
    m.castShadow = true;
    m.receiveShadow = true;
    this.rig.add(m);
    return m;
  }

  build() {
    const cap = (r, l, seg = 12) => new THREE.CapsuleGeometry(r, l, 6, seg);
    this.L = { upper: 0.30, fore: 0.28, thigh: 0.45, shin: 0.44 };
    const P = this.parts = {};
    P.pelvis = this.mesh(new THREE.SphereGeometry(0.15, 20, 14), 'pants', 0.85);
    P.belt = this.mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.04, 24), 'belt', 0.5);
    P.abdomen = this.mesh(cap(0.13, 0.12, 16), 'shirt', 0.88);
    P.chest = this.mesh(cap(0.145, 0.16, 18), 'shirt', 0.88);
    P.collar = this.mesh(new THREE.TorusGeometry(0.055, 0.016, 8, 16), 'shirt', 0.88);
    P.neck = this.mesh(cap(0.048, 0.06), 'skin', 0.6);
    P.head = this.mesh(new THREE.SphereGeometry(0.105, 24, 18), 'skin', 0.6);
    P.hair = this.mesh(new THREE.SphereGeometry(0.11, 20, 14, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.45), 'hair', 0.9);
    P.cap = this.mesh(new THREE.SphereGeometry(0.113, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), 'cap', 0.8);
    P.brim = this.mesh(new THREE.CylinderGeometry(0.085, 0.09, 0.012, 24, 1, false, -Math.PI * 0.5, Math.PI), 'cap', 0.8);
    P.ponytail = this.mesh(cap(0.035, 0.12), 'hair', 0.9);
    P.earL = this.mesh(new THREE.SphereGeometry(0.022, 10, 8), 'skin', 0.6);
    P.earR = this.mesh(new THREE.SphereGeometry(0.022, 10, 8), 'skin', 0.6);
    P.nose = this.mesh(new THREE.SphereGeometry(0.018, 10, 8), 'skin', 0.6);
    for (const s of ['L', 'R']) {
      P['shoulder' + s] = this.mesh(new THREE.SphereGeometry(0.068, 16, 12), 'shirt', 0.88);
      P['sleeve' + s] = this.mesh(cap(0.058, 0.13), 'shirt', 0.88);
      P['upper' + s] = this.mesh(cap(0.044, this.L.upper - 0.06), 'skin', 0.6);
      P['fore' + s] = this.mesh(cap(0.039, this.L.fore - 0.06), 'skin', 0.6);
      P['hand' + s] = this.mesh(new THREE.SphereGeometry(0.044, 14, 10), s === 'L' ? 'glove' : 'skin', 0.6);
      P['thigh' + s] = this.mesh(cap(0.078, this.L.thigh - 0.1), 'pants', 0.85);
      P['shin' + s] = this.mesh(cap(0.058, this.L.shin - 0.08), 'pants', 0.85);
      P['knee' + s] = this.mesh(new THREE.SphereGeometry(0.07, 12, 10), 'pants', 0.85);
      P['shoe' + s] = this.mesh(cap(0.05, 0.17), 'shoes', 0.55);
      P['sole' + s] = this.mesh(new THREE.BoxGeometry(0.1, 0.02, 0.27), 'sole', 0.9);
    }
    // 球桿（剛體）：原點在握把頂端，+Y 指向桿頭
    this.club = new THREE.Group();
    this.rig.add(this.club);
  }

  buildClub(type, lenOverride) {
    // 只有換球桿（或站位角度、長度改變）才重建；舊的模型要釋放，否則每次瞄準都會漏記憶體、越玩越卡
    const key = type + ':' + (this.lie || 0.9).toFixed(3) + ':' + (lenOverride || 0).toFixed(3);
    if (this._clubKey === key) return;
    this._clubKey = key;
    this.club.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.club.clear();
    const g = { ...(CLUB_GEOM[type] || CLUB_GEOM.iron) };
    if (lenOverride) g.len = lenOverride;      // 寫實角色依站位算出的長度
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde0, roughness: 0.18, metalness: 1 });
    const black = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.35, metalness: 0.3 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0075, g.len, 8), chrome);
    shaft.position.y = g.len / 2;
    const gr = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0105, 0.27, 10), grip);
    gr.position.y = 0.135;
    this.club.add(shaft, gr);
    let head;
    if (type === 'driver' || type === 'wood') {
      const s = type === 'driver' ? 1 : 0.78;
      head = new THREE.Mesh(new THREE.SphereGeometry(0.06 * s, 24, 16), black);
      head.scale.set(0.95, 0.55, 1.05);
      head.position.set(0.03 * s, 0, 0.055 * s);
    } else if (type === 'putter') {
      head = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.028, 0.11), black);
      head.position.set(0.01, 0, 0.045);
    } else {
      head = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, 0.078), type === 'wedge' ? new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.4, metalness: 1 }) : chrome);
      head.position.set(0.006, 0.006, 0.035);
    }
    // 桿頭的「趾端」方向 = 本地 (0, cosλ, sinλ)，讓桿底平貼地面
    const lam = this.lie || 0.9;
    const holder = new THREE.Group();
    holder.position.y = g.len;
    holder.rotation.x = -(Math.PI / 2 - lam);
    holder.add(head);
    head.castShadow = shaft.castShadow = gr.castShadow = true;
    this.headMesh = head;
    this.club.add(holder);
    this.clubLen = g.len;
  }

  setLook(look = {}) {
    this.look = { ...look };
    const set = (k, c) => this.mat(k).color.set(c);
    set('skin', look.skin || '#d9a77c');
    set('hair', look.hair || '#2b2118');
    set('shirt', look.shirt || '#f2ead8');
    set('pants', look.pants || '#2a3442');
    set('cap', look.cap || '#1d3a2a');
    set('shoes', look.shoes || '#f4f1ea');
    set('glove', look.glove || '#ffffff');
    set('belt', '#2a2420');
    set('sole', '#d7d2c8');
    this.female = look.body === 'f';
    this.parts.ponytail.visible = this.female;
    this.rig.scale.setScalar(this.female ? 0.95 : 1);
  }

  // 依球的位置、瞄準方向與球桿，決定站位與揮桿平面
  setup(ballPos, yaw, clubIcon) {
    this.isPutt = clubIcon === 'putter';
    this.clubType = clubIcon;
    const cg = CLUB_GEOM[clubIcon] || CLUB_GEOM.iron;
    this.stance = { driver: 0.27, wood: 0.25, iron: 0.21, wedge: 0.18, putter: 0.15 }[clubIcon] || 0.21;
    this.armR = this.isPutt ? 0.5 : 0.53;
    this.betaH = cg.beta * D2R;
    // 在本地座標先擺出準備姿勢，算出手的位置與球的位置
    this.phase = 0;
    this.anim = null;
    this.headLock = null;
    this.finished = false;
    const p0 = this.solveBody(this.isPutt ? [0, 0, 0, 0, 0, 0, 44, 0.8] : FULL[0]);
    const hub = p0.hub;
    const e2 = V(0, -Math.sin(this.betaH), Math.cos(this.betaH));
    const hands0 = hub.clone().addScaledVector(e2, this.armR).add(V(this.isPutt ? 0 : 0.05, 0, 0));
    const c = cg.len;
    const drop = hands0.y - 0.022;
    this.lie = Math.asin(clamp(drop / c, 0.3, 0.98));
    const ballLocal = hands0.clone().add(V(0, -drop, Math.cos(this.lie) * c));
    this.hub0 = hub;
    this.e2h = e2;
    this.e1h = V(1, 0, 0);
    this.e2c = ballLocal.clone().sub(hands0).normalize();
    this.e1c = V(1, 0, 0).sub(this.e2c.clone().multiplyScalar(this.e2c.x)).normalize();
    this.nc = this.e1c.clone().cross(this.e2c).normalize().negate();
    this.buildClub(clubIcon);
    // 角色整體：本地 x→目標方向 d，z→右向量 r（面向球）
    const d = V(Math.sin(yaw), 0, -Math.cos(yaw)), r = V(Math.cos(yaw), 0, Math.sin(yaw));
    const m = new THREE.Matrix4().makeBasis(d, UP, r);
    this.object.quaternion.setFromRotationMatrix(m);
    const s = this.rig.scale.x;
    const off = ballLocal.clone().multiplyScalar(s).applyQuaternion(this.object.quaternion);
    this.object.position.copy(ballPos).sub(off);
    this.object.position.y = ballPos.y - 0.021;
    this.pose(this.phase);
    // 微調站位：球放在桿面「中間、正前方」，不和桿頭重疊
    this.object.updateMatrixWorld(true);
    if (this.headMesh) {
      const box = new THREE.Box3().setFromObject(this.headMesh);
      const c = box.getCenter(V());
      let front = -Infinity;
      for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) front = Math.max(front, x * d.x + z * d.z);
      const along = (ballPos.x * d.x + ballPos.z * d.z) - 0.0213 - 0.004 - front;
      const side = (ballPos.x * r.x + ballPos.z * r.z) - (c.x * r.x + c.z * r.z);
      this.object.position.addScaledVector(d, along).addScaledVector(r, side);
      this.object.updateMatrixWorld(true);
    }
  }

  // 骨盆/胸/頭的位置
  solveBody(k) {
    const [, , , pelvisYaw, chestYaw, shift, tilt, knee] = k;
    const flex = 0.035 * knee;
    const pelvis = V(shift, 1.0 - flex, -0.05 - 0.04 * knee);
    const tiltR = tilt * D2R;
    const spineDir = V(0, Math.cos(tiltR), Math.sin(tiltR));
    const chest = pelvis.clone().addScaledVector(spineDir, 0.42);
    const hub = pelvis.clone().addScaledVector(spineDir, 0.5);
    return { pelvis, spineDir, chest, hub, pelvisYaw: pelvisYaw * D2R, chestYaw: chestYaw * D2R, knee };
  }

  keysAt(ph) {
    if (this.isPutt) {
      const A = 6 + 18 * (this.puttPower || 0.5);
      const keys = [[0, 0, 0, 0, 0, 0, 44, 0.8], [1, -A, -A * 1.12, -2, -A * 0.7, 0, 44, 0.8], [2, 0, 0, 0, 0, 0, 44, 0.8], [3, A * 1.25, A * 1.4, 3, A * 0.85, 0, 43, 0.8]];
      return sampleKeys(keys, ph);
    }
    return sampleKeys(FULL, ph);
  }

  pose(ph, override) {
    if (!this.hub0) return;
    const k = override || this.keysAt(ph);
    const [, theta, clubA] = k;
    const B = this.solveBody(k);
    const P = this.parts, L = this.L;
    const rotY = (v, a) => v.clone().applyAxisAngle(UP, a);
    // 胸部座標軸
    const cRight = rotY(V(1, 0, 0), B.chestYaw);
    const cUp = B.spineDir.clone();
    cRight.sub(cUp.clone().multiplyScalar(cRight.dot(cUp))).normalize();
    const cFwd = cRight.clone().cross(cUp).negate();
    const chestM = new THREE.Matrix4().makeBasis(cRight, cUp, cFwd);
    const pRight = rotY(V(1, 0, 0), B.pelvisYaw);
    const pFwd = rotY(V(0, 0, 1), B.pelvisYaw);
    const pelvisM = new THREE.Matrix4().makeBasis(pRight, UP, pFwd);

    P.pelvis.position.copy(B.pelvis);
    P.pelvis.quaternion.setFromRotationMatrix(pelvisM);
    P.pelvis.scale.set(1.15, 0.85, 0.85);
    P.belt.position.copy(B.pelvis).addScaledVector(B.spineDir, 0.1);
    P.belt.quaternion.setFromUnitVectors(UP, B.spineDir);
    P.belt.scale.set(1.08, 1, 0.82);
    P.abdomen.position.copy(B.pelvis).addScaledVector(B.spineDir, 0.2);
    P.abdomen.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(rotY(V(1, 0, 0), (B.pelvisYaw + B.chestYaw) / 2), B.spineDir, rotY(V(0, 0, 1), (B.pelvisYaw + B.chestYaw) / 2)));
    P.abdomen.scale.set(1.12, 1, 0.82);
    P.chest.position.copy(B.chest).addScaledVector(cUp, -0.08);
    P.chest.quaternion.setFromRotationMatrix(chestM);
    P.chest.scale.set(this.female ? 1.12 : 1.28, 1, 0.78);
    const neckBase = B.chest.clone().addScaledVector(cUp, 0.08);
    // 頭：保持準備姿勢時的位置，眼睛看球（下桿到送桿後才跟著轉）
    const headPos = this.headLock && ph < 2.15 ? this.headLock.clone() : neckBase.clone().addScaledVector(cUp, 0.08).add(V(0, 0.09, 0.03));
    if (!this.headLock && ph === 0) this.headLock = headPos.clone();
    placeLimb(P.neck, neckBase, headPos);
    P.head.position.copy(headPos);
    const look = ph > 2.3 ? V(1, -0.1, 0.4).normalize() : V(0.05, -0.85, 0.5).normalize();
    const hRight = V(0, 1, 0).cross(look).normalize().negate();
    const hUp = look.clone().cross(hRight).negate().normalize();
    const headM = new THREE.Matrix4().makeBasis(hRight, hUp, look);
    P.head.quaternion.setFromRotationMatrix(headM);
    P.head.scale.set(0.92, 1.06, 1);
    for (const n of ['hair', 'cap', 'brim', 'ponytail', 'earL', 'earR', 'nose']) P[n].quaternion.copy(P.head.quaternion);
    const hq = P.head.quaternion;
    const at = (x, y, z) => headPos.clone().add(V(x, y, z).applyQuaternion(hq));
    P.hair.position.copy(at(0, -0.005, -0.006));
    P.cap.position.copy(at(0, 0.018, 0));
    P.brim.position.copy(at(0, 0.03, 0.06));
    P.ponytail.position.copy(at(0, -0.02, -0.13));
    P.earL.position.copy(at(0.1, 0, -0.005)); P.earR.position.copy(at(-0.1, 0, -0.005));
    P.nose.position.copy(at(0, -0.015, 0.1));
    P.collar.position.copy(neckBase);
    P.collar.quaternion.setFromUnitVectors(V(0, 0, 1), cUp);

    // 手與球桿
    const hub = B.hub;
    const handDir = this.isPutt
      ? this.e2h.clone().multiplyScalar(Math.cos(theta * D2R)).addScaledVector(this.e1h, Math.sin(theta * D2R))
      : this.e2h.clone().multiplyScalar(Math.cos(theta * D2R)).addScaledVector(this.e1h, Math.sin(theta * D2R));
    const hands = this.hub0.clone().lerp(hub, 0.5).addScaledVector(handDir, this.armR).add(V(this.isPutt ? 0 : 0.05 * Math.cos(theta * D2R), 0, 0));
    const shL = B.chest.clone().addScaledVector(cRight, this.female ? 0.17 : 0.19).addScaledVector(cUp, 0.03);
    const shR = B.chest.clone().addScaledVector(cRight, -(this.female ? 0.17 : 0.19)).addScaledVector(cUp, 0.03);
    const [elL, wrL] = twoBoneIK(shL, hands, L.upper, L.fore, B.pelvis.clone().add(V(0.25, -0.2, -0.3)));
    const cdir = this.e2c.clone().multiplyScalar(Math.cos(clubA * D2R)).addScaledVector(this.e1c, Math.sin(clubA * D2R)).normalize();
    const gripR = wrL.clone().addScaledVector(cdir, 0.085);
    const [elR, wrR] = twoBoneIK(shR, gripR, L.upper, L.fore, B.pelvis.clone().add(V(-0.25, -0.2, -0.3)));
    for (const [s, sh, el, wr] of [['L', shL, elL, wrL], ['R', shR, elR, wrR]]) {
      P['shoulder' + s].position.copy(sh);
      const sleeveEnd = sh.clone().lerp(el, 0.5);
      placeLimb(P['sleeve' + s], sh, sleeveEnd);
      placeLimb(P['upper' + s], sh.clone().lerp(el, 0.35), el);
      placeLimb(P['fore' + s], el, wr);
      P['hand' + s].position.copy(wr).addScaledVector(cdir, 0.02);
    }
    // 球桿姿態：Y=桿身方向，Z=揮桿平面法線
    const Y = cdir, Z = this.nc.clone().sub(cdir.clone().multiplyScalar(this.nc.dot(cdir))).normalize();
    const X = Y.clone().cross(Z).normalize();
    this.club.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    this.club.position.copy(wrL).addScaledVector(cdir, -0.02);

    // 腿：腳固定，IK 求膝蓋
    const hipW = this.female ? 0.085 : 0.095;
    for (const [s, sign] of [['L', 1], ['R', -1]]) {
      const hip = B.pelvis.clone().addScaledVector(pRight, sign * hipW).add(V(0, -0.05, 0));
      const heelUp = s === 'R' && ph > 2.1 && !this.isPutt ? clamp((ph - 2.1) / 0.6, 0, 1) : 0;
      const ankle = V(sign * this.stance, 0.085 + heelUp * 0.07, 0.0 + heelUp * 0.02);
      const pole = hip.clone().add(V(sign * 0.12, -0.2, 0.5));
      const [knee, ank] = twoBoneIK(hip, ankle, L.thigh, L.shin, pole);
      placeLimb(P['thigh' + s], hip, knee);
      placeLimb(P['shin' + s], knee, ank);
      P['knee' + s].position.copy(knee);
      const footDir = V(sign * 0.25, -heelUp * 0.5, 1).normalize();
      const toe = ank.clone().add(V(0, -0.045, 0)).addScaledVector(footDir, 0.13);
      P['shoe' + s].position.copy(ank.clone().add(V(0, -0.04, 0)).lerp(toe, 0.5));
      P['shoe' + s].quaternion.setFromUnitVectors(UP, footDir);
      P['sole' + s].position.copy(P['shoe' + s].position).add(V(0, -0.045, 0));
      P['sole' + s].quaternion.setFromUnitVectors(V(0, 0, 1), footDir);
    }
  }

  // p: 0~1.1 拉桿程度
  setBackswing(p, puttPower) {
    if (this.anim) return;
    this.puttPower = puttPower ?? p;
    const top = this.isPutt ? clamp(p, 0, 1) : 0.15 + 0.85 * clamp(p, 0, 1.05);
    this.phase = top;
    this.topPhase = top;
    this.pose(top);
  }

  // 下桿 → 擊球 → 收桿
  swing(onImpact) {
    const from = this.keysAt(this.topPhase || 1);
    const impact = this.keysAt(2);
    this.anim = { t: 0, from, impact, fired: false, onImpact, down: this.isPutt ? 0.32 : 0.24 + 0.06 * (1 - (this.topPhase || 1)) };
  }

  update(dt) {
    this.time += dt;
    const a = this.anim;
    if (!a) {
      if (this.phase === 0) {
        // 準備時輕微呼吸
        const k = (this.isPutt ? [0, 0, 0, 0, 0, 0, 44, 0.8] : FULL[0]).slice();
        k[6] += Math.sin(this.time * 1.6) * 0.4;
        this.pose(0, k);
      }
      return;
    }
    a.t += dt;
    if (a.t < a.down) {
      const t = a.t / a.down;
      const ea = Math.pow(t, 1.5), ec = Math.pow(t, 2.6);   // 球桿比手慢 → 延遲釋放
      const k = a.from.map((v, i) => lerp(v, a.impact[i], i === 2 ? ec : ea));
      this.pose(1 + t, k);
    } else {
      if (!a.fired) { a.fired = true; a.onImpact && a.onImpact(); }
      const t = Math.min(1, (a.t - a.down) / (this.isPutt ? 0.6 : 0.9));
      const ph = 2 + (this.isPutt ? 1 : 1) * (1 - Math.pow(1 - t, 2.2));
      this.phase = ph;
      this.pose(ph);
      if (t >= 1) { this.anim = null; this.phase = 3; this.finished = true; }
    }
  }

  setVisible(v) { this.object.visible = v; }
}
