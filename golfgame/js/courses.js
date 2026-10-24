// 三座 18 洞球場。每洞：[標準桿, 黑梯碼數, 狗腿角度(負=左彎), 特徵, 差點順序]
// 特徵代號：
//   wl/wr 落點區左/右側水池（峽谷球場為深谷）   wc 果嶺前水障礙（峽谷為深谷）
//   xc    球道中段橫越障礙（溪流 / 峽谷）       sl/sr 整洞左/右側是海
//   b0~b4 沙坑多寡                             up/dn 果嶺比發球台高/低（UP/DN 落差更大）
//   tr    兩側樹林特別密、球道窄                 ww 兩側大片荒地
export const TEE_SETS = [
  { id: 'black', name: '黑梯', color: '#1c1c1c', ratio: 1.0 },
  { id: 'blue', name: '藍梯', color: '#2c4f8f', ratio: 0.94 },
  { id: 'white', name: '白梯', color: '#f4f1ea', ratio: 0.88 },
  { id: 'red', name: '紅梯', color: '#a3302a', ratio: 0.78 },
];

// 球場群組（之後新增球場時，在 COURSES 加一筆並指定 group 即可；沒有球場的群組顯示「即將加入」）
export const COURSE_GROUPS = [
  { id: 'coast', name: '海邊球場' },
  { id: 'mountain', name: '山地 / 林間球場' },
  { id: 'desert', name: '沙漠 / 高原球場' },
  { id: 'taiwan', name: '台灣球場' },
];

export const COURSES = [
  {
    id: 'heron', name: '鷺灣海岸', en: 'Heron Bay Links', style: 'links', group: 'coast',
    desc: '臨海林克斯球場。幾乎沒有樹，海風大且常轉向；球道硬、落地後滾很遠；深壺型沙坑掉進去常常只能往旁邊救。',
    stimp: 8, firm: 1.25, altitude: 8, temp: 17, wind: [6, 15], fairwayW: 44, roughW: 22, corridor: 92, trees: 0.04,
    holes: [
      [4, 425, -6, 'sl b3', 9], [4, 398, 10, 'b2 up', 13], [5, 560, -12, 'sl b4', 3], [3, 185, 0, 'b3 sl', 15],
      [4, 445, 8, 'b3 xc', 1], [4, 360, -14, 'b2 dn', 17], [3, 210, 0, 'b4', 11], [5, 575, 14, 'b4 sr', 5], [4, 432, -4, 'b3 up', 7],
      [4, 404, 6, 'b2 sr', 12], [5, 540, -10, 'b4 xc', 4], [3, 165, 0, 'b3 sr', 18], [4, 440, -8, 'b3', 2],
      [4, 378, 12, 'b2 dn', 14], [4, 452, -6, 'b3 sl', 6], [4, 410, 16, 'b3 sr', 10], [3, 212, 0, 'b3 sl', 16], [5, 495, -14, 'b4 xc up', 8],
    ],
  },
  {
    id: 'maple', name: '楓林谷', en: 'Maple Valley', style: 'parkland', group: 'mountain',
    desc: '林間公園型球場。球道兩側高大樹林，多處水池，果嶺起伏較多，考驗開球準度與推桿判讀。',
    stimp: 8.5, firm: 0.92, altitude: 220, temp: 22, wind: [2, 9], fairwayW: 32, roughW: 18, corridor: 70, trees: 1.0,
    holes: [
      [4, 402, 8, 'b2 tr', 7], [5, 538, -14, 'b3 wl', 3], [3, 176, 0, 'b3 wc', 15], [4, 365, 12, 'b2 dn', 11],
      [4, 428, -8, 'b3 wr', 1], [3, 192, 0, 'b2 up', 17], [4, 412, -6, 'b3 wr', 5], [5, 556, 10, 'b3 xc', 9], [4, 389, 0, 'b2 wc up', 13],
      [4, 418, -10, 'b2 tr', 8], [4, 385, 14, 'b3 dn', 12], [3, 168, 0, 'b2 wc', 18], [5, 545, -12, 'b3 wr xc', 2],
      [4, 440, 6, 'b3 tr UP', 4], [4, 372, -16, 'b2 wl', 14], [3, 205, 0, 'b3 dn', 16], [4, 401, 10, 'b2 tr', 10], [5, 520, -8, 'b3 wc', 6],
    ],
  },
  {
    id: 'canyon', name: '赤岩峽谷', en: 'Red Rock Canyon', style: 'canyon', group: 'desert',
    desc: '高海拔沙漠球場，空氣稀薄，球多飛約 6%。多洞必須飛越峽谷，球道外是荒地與岩石，果嶺最硬最快。',
    stimp: 9, firm: 1.15, altitude: 1600, temp: 29, wind: [3, 12], fairwayW: 34, roughW: 10, corridor: 78, trees: 0.25,
    holes: [
      [4, 440, -8, 'b2 ww', 9], [5, 590, 12, 'b3 xc ww', 3], [4, 410, -12, 'b2 wl', 11], [3, 205, 0, 'b2 wc DN', 15],
      [4, 455, 6, 'b3 ww up', 1], [5, 610, -10, 'b3 xc', 5], [3, 230, 0, 'b3 wc', 13], [4, 395, 14, 'b2 wr dn', 17], [4, 470, -6, 'b3 ww UP', 7],
      [4, 420, 10, 'b2 wl', 10], [4, 400, -14, 'b3 ww', 12], [4, 380, 4, 'b2 xc', 2], [3, 190, 0, 'b2 wc', 18],
      [5, 575, -12, 'b3 wr', 4], [4, 385, 12, 'b2 ww dn', 14], [3, 215, 0, 'b3 wc DN', 16], [4, 330, -10, 'b2 xc', 8], [5, 540, 8, 'b3 wl up', 6],
    ],
  },
];

export const courseById = id => COURSES.find(c => c.id === id);

export function teeYards(course, holeIdx, teeId) {
  const t = TEE_SETS.find(x => x.id === teeId) || TEE_SETS[1];
  return Math.round(course.holes[holeIdx][1] * t.ratio);
}

export function courseYards(course, teeId) {
  return course.holes.reduce((s, _, i) => s + teeYards(course, i, teeId), 0);
}
