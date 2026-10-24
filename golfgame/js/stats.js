// 角色素質系統：13 項素質、基準值 50、上限 99，用能力點升級
export const BASE = 50;
export const MAX = 99;
export const START_POINTS = 30;
export const START_RESPECS = 10;

export const STATS = [
  { key: 'power', group: '長打', name: '力量', en: 'Power', desc: '桿頭速度。50 時一號木約 100 mph，99 時約 118 mph。' },
  { key: 'contact', group: '長打', name: '擊球效率', en: 'Contact', desc: '擊球效率 (Smash) 上限，以及打不到甜蜜點的機率。' },
  { key: 'launch', group: '長打', name: '彈道控制', en: 'Launch', desc: '發射角的穩定度，越穩越接近該支球桿的最佳彈道。' },
  { key: 'accuracy', group: '方向', name: '準度', en: 'Accuracy', desc: '桿面角度的隨機誤差，影響左右偏移。' },
  { key: 'consistency', group: '方向', name: '穩定度', en: 'Consistency', desc: '每次擊球力道的浮動，影響距離忽遠忽近。' },
  { key: 'shaping', group: '方向', name: '曲球控制', en: 'Shaping', desc: '刻意打左曲/右曲時，實際彎曲量與想要的差距。' },
  { key: 'spin', group: '短桿', name: '旋轉控制', en: 'Spin', desc: '挖起桿與短鐵的後旋量，決定球上果嶺後停不停得住。' },
  { key: 'chipping', group: '短桿', name: '切球', en: 'Chipping', desc: '距旗 60 碼內短桿的距離與方向誤差。' },
  { key: 'bunker', group: '短桿', name: '沙坑', en: 'Bunker', desc: '沙坑擊球時球速損失與誤差變小。' },
  { key: 'recovery', group: '短桿', name: '脫困', en: 'Recovery', desc: '長草、荒地、斜坡上擊球的距離損失與誤差變小。' },
  { key: 'touch', group: '推桿', name: '推桿距離感', en: 'Touch', desc: '推桿力道的誤差。' },
  { key: 'line', group: '推桿', name: '推桿方向', en: 'Putting Line', desc: '推桿出球方向的誤差。' },
  { key: 'reading', group: '推桿', name: '讀果嶺', en: 'Green Reading', desc: '果嶺上預測推桿線可以顯示多長。' },
  { key: 'mental', group: '心理', name: '抗壓', en: 'Mental', desc: '關鍵球（推 Par、最後三洞、雙人對戰）時誤差放大的程度。' },
];

// 每項素質的詳細說明、公式、與「這個數值實際等於多少」（角色頁點開素質時顯示）
const f1 = (x, d = 1) => x.toFixed(d);
export const STAT_DETAIL = {
  power: {
    detail: '決定揮桿的桿頭速度，推桿以外的所有球桿都會一起變快。桿頭速度越快、球速越快、飛得越遠，是距離最主要的來源。',
    formula: '一號木桿頭速度 = 82 + 0.36 × 力量（mph）\n其他球桿 = 一號木 × 球桿比例（例：7 號鐵 × 0.796、SW × 0.695）\n球速 = 桿頭速度 × 擊球效率',
    effect: v => `一號木桿頭速度 ${f1(82 + 0.36 * v)} mph、7 號鐵 ${f1((82 + 0.36 * v) * 0.796)} mph`,
  },
  contact: {
    detail: '擊球效率（球速 ÷ 桿頭速度）的上限，以及打不到甜蜜點的程度。打偏時球速變慢、後旋改變，距離會短。每一桿都會隨機打偏一點，這項越高偏得越少。',
    formula: '效率倍率 = 0.96 + 0.0008 × 擊球效率\n打偏程度 = |N(0, 0.06 − 0.0004 × 擊球效率)|\n實際效率 = 球桿效率 × 效率倍率 × (1 − 1.6 × 打偏程度)',
    effect: v => `效率倍率 ×${f1(0.96 + 0.0008 * v, 3)}、打偏程度標準差 ${f1(0.06 - 0.0004 * v, 3)}（平均約損失 ${f1((0.06 - 0.0004 * v) * 0.8 * 1.6 * 100)}% 球速）`,
  },
  launch: {
    detail: '每一桿發射角的隨機誤差。發射角偏離這支桿的最佳值，球會太高（距離變短）或太低（飛不遠）。',
    formula: '發射角 = 球桿發射角 × (0.85 + 0.15 × 力道) + 球位加成 + N(0, 2.0 − 0.014 × 彈道控制) 度',
    effect: v => `發射角誤差標準差 ${f1(2 - 0.014 * v, 2)}°`,
  },
  accuracy: {
    detail: '桿面角度的隨機誤差，是球往左或往右偏的主要原因：桿面偏一點，球會往那邊飛出去，同時產生側旋再往同一邊彎。',
    formula: '桿面誤差 = N(0, 2.6 − 0.019 × 準度) 度\n起飛方向偏移 = 0.75 × 桿面誤差\n旋轉軸（側旋）+= 1.5 × 桿面誤差',
    effect: v => `桿面誤差標準差 ${f1(2.6 - 0.019 * v, 2)}°（一號木約等於左右偏 ±${f1((2.6 - 0.019 * v) * 2.6)} 碼）`,
  },
  consistency: {
    detail: '每次揮桿實際力道的浮動：同樣拉到 100%，球速會忽高忽低，決定距離穩不穩定。（距旗 55 碼內用挖起桿時改用「切球」）',
    formula: '球速 × (1 + N(0, 0.06 − 0.00045 × 穩定度))',
    effect: v => `力道浮動標準差 ±${f1((0.06 - 0.00045 * v) * 100, 2)}%（7 號鐵約 ±${f1((0.06 - 0.00045 * v) * 142 * 1.2)} 碼）`,
  },
  shaping: {
    detail: '刻意打 Draw / Fade / Hook / Slice 時，實際彎曲量和你想要的差多少。直球不受影響。',
    formula: '實際彎曲 = 想打的旋轉軸 × (1 + N(0, 0.5 − 0.0042 × 曲球控制))',
    effect: v => `彎曲量誤差標準差 ±${f1((0.5 - 0.0042 * v) * 100)}%`,
  },
  spin: {
    detail: '8 號鐵、9 號鐵與挖起桿的後旋量。後旋越多，球落地後越快停住，強後旋甚至會往後退。',
    formula: '後旋 × (0.85 + 0.003 × 旋轉控制)（只影響 8I、9I、PW、GW、SW、LW）',
    effect: v => `後旋倍率 ×${f1(0.85 + 0.003 * v, 3)}（SW 約 ${Math.round(10200 * 0.88 * (0.85 + 0.003 * v))} rpm）`,
  },
  chipping: {
    detail: '距旗 55 碼（約 60 碼）內用挖起桿時，取代「穩定度」決定距離誤差，並縮小方向誤差。短切、小劈起球的準度。',
    formula: '距離浮動 = N(0, 0.10 − 0.0008 × 切球)\n方向誤差 × (1.0 − 0.005 × 切球)',
    effect: v => `距離浮動 ±${f1((0.10 - 0.0008 * v) * 100, 2)}%、方向誤差 ×${f1(1 - 0.005 * v, 3)}`,
  },
  bunker: {
    detail: '沙坑擊球：球道沙坑保留多少球速、果嶺邊沙坑爆炸球的球速，以及誤差放大的程度。',
    formula: '球道沙坑：球速 × (0.62 + 0.0025 × 沙坑)\n果嶺邊沙坑（55 碼內挖起桿）：球速 × (0.42 + 0.0025 × 沙坑 × 0.8)\n誤差 × (1.7 − 0.009 × 沙坑)',
    effect: v => `球道沙坑球速 ${f1((0.62 + 0.0025 * v) * 100)}%、爆炸球球速 ${f1((0.42 + 0.002 * v) * 100)}%、誤差 ×${f1(1.7 - 0.009 * v, 2)}`,
  },
  recovery: {
    detail: '在長草、深草、荒地，以及斜坡站位時，球速損失和誤差放大的程度。長草會讓後旋變少（飛球），落地後滾比較多。',
    formula: '長草：球速 × (0.80 + 0.0018 × 脫困)、後旋 × 0.62\n深草：長草 × 0.72\n誤差 × (1.5 − 0.005 × 脫困)',
    effect: v => `長草球速 ${f1((0.8 + 0.0018 * v) * 100)}%、深草 ${f1((0.8 + 0.0018 * v) * 72)}%、誤差 ×${f1(1.5 - 0.005 * v, 2)}`,
  },
  touch: {
    detail: '推桿力道的誤差：同樣拉到某個碼數，實際滾的距離會差多少。',
    formula: '推桿初速 × (1 + N(0, 0.06 − 0.0004 × 推桿距離感))\n（滾動距離約和初速平方成正比，所以距離誤差約是 2 倍）',
    effect: v => `初速誤差 ±${f1((0.06 - 0.0004 * v) * 100, 2)}%（6 碼推桿距離約 ±${Math.round((0.06 - 0.0004 * v) * 2 * 6 * 91.4)} 公分）`,
  },
  line: {
    detail: '推桿出球方向的隨機誤差。',
    formula: '方向 = 瞄準 + 出桿偏移 × 1.5° + N(0, 1.0 − 0.007 × 推桿方向) 度',
    effect: v => `方向誤差標準差 ${f1(1 - 0.007 * v, 2)}°（3 碼推桿約偏 ±${f1(Math.tan((1 - 0.007 * v) * Math.PI / 180) * 274, 1)} 公分，洞口半徑 5.4 公分）`,
  },
  reading: {
    detail: '在果嶺上，預測推桿線能顯示多長。線越長，越容易看出球會往哪邊彎、彎多少。',
    formula: '預測線長度 = 1 + 0.08 × 讀果嶺（公尺）',
    effect: v => `預測線 ${f1(1 + 0.08 * v)} 公尺（約 ${f1((1 + 0.08 * v) / 0.9144)} 碼）`,
  },
  mental: {
    detail: '關鍵球時，所有誤差（桿面、力道、打偏、推桿）放大的倍率。關鍵球 = 在果嶺上推 Par 或更好的球、第 16~18 洞、比洞賽。67 以上就完全不受影響。',
    formula: '關鍵球誤差倍率 = max(1, 1.6 − 0.009 × 抗壓)',
    effect: v => `關鍵球誤差 ×${f1(Math.max(1, 1.6 - 0.009 * v), 3)}`,
  },
};

// 升 1 點要花的能力點：50~69 花 1、70~84 花 2、85~98 花 3
export const costFor = level => (level < 70 ? 1 : level < 85 ? 2 : 3);

export function spentFor(stats) {
  let s = 0;
  for (const st of STATS) for (let l = BASE; l < (stats[st.key] ?? BASE); l++) s += costFor(l);
  return s;
}

export function defaultStats() {
  const o = {};
  STATS.forEach(s => (o[s.key] = BASE));
  return o;
}

export function normalizeStats(stats) {
  const o = defaultStats();
  if (stats) for (const k in o) if (Number.isFinite(stats[k])) o[k] = Math.max(BASE, Math.min(MAX, Math.round(stats[k])));
  return o;
}

// 把素質轉成物理計算實際用到的數字（全部都是線性對應，方便在 README 說明）
export function derive(stats) {
  const s = normalizeStats(stats);
  return {
    driverMph: 82 + s.power * 0.36,                 // 一號木桿頭速度
    smashMul: 0.96 + s.contact * 0.0008,            // 擊球效率倍率
    mishitSigma: 0.06 - s.contact * 0.0004,         // 打偏甜蜜點的程度（標準差）
    launchSigma: 2.0 - s.launch * 0.014,            // 發射角誤差（度）
    faceSigma: 2.6 - s.accuracy * 0.019,            // 桿面角度誤差（度）
    powerSigma: 0.06 - s.consistency * 0.00045,     // 力道浮動（比例）
    shapeSigma: 0.5 - s.shaping * 0.0042,           // 曲球彎曲量誤差（比例）
    spinMul: 0.85 + s.spin * 0.003,                 // 短鐵/挖起桿後旋倍率
    chipSigma: 0.10 - s.chipping * 0.0008,          // 切球距離誤差（比例）
    chipFace: 1.0 - s.chipping * 0.005,             // 切球方向誤差倍率
    sandKeep: 0.62 + s.bunker * 0.0025,             // 球道沙坑球速保留
    sandSigma: 1.7 - s.bunker * 0.009,              // 沙坑誤差倍率
    roughKeep: 0.80 + s.recovery * 0.0018,          // 長草球速保留
    roughSigma: 1.5 - s.recovery * 0.005,           // 長草誤差倍率
    touchSigma: 0.06 - s.touch * 0.0004,            // 推桿力道誤差（比例）
    lineSigma: 1.0 - s.line * 0.007,                // 推桿方向誤差（度）
    readMeters: 1 + s.reading * 0.08,               // 預測推桿線長度（公尺）
    pressureMul: Math.max(1, 1.6 - s.mental * 0.009),// 關鍵球誤差倍率
  };
}

export const DEFAULT_LOOK = { body: 'm', skin: '#d9a77c', hair: '#2b2118', shirt: '#f2ead8', pants: '#2a3442', cap: '#1d3a2a', shoes: '#f4f1ea', glove: '#ffffff' };
export const LOOK_OPTIONS = {
  body: [['m', '男'], ['f', '女']],
  skin: ['#f1c9a5', '#e0ac85', '#c98e62', '#a46b45', '#6f4428'],
  hair: ['#1b1511', '#3b2a1e', '#6b4a2b', '#b08a5a', '#8c8c8c'],
  shirt: ['#f2ead8', '#ffffff', '#1d3a2a', '#20324f', '#a3302a', '#d8c08a', '#6d8fb3', '#2b2b2b'],
  pants: ['#2a3442', '#e8e1d0', '#6b6255', '#1c1c1c', '#3d4a35'],
  cap: ['#1d3a2a', '#ffffff', '#20324f', '#a3302a', '#1c1c1c', '#d8c08a'],
};
