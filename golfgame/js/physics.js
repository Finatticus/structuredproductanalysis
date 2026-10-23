// 物理引擎：飛行（重力 + 空氣阻力 + 馬格努斯升力 + 風）、落地彈跳、滾動、推桿、進洞判定
import { MPH, clamp, rad, deg } from './util.js';
import { derive } from './stats.js';

export const SURF = { TEE: 0, FAIRWAY: 1, FRINGE: 2, GREEN: 3, ROUGH: 4, DEEP: 5, SAND: 6, WATER: 7, OB: 8, CHASM: 9, WASTE: 10 };
export const SURF_NAME = ['發球台', '球道', '果嶺邊', '果嶺', '長草', '深草', '沙坑', '水障礙', '界外', '峽谷', '荒地'];

const R = 0.021335, AREA = Math.PI * R * R, MASS = 0.04593, G = 9.81;
const CUP_R = 0.054;
// 空氣動力係數：用 PGA TrackMan 平均數據回歸（Driver 167mph/10.9°/2686rpm → 275y；7I 120mph → 172y）
const CD0 = 0.215, CDK = 0.30, CLK = 1.8, CLQ = 1.5, CL_MAX = 0.34, SPIN_TAU = 25;

// 各地面：e = 法向恢復係數；keep = 落地切向速度保留；crr = 滾動阻力係數
export const GROUND = {
  [SURF.TEE]: { e: 0.30, keep: 0.62, crr: 0.12 },
  [SURF.FAIRWAY]: { e: 0.32, keep: 0.70, crr: 0.11 },
  [SURF.FRINGE]: { e: 0.27, keep: 0.62, crr: 0.085 },
  [SURF.GREEN]: { e: 0.22, keep: 0.62, crr: 0.05 },
  [SURF.ROUGH]: { e: 0.15, keep: 0.42, crr: 0.36 },
  [SURF.DEEP]: { e: 0.07, keep: 0.22, crr: 0.75 },
  [SURF.SAND]: { e: 0.03, keep: 0.10, crr: 1.6 },
  [SURF.WASTE]: { e: 0.20, keep: 0.50, crr: 0.30 },
};

export function airDensity(altitude, tempC) {
  const P = 101325 * Math.pow(1 - 2.25577e-5 * altitude, 5.25588);
  return P / (287.05 * (tempC + 273.15));
}

// 果嶺速度（Stimp 呎）→ 滾動阻力。Stimp 球道以約 1.83 m/s 滾出，滾 stimp 呎停下：a = v²/2d
export const stimpCrr = stimp => (1.83 * 1.83) / (2 * stimp * 0.3048) / G;

function windAt(env, h) {
  // 對數風廓線：地面風小、高空風大。顯示的風速是 10 公尺高度
  const f = clamp(Math.log(Math.max(h, 0.3) / 0.05) / Math.log(10 / 0.05), 0.3, 1.25);
  return [env.wind[0] * f, env.wind[1] * f];
}

export function groundFor(code, course) {
  const g = { ...(GROUND[code] || GROUND[SURF.ROUGH]) };
  if (code === SURF.GREEN) g.crr = stimpCrr(course.stimp);
  if (code === SURF.FAIRWAY || code === SURF.FRINGE || code === SURF.TEE || code === SURF.GREEN) {
    g.e *= course.firm; g.keep = Math.min(0.9, g.keep * (0.85 + 0.15 * course.firm));
    if (code !== SURF.GREEN) g.crr /= course.firm;
  }
  return g;
}

const isHazard = c => c === SURF.WATER || c === SURF.CHASM;

/**
 * 模擬一顆球從擊出到停止。
 * launch: { pos:[x,y,z], speed(m/s), launchDeg, yaw(rad, 0=朝 -z), spin(rpm), axisDeg(+右曲) , rollOnly }
 * 回傳 { frames:[[t,x,y,z]...]（60fps）, end, result, carry, total, apex, ... }
 */
export function simulate(launch, env, terrain) {
  const rho = env.rho;
  const course = terrain.course;
  let [x, y, z] = launch.pos;
  const dX = Math.sin(launch.yaw), dZ = -Math.cos(launch.yaw);
  const rX = Math.cos(launch.yaw), rZ = Math.sin(launch.yaw);
  const L = rad(launch.launchDeg);
  let vx = launch.speed * Math.cos(L) * dX, vy = launch.speed * Math.sin(L), vz = launch.speed * Math.cos(L) * dZ;
  let w = launch.spin * 2 * Math.PI / 60;
  const ax0 = rad(launch.axisDeg || 0);
  // 旋轉軸：純後旋時 = 右向量；傾斜 axis 產生側旋
  const sx = rX * Math.cos(ax0), sy = -Math.sin(ax0), sz = rZ * Math.cos(ax0);

  const frames = [];
  const events = [];
  const dt = 1 / 240;
  let t = 0, nextFrame = 0, apex = y, landed = false, carryPt = null, descent = 0, flightTime = 0;
  let mode = launch.rollOnly ? 'roll' : 'fly';
  let result = 'rest', bounces = 0, lastSafe = [x, z], hitTree = false;
  const startY = y;
  const push = () => { if (t >= nextFrame) { frames.push([t, x, y, z]); nextFrame += 1 / 60; } };

  while (t < 40) {
    push();
    if (mode === 'fly') {
      const [wx, wz] = windAt(env, y - terrain.height(x, z));
      const rvx = vx - wx, rvy = vy, rvz = vz - wz;
      const sp = Math.hypot(rvx, rvy, rvz) || 1e-6;
      const S = R * w / sp;
      const cd = CD0 + CDK * S;
      const cl = S < 0.3 ? Math.min(CL_MAX, CLK * S - CLQ * S * S) : CL_MAX;
      const k = 0.5 * rho * AREA * sp / MASS;
      // 升力方向 = 旋轉軸 × 相對速度（單位化）
      let lx = sy * rvz - sz * rvy, ly = sz * rvx - sx * rvz, lz = sx * rvy - sy * rvx;
      const ln = Math.hypot(lx, ly, lz) || 1;
      lx /= ln; ly /= ln; lz /= ln;
      vx += (-k * cd * rvx + k * cl * sp * lx) * dt;
      vy += (-G - k * cd * rvy + k * cl * sp * ly) * dt;
      vz += (-k * cd * rvz + k * cl * sp * lz) * dt;
      x += vx * dt; y += vy * dt; z += vz * dt;
      w *= Math.exp(-dt / SPIN_TAU);
      apex = Math.max(apex, y);
      t += dt;

      if (!terrain.inBounds(x, z)) { result = 'ob'; break; }
      // 樹冠：穿過時大幅減速並亂彈
      if (!hitTree || bounces > 0) {
        const tr = terrain.treeAt(x, y, z);
        if (tr) {
          hitTree = true;
          events.push({ t, type: 'tree' });
          const f = 0.25 + env.rng() * 0.25;
          const a = (env.rng() - 0.5) * 2.2;
          const nvx = vx * Math.cos(a) - vz * Math.sin(a), nvz = vx * Math.sin(a) + vz * Math.cos(a);
          vx = nvx * f; vz = nvz * f; vy = vy * f * 0.5 - 1; w *= 0.3;
        }
      }
      const gh = terrain.height(x, z);
      if (y - R <= gh) {
        const code = terrain.surface(x, z);
        if (!landed) {
          landed = true; carryPt = [x, z]; flightTime = t;
          descent = deg(Math.atan2(-vy, Math.hypot(vx, vz)));
        }
        if (isHazard(code)) { result = code === SURF.WATER ? 'water' : 'chasm'; events.push({ t, type: 'splash' }); y = gh; break; }
        if (code === SURF.OB) { result = 'ob'; break; }
        // 進洞（直接飛進或彈跳時經過）
        if (terrain.distToPin(x, z) < CUP_R && Math.hypot(vx, vz) < 3) { result = 'holed'; break; }
        y = gh + R;
        const n = terrain.normal(x, z);
        const vn = vx * n[0] + vy * n[1] + vz * n[2];
        let tx = vx - vn * n[0], ty = vy - vn * n[1], tz = vz - vn * n[2];
        const gnd = groundFor(code, course);
        const tsp = Math.hypot(tx, ty, tz) || 1e-6;
        // 後旋讓球落地後「咬住」：切向速度扣掉 spin 造成的煞車，強後旋可以倒退一點
        const spinBrake = Math.min(tsp + 1.2, R * w * 0.55 * (code === SURF.GREEN ? 1 : 0.6) * clamp(-vn / 12, 0.2, 1.2));
        const keep = gnd.keep * (1 - Math.min(0.6, (-vn) * 0.02));
        const newT = Math.max(-1.0, tsp * keep - spinBrake);
        tx = tx / tsp * newT; ty = ty / tsp * newT; tz = tz / tsp * newT;
        const nvn = -vn * gnd.e;
        vx = tx + nvn * n[0]; vy = ty + nvn * n[1]; vz = tz + nvn * n[2];
        w *= 0.45;
        bounces++;
        events.push({ t, type: 'bounce', surf: code, speed: -vn });
        if (nvn < 0.6 || bounces > 12) mode = 'roll';
        lastSafe = [x, z];
      }
    } else {
      // 滾動：沿地面切線，重力分量推動，滾動阻力煞車
      const code = terrain.surface(x, z);
      if (isHazard(code)) { result = code === SURF.WATER ? 'water' : 'chasm'; events.push({ t, type: 'splash' }); break; }
      if (code === SURF.OB || !terrain.inBounds(x, z)) { result = 'ob'; break; }
      const gnd = groundFor(code, course);
      const n = terrain.normal(x, z);
      const gx = -G * n[1] * n[0] * -1, gz = -G * n[1] * n[2] * -1; // 重力沿坡面的水平分量 ≈ G·n_y·(n_x, n_z)
      let sp = Math.hypot(vx, vz);
      const slopeAcc = Math.hypot(gx, gz);
      if (sp < 0.03 && slopeAcc < gnd.crr * G * 1.3) { vx = vz = 0; break; }
      let ax = gx, az = gz;
      if (sp > 1e-4) { ax -= gnd.crr * G * vx / sp; az -= gnd.crr * G * vz / sp; }
      const ovx = vx, ovz = vz;
      vx += ax * dt; vz += az * dt;
      // 阻力不能讓球反向
      if (sp > 1e-4 && (vx * ovx + vz * ovz) < 0 && slopeAcc < gnd.crr * G) { vx = vz = 0; break; }
      x += vx * dt; z += vz * dt;
      y = terrain.height(x, z) + R;
      t += dt;
      sp = Math.hypot(vx, vz);
      const dp = terrain.distToPin(x, z);
      if (dp < CUP_R) {
        if (sp < 1.35) { result = 'holed'; events.push({ t, type: 'cup' }); break; }
        // 太快：擦邊，方向偏折、減速
        if (dp < CUP_R * 0.7) {
          const a = (env.rng() - 0.5) * 1.4;
          const nvx = vx * Math.cos(a) - vz * Math.sin(a), nvz = vx * Math.sin(a) + vz * Math.cos(a);
          vx = nvx * 0.6; vz = nvz * 0.6;
          events.push({ t, type: 'lip' });
        }
      }
      if (code === SURF.SAND && sp < 0.5) { vx = vz = 0; break; }
      lastSafe = [x, z];
    }
  }
  frames.push([t, x, y, z]);
  if (!carryPt) carryPt = [x, z];
  const sx0 = launch.pos[0], sz0 = launch.pos[2];
  const along = (px, pz) => (px - sx0) * dX + (pz - sz0) * dZ;
  return {
    frames, events, result,
    end: [x, y, z],
    lastSafe,
    carry: launch.rollOnly ? 0 : along(carryPt[0], carryPt[1]),
    total: along(x, z),
    offline: (x - sx0) * rX + (z - sz0) * rZ,
    apex: apex - startY,
    descent, flightTime,
    duration: t,
  };
}

const CLUB_NOMINAL_MPH = 113; // TrackMan 一號木平均桿頭速度，用來把 spin 換算到玩家速度

/**
 * 揮桿輸入 + 素質 + 球位 → 擊球參數
 * input: { power(0~1.1), curve(-1~1), aimYaw }
 * ctx:   { club, lie(SURF), stats, rng, pressure, distToPin(m), slope }
 */
export function makeLaunch(input, ctx) {
  const d = derive(ctx.stats);
  const rng = ctx.rng;
  const club = ctx.club;
  const pm = ctx.pressure ? d.pressureMul : 1;
  const lie = ctx.lie;
  const n = () => rng.normal();

  if (club.putter) {
    // 推桿：拉桿長度決定「平地滾動距離」，推的方向偏差造成推出偏左/偏右
    const crr = stimpCrr(ctx.stimp) * (lie === SURF.GREEN ? 1 : 1.6);
    const dist = Math.max(0.2, input.power * ctx.puttScale);
    let v0 = Math.sqrt(2 * crr * G * dist);
    v0 *= 1 + n() * d.touchSigma * pm;
    const yaw = input.aimYaw + rad(input.curve * 1.5 + n() * d.lineSigma * pm);
    return { speed: v0, launchDeg: 0, yaw, spin: 0, axisDeg: 0, rollOnly: true, info: { clubMph: 0, smash: 0, ballMph: v0 / MPH } };
  }

  let pw = clamp(input.power, 0.05, 1.1);
  let sig = 1;
  let speedF = pw;
  if (pw > 1) { speedF = 1 + (pw - 1) * 0.5; sig = 1 + (pw - 1) * 8; }     // 超揮：多一點距離、誤差大很多

  // 球位影響
  let lieKeep = 1, lieSpin = 1, lieSig = 1, launchAdd = 0;
  const shortGame = ctx.distToPin < 55 && club.wedge;
  if (lie === SURF.ROUGH) { lieKeep = d.roughKeep; lieSpin = 0.62; lieSig = d.roughSigma; launchAdd = 1.2; }
  else if (lie === SURF.DEEP) { lieKeep = d.roughKeep * 0.72; lieSpin = 0.45; lieSig = d.roughSigma * 1.5; launchAdd = 3; }
  else if (lie === SURF.WASTE) { lieKeep = (d.roughKeep + 0.05) * 0.95; lieSpin = 0.7; lieSig = d.roughSigma * 1.1; }
  else if (lie === SURF.SAND) {
    if (shortGame) { lieKeep = 0.42 + (d.sandKeep - 0.62) * 0.8; lieSpin = 0.55; launchAdd = 6; }
    else { lieKeep = d.sandKeep; lieSpin = 0.8; }
    lieSig = d.sandSigma;
  } else if (lie === SURF.FAIRWAY || lie === SURF.FRINGE || lie === SURF.GREEN) {
    if (club.id === 'D') { lieKeep = 0.93; lieSig = 1.3; }  // 球道上直接用一號木
  }
  // 斜坡站位：坡度越大誤差越大
  lieSig *= 1 + Math.min(0.8, (ctx.slope || 0) * 6) * (1.2 - d.roughKeep);

  const clubMph = d.driverMph * club.ratio * speedF;
  const powerNoise = 1 + n() * (shortGame ? d.chipSigma : d.powerSigma) * sig * pm;
  const mis = Math.abs(n()) * d.mishitSigma * sig * pm * lieSig;
  const smash = club.smash * d.smashMul * (1 - mis * 1.6);
  const ballMph = clubMph * powerNoise * smash * lieKeep;

  const launchDeg = club.launch * (0.85 + 0.15 * pw) + launchAdd + n() * d.launchSigma * Math.sqrt(sig) * pm;
  let spin = club.spin * (clubMph / (CLUB_NOMINAL_MPH * club.ratio)) * (0.6 + 0.4 * pw) * lieSpin;
  if (club.wedge || club.id === '9I' || club.id === '8I') spin *= d.spinMul;
  spin *= 1 + mis * 2.5 * (n() > 0 ? 1 : -0.4);

  const faceErr = n() * d.faceSigma * sig * pm * lieSig * (shortGame ? d.chipFace : 1);
  const intended = clamp(input.curve, -1, 1) * 20;                 // 想打的旋轉軸（度），±20°
  const shaped = intended * (1 + n() * d.shapeSigma * pm);
  const axisDeg = shaped + faceErr * 2.0;
  // 起飛方向：桿面誤差的 75% + 為了讓曲球彎回目標線而預先反向開出去
  const yaw = input.aimYaw + rad(faceErr * 0.75 - shaped * 0.36);

  return {
    speed: ballMph * MPH, launchDeg, yaw, spin: Math.max(600, spin), axisDeg,
    info: { clubMph: clubMph * powerNoise, smash, ballMph, faceErr, mis },
  };
}

// 無誤差、無風、平坦球道的距離表（HUD 顯示「平均 Carry」、自動選桿用）
export function distanceTable(stats, clubs, course, rho = 1.2) {
  const flat = {
    course: course || { firm: 1, stimp: 11 },
    height: () => 0, surface: () => SURF.FAIRWAY, normal: () => [0, 1, 0], inBounds: () => true,
    treeAt: () => null, distToPin: () => 999,
  };
  const zero = Object.assign(() => 0.5, { normal: () => 0 });
  const env = { rho, wind: [0, 0], rng: zero };
  const out = {};
  for (const c of clubs) {
    if (c.putter) continue;
    const l = makeLaunch({ power: 1, curve: 0, aimYaw: 0 }, { club: c, lie: SURF.FAIRWAY, stats, rng: zero, distToPin: 999 });
    const r = simulate({ ...l, pos: [0, R, 0] }, env, flat);
    out[c.id] = { carry: r.carry, total: r.total };
  }
  return out;
}
