/* 城市座標與旅行統計
 * 城市座標來源（依序）：旅程裡存的座標 trip.geo → 內建常用城市表 CITY → 線上查詢快取
 * 新城市會透過 OpenStreetMap（Nominatim）查詢一次，存回旅程，之後不必再查。
 * 距離估算：出發地 → 依序經過各城市 → 回出發地（大圓距離，約略值）；找不到城市時用該國首都。 */
(function () {
  const HOME = { name: '台北', ll: [25.08, 121.23] }; // 桃園機場
  const CITY = {
    // 日本
    東京: [35.68, 139.69], 大阪: [34.69, 135.5], 京都: [35.01, 135.77], 奈良: [34.69, 135.8], 神戶: [34.69, 135.2], 鐮倉: [35.32, 139.55], 鎌倉: [35.32, 139.55],
    河口湖: [35.5, 138.76], 日光: [36.75, 139.6], 札幌: [43.06, 141.35], 北海道: [43.06, 141.35], 福岡: [33.59, 130.4], 名古屋: [35.18, 136.91], 沖繩: [26.21, 127.68], 那霸: [26.21, 127.68],
    橫濱: [35.44, 139.64], 箱根: [35.23, 139.1], 金澤: [36.56, 136.65], 廣島: [34.39, 132.46], 仙台: [38.27, 140.87], 熊本: [32.8, 130.71], 輕井澤: [36.35, 138.6],
    // 韓國
    首爾: [37.57, 126.98], 釜山: [35.18, 129.08], 束草: [38.2, 128.59], 江原道: [37.75, 128.9], 江陵: [37.75, 128.9], 大邱: [35.87, 128.6], 慶洲: [35.86, 129.22], 慶州: [35.86, 129.22], 濟州: [33.5, 126.53], 濟州島: [33.5, 126.53],
    // 港澳中
    深圳: [22.54, 114.06], 廣州: [23.13, 113.26], 廈門: [24.48, 118.09], 福州: [26.07, 119.3], 杭州: [30.27, 120.16], 蘇州: [31.3, 120.62], 南京: [32.06, 118.8],
    成都: [30.57, 104.07], 重慶: [29.56, 106.55], 西安: [34.34, 108.94], 桂林: [25.27, 110.29], 哈爾濱: [45.8, 126.53], 青島: [36.07, 120.38],
    香港: [22.32, 114.17], 澳門: [22.2, 113.55], 上海: [31.23, 121.47], 北京: [39.9, 116.4],
    // 東南亞
    清邁: [18.79, 98.98], 清萊: [19.91, 99.84], 曼谷: [13.76, 100.5], 普吉島: [7.88, 98.39], 寮國: [19.89, 102.13], 龍坡邦: [19.89, 102.13], 永珍: [17.97, 102.63],
    峴港: [16.05, 108.2], 會安: [15.88, 108.33], 河內: [21.03, 105.85], 下龍灣: [20.91, 107.18], 寧平: [20.25, 105.97], 沙壩: [22.34, 103.84], 胡志明市: [10.82, 106.63], 富國島: [10.29, 103.98],
    馬尼拉: [14.6, 120.98], 宿霧: [10.32, 123.89], 長灘島: [11.97, 121.92], 新加坡: [1.35, 103.82], 吉隆坡: [3.14, 101.69], 峇里島: [-8.4, 115.19], 暹粒: [13.36, 103.86],
    // 歐洲
    倫敦: [51.51, -0.13], 巴黎: [48.86, 2.35], 布魯塞爾: [50.85, 4.35], 阿姆斯特丹: [52.37, 4.9], 捷克: [50.08, 14.44], 布拉格: [50.08, 14.44], 庫倫洛夫: [48.81, 14.32],
    Wroclaw: [51.11, 17.03], 樂斯拉夫: [51.11, 17.03], Krakow: [50.06, 19.94], 克拉科夫: [50.06, 19.94], 華沙: [52.23, 21.01], 布達佩斯: [47.5, 19.04], Budapest: [47.5, 19.04],
    布拉提斯拉瓦: [48.15, 17.11], Bratislava: [48.15, 17.11], 薩爾斯堡: [47.81, 13.06], Salzburg: [47.81, 13.06], 維也納: [48.21, 16.37], 哈修塔特: [47.56, 13.65],
    羅馬: [41.9, 12.5], 佛羅倫斯: [43.77, 11.26], 威尼斯: [45.44, 12.32], 米蘭: [45.46, 9.19], 巴塞隆納: [41.39, 2.17], 馬德里: [40.42, -3.7], 里斯本: [38.72, -9.14],
    柏林: [52.52, 13.4], 慕尼黑: [48.14, 11.58], 法蘭克福: [50.11, 8.68], 蘇黎世: [47.38, 8.54], 因特拉肯: [46.69, 7.86], 愛丁堡: [55.95, -3.19], 雅典: [37.98, 23.73],
    // 土耳其
    伊斯坦堡: [41.01, 28.98], İzmir: [38.42, 27.14], Izmir: [38.42, 27.14], 伊士麥: [38.42, 27.14], 棉花堡: [37.92, 29.12], 庫莎達西: [37.86, 27.26],
    Antalya: [36.9, 30.71], 安塔利亞: [36.9, 30.71], Konya: [37.87, 32.48], 孔亞: [37.87, 32.48], Capadocia: [38.64, 34.83], Cappadocia: [38.64, 34.83], 卡帕多奇亞: [38.64, 34.83],
    // 美洲
    洛杉磯: [34.05, -118.24], 聖地牙哥: [32.72, -117.16], 拉斯維加斯: [36.17, -115.14], 舊金山: [37.77, -122.42], 紐約: [40.71, -74.01], 西雅圖: [47.61, -122.33],
    芝加哥: [41.88, -87.63], 波士頓: [42.36, -71.06], 華盛頓: [38.91, -77.04], 夏威夷: [21.31, -157.86], 檀香山: [21.31, -157.86], 溫哥華: [49.28, -123.12], 多倫多: [43.65, -79.38],
    // 大洋洲
    雪梨: [-33.87, 151.21], 墨爾本: [-37.81, 144.96], 奧克蘭: [-36.85, 174.76],
  };

  const CACHE_KEY = 'ta.geocache.v1';
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch { }
  const saveCache = () => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { } };

  function dist([a, b], [c, d]) {
    const R = 6371, r = Math.PI / 180;
    const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  /** holder：旅程或足跡紀錄（有 geo 欄位） */
  function cityLL(name, holder) {
    if (!name) return null;
    const g = holder?.geo?.[name];
    if (g) return g.ll || g;
    if (CITY[name]) return CITY[name];
    const c = Object.entries(cache).find(([k]) => k.startsWith(name + '|'));
    return c && c[1] ? c[1].ll : null;
  }
  function placePoints(countries, cities, holder) {
    const pts = [];
    for (const c of cities || []) { const ll = cityLL(c, holder); if (ll) pts.push({ name: c, ll }); }
    if (!pts.length) for (const c of countries || []) { const k = TA.countries.find(c); if (k?.cap) pts.push({ name: k.zh, ll: k.cap }); }
    return pts;
  }
  const tripPoints = t => placePoints(t.countries, t.cities, t);
  const roundKm = pts => { if (!pts.length) return 0; let km = 0, prev = HOME.ll; for (const p of pts) { km += dist(prev, p.ll); prev = p.ll; } return km + dist(prev, HOME.ll); };
  const tripKm = t => roundKm(tripPoints(t));

  // ---------- 線上查詢（OpenStreetMap Nominatim，每秒最多 1 次） ----------
  // OSM 名稱有時是「簡體;繁體」，取最後一個
  const pick = s => String(s || '').split(';').pop().trim();
  let queue = Promise.resolve(), last = 0;
  function search(name, countries = []) {
    const isos = countries.map(c => TA.countries.find(c)?.iso).filter(Boolean);
    const key = `${name}|${isos.join(',')}`;
    if (cache[key] !== undefined) return Promise.resolve(cache[key] ? [cache[key], ...(cache[key].alt || [])] : []);
    const run = async () => {
      const wait = Math.max(0, last + 1100 - Date.now());
      if (wait) await new Promise(r => setTimeout(r, wait));
      last = Date.now();
      const q = new URLSearchParams({ q: name, format: 'jsonv2', limit: '5', 'accept-language': 'zh-TW', addressdetails: '1' });
      if (isos.length) q.set('countrycodes', isos.join(','));
      const r = await fetch('https://nominatim.openstreetmap.org/search?' + q);
      const j = await r.json();
      const list = j.map(x => ({
        ll: [Math.round(+x.lat * 100) / 100, Math.round(+x.lon * 100) / 100],
        label: [pick(x.address?.city || x.address?.town || x.address?.state || x.name), TA.countries.byIso(x.address?.country_code)?.zh || pick(x.address?.country)].filter(Boolean).join('，'),
        cc: x.address?.country_code || '',
      }));
      cache[key] = list[0] ? { ...list[0], alt: list.slice(1) } : null;
      saveCache();
      return list;
    };
    const p = queue.then(run, run);
    queue = p.catch(() => { });
    return p;
  }
  /** 座標 → 國家、城市（用來自動填願望清單的地點） */
  function reverse(ll) {
    const run = async () => {
      const wait = Math.max(0, last + 1100 - Date.now());
      if (wait) await new Promise(r => setTimeout(r, wait));
      last = Date.now();
      const q = new URLSearchParams({ lat: ll[0], lon: ll[1], format: 'jsonv2', 'accept-language': 'zh-TW', zoom: '10' });
      const j = await (await fetch('https://nominatim.openstreetmap.org/reverse?' + q)).json();
      const a = j.address || {};
      return { country: TA.countries.byIso(a.country_code)?.zh || pick(a.country), city: pick(a.city || a.town || a.county || a.state) };
    };
    const p = queue.then(run, run);
    queue = p.catch(() => { });
    return p;
  }

  /** 查一個城市並把座標存進 holder.geo；回傳是否有變動 */
  async function resolve(holder, name, countries) {
    if (!name || holder.geo?.[name] || CITY[name]) return false;
    const list = await search(name, countries);
    if (!list[0]) return false;
    holder.geo = holder.geo || {};
    holder.geo[name] = { ll: list[0].ll, label: list[0].label };
    return true;
  }
  /** 背景補齊所有旅程與足跡裡還沒有座標的城市 */
  let filling = false;
  async function backfill(onDone) {
    if (filling || TA.store.isGuest()) return; filling = true;
    const S = TA.store;
    let changed = 0;
    try {
      for (const t of S.all()) {
        let hit = false;
        for (const c of t.cities || []) if (!cityLL(c, t)) { try { if (await resolve(t, c, t.countries)) hit = true; } catch { } }
        if (hit) { S.upsert(t); changed++; }
      }
      const prof = S.profile();
      let hit = false;
      for (const x of prof.extras || []) for (const c of x.cities || []) if (!cityLL(c, x)) { try { if (await resolve(x, c, [x.country])) hit = true; } catch { } }
      if (hit) { S.saveProfile(prof); changed++; }
    } finally { filling = false; }
    if (changed && onDone) onDone();
  }

  /** 已完成旅程 + 手動補充的足跡 */
  function stats(trips, profile) {
    const S = TA.store, u = TA.u;
    const done = trips.filter(t => S.statusOf(t) === 'done');
    const countries = new Set(), cities = new Set(), hotels = new Set();
    let days = 0, km = 0;
    for (const t of done) {
      (t.countries || []).forEach(c => countries.add(TA.countries.find(c)?.zh || c));
      (t.cities || []).forEach(c => cities.add(c));
      (t.days || []).forEach(d => d.hotel && hotels.add(d.hotel.toLowerCase().replace(/\s+/g, ' ').trim()));
      days += t.startDate && t.endDate ? u.diffDays(t.startDate, t.endDate) + 1 : (t.days || []).length;
      km += tripKm(t);
    }
    for (const x of profile?.extras || []) {
      if (x.country) countries.add(TA.countries.find(x.country)?.zh || x.country);
      (x.cities || []).forEach(c => cities.add(c));
      days += +x.days || 0;
      km += roundKm(placePoints([x.country], x.cities, x)) * Math.max(1, +x.times || 1);
    }
    if (profile?.home) countries.delete(TA.countries.find(profile.home)?.zh || profile.home);
    return { trips: done.length, countries: countries.size, cities: cities.size, days, months: days / 30.4, hotels: hotels.size, km: Math.round(km), laps: km / 40075 };
  }

  window.TA = window.TA || {};
  TA.geo = { stats, tripKm, roundKm, dist, HOME, placePoints, cityLL, search, resolve, reverse, backfill };
})();
