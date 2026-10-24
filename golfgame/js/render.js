// Three.js 3D 場景：天空 HDR、地形（顏色圖 + 寫實細節材質）、水面、樹、旗桿、球、彈道線、瞄準標記
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { paintMaps } from './terrain.js';
import { makeNoise, makeRng, clamp } from './util.js';
import { heatColor } from './hud.js';

const BALL_R = 0.021335;
const QUALITY = {
  high: { ratio: 2, shadow: 2048, grid: 1.5, trees: 1, far: 1 },
  medium: { ratio: 1.5, shadow: 1536, grid: 2, trees: 0.8, far: 0.6 },
  low: { ratio: 1, shadow: 1024, grid: 3, trees: 0.55, far: 0.3 },
};

export class World {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    this.q = QUALITY[quality] || QUALITY.high;
    this.holeGroup = null;
    this.time = 0;
  }

  async init(onProgress = () => {}) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.ratio));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 6000);
    this.resize();
    window.addEventListener('resize', () => this.resize());

    const sun = this.sun = new THREE.DirectionalLight(0xfff0d8, 2.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -45; sc.right = sc.top = 45; sc.near = 1; sc.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.sunDir = new THREE.Vector3(-0.45, 0.78, 0.35).normalize();
    this.scene.add(sun, sun.target);
    this.scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5a32, 0.35));

    const tl = new THREE.TextureLoader();
    const load = (url, srgb) => new Promise(res => tl.load(url, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = r.capabilities.getMaxAnisotropy();
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      onProgress();
      res(t);
    }, undefined, () => { onProgress(); res(null); }));
    const [hdr, grassD, grassN, sandD, sandN, rockD, rockN] = await Promise.all([
      new Promise(res => new RGBELoader().load('assets/textures/sky.hdr', t => { onProgress(); res(t); }, undefined, () => { onProgress(); res(null); })),
      load('assets/textures/grass_d.jpg', true), load('assets/textures/grass_n.jpg'),
      load('assets/textures/sand_d.jpg', true), load('assets/textures/sand_n.jpg'),
      load('assets/textures/rock_d.jpg', true), load('assets/textures/rock_n.jpg'),
    ]);
    this.tex = { grassD, grassN, sandD, sandN, rockD, rockN };
    if (hdr) {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.background = hdr;
      const pm = new THREE.PMREMGenerator(r);
      this.scene.environment = pm.fromEquirectangular(hdr).texture;
      pm.dispose();
    } else {
      this.scene.background = new THREE.Color(0xbcd2df);
    }
    this.grassAvg = avgLum(grassD) || 0.3;
    this.sandAvg = avgLum(sandD) || 0.5;
    this.waterNormal = makeWaterNormal();

    this.buildBall();
    this.buildMarkers();
    this.buildTracer();
    return this;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    // 視窗被隱藏/切到背景時大小可能是 0，這時不更新（否則比例變成 NaN，鏡頭會壞掉）
    if (w < 2 || h < 2) return;
    this._w = w; this._h = h;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // 橫向寬螢幕時限制水平視角約 72°，避免畫面邊緣的人物和樹被拉寬變胖
    this.camera.fov = aspect < 1 ? 62 : Math.min(50, 2 * Math.atan(Math.tan(36 * Math.PI / 180) / aspect) * 180 / Math.PI);
    this.camera.updateProjectionMatrix();
  }

  // ---------- 地形材質：顏色圖 × 照片細節（近距離）+ 陡坡岩石 ----------
  terrainMaterial(colorTex, maskTex, style, vertexColors) {
    const m = new THREE.MeshStandardMaterial({
      map: colorTex || null, vertexColors: !!vertexColors, roughness: 0.93, metalness: 0,
      normalMap: this.tex.grassN, normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 0.55,
    });
    if (colorTex) colorTex.channel = 1;
    const tex = this.tex;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, {
        tGrassD: { value: tex.grassD }, tSandD: { value: tex.sandD }, tRock: { value: tex.rockD },
        tMask: { value: maskTex || tex.grassD }, uHasMask: { value: maskTex ? 1 : 0 },
        uGAvg: { value: this.grassAvg }, uSAvg: { value: this.sandAvg },
        uRock: { value: style === 'canyon' ? 1 : style === 'links' ? 0.15 : 0.35 },
        uSandAll: { value: !maskTex && style === 'canyon' ? 1 : 0 },
      });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWN; varying vec2 vMaskUv;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);
          #ifdef USE_MAP
            vMaskUv = vMapUv;
          #else
            vMaskUv = vec2(0.0);
          #endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWPos; varying vec3 vWN; varying vec2 vMaskUv;
          uniform sampler2D tGrassD; uniform sampler2D tSandD; uniform sampler2D tRock; uniform sampler2D tMask;
          uniform float uHasMask; uniform float uGAvg; uniform float uSAvg; uniform float uRock; uniform float uSandAll;
          float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec4 mk = uHasMask > 0.5 ? texture2D(tMask, vMaskUv) : vec4(uSandAll, 0.0, 0.0, 1.0);
          float dist = length(vWPos - cameraPosition);
          float fade = smoothstep(260.0, 12.0, dist);
          float g1 = lum(texture2D(tGrassD, vWPos.xz / 3.4).rgb) / uGAvg;
          float g2 = lum(texture2D(tGrassD, vWPos.xz / 29.0 + 0.37).rgb) / uGAvg;
          float s1 = lum(texture2D(tSandD, vWPos.xz / 2.6).rgb) / uSAvg;
          float det = mix(g1, s1, mk.r);
          float k = mix(1.0, det, mix(0.6, 0.22, mk.g) * fade) * mix(1.0, g2, 0.22 * (1.0 - mk.r));
          diffuseColor.rgb *= clamp(k, 0.55, 1.5);
          vec3 an = abs(vWN);
          vec3 rk = texture2D(tRock, vWPos.zy / 7.0).rgb * an.x + texture2D(tRock, vWPos.xy / 7.0).rgb * an.z + texture2D(tRock, vWPos.xz / 7.0).rgb * an.y;
          rk /= (an.x + an.y + an.z);
          float steep = smoothstep(0.42, 0.62, 1.0 - vWN.y) * uRock;
          diffuseColor.rgb = mix(diffuseColor.rgb, rk * vec3(1.08, 0.82, 0.72), steep);`);
    };
    return m;
  }

  disposeHole() {
    if (!this.holeGroup) return;
    this.scene.remove(this.holeGroup);
    this.holeGroup.traverse(o => {
      // 樹的形狀是所有洞共用的，不釋放（否則每洞都要重新上傳到顯示卡）
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(mt => { if (mt.map && mt.map.isCanvasTexture) mt.map.dispose(); mt.dispose(); });
      }
    });
    // 地形的顏色圖 / 材質遮罩（遮罩不在 material.map 上，要另外釋放，否則每換一洞就漏掉幾 MB 顯示記憶體）
    (this.holeTextures || []).forEach(t => t.dispose());
    this.holeTextures = [];
    this.waterMats = [];
    this.holeGroup = null;
  }

  async loadHole(hole) {
    this.disposeHole();
    this.hole = hole;
    const g = this.holeGroup = new THREE.Group();
    this.scene.add(g);
    const style = hole.course.style;
    const fogCol = style === 'canyon' ? 0xd9c3a8 : style === 'links' ? 0xc8d6dc : 0xc6d4d6;
    this.scene.fog = new THREE.Fog(fogCol, 380, 3200);

    // 顏色圖
    const maps = paintMaps(hole);
    const colorTex = new THREE.CanvasTexture(maps.color);
    colorTex.colorSpace = THREE.SRGBColorSpace;
    colorTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const maskTex = new THREE.CanvasTexture(maps.mask);
    this.holeTextures = [colorTex, maskTex];
    this.colorCanvas = maps.color;

    // 精細地形網格
    const b = hole.bbox, step = this.q.grid;
    const nx = Math.ceil((b.maxU - b.minU) / step) + 1, nz = Math.ceil((b.maxV - b.minV) / step) + 1;
    const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), uv1 = new Float32Array(nx * nz * 2);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const u = Math.min(b.minU + i * step, b.maxU), v = Math.min(b.minV + j * step, b.maxV);
      const k = j * nx + i;
      pos[k * 3] = u; pos[k * 3 + 1] = hole.heightUV(u, v); pos[k * 3 + 2] = -v;
      uv[k * 2] = u / 4; uv[k * 2 + 1] = v / 4;
      uv1[k * 2] = (u - b.minU) / (b.maxU - b.minU); uv1[k * 2 + 1] = (v - b.minV) / (b.maxV - b.minV);
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, c = a + nx;
      idx[p++] = a; idx[p++] = a + 1; idx[p++] = c; idx[p++] = a + 1; idx[p++] = c + 1; idx[p++] = c;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    this.tgrid = { minU: b.minU, minV: b.minV, step, nx, nz, pos };
    const terrain = new THREE.Mesh(geo, this.terrainMaterial(colorTex, maskTex, style));
    terrain.receiveShadow = true;
    g.add(terrain);
    this.terrainMesh = terrain;
    await frame();

    // 外圍大地形（同一個高度函數，地圖範圍內往下壓避免重疊）
    g.add(this.buildSkirt(hole, style));
    if (hole.seaSide || style === 'links') g.add(this.buildSea(hole));
    this.buildWaters(hole, g);
    await frame();
    this.buildTrees(hole, g);
    await frame();
    this.buildTeeMarkers(hole, g);
    this.buildFlag(hole, g);
    this.buildGreenGrid(hole, g);
  }

  buildSkirt(hole, style) {
    const b = hole.bbox;
    const cu = (b.minU + b.maxU) / 2, cv = (b.minV + b.maxV) / 2;
    const size = 4200, n = Math.round(150 * (0.6 + 0.4 * this.q.far)) + 40;
    const geo = new THREE.PlaneGeometry(size, size, n, n);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const nz = makeNoise(77 + hole.holeIdx);
    const base = style === 'canyon' ? [0.70, 0.42, 0.27] : style === 'links' ? [0.55, 0.53, 0.33] : [0.24, 0.36, 0.16];
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + cu, v = -pos.getZ(i) + cv;
      const inside = Math.min(u - b.minU, b.maxU - u, v - b.minV, b.maxV - v);
      let hh = hole.heightUV(u, v);
      const far = Math.hypot(u - cu, v - cv);
      if (style === 'canyon') hh += 45 * Math.max(0, nz.fbm(u / 300, v / 300, 3) + 0.05) * clamp((far - 500) / 500, 0, 1);
      else if (style === 'parkland') hh += 30 * (0.5 + nz.fbm(u / 500, v / 500, 3)) * clamp((far - 450) / 700, 0, 1);
      else hh += 6 * nz.fbm(u / 120, v / 120, 2) * clamp((far - 400) / 400, 0, 1);
      if (inside > 0) hh -= 0.6 * clamp(inside / 12, 0, 1);
      pos.setXYZ(i, u, hh, -v);
      const f = 0.85 + 0.25 * nz(u / 40, v / 40);
      col[i * 3] = base[0] * f; col[i * 3 + 1] = base[1] * f; col[i * 3 + 2] = base[2] * f;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 4, -pos.getZ(i) / 4);
    geo.computeVertexNormals();
    const mat = this.terrainMaterial(null, null, style, true);
    mat.polygonOffset = true; mat.polygonOffsetFactor = 2; mat.polygonOffsetUnits = 2;
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    return m;
  }

  waterMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x24464f, roughness: 0.06, metalness: 0.0, normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.28, 0.28),
      envMapIntensity: 1.25, transparent: true, opacity: 0.94,
    });
  }

  buildSea(hole) {
    const geo = new THREE.PlaneGeometry(8000, 8000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, this.waterMaterial());
    m.position.y = -0.9;
    m.receiveShadow = true;
    this.waterMats = (this.waterMats || []).concat(m.material);
    return m;
  }

  buildWaters(hole, g) {
    this.waterMats = this.waterMats || [];
    for (const w of hole.waters) {
      if (w.kind !== 'pond') continue;
      const shape = new THREE.Shape();
      for (let i = 0; i <= 64; i++) {
        const a = i / 64 * Math.PI * 2;
        const lu = Math.cos(a) * w.rx * 1.35, lv = Math.sin(a) * w.ry * 1.35;
        const c = Math.cos(-w.rot), s = Math.sin(-w.rot);
        const u = w.u + lu * c - lv * s, v = w.v + lu * s + lv * c;
        if (i === 0) shape.moveTo(u, v); else shape.lineTo(u, v);
      }
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const mat = this.waterMaterial();
      this.waterMats.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = w.level + 0.05;
      m.receiveShadow = true;
      g.add(m);
    }
    const cr = hole.cross;
    if (cr && cr.kind === 'creek') {
      const pts = [];
      for (let d = -hole.course.corridor - 40; d <= hole.course.corridor + 40; d += 4) {
        const p = hole.pointAt(cr.s), dir = hole.dirAt(cr.s);
        pts.push([p[0] + dir[1] * d, p[1] - dir[0] * d, dir]);
      }
      const verts = [], idx = [];
      pts.forEach(([u, v, dir], i) => {
        const hw = cr.half + 3;
        verts.push(u - dir[0] * hw, 0, -(v - dir[1] * hw), u + dir[0] * hw, 0, -(v + dir[1] * hw));
        if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mat = this.waterMaterial();
      mat.side = THREE.DoubleSide;
      this.waterMats.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = cr.level + 0.25;
      g.add(m);
    }
  }

  // ---------- 樹木 ----------
  treeGeos() {
    if (this._treeGeos) return this._treeGeos;
    const nz = makeNoise(42);
    const blob = (r, seg = 2) => {
      const gg = new THREE.IcosahedronGeometry(r, seg);
      const p = gg.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 1 + 0.2 * nz(x * 2.2 + 3, y * 2.2 + z * 1.7) + 0.09 * nz(x * 7, z * 7 + y * 3) + 0.05 * nz(x * 16 + y * 9, z * 16);
        p.setXYZ(i, x * k, y * k, z * k);
      }
      return gg;
    };
    const colorize = (gg, top, bot) => {
      const p = gg.attributes.position, c = new Float32Array(p.count * 3);
      gg.computeBoundingBox();
      const y0 = gg.boundingBox.min.y, y1 = gg.boundingBox.max.y;
      for (let i = 0; i < p.count; i++) {
        const t = (p.getY(i) - y0) / (y1 - y0);
        const n = 0.85 + 0.3 * Math.abs(nz(p.getX(i) * 5, p.getZ(i) * 5 + p.getY(i) * 3));
        for (let k = 0; k < 3; k++) c[i * 3 + k] = (bot[k] + (top[k] - bot[k]) * t) * n;
      }
      gg.setAttribute('color', new THREE.BufferAttribute(c, 3));
      return gg;
    };
    // 闊葉樹冠：多顆凹凸球合併，半徑約 1
    const parts = [[0, 0, 0, 0.72], [0.45, -0.15, 0.2, 0.55], [-0.42, -0.1, -0.25, 0.55], [0.1, 0.4, -0.3, 0.5], [-0.2, 0.35, 0.35, 0.48], [0.25, -0.35, -0.45, 0.45], [-0.35, -0.4, 0.4, 0.42]];
    const smoothBlob = (r, x, y, z) => { const gg = blob(r, 3); gg.deleteAttribute('uv'); gg.deleteAttribute('normal'); const m = mergeVertices(gg); m.computeVertexNormals(); return m.translate(x, y, z); };
    const broad = colorize(mergeGeometries(parts.map(([x, y, z, r]) => smoothBlob(r, x, y, z))), [1, 1, 1], [0.42, 0.48, 0.42]);
    // 松樹：四層錐體，高度 1、半徑約 0.35
    const cones = [];
    for (let i = 0; i < 8; i++) {
      const cg = new THREE.ConeGeometry(0.44 - i * 0.048, 0.26, 14, 3, true);
      const p = cg.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        const a = Math.atan2(z, x);
        const f = 1 + 0.16 * nz(Math.cos(a) * 3 + i, Math.sin(a) * 3) + 0.12 * Math.sin(a * 7 + i) * (0.5 - y);
        p.setX(k, x * f); p.setZ(k, z * f); p.setY(k, y - 0.05 * Math.abs(Math.sin(a * 5 + i)) * (0.5 - y));
      }
      cg.translate(0, 0.24 + i * 0.095, 0);
      cg.deleteAttribute('uv');
      cones.push(cg);
    }
    const pine = colorize(mergeGeometries(cones), [0.95, 1, 0.95], [0.45, 0.5, 0.45]);
    pine.computeVertexNormals();
    const trunk = new THREE.CylinderGeometry(0.7, 1, 1, 7, 1);
    trunk.translate(0, 0.5, 0);
    const rock = blob(1, 1);
    rock.scale(1, 0.62, 1);
    rock.computeVertexNormals();
    // 仙人掌：主幹 + 兩支手臂
    const cyl = (r, h) => new THREE.CapsuleGeometry(r, h, 4, 8);
    const arm1 = cyl(0.11, 0.4).translate(0.32, 0.45, 0), arm1b = cyl(0.1, 0.35).rotateZ(Math.PI / 2).translate(0.2, 0.25, 0);
    const arm2 = cyl(0.1, 0.32).translate(-0.3, 0.55, 0), arm2b = cyl(0.09, 0.3).rotateZ(Math.PI / 2).translate(-0.18, 0.38, 0);
    const cactus = mergeGeometries([cyl(0.15, 0.8).translate(0, 0.5, 0), arm1, arm1b, arm2, arm2b].map(gg => { gg.deleteAttribute('uv'); return gg; }));
    this._treeGeos = { broad, pine, trunk, rock, cactus, shrub: broad };
    for (const gg of [broad, pine, trunk, rock, cactus]) gg.userData.shared = true;
    return this._treeGeos;
  }

  buildTrees(hole, g) {
    const G = this.treeGeos();
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, envMapIntensity: 0.5 });
    // 樹冠隨風擺動：位移方向 = 風向，幅度隨風速與高度增加，每棵樹相位不同
    this.windU = this.windU || { uTime: { value: 0 }, uWind: { value: new THREE.Vector2() } };
    leafMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = this.windU.uTime;
      sh.uniforms.uWind = this.windU.uWind;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec2 uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            mat3 swIm = mat3(instanceMatrix);
            float swPh = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17;
            float swWs = length(uWind);
            float swAmt = 0.6 + 0.4 * sin(uTime * (1.1 + swWs * 0.18) + swPh) + 0.15 * sin(uTime * 3.7 + swPh * 2.0);
            float swH = clamp(position.y + 0.7, 0.0, 1.8);
            vec3 swD = vec3(uWind.x, 0.0, uWind.y) * swAmt * swH * 0.05;
            vec3 swL = transpose(swIm) * swD;
            swL /= vec3(dot(swIm[0], swIm[0]), dot(swIm[1], swIm[1]), dot(swIm[2], swIm[2]));
            transformed += swL;
          #endif`);
    };
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 });
    const rockMat = new THREE.MeshStandardMaterial({ map: this.tex.rockD, normalMap: this.tex.rockN, color: 0xd29a7a, roughness: 0.95 });
    const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4f6b3a, roughness: 0.75 });
    const all = hole.trees.map(t => ({ ...t, near: true }));
    const keep = this.q.trees;
    const rng = makeRng(9);
    for (const t of hole.scenery) if (rng() < keep * this.q.far + 0.15) all.push({ ...t, y: hole.heightUV(t.uv[0], t.uv[1]), near: false });
    const groups = {};
    const add = (k, t) => (groups[k] = groups[k] || []).push(t);
    for (const t of all) {
      if (t.type === 'broad' || t.type === 'maple' || t.type === 'shrub' || t.type === 'juniper') { add('canopy' + (t.near ? 'N' : 'F'), t); if (t.type !== 'shrub') add('trunk' + (t.near ? 'N' : 'F'), t); }
      else if (t.type === 'pine') { add('pine' + (t.near ? 'N' : 'F'), t); add('trunk' + (t.near ? 'N' : 'F'), t); }
      else add(t.type, t);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const make = (geo, mat, list, fn, shadow) => {
      if (!list || !list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => {
        const col = fn(t, p, s);
        q.setFromAxisAngle(up, t.rot);
        m4.compose(p, q, s);
        im.setMatrixAt(i, m4);
        if (col) im.setColorAt(i, col);
      });
      im.castShadow = shadow; im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
      g.add(im);
    };
    const canopyColor = t => {
      if (t.type === 'maple') return c.setHSL(0.04 + t.tint * 0.06, 0.62, 0.36 + t.tint * 0.08);
      if (t.type === 'shrub') return c.setHSL(0.2, 0.3, 0.15 + t.tint * 0.05);
      if (t.type === 'juniper') return c.setHSL(0.22, 0.2, 0.17 + t.tint * 0.05);
      return c.setHSL(0.24 + t.tint * 0.06, 0.38 + t.tint * 0.12, 0.25 + t.tint * 0.07);
    };
    for (const sfx of ['N', 'F']) {
      make(G.broad, leafMat, groups['canopy' + sfx], (t, P, S) => {
        const lowCanopy = t.type === 'shrub' || t.type === 'juniper';
        P.set(t.x, lowCanopy ? t.y + t.h * 0.45 : t.y + t.h * 0.64, t.z);
        S.set(t.r, lowCanopy ? t.h * 0.55 : t.r * 1.08 + t.h * 0.05, t.r);
        return canopyColor(t);
      }, sfx === 'N');
      make(G.pine, leafMat, groups['pine' + sfx], (t, P, S) => {
        P.set(t.x, t.y, t.z); S.set(t.r / 0.4, t.h, t.r / 0.4);
        return c.setHSL(0.36, 0.3, 0.2 + t.tint * 0.05);
      }, sfx === 'N');
      make(G.trunk, barkMat, groups['trunk' + sfx], (t, P, S) => {
        P.set(t.x, t.y - 0.3, t.z);
        const tr = t.type === 'juniper' ? 0.12 : 0.16 + t.h * 0.012;
        S.set(tr, t.type === 'pine' ? t.h * 0.4 : t.h * 0.55, tr);
        return null;
      }, sfx === 'N');
    }
    make(G.rock, rockMat, groups.rock, (t, P, S) => { P.set(t.x, t.y + t.h * 0.15, t.z); S.set(t.r, t.h * 0.7, t.r * (0.7 + t.tint * 0.5)); return null; }, true);
    make(G.cactus, cactusMat, groups.cactus, (t, P, S) => { P.set(t.x, t.y - 0.2, t.z); S.set(t.h * 0.28, t.h * 0.95, t.h * 0.28); return null; }, true);
  }

  buildTeeMarkers(hole, g) {
    const geo = new THREE.SphereGeometry(0.11, 16, 12);
    for (const t of hole.tees) {
      const mat = new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.35, metalness: 0.1 });
      for (const side of [-1, 1]) {
        const u = t.u + t.dir[1] * side * 3.6 + t.dir[0] * 1.5, v = t.v - t.dir[0] * side * 3.6 + t.dir[1] * 1.5;
        const m = new THREE.Mesh(geo, mat);
        m.position.set(u, hole.heightUV(u, v) + 0.08, -v);
        m.castShadow = true;
        g.add(m);
      }
    }
  }

  buildFlag(hole, g) {
    const [px, pz] = hole.pin;
    const py = hole.height(px, pz);
    const grp = this.flag = new THREE.Group();
    grp.position.set(px, py, pz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.4, 8), new THREE.MeshStandardMaterial({ color: 0xf2e6a8, roughness: 0.4 }));
    pole.position.y = 1.2;
    pole.castShadow = true;
    const cloth = new THREE.PlaneGeometry(0.55, 0.38, 12, 6);
    cloth.translate(0.275, 0, 0);
    this.flagCloth = cloth;
    this.flagBase = cloth.attributes.position.array.slice();
    const flag = new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ color: 0xb2332b, roughness: 0.8, side: THREE.DoubleSide }));
    flag.position.y = 2.2;
    flag.castShadow = true;
    this.flagMesh = flag;
    const cup = new THREE.Mesh(new THREE.CircleGeometry(0.054, 24), new THREE.MeshBasicMaterial({ color: 0x0b0d08 }));
    cup.rotation.x = -Math.PI / 2;
    cup.position.y = 0.006;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.056, 24), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.007;
    grp.add(pole, flag, cup, ring);
    g.add(grp);
  }

  // 果嶺高低格線（推桿時顯示）：比果嶺平均高 → 紅、低 → 藍、平 → 綠
  buildGreenGrid(hole, g) {
    const gr = hole.green;
    const pts = [], cols = [];
    const R = Math.max(gr.rx, gr.ry) * 1.3;
    const col = new THREE.Color();
    const gs = hole.greenStats();
    const addSeg = (u0, v0, u1, v1) => {
      const h0 = hole.heightUV(u0, v0) + 0.02, h1 = hole.heightUV(u1, v1) + 0.02;
      const [cr, cg, cb] = heatColor(((h0 + h1) / 2 - 0.02 - gs.h0) / gs.range);
      col.setRGB(cr / 255, cg / 255, cb / 255, THREE.SRGBColorSpace);
      pts.push(u0, h0, -v0, u1, h1, -v1);
      cols.push(col.r, col.g, col.b, col.r, col.g, col.b);
    };
    const stp = 1;
    for (let a = -R; a <= R; a += stp) for (let b2 = -R; b2 <= R; b2 += stp * 0.5) {
      for (const dirc of [0, 1]) {
        const u0 = gr.u + (dirc ? a : b2), v0 = gr.v + (dirc ? b2 : a);
        const u1 = u0 + (dirc ? 0 : stp * 0.5), v1 = v0 + (dirc ? stp * 0.5 : 0);
        if (hole.greenR(u0, v0) < 1.02 && hole.greenR(u1, v1) < 1.02) addSeg(u0, v0, u1, v1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.greenGrid = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false }));
    this.greenGrid.visible = false;
    g.add(this.greenGrid);
  }

  // 練習場沙坑：把發球台換成一片沙地（傳 null 隱藏）
  setSandPatch(tee) {
    if (!this.sandPatch) {
      const tex = this.tex.sandD.clone();
      tex.needsUpdate = true;
      tex.repeat.set(3, 2);
      const m = new THREE.MeshStandardMaterial({ map: tex, normalMap: this.tex.sandN, color: 0xf2e6c8, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const g = new THREE.PlaneGeometry(12, 9, 1, 1);
      g.rotateX(-Math.PI / 2);
      this.sandPatch = new THREE.Mesh(g, m);
      this.sandPatch.receiveShadow = true;
      this.scene.add(this.sandPatch);
    }
    this.sandPatch.visible = !!tee && !!this.hole;
    if (!this.sandPatch.visible) return;
    this.sandPatch.position.set(tee.u, this.hole.heightUV(tee.u, tee.v) + 0.004, -tee.v);
    this.sandPatch.rotation.y = -Math.atan2(tee.dir[0], tee.dir[1]);
  }

  // ---------- 球、陰影、彈道、瞄準 ----------
  buildBall() {
    const tex = makeDimpleNormal();
    const ball = this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 20), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, normalMap: tex, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 0.9 }));
    ball.castShadow = true;
    this.scene.add(ball);
    const sh = this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.1, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    this.scene.add(sh);
  }

  // 畫面上地形網格（每 1.5m 一個點、三角形內插）的高度。凹下去的地方（沙坑）網格會比物理高度高一點
  meshHeight(x, z) {
    const g = this.tgrid;
    if (!g) return this.hole ? this.hole.height(x, z) : 0;
    const fi = (x - g.minU) / g.step, fj = (-z - g.minV) / g.step;
    const i = Math.max(0, Math.min(g.nx - 2, Math.floor(fi))), j = Math.max(0, Math.min(g.nz - 2, Math.floor(fj)));
    const fx = Math.max(0, Math.min(1, fi - i)), fz = Math.max(0, Math.min(1, fj - j));
    const H = (ii, jj) => g.pos[((jj * g.nx) + ii) * 3 + 1];
    const h00 = H(i, j), h10 = H(i + 1, j), h01 = H(i, j + 1), h11 = H(i + 1, j + 1);
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  setBall(x, y, z) {
    const gh0 = this.hole ? this.hole.height(x, z) : y - BALL_R;
    // 球在地面上時，畫在「畫面網格」上面，不會看起來陷進沙裡或草裡
    if (this.hole && y - gh0 < BALL_R + 0.05) y = Math.max(y, this.meshHeight(x, z) + BALL_R);
    this.ball.position.set(x, y, z);
    const gh = gh0;
    this.ballShadow.position.set(x, gh + 0.01, z);
    const air = y - gh - BALL_R;
    this.ballShadow.visible = air > 0.05;
    this.ballShadow.material.opacity = clamp(0.35 - air * 0.006, 0.08, 0.35);
  }

  buildMarkers() {
    // 預估落點：一個白點（外圈一點深色邊，在亮草地上也看得到）
    const edge = new THREE.Mesh(new THREE.CircleGeometry(0.62, 32), new THREE.MeshBasicMaterial({ color: 0x0b1510, transparent: true, opacity: 0.45, depthWrite: false }));
    edge.rotation.x = -Math.PI / 2;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false }));
    dot.rotation.x = -Math.PI / 2;
    dot.position.y = 0.01;
    const tgt = this.target = new THREE.Group();
    tgt.add(edge, dot);
    tgt.renderOrder = 5;
    this.scene.add(tgt);
    // 推桿預測線
    const pl = new THREE.BufferGeometry();
    pl.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
    this.puttLine = new THREE.Points(pl, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false }));
    this.puttLine.visible = false;
    this.puttLine.renderOrder = 10;   // 不做深度測試：草地網格起伏不會把引導線蓋掉
    this.puttLine.frustumCulled = false;
    this.scene.add(this.puttLine);
  }

  setTarget(x, z, scale = 1, visible = true) {
    this.target.visible = visible;
    if (!visible || !this.hole) return;
    this.target.position.set(x, this.hole.height(x, z) + 0.08, z);

  }

  setPuttLine(points) {
    if (!points) { this.puttLine.visible = false; return; }
    const arr = this.puttLine.geometry.attributes.position.array;
    const n = Math.min(points.length, 600);
    for (let i = 0; i < n; i++) { arr[i * 3] = points[i][0]; arr[i * 3 + 1] = points[i][1] + 0.015; arr[i * 3 + 2] = points[i][2]; }
    this.puttLine.geometry.setDrawRange(0, n);
    this.puttLine.geometry.attributes.position.needsUpdate = true;
    this.puttLine.visible = true;
  }

  buildTracer() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(1200 * 6), 3));
    const idx = [];
    for (let i = 0; i < 1199; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.tracer = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xf2d27a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    this.tracer.frustumCulled = false;
    this.tracerPts = [];
    this.scene.add(this.tracer);
  }

  clearTracer() { this.tracerPts = []; this.tracer.geometry.setDrawRange(0, 0); }
  pushTracer(x, y, z) { if (this.tracerPts.length < 1200) this.tracerPts.push(new THREE.Vector3(x, y, z)); }

  updateTracer() {
    const pts = this.tracerPts, n = pts.length;
    if (n < 2) { this.tracer.geometry.setDrawRange(0, 0); return; }
    const arr = this.tracer.geometry.attributes.position.array;
    const cam = this.camera.position, t = new THREE.Vector3(), v = new THREE.Vector3(), o = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      t.subVectors(b, a).normalize();
      v.subVectors(pts[i], cam);
      const w = Math.max(0.025, v.length() * 0.0022);
      o.crossVectors(t, v).normalize().multiplyScalar(w);
      arr[i * 6] = pts[i].x + o.x; arr[i * 6 + 1] = pts[i].y + o.y; arr[i * 6 + 2] = pts[i].z + o.z;
      arr[i * 6 + 3] = pts[i].x - o.x; arr[i * 6 + 4] = pts[i].y - o.y; arr[i * 6 + 5] = pts[i].z - o.z;
    }
    this.tracer.geometry.attributes.position.needsUpdate = true;
    this.tracer.geometry.setDrawRange(0, (n - 1) * 6);
  }

  // OK 推範圍：以洞為中心、半徑 = OK 推距離的淡白色圓圈（貼著果嶺起伏）。radius = 0 隱藏
  setGimmeRing(radius) {
    if (this.gimmeRing && (this.gimmeRing.userData.r !== radius || this.gimmeRing.userData.hole !== this.hole)) {
      this.scene.remove(this.gimmeRing); this.gimmeRing.geometry.dispose(); this.gimmeRing.material.dispose(); this.gimmeRing = null;
    }
    if (!radius || !this.hole) { if (this.gimmeRing) this.gimmeRing.visible = false; return; }
    if (!this.gimmeRing) {
      const [px, pz] = this.hole.pin;
      const pts = [];
      for (let i = 0; i < 96; i++) {
        const a = i / 96 * Math.PI * 2, x = px + Math.cos(a) * radius, z = pz + Math.sin(a) * radius;
        pts.push(new THREE.Vector3(x, this.meshHeight(x, z) + 0.02, z));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.gimmeRing = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
      this.gimmeRing.renderOrder = 6;
      this.gimmeRing.userData = { r: radius, hole: this.hole };
      this.scene.add(this.gimmeRing);
    }
    this.gimmeRing.visible = true;
  }

  // 進洞小動畫：洞口噴出金色、白色小火花（受重力落下、慢慢淡出）
  cupBurst(x, y, z) {
    const n = 80;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const vel = [];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos[i * 3] = x; pos[i * 3 + 1] = y + 0.02; pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * 0.9;
      vel.push([Math.cos(a) * sp, 1.6 + Math.random() * 1.8, Math.sin(a) * sp]);
      c.setHSL(0.09 + Math.random() * 0.06, 1, Math.random() < 0.25 ? 0.85 : 0.55);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!this.sparkTex) {
      // 圓形光點貼圖（中心亮、邊緣漸淡）
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const cx = cv.getContext('2d');
      const gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
      this.sparkTex = new THREE.CanvasTexture(cv);
    }
    const mat = new THREE.PointsMaterial({ map: this.sparkTex, size: 0.11, vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    (this.bursts = this.bursts || []).push({ pts, vel, t: 0, y0: y });
  }

  updateBursts(dt) {
    if (!this.bursts || !this.bursts.length) return;
    for (const b of this.bursts) {
      b.t += dt;
      const p = b.pts.geometry.attributes.position;
      for (let i = 0; i < b.vel.length; i++) {
        const v = b.vel[i];
        v[1] -= 6 * dt;
        p.setXYZ(i, p.getX(i) + v[0] * dt, Math.max(b.y0, p.getY(i) + v[1] * dt), p.getZ(i) + v[2] * dt);
      }
      p.needsUpdate = true;
      b.pts.material.opacity = Math.max(0, 1 - b.t / 1.3);
    }
    this.bursts = this.bursts.filter(b => {
      if (b.t < 1.3) return true;
      this.scene.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose();   // 貼圖共用，不釋放
      return false;
    });
  }

  // 風紋：鏡頭附近飄過的細白線，數量、速度、亮度隨風速增加（15 mph 最明顯）
  updateWindStreaks(dt, windVec) {
    const N = 140;
    if (!this.streaks) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      this.streaks = new THREE.LineSegments(geo, mat);
      this.streaks.frustumCulled = false;
      this.scene.add(this.streaks);
      this.streakData = Array.from({ length: N }, () => ({ p: new THREE.Vector3(), life: 0, len: 2, phase: Math.random() * 6 }));
    }
    const ws = windVec ? Math.hypot(windVec[0], windVec[1]) : 0;
    const strength = clamp(ws / 6.7, 0, 1);            // 6.7 m/s ≈ 15 mph
    const count = Math.round(strength * N);
    this.streaks.visible = count > 0 && !!this.hole;
    if (!this.streaks.visible) return;
    this.streaks.material.opacity = 0.12 + 0.28 * strength;
    const dir = new THREE.Vector3(windVec[0], 0, windVec[1]).normalize();
    const cam = this.camera.position;
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const center = cam.clone().addScaledVector(fwd, 18);
    const R = 26;
    const arr = this.streaks.geometry.attributes.position.array;
    const speed = ws * 1.6 + 2;
    for (let i = 0; i < N; i++) {
      const s = this.streakData[i];
      if (i >= count) { arr.fill(0, i * 6, i * 6 + 6); continue; }
      s.life -= dt;
      const ox = s.p.x - center.x, oz = s.p.z - center.z;   // 不建立新物件，避免每幀大量垃圾回收造成卡頓
      if (s.life <= 0 || ox * ox + oz * oz > R * R) {
        // 從上風處重新出現
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
        s.p.set(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r).addScaledVector(dir, -R * 0.5 * Math.random());
        const gh = this.hole.height(s.p.x, s.p.z);
        s.p.y = gh + 0.4 + Math.random() * 6;
        s.life = 1.5 + Math.random() * 2.5;
        s.len = (1.2 + Math.random() * 2.5) * (0.6 + strength);
      }
      s.p.addScaledVector(dir, speed * dt);
      s.p.y += Math.sin(this.time * 2 + s.phase) * 0.15 * dt;
      arr[i * 6] = s.p.x; arr[i * 6 + 1] = s.p.y; arr[i * 6 + 2] = s.p.z;
      arr[i * 6 + 3] = s.p.x - dir.x * s.len; arr[i * 6 + 4] = s.p.y; arr[i * 6 + 5] = s.p.z - dir.z * s.len;
    }
    this.streaks.geometry.attributes.position.needsUpdate = true;
  }

  // ---------- 每幀 ----------
  // 自動畫質：連續約 2 秒每幀超過 1/32 秒（低於約 30fps），就把解析度降一級；最後一級再縮小陰影。只降不升，確保流暢
  watchPerf(dt) {
    const pf = this.perf || (this.perf = { ema: 1 / 60, slow: 0, level: 0 });
    pf.ema += (dt - pf.ema) * 0.05;
    if (pf.ema > 1 / 32) pf.slow += dt; else pf.slow = Math.max(0, pf.slow - dt * 0.5);
    if (pf.slow < 2 || pf.level >= 4) return;
    pf.slow = 0;
    pf.level++;
    const r = this.renderer;
    if (pf.level <= 3) {
      r.setPixelRatio(Math.max(0.75, r.getPixelRatio() * 0.8));
      this._w = 0;                     // 讓下一幀重新設定畫布大小
    } else {
      this.sun.shadow.mapSize.set(1024, 1024);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    console.info('[Dixen] 畫面較慢，自動降低畫質一級', pf.level, r.getPixelRatio());
  }

  frame(dt, windVec) {
    this.time += dt;
    this.watchPerf(dt);
    // 手機轉向時 resize 事件可能比版面更新早，所以每幀檢查一次畫布大小
    if (this.canvas.clientWidth !== this._w || this.canvas.clientHeight !== this._h) this.resize();
    // 球在遠處放大，維持最小可見尺寸
    const d = this.camera.position.distanceTo(this.ball.position);
    this.ball.scale.setScalar(Math.max(1, d * 0.0028 / (2 * BALL_R)));
    this.ballShadow.scale.setScalar(this.ball.scale.x);
    // 陰影跟著鏡頭關注點
    const focus = this.shadowFocus || this.ball.position;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 200);
    if (this.waterMats) for (const m of this.waterMats) { m.normalMap.offset.x = this.time * 0.012; m.normalMap.offset.y = this.time * 0.007; }
    if (this.flagCloth && windVec) {
      const p = this.flagCloth.attributes.position, base = this.flagBase;
      const ws = Math.hypot(windVec[0], windVec[1]);
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        const amp = 0.02 + ws * 0.006;
        p.setZ(i, Math.sin(x * 9 - this.time * (4 + ws * 0.6) + y * 2) * amp * (x / 0.55));
        p.setY(i, y - x * Math.max(0, 0.5 - ws * 0.06) * 0.6);
      }
      p.needsUpdate = true;
      this.flagCloth.computeVertexNormals();
      if (ws > 0.1) this.flagMesh.rotation.y = Math.atan2(-windVec[1], windVec[0]);
    }
    if (this.greenGrid && this.greenGrid.visible) this.greenGrid.material.opacity = 0.68 + 0.1 * Math.sin(this.time * 2);
    // 落點白點依距離放大，在畫面上大約維持同樣大小
    if (this.target.visible) this.target.scale.setScalar(Math.max(0.3, this.camera.position.distanceTo(this.target.position) * 0.011));
    this.updateBursts(dt);
    if (this.windU && windVec) { this.windU.uTime.value = this.time; this.windU.uWind.value.set(windVec[0], windVec[1]); }
    this.updateWindStreaks(dt, windVec);
    this.updateTracer();
    this.renderer.render(this.scene, this.camera);
  }

  // 把世界座標投影成畫面像素（HUD 標籤用）
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, visible: v.z < 1 && v.z > -1 };
  }
}

// 讓出一個畫面更新；分頁在背景時 requestAnimationFrame 不會觸發，用 setTimeout 保底
const frame = () => new Promise(r => { requestAnimationFrame(() => r()); setTimeout(r, 60); });

function avgLum(tex) {
  try {
    const img = tex.image;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, 64, 64);
    const d = x.getImageData(0, 0, 64, 64).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    // 貼圖是 sRGB，著色器取樣時已轉線性，平均值也轉線性
    return Math.pow(s / (d.length / 4), 2.2);
  } catch (e) { return 0; }
}

function heightToNormal(size, hf) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const hx = hf((i + 1) % size, j) - hf((i - 1 + size) % size, j);
    const hy = hf(i, (j + 1) % size) - hf(i, (j - 1 + size) % size);
    const l = Math.hypot(hx, hy, 1);
    const o = (j * size + i) * 4;
    img.data[o] = (-hx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (-hy / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeWaterNormal() {
  const n = makeNoise(5);
  const S = 256;
  // 可無縫重複：在圓環上取樣雜訊
  const hf = (i, j) => {
    const a = i / S * Math.PI * 2, b = j / S * Math.PI * 2;
    return n.fbm(Math.cos(a) * 2 + 10, Math.sin(a) * 2 + Math.cos(b) * 2, 4) * 6 + n(Math.sin(b) * 3, Math.cos(a) * 3) * 2;
  };
  const t = heightToNormal(S, hf);
  t.repeat.set(60, 60);
  return t;
}

function makeDimpleNormal() {
  const S = 256;
  const hf = (i, j) => {
    const u = i / S * 18, v = j / S * 10;
    const fu = u - Math.floor(u) - 0.5, fv = v - Math.floor(v + (Math.floor(u) % 2) * 0.5) - 0.5;
    const r = Math.hypot(fu, fv);
    return r < 0.42 ? -Math.cos(r / 0.42 * Math.PI / 2) * 3 : 0;
  };
  return heightToNormal(S, hf);
}
