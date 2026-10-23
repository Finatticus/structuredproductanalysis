// 由球場資料生成單洞：中心線、球道、果嶺（含坡度）、沙坑、水障礙、樹木、高度與地面種類
import { makeRng, makeNoise, hashStr, clamp, lerp, rad, YD } from './util.js';
import { SURF } from './physics.js';
import { TEE_SETS } from './courses.js';

const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const STYLE = {
  links: { macroA: 2.2, macroL: 120, microA: 1.5, microL: 16, edgeRise: 3, potDepth: 0.85, bunkerSize: [3.4, 4.6] },
  parkland: { macroA: 4.5, macroL: 110, microA: 0.6, microL: 28, edgeRise: 9, potDepth: 0.45, bunkerSize: [5, 9] },
  canyon: { macroA: 3.0, macroL: 90, microA: 0.8, microL: 24, edgeRise: 24, potDepth: 0.45, bunkerSize: [4.5, 8] },
};

export function buildHole(course, holeIdx, opts = {}) {
  const [par, yards, bend, feat, hcp] = course.holes[holeIdx];
  const F = new Set(feat.split(/\s+/));
  const seed = hashStr(course.id + ':' + holeIdx);
  const rng = makeRng(seed);
  const nz = makeNoise(seed), nz2 = makeNoise(seed + 911), nz3 = makeNoise(seed + 3301);
  const st = STYLE[course.style];
  const L = yards * YD;
  const canyon = course.style === 'canyon', links = course.style === 'links', park = course.style === 'parkland';

  // ---------- 1. 中心線 ----------
  const raw = [[0, 0]];
  let h = rad((rng() - 0.5) * 6);
  const legs = [];
  if (par === 3) legs.push([L, h + rad(bend + (rng() - 0.5) * 6)]);
  else if (par === 4) {
    const c = clamp(L * 0.6, 200, 255);
    legs.push([c, h], [L - c, h + rad(bend)]);
  } else {
    const c1 = clamp(L * 0.45, 220, 265), c2 = clamp(L * 0.3, 140, 190);
    const s2 = rng() < 0.5 ? -0.6 : 0.5;
    legs.push([c1, h], [c2, h + rad(bend)], [L - c1 - c2, h + rad(bend + bend * s2)]);
  }
  for (const [len, hd] of legs) {
    const [pu, pv] = raw[raw.length - 1];
    const n = Math.ceil(len / 2);
    for (let i = 1; i <= n; i++) raw.push([pu + Math.sin(hd) * len * i / n, pv + Math.cos(hd) * len * i / n]);
  }
  // 平滑轉角（移動平均 ±18 m）
  const W = 9;
  const P = raw.map((_, i) => {
    let su = 0, sv = 0, c = 0;
    for (let k = -W; k <= W; k++) { const p = raw[clamp(i + k, 0, raw.length - 1)]; su += p[0]; sv += p[1]; c++; }
    return [su / c, sv / c];
  });
  P[0] = [0, 0];
  // 每 6 m 取一點
  const path = [P[0]];
  for (let i = 3; i < P.length; i += 3) path.push(P[i]);
  if (path[path.length - 1] !== P[P.length - 1]) path.push(P[P.length - 1]);
  const S = [0];
  for (let i = 1; i < path.length; i++) S.push(S[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const Lp = S[S.length - 1];
  const dirAt = s => {
    let i = 1;
    while (i < S.length - 1 && S[i] < s) i++;
    const a = path[i - 1], b = path[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const pointAt = s => {
    s = clamp(s, 0, Lp);
    let i = 1;
    while (i < S.length - 1 && S[i] < s) i++;
    const t = (s - S[i - 1]) / (S[i] - S[i - 1] || 1);
    return [lerp(path[i - 1][0], path[i][0], t), lerp(path[i - 1][1], path[i][1], t)];
  };

  // ---------- 範圍與最近點加速格 ----------
  const corridor = course.corridor;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [u, v] of path) { minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
  const pad = corridor + 70;
  const bbox = { minU: minU - pad, maxU: maxU + pad, minV: minV - 90, maxV: maxV + 110 };
  const CELL = 6;
  const gw = Math.ceil((bbox.maxU - bbox.minU) / CELL) + 1, gh = Math.ceil((bbox.maxV - bbox.minV) / CELL) + 1;
  const segIdx = new Int16Array(gw * gh);
  const segDist2 = (u, v, i) => {
    const a = path[i], b = path[i + 1];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const l2 = ex * ex + ey * ey || 1;
    const t = clamp(((u - a[0]) * ex + (v - a[1]) * ey) / l2, 0, 1);
    const qx = a[0] + ex * t - u, qy = a[1] + ey * t - v;
    return [qx * qx + qy * qy, t];
  };
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const u = bbox.minU + i * CELL, v = bbox.minV + j * CELL;
    let best = 1e18, bi = 0;
    for (let k = 0; k < path.length - 1; k++) { const d = segDist2(u, v, k)[0]; if (d < best) { best = d; bi = k; } }
    segIdx[j * gw + i] = bi;
  }
  // 回傳 s（沿中心線距離）、d（橫向距離，右正）
  const near = (u, v) => {
    const gi = clamp(Math.round((u - bbox.minU) / CELL), 0, gw - 1), gj = clamp(Math.round((v - bbox.minV) / CELL), 0, gh - 1);
    const c = segIdx[gj * gw + gi];
    let best = 1e18, bi = c, bt = 0;
    for (let k = Math.max(0, c - 4); k <= Math.min(path.length - 2, c + 4); k++) {
      const [d2, t] = segDist2(u, v, k);
      if (d2 < best) { best = d2; bi = k; bt = t; }
    }
    const a = path[bi], b = path[bi + 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const du = (b[0] - a[0]) / l, dv = (b[1] - a[1]) / l;
    let s = S[bi] + bt * l;
    const ru = dv, rv = -du;
    const d = (u - a[0]) * ru + (v - a[1]) * rv;
    if (bt === 0 && bi === 0) s = (u - a[0]) * du + (v - a[1]) * dv;
    if (bt === 1 && bi === path.length - 2) s = Lp + (u - b[0]) * du + (v - b[1]) * dv;
    return { s, d };
  };

  // ---------- 2. 球道寬度、高低差 ----------
  const fwBase = course.fairwayW * (F.has('tr') ? 0.85 : 1);
  const fwHalf = (s, side) => fwBase / 2 * (1 + 0.14 * nz(s * 0.018, side * 3.1) + 0.06 * nz(s * 0.07, side * 7.7));
  const elevTotal = F.has('UP') ? 14 : F.has('DN') ? -14 : F.has('up') ? 6 : F.has('dn') ? -6 : (rng() - 0.5) * 3;
  const baseElev = s => elevTotal * ss(0, Lp, s);

  // ---------- 3. 果嶺 ----------
  const G = path[path.length - 1];
  const endDir = dirAt(Lp);
  const gRot = Math.atan2(endDir[0], endDir[1]) + rad((rng() - 0.5) * 50);
  const grx = (par === 3 ? 10.5 : 11) + rng() * 2, gry = (par === 3 ? 11 : 11.5) + rng() * 2;
  const gPh = [rng() * 6.28, rng() * 6.28];
  const gLocal = (u, v) => {
    const du = u - G[0], dv = v - G[1];
    const c = Math.cos(gRot), s = Math.sin(gRot);
    return [du * c - dv * s, du * s + dv * c]; // [橫向, 縱深]
  };
  const greenR = (u, v) => {
    const [lu, lv] = gLocal(u, v);
    const th = Math.atan2(lv, lu);
    return Math.hypot(lu / grx, lv / gry) * (1 + 0.07 * Math.sin(3 * th + gPh[0]) + 0.045 * Math.sin(5 * th + gPh[1]));
  };
  const fringeR = 1 + 2.2 / Math.min(grx, gry);
  const slopeBack = 0.008 + rng() * 0.01, slopeSide = (rng() - 0.5) * 0.014;
  const bumps = [];
  const nb = 1 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < nb; i++) bumps.push({ lu: (rng() - 0.5) * grx * 1.2, lv: (rng() - 0.5) * gry * 1.2, a: (rng() < 0.5 ? -1 : 1) * (0.05 + rng() * 0.07), s: 4 + rng() * 2.5 });
  const greenShape = (u, v) => {
    const [lu, lv] = gLocal(u, v);
    let hh = lv * slopeBack + lu * slopeSide;
    for (const b of bumps) hh += b.a * Math.exp(-((lu - b.lu) ** 2 + (lv - b.lv) ** 2) / (2 * b.s * b.s));
    return hh;
  };

  // ---------- 4. 沙坑 ----------
  const bunkers = [];
  const bl = [0, 1, 2, 3, 4].find(i => F.has('b' + i)) ?? 2;
  const nGreenside = links ? bl + 1 : bl;
  const [bmin, bmax] = st.bunkerSize;
  for (let i = 0; i < nGreenside; i++) {
    const a = (i / nGreenside) * Math.PI * 2 + rng() * 0.9 - Math.PI / 2 + 0.6;
    const brx = bmin + rng() * (bmax - bmin), bry = links ? brx * (0.85 + rng() * 0.2) : brx * (0.45 + rng() * 0.2);
    const dist = 1 + (links ? 0.25 : 0.12) + (Math.max(brx, bry) * 0.6) / Math.min(grx, gry);
    const lu = Math.cos(a) * grx * dist, lv = Math.sin(a) * gry * dist;
    const c = Math.cos(-gRot), s = Math.sin(-gRot);
    bunkers.push({ u: G[0] + lu * c - lv * s, v: G[1] + lu * s + lv * c, rx: brx, ry: bry, rot: a + Math.PI / 2, depth: st.potDepth * (links ? 1 : 1.1), ph: rng() * 6 });
  }
  if (par >= 4) {
    const zones = par === 4 ? [clamp(L * 0.62, 215, 265)] : [clamp(L * 0.45, 220, 265), clamp(L * 0.75, 380, 440)];
    for (const zs of zones) {
      const cnt = links ? bl : Math.min(2, Math.ceil(bl / 2));
      for (let i = 0; i < cnt; i++) {
        const sAt = zs + (rng() - 0.5) * 40;
        const side = rng() < 0.5 ? -1 : 1;
        const dir = dirAt(sAt), pt = pointAt(sAt);
        const brx = bmin + rng() * (bmax - bmin) * (links ? 1 : 0.8);
        const lat = links ? (rng() - 0.5) * fwBase * 1.1 : side * (fwHalf(sAt, side) + brx * 0.35);
        bunkers.push({ u: pt[0] + dir[1] * lat, v: pt[1] - dir[0] * lat, rx: links ? brx : brx * 0.55, ry: links ? brx * 0.9 : brx * 1.5, rot: Math.atan2(dir[0], dir[1]), depth: st.potDepth, ph: rng() * 6 });
      }
    }
  }
  const bunkerR = (b, u, v) => {
    const du = u - b.u, dv = v - b.v;
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const lu = du * c - dv * s, lv = du * s + dv * c;
    const th = Math.atan2(lv, lu);
    return Math.hypot(lu / b.rx, lv / b.ry) * (1 + 0.12 * Math.sin(2 * th + b.ph) + 0.06 * Math.sin(5 * th + b.ph * 2));
  };

  // ---------- 5. 水障礙 / 峽谷 ----------
  const waters = [];
  const pondKind = canyon ? 'chasm' : 'pond';
  for (const side of [-1, 1]) {
    if (!F.has(side < 0 ? 'wl' : 'wr')) continue;
    const sAt = par === 5 ? clamp(L * 0.5, 240, 300) : clamp(L * 0.58, 200, 260);
    const pt = pointAt(sAt), dir = dirAt(sAt);
    const rx = canyon ? 26 + rng() * 10 : 20 + rng() * 10, ry = 55 + rng() * 30;
    const lat = side * (fwHalf(sAt, side) + rx * 0.62);
    waters.push({ u: pt[0] + dir[1] * lat, v: pt[1] - dir[0] * lat, rx, ry, rot: Math.atan2(dir[0], dir[1]), kind: pondKind, ph: rng() * 6 });
  }
  if (F.has('wc')) {
    const depth = par === 3 ? 22 + rng() * 12 : 11 + rng() * 4;
    const sAt = Lp - gry - depth - (par === 3 ? 4 : 6);
    const pt = pointAt(sAt), dir = dirAt(sAt);
    waters.push({ u: pt[0], v: pt[1], rx: grx + 16 + rng() * 8, ry: depth, rot: Math.atan2(dir[0], dir[1]), kind: pondKind, ph: rng() * 6 });
  }
  const waterR = (w, u, v) => {
    const du = u - w.u, dv = v - w.v;
    // rot 指的是長軸方向；把座標轉到水體自己的座標系
    const c = Math.cos(w.rot), s = Math.sin(w.rot);
    const lu = du * c - dv * s, lv = du * s + dv * c;
    const th = Math.atan2(lv, lu);
    return Math.hypot(lu / w.rx, lv / w.ry) * (1 + 0.1 * Math.sin(3 * th + w.ph) + 0.05 * Math.sin(7 * th + w.ph));
  };
  let cross = null;
  if (F.has('xc')) {
    const sc = par === 5 ? clamp(L * 0.66, 330, 380) : par === 4 ? clamp(L * 0.42, 150, 185) : Lp * 0.5;
    cross = { s: sc, half: canyon ? 13 : links ? 2.8 : 3.6, kind: canyon ? 'chasm' : 'creek' };
  }
  const crossDist = (s, d) => cross ? Math.abs(s - cross.s + 6 * nz2(d * 0.02, 5)) - cross.half : 99;
  const seaSide = F.has('sl') ? -1 : F.has('sr') ? 1 : 0;
  const seaEdge = s => fwBase / 2 + 30 + 9 * nz3(s * 0.012, 1);

  // ---------- 6. 發球台 ----------
  const tees = TEE_SETS.map(t => {
    const sT = Lp * (1 - t.ratio);
    const pt = pointAt(sT), dir = dirAt(sT);
    const off = (rng() - 0.5) * 3;
    return { id: t.id, s: sT, u: pt[0] + dir[1] * off, v: pt[1] - dir[0] * off, dir, color: t.color };
  });
  const inTee = (u, v, margin = 0) => {
    for (const t of tees) {
      const du = u - t.u, dv = v - t.v;
      const al = du * t.dir[0] + dv * t.dir[1], la = du * t.dir[1] - dv * t.dir[0];
      if (Math.abs(al) < 5.5 + margin && Math.abs(la) < 4 + margin) return t;
    }
    return null;
  };

  const fs = par === 3 ? Lp - gry - 30 : clamp(Lp * 0.3, 110, 190);
  const fe = Lp - gry * 0.7;
  const roughW = course.roughW;

  // ---------- 7. 地面種類 ----------
  function surface(u, v) {
    const { s, d } = near(u, v);
    const ad = Math.abs(d);
    if (ad > corridor || s < -45 || s > Lp + 55) return SURF.OB;
    if (seaSide && seaSide * d > seaEdge(s)) return SURF.WATER;
    for (const w of waters) if (waterR(w, u, v) < 1) return w.kind === 'chasm' ? SURF.CHASM : SURF.WATER;
    if (cross && crossDist(s, d) < 0) return cross.kind === 'chasm' ? SURF.CHASM : SURF.WATER;
    const gr = greenR(u, v);
    if (gr < 1) return SURF.GREEN;
    for (const b of bunkers) if (bunkerR(b, u, v) < 1) return SURF.SAND;
    if (gr < fringeR) return SURF.FRINGE;
    if (inTee(u, v)) return SURF.TEE;
    const fh = fwHalf(s, d > 0 ? 1 : -1);
    if (s > fs && s < fe) {
      const taper = s < fs + 18 ? Math.sqrt((s - fs) / 18) : 1;
      if (ad < fh * taper) return SURF.FAIRWAY;
    }
    if (seaSide && seaSide * d > seaEdge(s) - 10) return SURF.WASTE;
    if (gr < 2.1 || ad < fh + roughW * (1 + 0.3 * nz2(s * 0.03, d > 0 ? 2 : 9))) return SURF.ROUGH;
    if (canyon) return SURF.WASTE;
    return F.has('ww') ? SURF.WASTE : SURF.DEEP;
  }

  // ---------- 8. 高度 ----------
  // 林克斯陸地的平滑地板：高度不低於約 1.3m（海面 -0.9m），下坡洞也不會低到被海面穿透
  const floorL = x => links ? 0.5 * (x + 0.8 + Math.sqrt((x - 0.8) ** 2 + 1)) : x;
  const gCenterBase = baseElev(Lp) + st.macroA * nz.fbm(G[0] / st.macroL, G[1] / st.macroL, 3) + 0.55 + (links ? 3.5 : 0);
  const gCenterBaseF = floorL(gCenterBase - 0.55) + 0.55;
  const teeBase = {};
  tees.forEach(t => (teeBase[t.id] = baseElev(t.s) + st.macroA * nz.fbm(t.u / st.macroL, t.v / st.macroL, 3) + 0.7 + (links ? 3.5 : 0)));
  if (links) tees.forEach(t => (teeBase[t.id] = floorL(teeBase[t.id] - 0.7) + 0.7));
  // 大尺度起伏沿中心線取值：球道上只有前後起伏、左右是平的（避免球落地後往側邊滾進樹林），
  // 離開球道 4~30 公尺再慢慢恢復成真正的地形起伏
  const macro = (u, v) => st.macroA * nz.fbm(u / st.macroL, v / st.macroL, 3);
  const macroTab = [];
  for (let s = 0; s <= Lp + 2; s += 2) { const p = pointAt(s); macroTab.push(macro(p[0], p[1])); }
  const macroC = s => { const f = clamp(s, 0, Lp) / 2, i = Math.floor(f); return lerp(macroTab[i], macroTab[Math.min(i + 1, macroTab.length - 1)], f - i); };
  const rawH = (u, v, s, ad) => {
    const w = ss(fwBase / 2 + 4, fwBase / 2 + 30, ad);
    // 林克斯球場整體墊高 3.5m，陸地一定高於海面（-0.9m），海面不會從球道透出來閃爍
    let hh = baseElev(clamp(s, 0, Lp)) + lerp(macroC(s), macro(u, v), w) + (links ? 3.5 : 0);
    const k = 0.12 + 0.88 * ss(fwBase / 2, fwBase / 2 + 20, ad);
    hh += st.microA * nz2.fbm(u / st.microL, v / st.microL, 3) * k;
    if (links) hh += 2.2 * Math.max(0, nz3.fbm(u / 22, v / 22, 2)) * ss(fwBase / 2 + 5, fwBase / 2 + 30, ad);
    return floorL(hh);
  };
  waters.forEach(w => { w.level = rawH(w.u, w.v, near(w.u, w.v).s, 0) - 1.1; });
  if (cross) cross.level = rawH(...pointAt(cross.s), cross.s, 0) - (cross.kind === 'chasm' ? 26 : 1.3);

  function height(u, v) {
    const { s, d } = near(u, v);
    const ad = Math.abs(d);
    let hh = rawH(u, v, s, ad);
    // 走廊外：地形抬升，形成視覺邊界
    const out = ss(corridor * 0.8, corridor + (canyon ? 25 : 90), ad);
    if (canyon) {
      const mesa = ss(-0.1, 0.25, nz3.fbm(u / 60, v / 60, 3));
      hh += out * (st.edgeRise * (0.55 + 0.6 * mesa));
    } else hh += out * st.edgeRise * (0.6 + 0.6 * nz3.fbm(u / 80, v / 80, 2));
    if (seaSide) {
      const beyond = seaSide * d - seaEdge(s);
      hh = lerp(hh, -3.2, ss(-14, 3, beyond));
      if (seaSide * d > 0) hh -= out * st.edgeRise;
    }
    // 發球台平台
    for (const t of tees) {
      const du = u - t.u, dv = v - t.v;
      const al = Math.abs(du * t.dir[0] + dv * t.dir[1]) - 5.5, la = Math.abs(du * t.dir[1] - dv * t.dir[0]) - 4;
      const e = Math.max(al, la);
      if (e < 4) hh = lerp(teeBase[t.id], hh, ss(0, 4, e));
    }
    // 果嶺：平台 + 坡度 + 起伏
    const gr = greenR(u, v);
    if (gr < 2.0) hh = lerp(gCenterBaseF + greenShape(u, v), hh, ss(1.15, 2.0, gr));
    // 果嶺與果嶺邊不受沙坑、水池影響，坡度只由果嶺本身決定
    const gk = ss(1.12, 1.4, gr);
    // 沙坑凹陷與唇邊
    for (const b of bunkers) {
      const br = bunkerR(b, u, v);
      if (br < 1.6) {
        // 坑底平（半徑 80% 內同一個深度），邊坡較緩，唇邊只微微隆起
        hh -= gk * b.depth * ss(1.12, 0.8, br);
        hh += gk * 0.15 * Math.exp(-(((br - 1.12) / 0.12) ** 2));
      }
    }
    const beforeWater = hh;
    // 水池 / 峽谷
    for (const w of waters) {
      const wr = waterR(w, u, v);
      if (wr < 1.6) {
        if (w.kind === 'chasm') {
          hh = lerp(hh, w.level - 24, ss(1.04, 0.86, wr));
        } else {
          const bank = lerp(w.level + 0.3, hh, ss(1.0, 1.6, wr));
          hh = Math.min(hh, wr < 1 ? w.level - 0.4 - 1.4 * ss(1, 0.5, wr) : bank);
        }
      }
    }
    hh = lerp(beforeWater, hh, gk);
    if (cross) {
      const cd = crossDist(s, d);
      if (cd < (cross.kind === 'chasm' ? 2 : 5)) {
        if (cross.kind === 'chasm') hh = lerp(hh, cross.level, ss(0.5, -2.5, cd));
        else hh = Math.min(hh, lerp(cross.level - 0.6, hh, ss(-0.5, 5, cd)));
      }
    }
    return hh;
  }

  // ---------- 9. 旗桿位置 ----------
  const prng = makeRng(seed ^ (opts.pinSeed || 1));
  let pin = null, bestSlope = 1e9;
  for (let i = 0; i < 10; i++) {
    const a = prng() * Math.PI * 2, r = 0.25 + prng() * 0.45;
    const lu = Math.cos(a) * grx * r, lv = Math.sin(a) * gry * r;
    const c = Math.cos(-gRot), s = Math.sin(-gRot);
    const u = G[0] + lu * c - lv * s, v = G[1] + lu * s + lv * c;
    const e = 0.6;
    const sl = Math.hypot(height(u + e, v) - height(u - e, v), height(u, v + e) - height(u, v - e)) / (2 * e);
    const score = sl + prng() * 0.01;
    if (score < bestSlope) { bestSlope = score; pin = [u, v]; }
  }

  // ---------- 10. 樹木 ----------
  const trees = [];
  const treeGrid = new Map();
  const key = (x, z) => Math.floor(x / 10) + ',' + Math.floor(z / 10);
  const addTree = t => {
    trees.push(t);
    const k = key(t.x, t.z);
    if (!treeGrid.has(k)) treeGrid.set(k, []);
    treeGrid.get(k).push(t);
  };
  const tooClose = (x, z, r) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const arr = treeGrid.get((Math.floor(x / 10) + i) + ',' + (Math.floor(z / 10) + j));
      if (arr) for (const t of arr) if (Math.hypot(t.x - x, t.z - z) < r + t.r * 0.6) return true;
    }
    return false;
  };
  const trng = makeRng(seed + 5);
  const area = (bbox.maxU - bbox.minU) * (bbox.maxV - bbox.minV);
  const attempts = Math.floor(area / 18 * Math.min(1.4, course.trees * (F.has('tr') ? 1.35 : 1)) + (canyon ? area / 60 : 0));
  for (let i = 0; i < attempts; i++) {
    const u = lerp(bbox.minU, bbox.maxU, trng()), v = lerp(bbox.minV, bbox.maxV, trng());
    const { s, d } = near(u, v);
    const ad = Math.abs(d);
    const fh = fwHalf(s, d > 0 ? 1 : -1);
    const minAd = fh + (park ? 9 : 14) + (s < fs ? 4 : 0);
    if (ad < minAd || greenR(u, v) < 2.8 || inTee(u, v, 6)) continue;
    const sf = surface(u, v);
    if (sf === SURF.WATER || sf === SURF.CHASM || sf === SURF.SAND) continue;
    let t;
    if (park) {
      // 越靠近走廊邊越密，形成樹牆
      const edge = ss(minAd, minAd + 14, ad);
      if (trng() > 0.35 + 0.65 * edge) continue;
      const pine = trng() < 0.26;
      const hgt = (pine ? 14 : 11) + trng() * 9;
      t = { type: pine ? 'pine' : (trng() < 0.12 ? 'maple' : 'broad'), h: hgt, r: pine ? 3 + trng() * 1.2 : 3.6 + trng() * 2.6 };
    } else if (links) {
      if (trng() > 0.5) continue;
      t = trng() < 0.85 ? { type: 'shrub', h: 1.2 + trng() * 0.8, r: 1.2 + trng() * 1.2 } : { type: 'broad', h: 7 + trng() * 4, r: 3 + trng() };
    } else {
      const r0 = trng();
      t = r0 < 0.45 ? { type: 'rock', h: 1 + trng() * 2.4, r: 0.8 + trng() * 2.2 }
        : r0 < 0.75 ? { type: 'juniper', h: 3 + trng() * 2.5, r: 1.4 + trng() * 1.2 }
          : { type: 'cactus', h: 3 + trng() * 4, r: 0.5 };
    }
    const x = u, z = -v;
    if (tooClose(x, z, t.r * 0.8)) continue;
    t.x = x; t.z = z; t.y = height(u, v); t.rot = trng() * 6.28; t.tint = trng();
    t.cy = t.type === 'rock' ? t.y + t.h * 0.3 : t.type === 'pine' ? t.y + t.h * 0.5 : t.type === 'cactus' ? t.y + t.h * 0.5 : t.y + t.h * 0.66;
    t.cr = t.type === 'pine' ? t.r * 0.9 : t.type === 'cactus' ? 0.6 : t.type === 'rock' ? t.r * 0.8 : t.r;
    addTree(t);
  }

  // 遠景樹（只畫不碰撞）
  const scenery = [];
  if (!links) {
    const n = park ? 2600 : 500;
    for (let i = 0; i < n; i++) {
      const u = lerp(bbox.minU - 250, bbox.maxU + 250, trng()), v = lerp(bbox.minV - 150, bbox.maxV + 350, trng());
      const { s, d } = near(u, v);
      if (Math.abs(d) < corridor + 20 && s > -40 && s < Lp + 60) continue;
      const pine = trng() < 0.3;
      scenery.push({ x: u, z: -v, uv: [u, v], type: park ? (pine ? 'pine' : (trng() < 0.15 ? 'maple' : 'broad')) : 'juniper', h: park ? 12 + trng() * 10 : 3 + trng() * 2, r: park ? 4 + trng() * 2.5 : 1.6, rot: trng() * 6.28, tint: trng() });
    }
  }

  // ---------- 世界座標介面（x = u, z = -v） ----------
  const H = (x, z) => height(x, -z);
  const api = {
    course, holeIdx, par, hcp, yards, feat: F, L: Lp, path, S, bbox, tees, pin: [pin[0], -pin[1]],
    green: { u: G[0], v: G[1], rx: grx, ry: gry, rot: gRot }, bunkers, waters, cross, seaSide, seaEdge, trees, scenery,
    near, pointAt, dirAt, fwHalf, greenR, surfaceUV: surface, heightUV: height, fs, fe,
    height: H,
    surface: (x, z) => surface(x, -z),
    normal(x, z) {
      const e = 0.3;
      const hx = (H(x + e, z) - H(x - e, z)) / (2 * e), hz = (H(x, z + e) - H(x, z - e)) / (2 * e);
      const l = Math.hypot(hx, 1, hz);
      return [-hx / l, 1 / l, -hz / l];
    },
    inBounds: (x, z) => x > bbox.minU && x < bbox.maxU && -z > bbox.minV && -z < bbox.maxV,
    distToPin: (x, z) => Math.hypot(x - api.pin[0], z - api.pin[1]),
    treeAt(x, y, z) {
      const arr = treeGrid.get(key(x, z));
      if (!arr) return null;
      for (const t of arr) {
        if (t.type === 'shrub') { if (y < t.y + t.h && Math.hypot(x - t.x, z - t.z) < t.r) return t; continue; }
        if (Math.hypot(x - t.x, y - t.cy, z - t.z) < t.cr) return t;
        if (t.type !== 'rock' && y < t.y + t.h * 0.4 && Math.hypot(x - t.x, z - t.z) < 0.35) return t; // 樹幹
      }
      return null;
    },
    teePos(teeId) {
      const t = tees.find(q => q.id === teeId) || tees[1];
      return [t.u, H(t.u, -t.v) + 0.0213, -t.v];   // 球心在地面上一個半徑
    },
    // 果嶺高度統計：平均高度與最大高低差（色階用）
    greenStats() {
      if (api._gs) return api._gs;
      let sum = 0, n = 0;
      const hs = [];
      for (let i = -20; i <= 20; i++) for (let j = -20; j <= 20; j++) {
        const u = G[0] + i * 0.7, v = G[1] + j * 0.7;
        if (greenR(u, v) >= 1) continue;
        const h = height(u, v);
        hs.push(h); sum += h; n++;
      }
      const h0 = sum / Math.max(1, n);
      const range = Math.max(0.12, ...hs.map(h => Math.abs(h - h0)));
      api._gs = { h0, range };
      return api._gs;
    },
    // 球道上第 dist 公尺處的中心點（給預設瞄準用）
    centerAt(s) { const p = pointAt(s); return [p[0], -p[1]]; },
  };
  return api;
}

// ---------- 地圖貼圖：顏色圖 + 材質遮罩 ----------
const PALETTE = {
  links: { fair: [128, 148, 78], fair2: [116, 136, 70], cut: [110, 128, 64], rough: [108, 120, 62], deep: [160, 146, 94], green: [104, 140, 64], green2: [94, 130, 58], fringe: [110, 140, 66], sand: [222, 204, 160], waste: [196, 178, 132], tee: [128, 158, 72], ob: [150, 140, 92] },
  parkland: { fair: [92, 134, 58], fair2: [80, 120, 50], cut: [76, 114, 48], rough: [62, 98, 42], deep: [50, 82, 34], green: [90, 138, 60], green2: [80, 128, 54], fringe: [84, 130, 56], sand: [232, 222, 196], waste: [130, 118, 84], tee: [90, 134, 58], ob: [46, 76, 32] },
  canyon: { fair: [100, 142, 60], fair2: [88, 130, 52], cut: [84, 122, 50], rough: [92, 116, 54], deep: [178, 112, 72], green: [94, 144, 62], green2: [84, 134, 56], fringe: [90, 136, 58], sand: [222, 200, 160], waste: [186, 118, 76], tee: [108, 158, 64], ob: [170, 104, 66] },
};

// opts.px：每像素幾公尺（縮圖用大一點的值，畫得很快）
export function paintMaps(hole, opts = {}) {
  const { bbox } = hole;
  const w = bbox.maxU - bbox.minU, h = bbox.maxV - bbox.minV;
  const px = opts.px || Math.max(0.3, Math.max(w, h) / 2048);
  const W = Math.round(w / px), Hh = Math.round(h / px);
  const pal = PALETTE[hole.course.style];
  const color = document.createElement('canvas');
  color.width = W; color.height = Hh;
  const mask = document.createElement('canvas');
  mask.width = W; mask.height = Hh;
  const cx = color.getContext('2d'), mx = mask.getContext('2d');
  const cimg = cx.createImageData(W, Hh), mimg = mx.createImageData(W, Hh);
  const cd = cimg.data, md = mimg.data;
  const nz = makeNoise(hashStr(hole.course.id + hole.holeIdx + 'paint'));
  const stripe = 9;
  const g = hole.green;
  const gc = Math.cos(g.rot + 0.4), gs = Math.sin(g.rot + 0.4);
  for (let j = 0; j < Hh; j++) {
    // 畫布第 0 列 = 最遠處（v 最大），對應世界 z 最小
    const v = bbox.maxV - (j + 0.5) * px;
    for (let i = 0; i < W; i++) {
      const u = bbox.minU + (i + 0.5) * px;
      const sf = hole.surfaceUV(u, v);
      const n1 = nz(u * 0.08, v * 0.08), n2 = nz(u * 0.5, v * 0.5);
      let c, sand = 0;
      switch (sf) {
        case SURF.FAIRWAY: {
          const { s, d } = hole.near(u, v);
          const edge = hole.fwHalf(s, d > 0 ? 1 : -1) - Math.abs(d);
          c = edge < 1.6 ? pal.cut : (Math.floor(s / stripe) % 2 ? pal.fair : pal.fair2);
          break;
        }
        case SURF.GREEN: {
          const lu = (u - g.u) * gc - (v - g.v) * gs, lv = (u - g.u) * gs + (v - g.v) * gc;
          c = (Math.floor(lu / 3.2) + Math.floor(lv / 3.2)) % 2 ? pal.green : pal.green2;
          break;
        }
        case SURF.FRINGE: c = pal.fringe; break;
        case SURF.TEE: c = (Math.floor(v / 2.5) % 2) ? pal.tee : pal.fair2; break;
        case SURF.ROUGH: c = pal.rough; break;
        case SURF.DEEP: c = pal.deep; break;
        case SURF.SAND: c = pal.sand; sand = 1; break;
        case SURF.WASTE: c = pal.waste; sand = 1; break;
        case SURF.WATER: c = [70, 92, 70]; break;
        case SURF.CHASM: c = pal.waste; sand = 1; break;
        default: c = pal.ob; sand = hole.course.style === 'canyon' ? 1 : 0;
      }
      const f = 1 + n1 * 0.10 + n2 * 0.05;
      const o = (j * W + i) * 4;
      cd[o] = clamp(c[0] * f, 0, 255); cd[o + 1] = clamp(c[1] * f, 0, 255); cd[o + 2] = clamp(c[2] * f, 0, 255); cd[o + 3] = 255;
      md[o] = sand * 255; md[o + 1] = sf === SURF.GREEN || sf === SURF.FRINGE ? 255 : 0; md[o + 2] = 0; md[o + 3] = 255;
    }
  }
  cx.putImageData(cimg, 0, 0);
  mx.putImageData(mimg, 0, 0);
  return { color, mask, px };
}
