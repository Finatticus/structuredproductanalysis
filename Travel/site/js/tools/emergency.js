/* 旅行工具箱：緊急資訊
 * #/tool/emergency            選旅程或任何國家
 * #/tool/emergency/<tripId>   這趟旅程每個國家的緊急資訊
 * 資料：js/emergency-data.js（外交部領事事務局、駐外館處入口網、中華人民共和國外交部公開資料，開啟本頁時才載入） */
(function () {
  const U = TA.u, S = TA.store, E = TA.u.esc, UI = TA.ui;
  let dataP = null;
  const loadData = () => dataP || (dataP = new Promise((res, rej) => {
    if (window.TA_EMERGENCY) return res(window.TA_EMERGENCY);
    const s = document.createElement('script');
    s.src = 'js/emergency-data.js?v=' + (document.querySelector('script[src*="emergency.js"]')?.src.split('v=')[1] || '1');
    s.onload = () => res(window.TA_EMERGENCY); s.onerror = () => { dataP = null; rej(new Error('資料載入失敗')); };
    document.head.appendChild(s);
  }));

  /** 從文字中取出第一個電話號碼，轉成可撥打的格式 */
  function tel(str) {
    if (!str) return '';
    // 911、112、110 這類短號：第一段號碼總共只有 3–5 個數字
    const s0 = String(str).replace(/（/g, '(').replace(/）/g, ')').replace(/＋/g, '+').replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
    const segs = s0.split(/[；;\n/／、]/).map(x => x.trim()).filter(Boolean);
    const digits = (segs[0] || '').replace(/\D/g, '');
    if (digits.length >= 3 && digits.length <= 5) return digits;
    // 優先用國際格式（有 +），其次用「境內直撥」（人在當地一定撥得通），最後才用第一個號碼
    const pick = segs.find(x => /\+\s*\d/.test(x)) || segs.find(x => /境內|當地|國內/.test(x)) || segs.find(x => /\d{3}/.test(x)) || '';
    const m = pick.match(/(?:\+|\(?00\d?[-\s]?)?[\d()\-\s]{6,}\d/);
    if (!m) return '';
    let n = m[0].trim();
    // (002-81)、0081、(81-3)、(48) 這幾種寫法都轉成 +國碼
    n = n.replace(/^\(?002-?/, '+').replace(/^\(?00(?=\d)/, '+').replace(/^\((\d{1,3})(?:-|\)\s*)/, '+$1-').replace(/[^\d+]/g, '');
    // 沒有 0 開頭又很長的號碼，視為已含國碼（例如 82-10-…）
    if (!n.startsWith('+') && !n.startsWith('0') && n.length >= 11) n = '+' + n;
    return n.length >= 6 ? n : '';
  }
  const telLink = (label, str, cls = '') => {
    const t = tel(str);
    // 大字顯示「實際會撥出的那個號碼」，原文完整放在下方小字
    const full = String(str).trim();
    let main = full, note = '';
    if (t && full.length > 24) {
      const tail = t.replace(/\D/g, '').slice(-7);
      const cands = full.match(/[+(（]*\d[\d()（）+\-\s]{4,}\d/g) || [];
      const hit = cands.find(c => c.replace(/\D/g, '').endsWith(tail));
      main = hit ? hit.trim() : t;
      note = full;
    }
    const inner = `${E(label)}<b>${E(main)}</b>${note ? `<small>${E(note.length > 120 ? note.slice(0, 120) + '…' : note)}</small>` : ''}`;
    return t ? `<a class="em-tel ${cls}" href="tel:${t}">${inner}</a>` : `<div class="em-tel ${cls}">${inner}</div>`;
  };
  const mapLink = q => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  const nl = s => E(s || '').replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

  function missionCard(m, near, kind) {
    const rows = [];
    if (m.addr) {
      // 地址後面常接交通、停車說明：地址單獨顯示，其餘收合
      // 有些館址第一行是館名，取第一個含數字的段落
      const segs = m.addr.split(/\n|\s(?=交通|停車|（一）|\(一\)|一、|Transportation)/).map(x => x.trim()).filter(Boolean);
      let main = segs.find(x => /\d/.test(x)) || segs[0] || '';
      if (main.length > 160) main = main.slice(0, 160) + '…';
      const rest = m.addr.slice(m.addr.indexOf(main.replace(/…$/, '')) + main.replace(/…$/, '').length).trim();
      rows.push(`<div class="em-row"><dt>地址</dt><dd>${E(main)}　<a href="${mapLink(main.replace(/…$/, ''))}" target="_blank" rel="noopener">${UI.icon('map', 13)}地圖</a>
        ${rest.length > 10 ? `<details class="em-more"><summary>交通與其他說明</summary><p class="em-txt">${nl(rest)}</p></details>` : ''}</dd></div>`);
    }
    if (m.tel) rows.push(`<div class="em-row"><dt>電話</dt><dd>${tel(m.tel) ? `<a href="tel:${tel(m.tel)}">${E(m.tel)}</a>` : E(m.tel)}</dd></div>`);
    if (m.email) rows.push(`<div class="em-row"><dt>電子郵件</dt><dd>${E(m.email).replace(/\n/g, '<br>')}</dd></div>`);
    if (m.hours) rows.push(`<div class="em-row"><dt>服務時間</dt><dd>${E(m.hours)}</dd></div>`);
    if (m.url) rows.push(`<div class="em-row"><dt>網站</dt><dd><a href="${E(m.url)}" target="_blank" rel="noopener">${E(m.url.replace(/^https?:\/\//, '').slice(0, 40))}</a></dd></div>`);
    return `<article class="em-card${near ? ' near' : ''}">
      <div class="em-card-h"><b>${E(m.name)}</b>${near ? `<span class="em-near">在你的行程附近</span>` : ''}</div>
      ${m.emg ? telLink(kind === 'tw' ? '急難救助（24 小時，非急難請勿撥打）' : '領事保護與協助', m.emg, 'urgent') : ''}
      <dl class="em-dl">${rows.join('')}</dl>
      ${m.area ? `<div class="fold"><div class="fold-title">領務轄區</div><div class="fold-body"><p class="em-txt">${nl(m.area)}</p></div></div>` : ''}
    </article>`;
  }

  /** 依行程排序：在行程城市附近（150 公里內）的館處排前面、依造訪順序；其餘依距離 */
  function sortByTrip(list, pts) {
    if (!pts.length) return list.map(m => ({ m, near: false }));
    const score = m => {
      if (!m.ll) return { s: 1e12, near: false };
      const ds = pts.map(p => TA.geo.dist(p.ll, m.ll));
      const i = ds.findIndex(d => d < 150);
      return i >= 0 ? { s: i * 1000 + ds[i], near: true } : { s: 1e6 + Math.min(...ds), near: false };
    };
    const sc = new Map(list.map(m => [m, score(m)]));
    const sorted = list.slice().sort((a, b) => sc.get(a).s - sc.get(b).s);
    const anyFar = list.length > 1;
    return sorted.map(m => ({ m, near: anyFar && sc.get(m).near }));
  }

  function countryHtml(data, name, trip) {
    const c = TA.countries.find(name);
    if (!c) return `<section class="em-country"><h2>${E(name)}</h2><p class="muted">找不到這個國家。</p></section>`;
    const info = TA.countryInfo.get(c.zh);
    const pts = trip ? TA.geo.placePoints([c.zh], trip.cities, trip).filter(p => {
      // 只用這個國家裡的城市來排序
      return !c.cap || TA.geo.dist(p.ll, c.cap) < 4000;
    }) : [];
    const tw = sortByTrip(data.tw[c.iso] || [], pts);
    const cn = sortByTrip(data.cn[c.iso] || [], pts);
    const life = data.info[c.iso] || {};
    return `<section class="em-country">
      <h2>${UI.flag(c.zh, 80)}<span>${E(c.zh)}</span></h2>
      <div class="em-sos">
        ${telLink('當地報警／急救', info?.sos || '112（多數國家的手機都能撥打）', 'big')}
        ${telLink('外交部急難救助 全球免付費', '800-0885-0885', 'big')}
        ${telLink('無法撥打免付費時', '+886-800-085-095', 'big')}
      </div>
      <h3 class="em-h">台灣駐外館處</h3>
      ${life.cover ? `<p class="em-cover">${E(life.cover)}</p>` : ''}
      ${life.sef ? telLink('海基會 24 小時緊急服務專線', '+886-2-2533-9995', 'urgent') : ''}
      ${tw.length ? tw.map(x => missionCard(x.m, x.near, 'tw')).join('') : (life.sef ? '' : '<p class="muted">這個國家沒有我國駐外館處，請撥打上方外交部急難救助專線。</p>')}
      ${['cn', 'hk', 'mo'].includes(c.iso) ? '' : '<h3 class="em-h">中國駐當地使領館</h3>'}
      ${['cn', 'hk', 'mo'].includes(c.iso) ? '' : cn.length ? cn.map(x => missionCard(x.m, x.near, 'cn')).join('') : '<p class="muted">沒有找到中國在這個國家的使領館資料。</p>'}
      ${life.safety || life.medical ? `<h3 class="em-h">當地資訊</h3>
        ${life.safety ? `<div class="fold"><div class="fold-title">治安狀況</div><div class="fold-body"><p class="em-txt">${nl(life.safety)}</p></div></div>` : ''}
        ${life.medical ? `<div class="fold"><div class="fold-title">醫療與保險</div><div class="fold-body"><p class="em-txt">${nl(life.medical)}</p></div></div>` : ''}` : ''}
      ${life.src ? `<p class="hint">資料來源：<a href="${E(life.src)}" target="_blank" rel="noopener">外交部領事事務局</a></p>` : ''}
    </section>`;
  }

  const GENERAL = `<section class="em-country em-general">
    <h2><span>通用處理方式</span></h2>
    <div class="fold"><div class="fold-title">護照遺失或被竊</div><div class="fold-body"><ol class="em-steps">
      <li>向當地警察報案，取得報案證明（Police Report）。</li>
      <li>準備：報案證明、身分證或護照影本、2 吋照片 2 張（沒有的話可先到館處詢問）。</li>
      <li>聯絡最近的駐外館處，申請補發護照，或申請「入國證明書」先回台灣。</li>
      <li>若影響回程班機，同時通知航空公司與旅行社。</li>
    </ol><p class="hint">建議出發前把護照資料頁拍照存在手機與雲端。</p></div></div>
    <div class="fold"><div class="fold-title">信用卡遺失或被盜刷</div><div class="fold-body">
      ${telLink('Visa 全球緊急服務', '+1-303-967-1090')}
      ${telLink('Mastercard 全球服務', '+1-636-722-7111')}
      ${telLink('American Express', '+1-336-393-1111')}
      <p class="hint">JCB 與各發卡銀行的海外掛失電話印在卡片背面，建議出發前先存進手機通訊錄。</p></div></div>
    <div class="fold"><div class="fold-title">生病或受傷</div><div class="fold-body"><ol class="em-steps">
      <li>緊急狀況先撥當地急救電話，或直接到最近的醫院急診。</li>
      <li>聯絡旅遊保險的海外急難救助專線（保單上有），可協助轉介醫院、墊付醫療費用。</li>
      <li>保留所有診斷證明、收據正本，回國後申請保險理賠與健保核退（需在 6 個月內）。</li>
    </ol></div></div>
    <div class="fold"><div class="fold-title">遭遇天災、意外或被捕</div><div class="fold-body"><ol class="em-steps">
      <li>先確保自身安全，聯絡家人報平安。</li>
      <li>撥打駐外館處急難救助電話，或外交部急難救助全球免付費專線。</li>
      <li>出發前可到外交部「出國登錄」登錄行程，發生重大事件時館處能主動聯繫你。</li>
    </ol><p class="hint"><a href="https://www.boca.gov.tw/sp-trreg-main-1.html" target="_blank" rel="noopener">外交部出國登錄</a></p></div></div>
  </section>`;

  async function render(el, { trip, sub }) {
    if (sub && !trip) { el.innerHTML = `<div class="empty-box">找不到這段旅程<br><a class="btn" href="#/tool/emergency">回緊急資訊</a></div>`; return; }
    const trips = S.all().filter(t => S.statusOf(t) !== 'done').sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    const cur = trip || trips[0] || null;
    let picked = sessionStorage.getItem('ta.em.country') || '';
    el.innerHTML = `<div class="narrow wide">
      <a class="back" href="${trip ? '#/trip/' + trip.id : '#/tools'}">${UI.icon('back', 16)}${trip ? E(trip.title) : '旅行工具箱'}</a>
      <header class="page-head slim"><div class="eyebrow">Emergency</div><h1 class="display">緊急資訊</h1>
        <p class="lede">當地緊急電話、我國駐外館處與急難救助電話、中國駐當地使領館，以及治安、醫療與證件遺失的處理方式。</p></header>
      <div class="wx-pick">${trips.map(t => `<a href="#/tool/emergency/${t.id}" class="chip-x${cur && cur.id === t.id && !picked ? ' on' : ''}">${E(t.title)}</a>`).join('')}</div>
      <form class="wx-search"><input type="text" id="em-q" list="dl-em" placeholder="查詢其他國家，例如：義大利" value="${E(picked)}"><button class="btn" type="submit">查詢</button></form>
      <datalist id="dl-em">${TA.countries.list.map(c => `<option value="${c.zh}">`).join('')}</datalist>
      <div class="em-body"><p class="muted">讀取中…</p></div>
    </div>`;
    const body = U.$('.em-body', el);
    let data;
    try { data = await loadData(); } catch (e) { body.innerHTML = `<p class="muted">${E(e.message)}</p>`; return; }
    const paint = () => {
      const names = picked ? [picked] : (cur?.countries || []);
      body.innerHTML = (names.length ? names.map(n => countryHtml(data, n, picked ? null : cur)).join('') : '<p class="muted">選一段旅程，或查詢國家。</p>') + GENERAL
        + `<p class="hint">館處資料整理自外交部領事事務局（${E(data.updated)}），出發前可到外交部網站確認最新資訊。</p>`;
    };
    paint();
    U.$('.wx-search', el).addEventListener('submit', e => {
      e.preventDefault();
      const v = U.$('#em-q', el).value.trim();
      if (v && !TA.countries.find(v)) return U.toast('找不到這個國家', 'err');
      picked = v; sessionStorage.setItem('ta.em.country', v);
      U.$$('.wx-pick .chip-x', el).forEach(a => a.classList.toggle('on', !v && cur && a.getAttribute('href').endsWith(cur.id)));
      paint();
    });
    el.addEventListener('click', e => {
      const ft = e.target.closest('.fold-title'); if (ft) { ft.parentElement.classList.toggle('open'); return; }
      if (e.target.closest('.wx-pick a')) sessionStorage.removeItem('ta.em.country');
    });
  }

  const tool = TA.tools.get('emergency');
  tool.status = 'ready';
  tool.render = render;
})();
