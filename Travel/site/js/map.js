/* 足跡地圖：去過的國家上色、去過的城市標點、計畫中的城市空心圈
 * 地圖資料：vendor/world-110m.js（Natural Earth），繪圖：vendor/d3.min.js + topojson.min.js */
(function () {
  const numOf = c => c?.num || '';

  function collect() {
    const S = TA.store;
    const visited = new Map(), planned = new Set(), cities = new Map();
    for (const t of S.all()) {
      const done = S.statusOf(t) === 'done';
      for (const name of t.countries || []) {
        const c = TA.countries.find(name);
        if (!c || !numOf(c)) continue;
        if (done) { const v = visited.get(numOf(c)) || { name: c.zh, n: 0 }; v.n++; visited.set(numOf(c), v); }
        else planned.add(numOf(c));
      }
      for (const city of t.cities || []) {
        const ll = TA.geo.cityLL(city, t);
        if (!ll) continue;
        const k = ll.join();
        const cur = cities.get(k) || { name: city, ll, done: false, n: 0 };
        if (done) { cur.done = true; cur.n++; }
        cities.set(k, cur);
      }
    }
    // 手動補充的足跡（沒有排行程的造訪）
    const prof = S.profile();
    for (const x of prof.extras || []) {
      const c = TA.countries.find(x.country);
      if (c && numOf(c)) { const v = visited.get(numOf(c)) || { name: c.zh, n: 0 }; v.n += Math.max(1, +x.times || 1); visited.set(numOf(c), v); planned.delete(numOf(c)); }
      for (const p of TA.geo.placePoints([x.country], x.cities, x)) {
        const k = p.ll.join();
        const cur = cities.get(k) || { name: p.name, ll: p.ll, done: false, n: 0 };
        cur.done = true; cur.n += Math.max(1, +x.times || 1);
        cities.set(k, cur);
      }
    }
    const hc = TA.countries.find(prof.home);
    const home = hc && numOf(hc) ? { id: numOf(hc), name: hc.zh } : null;
    if (home) visited.delete(home.id);
    return { visited, planned, cities: [...cities.values()], home };
  }

  function render(el, { onCountry } = {}) {
    if (!window.d3 || !window.topojson || !window.TA_WORLD) { el.hidden = true; return; }
    const { visited, planned, cities, home } = collect();
    const zhOf = id => TA.countries.list.find(c => c.num === id)?.zh;
    const land = topojson.feature(TA_WORLD, TA_WORLD.objects.countries).features.filter(f => f.id !== '010'); // 去掉南極
    // 法國的海外領地（南美的法屬圭亞那）不算在「去過」裡
    const fr = land.find(f => f.id === '250');
    if (fr && fr.geometry.type === 'MultiPolygon') fr.geometry.coordinates = fr.geometry.coordinates.filter(poly => poly[0][0][0] > -30);
    const W = 1000, H = 470;
    const proj = d3.geoEqualEarth().rotate([-12, 0]).fitExtent([[4, 4], [W - 4, H - 4]], { type: 'Sphere' });
    const path = d3.geoPath(proj);
    const grat = d3.geoGraticule10();

    // 裁掉兩極，只留北緯 78° 到南緯 50°
    const y0 = proj([0, 78])[1], y1 = proj([0, -50])[1];
    el.innerHTML = `<svg class="map-svg" viewBox="0 ${y0.toFixed(0)} ${W} ${(y1 - y0).toFixed(0)}" role="img" aria-label="足跡地圖">
      <path class="m-grat" d="${path(grat)}"/>
      <g class="m-land">${land.map(f => {
        const v = visited.get(f.id), p = planned.has(f.id), h = home && home.id === f.id;
        return `<path d="${path(f)}" class="${h ? 'h' : v ? 'v' : p ? 'p' : ''}" data-id="${f.id}" data-name="${TA.u.esc(h ? home.name : v ? v.name : zhOf(f.id) || f.properties.name)}"${v ? ` data-n="${v.n}"` : ''}/>`;
      }).join('')}</g>
      <g class="m-cities">${cities.sort((a, b) => a.done - b.done).map(c => {
        const [x, y] = proj([c.ll[1], c.ll[0]]);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${c.done ? 3.2 : 3.6}" class="${c.done ? 'cd' : 'cp'}" data-city="${TA.u.esc(c.name)}" data-n="${c.n}"/>`;
      }).join('')}</g>
    </svg>
    <div class="map-tip" hidden></div>
    <div class="map-legend">
      <span><i class="lg-v"></i>去過的國家 ${visited.size}</span>
      <span><i class="lg-c"></i>去過的城市 ${cities.filter(c => c.done).length}</span>
      ${cities.some(c => !c.done) ? '<span><i class="lg-p"></i>即將前往</span>' : ''}
      ${home ? `<span><i class="lg-h"></i>居住地</span>` : ''}
      <button type="button" class="map-edit" data-act="footprint">編輯足跡</button>
    </div>`;

    const tip = el.querySelector('.map-tip');
    let hideT = 0;
    const tipText = t => {
      if (t.dataset.city) return `${t.dataset.city}${+t.dataset.n ? `・${t.dataset.n} 次` : '・即將前往'}`;
      if (!t.dataset.name) return '';
      if (t.classList.contains('h')) return `${t.dataset.name}・居住地`;
      if (t.classList.contains('v')) return `${t.dataset.name}・${t.dataset.n} 次`;
      if (t.classList.contains('p')) return `${t.dataset.name}・即將前往`;
      return t.dataset.name;
    };
    const showTip = (e, autoHide) => {
      const txt = tipText(e.target);
      clearTimeout(hideT);
      if (!txt) { tip.hidden = true; return; }
      const r = el.getBoundingClientRect();
      tip.hidden = false; tip.textContent = txt;
      tip.style.left = (e.clientX - r.left) + 'px'; tip.style.top = (e.clientY - r.top) + 'px';
      if (autoHide) hideT = setTimeout(() => (tip.hidden = true), 2500);
    };
    el.addEventListener('mousemove', e => { if (!touched) showTip(e); });
    el.addEventListener('mouseleave', () => (tip.hidden = true));
    // 手機：點一下顯示國名（幾秒後自動消失）
    let touched = false;
    el.addEventListener('touchstart', () => (touched = true), { passive: true });
    el.addEventListener('click', e => {
      const t = e.target;
      if (touched) showTip(e, true);
      const name = t.dataset.city || (t.classList.contains('v') ? t.dataset.name : '');
      if (name && onCountry) onCountry(name);
    });
  }

  window.TA = window.TA || {};
  TA.worldMap = { render };
})();
