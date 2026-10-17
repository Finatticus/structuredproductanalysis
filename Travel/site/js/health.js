/* 資料健檢：找出需要整理的地方，點一下跳到編輯頁的那個位置
 * 檢查項目：殘留的亂碼網址、失效的圖片與連結、找不到位置的城市、空白的天、日期不在旅程範圍內的訂位與天數 */
(function () {
  const U = TA.u, S = TA.store, E = TA.u.esc, UI = TA.ui;

  const GARBLED = s => /[!-~]{41,}/.test(s || '') || /(%[0-9A-F]{2}){4,}/i.test(s || '');
  const PLACEHOLDER = u => !u || /^https?:\/\/?$/.test(u) || /圖片網址|example\.com/.test(u);
  const textOf = h => TA.rich.textOf(h || '');

  /** 一段旅程裡所有的網址，附上所在位置 */
  function collectUrls(t) {
    const out = [];
    const fromHtml = (html, where) => {
      for (const m of String(html || '').matchAll(/<a[^>]+href="([^"]+)"/g)) out.push({ url: m[1].replace(/&amp;/g, '&'), kind: 'link', where });
      for (const m of String(html || '').matchAll(/<img[^>]+src="([^"]+)"/g)) out.push({ url: m[1].replace(/&amp;/g, '&'), kind: 'image', where });
    };
    fromHtml(t.intro, { kind: 'intro', label: '行前備註' });
    (t.days || []).forEach((d, i) => {
      const day = `Day ${i + 1}（${UI.dot(d.date, false)}）`;
      (d.stops || []).forEach((p, k) => p.url && out.push({ url: p.url, kind: 'link', where: { kind: 'stop', i, k, label: `${day} 站點「${tidy(p.name)}」` } }));
      if (d.hotelUrl) out.push({ url: d.hotelUrl, kind: 'link', where: { kind: 'day', i, field: 'hotelUrl', label: `${day} 住宿連結` } });
      fromHtml(d.notes, { kind: 'day', i, field: 'notes', label: `${day} 備註` });
      (d.blocks || []).forEach((b, j) => fromHtml(b.body, { kind: 'block', i, j, label: `${day}「${b.title || '收合區塊'}」` }));
    });
    (t.sections || []).forEach((s, k) => fromHtml(s.body, { kind: 'section', k, label: `分頁「${s.title}」` }));
    (t.bookings || []).forEach((b, i) => {
      const label = `訂位「${TA.bookings.titleOf(b)}」`;
      if (b.url) out.push({ url: b.url, kind: 'link', where: { kind: 'booking', i, label } });
      fromHtml(b.note, { kind: 'booking', i, label });
    });
    return out.filter(x => /^https?:/i.test(x.url) || PLACEHOLDER(x.url));
  }
  const tidy = s => String(s || '').replace(/[!-~]{41,}/g, m => (m.match(/^[^,%/+]{1,20}/) || [''])[0] + '…').slice(0, 40);

  /** 不需要連網的檢查（很快） */
  function quickChecks() {
    const issues = [];
    const add = (t, type, title, where) => issues.push({ trip: t, type, title, where });
    const trips = S.all();
    for (const t of trips) {
      // 亂碼
      (t.days || []).forEach((d, i) => {
        const day = `Day ${i + 1}（${UI.dot(d.date, false)}）`;
        if (GARBLED(d.title)) add(t, 'garbled', `當天標題含有亂碼`, { kind: 'day', i, field: 'title', label: day });
        if (GARBLED(d.hotel)) add(t, 'garbled', `住宿名稱含有亂碼`, { kind: 'day', i, field: 'hotel', label: day });
        (d.stops || []).forEach((p, k) => { if (GARBLED(p.name)) add(t, 'garbled', `站點名稱含有殘留的網址：「${tidy(p.name)}」`, { kind: 'stop', i, k, label: day }); });
        if (/(%[0-9A-F]{2}){6,}/i.test(textOf(d.notes))) add(t, 'garbled', '備註裡有一長串編碼過的網址文字', { kind: 'day', i, field: 'notes', label: day });
      });
      // 城市
      for (const c of t.cities || []) if (!TA.geo.cityLL(c, t)) add(t, 'city', `城市「${c}」找不到位置（地圖、距離、天氣不會包含它）`, { kind: 'city', name: c, label: '基本資訊' });
      // 空白的天
      (t.days || []).forEach((d, i) => {
        const has = d.title || (d.stops || []).some(p => p.name || p.time) || !TA.rich.isEmpty(d.notes) || d.hotel || (d.blocks || []).length
          || (t.bookings || []).some(b => TA.bookings.dayItems({ bookings: [b] }, d.date));
        if (!has) add(t, 'empty', '這一天沒有任何內容', { kind: 'day', i, label: `Day ${i + 1}（${UI.dot(d.date, false)}）` });
        if (t.startDate && d.date && (d.date < t.startDate || d.date > t.endDate)) add(t, 'range', `這一天（${UI.dot(d.date)}）不在旅程日期 ${UI.range(t.startDate, t.endDate)} 內`, { kind: 'day', i, label: `Day ${i + 1}` });
      });
      // 訂位日期
      (t.bookings || []).forEach((b, i) => {
        const dates = [b.dep, b.arr, b.checkin, b.checkout, b.pickup, b.dropoff, b.when].filter(Boolean).map(x => x.slice(0, 10));
        const lo = t.startDate ? U.addDays(t.startDate, -1) : null, hi = t.endDate ? U.addDays(t.endDate, 1) : null;
        const bad = lo && dates.find(x => x < lo || x > hi);
        if (bad) add(t, 'range', `訂位「${TA.bookings.titleOf(b)}」的日期 ${UI.dot(bad)} 不在旅程日期 ${UI.range(t.startDate, t.endDate)} 內`, { kind: 'booking', i, label: '訂位與交通' });
        if (!dates.length) add(t, 'range', `訂位「${TA.bookings.titleOf(b)}」沒有填日期`, { kind: 'booking', i, label: '訂位與交通' });
      });
      // 空白或範例網址
      for (const u of collectUrls(t)) if (PLACEHOLDER(u.url)) add(t, 'link', `${u.kind === 'image' ? '圖片' : '連結'}網址沒有填完整：${u.url || '（空白）'}`, u.where);
    }
    return issues;
  }

  /** 圖片：直接在瀏覽器載入看看 */
  function checkImage(url) {
    return new Promise(res => {
      const img = new Image(); let done = false;
      const fin = ok => { if (!done) { done = true; res(ok); } };
      img.onload = () => fin(img.naturalWidth > 0); img.onerror = () => fin(false);
      setTimeout(() => fin(null), 15000);   // 太久沒回應：不判定
      img.src = url;
    });
  }

  /** 需要連網的檢查：圖片在瀏覽器檢查，網頁連結交給 Apps Script */
  async function onlineChecks(onProgress) {
    const issues = [];
    const items = S.all().flatMap(t => collectUrls(t).filter(u => !PLACEHOLDER(u.url)).map(u => ({ ...u, trip: t })));
    const imgs = items.filter(x => x.kind === 'image'), links = items.filter(x => x.kind === 'link');
    const uniq = arr => [...new Set(arr.map(x => x.url))];
    const imgUrls = uniq(imgs), linkUrls = uniq(links);
    const total = imgUrls.length + linkUrls.length;
    let done = 0;
    const badImg = new Set();
    let i = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (i < imgUrls.length) { const u = imgUrls[i++]; if ((await checkImage(u)) === false) badImg.add(u); onProgress(++done, total); }
    }));
    imgs.filter(x => badImg.has(x.url)).forEach(x => issues.push({ trip: x.trip, type: 'image', title: '圖片打不開', where: x.where, url: x.url }));

    const badLink = new Map();
    let linkNote = '';
    for (let k = 0; k < linkUrls.length; k += 30) {
      const part = linkUrls.slice(k, k + 30);
      try {
        const r = await S.call('checkLinks', { urls: part });
        // 只回報確定失效的：404／410，或網域根本不存在；逾時、被網站擋下等不確定的情況不回報
        for (const x of r.results) {
          if (x.status === 404 || x.status === 410) badLink.set(x.url, x.status === 404 ? '找不到網頁 404' : '網頁已移除 410');
          else if (x.status === 0 && /address unavailable|dns|getaddrinfo|name.?not.?resolved|unknown host|nodename|not known/i.test(x.error || '')) badLink.set(x.url, '網域不存在');
        }
      } catch (e) {
        linkNote = /未知動作/.test(e.message) ? '網頁連結需要更新 Apps Script 後才能檢查（圖片已檢查）。' : '網頁連結檢查失敗：' + e.message;
        done += linkUrls.length - k; onProgress(done, total); break;
      }
      done += part.length; onProgress(done, total);
    }
    links.filter(x => badLink.has(x.url)).forEach(x => issues.push({ trip: x.trip, type: 'link', title: `連結失效（${badLink.get(x.url)}）`, where: x.where, url: x.url }));
    return { issues, linkNote, counts: { images: imgUrls.length, links: linkUrls.length } };
  }

  const TYPES = { garbled: '殘留的亂碼網址', image: '打不開的圖片', link: '失效或不完整的連結', city: '找不到位置的城市', empty: '沒有內容的天', range: '日期不在旅程範圍內' };

  function listHtml(issues) {
    if (!issues.length) return '<p class="hc-ok">沒有發現問題。</p>';
    return Object.keys(TYPES).filter(ty => issues.some(x => x.type === ty)).map(ty => {
      const list = issues.filter(x => x.type === ty);
      return `<section class="hc-group"><div class="pk-gh"><span>${TYPES[ty]}</span><small>${list.length}</small></div>
        ${list.map(x => `<div class="hc-item">
          <div class="hc-main"><b>${E(x.trip.title)}</b><span class="hc-where">${E(x.where?.label || '')}</span><div>${E(x.title)}</div>${x.url ? `<a class="hc-url" href="${E(x.url)}" target="_blank" rel="noopener">${E(x.url.length > 70 ? x.url.slice(0, 67) + '…' : x.url)}</a>` : ''}</div>
          <button class="btn sm" data-fix='${E(JSON.stringify({ id: x.trip.id, ...x.where }))}'>前往修改</button>
        </div>`).join('')}</section>`;
    }).join('');
  }

  /** 設定 → 資料健檢 */
  function render(box) {
    let issues = quickChecks();
    box.innerHTML = `
      <p class="hint">已完成基本檢查（亂碼、城市、空白的天、日期）。圖片與網頁連結需要逐一連線確認，按下方按鈕開始（約 1～3 分鐘）。</p>
      <div class="add-row"><button class="btn primary" data-act="hc-online">檢查圖片與連結</button><button class="btn ghost" data-act="hc-rerun">重新檢查</button></div>
      <div class="progress" hidden><div class="bar"><i></i></div><span class="ptxt"></span></div>
      <p class="hint hc-note"></p>
      <div class="hc-summary"></div>
      <div class="hc-list">${listHtml(issues)}</div>`;
    const paintSummary = () => {
      const c = Object.keys(TYPES).map(ty => [ty, issues.filter(x => x.type === ty).length]).filter(x => x[1]);
      U.$('.hc-summary', box).innerHTML = c.length ? `<div class="hc-chips">${c.map(([ty, n]) => `<span>${TYPES[ty]} <b>${n}</b></span>`).join('')}</div>` : '';
    };
    paintSummary();
    box.addEventListener('click', async e => {
      const fx = e.target.closest('[data-fix]');
      if (fx) {
        const f = JSON.parse(fx.dataset.fix);
        sessionStorage.setItem('ta.focus', JSON.stringify(f));
        location.hash = `#/trip/${f.id}/edit`;
        return;
      }
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'hc-rerun') { issues = quickChecks(); U.$('.hc-list', box).innerHTML = listHtml(issues); paintSummary(); U.toast('已重新檢查'); }
      if (a.dataset.act === 'hc-online') {
        if (!navigator.onLine) return U.toast('目前沒有網路', 'err');
        a.disabled = true; a.textContent = '檢查中…';
        const pg = U.$('.progress', box); pg.hidden = false;
        const r = await onlineChecks((d, t) => { U.$('.bar i', box).style.width = (t ? d / t * 100 : 100) + '%'; U.$('.ptxt', box).textContent = `${d} / ${t}`; });
        issues = [...quickChecks(), ...r.issues];
        U.$('.hc-list', box).innerHTML = listHtml(issues); paintSummary();
        U.$('.hc-note', box).textContent = `已檢查 ${r.counts.images} 張圖片、${r.counts.links} 個連結。${r.linkNote}`;
        a.disabled = false; a.textContent = '檢查圖片與連結';
      }
    });
  }

  window.TA = window.TA || {};
  TA.health = { quickChecks, onlineChecks, render };
})();
