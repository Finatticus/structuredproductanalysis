// 14 支球桿。數據參考 PGA Tour TrackMan 平均值，並換算成「桿頭速度相對一號木的比例」。
// ratio: 桿頭速度 / 一號木桿頭速度；smash: 擊球效率；launch: 發射角(度)；spin: 後旋(rpm)
export const CLUBS = [
  { id: 'D', name: 'DRIVER', short: '1W', zh: '一號木', icon: 'driver', loft: 10.5, ratio: 1.0, smash: 1.48, launch: 13.2, spin: 2700 },
  { id: '3W', name: '3 WOOD', short: '3W', zh: '三號木', icon: 'wood', loft: 15, ratio: 0.947, smash: 1.47, launch: 10.0, spin: 3650 },
  { id: '5W', name: '5 WOOD', short: '5W', zh: '五號木', icon: 'wood', loft: 18, ratio: 0.912, smash: 1.46, launch: 10.6, spin: 4350 },
  { id: '4H', name: '4 HYBRID', short: '4H', zh: '四號混血', icon: 'wood', loft: 22, ratio: 0.885, smash: 1.44, launch: 11.4, spin: 4450 },
  { id: '5I', name: '5 IRON', short: '5I', zh: '五號鐵', icon: 'iron', loft: 27, ratio: 0.832, smash: 1.38, launch: 12.6, spin: 5360 },
  { id: '6I', name: '6 IRON', short: '6I', zh: '六號鐵', icon: 'iron', loft: 30, ratio: 0.814, smash: 1.36, launch: 14.3, spin: 6230 },
  { id: '7I', name: '7 IRON', short: '7I', zh: '七號鐵', icon: 'iron', loft: 34, ratio: 0.796, smash: 1.33, launch: 16.3, spin: 7100 },
  { id: '8I', name: '8 IRON', short: '8I', zh: '八號鐵', icon: 'iron', loft: 38, ratio: 0.770, smash: 1.31, launch: 18.1, spin: 8000 },
  { id: '9I', name: '9 IRON', short: '9I', zh: '九號鐵', icon: 'iron', loft: 42, ratio: 0.752, smash: 1.28, launch: 20.4, spin: 8650 },
  { id: 'PW', name: 'PITCHING WEDGE', short: 'PW', zh: 'P 挖起桿', icon: 'wedge', loft: 46, ratio: 0.735, smash: 1.23, launch: 24.2, spin: 9300, wedge: true },
  { id: 'GW', name: 'GAP WEDGE 50°', short: 'GW', zh: 'G 挖起桿', icon: 'wedge', loft: 50, ratio: 0.715, smash: 1.20, launch: 27.0, spin: 9800, wedge: true },
  { id: 'SW', name: 'SAND WEDGE 56°', short: 'SW', zh: 'S 挖起桿', icon: 'wedge', loft: 56, ratio: 0.695, smash: 1.16, launch: 30.5, spin: 10200, wedge: true },
  { id: 'LW', name: 'LOB WEDGE 60°', short: 'LW', zh: 'L 挖起桿', icon: 'wedge', loft: 60, ratio: 0.675, smash: 1.12, launch: 33.5, spin: 10500, wedge: true },
  { id: 'PT', name: 'PUTTER', short: 'PT', zh: '推桿', icon: 'putter', loft: 3, ratio: 0, smash: 0, launch: 0, spin: 0, putter: true },
];

export const clubById = id => CLUBS.find(c => c.id === id);
export const clubIndex = id => CLUBS.findIndex(c => c.id === id);
