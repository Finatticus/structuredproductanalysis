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
