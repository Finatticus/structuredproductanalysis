/* 市場日報 共用腳本：主分頁／子分頁（可用網址 #id 直接開啟）、新聞篩選、上一篇／下一篇、首頁清單、隱藏區塊 */
(function () {
  var STANCE = {
    bull: ['偏多', 'st-bull'], lbull: ['中性偏多', 'st-lbull'], neutral: ['中性', 'st-neutral'],
    lbear: ['中性偏空', 'st-lbear'], bear: ['偏空', 'st-bear']
  };
  var MKTS = [['tw', '台灣'], ['us', '美國']];
  function chip(k) { var s = STANCE[k] || STANCE.neutral; return '<span class="st ' + s[1] + '">' + s[0] + '</span>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ---- 隱藏區塊（理性市場資訊、AI 成績單）：依序輸入密碼開啟，瀏覽器記住；手機可連點刊頭小字 5 下輸入 ----
  var VAULT_KEY = 'md-vault', VAULT_CODE = 'xu06rmp4';
  function vaultOn() { try { return localStorage.getItem(VAULT_KEY) === '1'; } catch (e) { return false; } }
  function setVault(on) {
    try { if (on) localStorage.setItem(VAULT_KEY, '1'); else localStorage.removeItem(VAULT_KEY); } catch (e) {}
    document.documentElement.classList.toggle('vault-on', !!on);
  }
  if (vaultOn()) document.documentElement.classList.add('vault-on');
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'vault-toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }
  function unlock() {
    if (vaultOn()) return;
    setVault(true); toast('隱藏權限已開啟');
    if (document.getElementById('home')) vaultBadge();
  }
  function initVault() {
    var buf = '';
    document.addEventListener('keydown', function (e) {
      var tg = e.target && e.target.tagName;
      if (tg === 'INPUT' || tg === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!e.key || e.key.length !== 1) return;
      buf = (buf + e.key.toLowerCase()).slice(-VAULT_CODE.length);
      if (buf === VAULT_CODE) { buf = ''; unlock(); }
    });
    var k = document.querySelector('.mast .kicker'), n = 0, timer = null;
    if (k) k.addEventListener('click', function () {
      n++; clearTimeout(timer); timer = setTimeout(function () { n = 0; }, 1500);
      if (n >= 5) { n = 0; var v = window.prompt(''); if (v && v.trim().toLowerCase() === VAULT_CODE) unlock(); }
    });
    if (document.getElementById('home')) vaultBadge();
  }
  function vaultBadge() {
    var old = document.getElementById('vaultBadge'); if (old) old.remove();
    if (!vaultOn()) return;
    var b = document.createElement('div'); b.id = 'vaultBadge'; b.className = 'vault-badge';
    b.innerHTML = '隱藏權限已開啟<button type="button">關閉</button>';
    b.querySelector('button').addEventListener('click', function () { setVault(false); b.remove(); toast('隱藏權限已關閉'); });
    var m = document.querySelector('.mast .wrap'); if (m) m.appendChild(b);
  }

  document.addEventListener('DOMContentLoaded', function () {
    initVault();
    var reports = (window.REPORTS || []).slice().sort(function (a, b) { return a.id < b.id ? 1 : a.id > b.id ? -1 : 0; });
    if (document.querySelector('nav.maintabs')) initTabs();
    initNews();
    initTips();
    initMobileTables();
    initPrevNext(reports);
    if (document.getElementById('home')) buildHome(reports);
  });


  // ---- 註解提示：.tbd 標籤滑鼠移過（或點一下）顯示說明。可用 data-tip 自訂內容 ----
  var TIPS = {
    '單一來源': '這個數字或說法目前只找到一個來源，沒有第二個獨立來源可以交叉確認，可信度較低，請保留一點懷疑。',
    '非官方來源': '數字來自市場評論、彙整網站或部落格，不是交易所、政府或主要通訊社的原始資料，可能和官方數字略有出入。',
    '二手資訊': '這是其他媒體轉述的內容，沒有找到原始報告或原文可以核對。',
    '待確認': '目前還沒有可靠資料可以確認，之後的報告會再補查更新。',
    '待確認日期': '確切的公布或發生日期還沒確認，括號內是依往例推估的時間。',
    '日期待確認': '確切的公布或發生日期還沒確認，括號內是依往例推估的時間。',
    '日期各行事曆不一': '不同的財經行事曆列出的日期不一致，實際時間以官方公告為準。',
    '推定': '原文沒有標明時區或時間，這是依頁面資訊推算的結果。'
  };
  function initTips() {
    $all('.tbd').forEach(function (el) {
      if (!el.getAttribute('data-tip')) {
        var k = el.textContent.trim();
        var tip = TIPS[k];
        if (!tip) { for (var key in TIPS) { if (k.indexOf(key) >= 0) { tip = TIPS[key]; break; } } }
        if (!tip) return;
        el.setAttribute('data-tip', tip);
      }
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'note');
      el.setAttribute('aria-label', el.textContent.trim() + '：' + el.getAttribute('data-tip'));
    });
    var box = document.createElement('div'); box.className = 'tipbox'; box.hidden = true; document.body.appendChild(box);
    var cur = null;
    function place(el) {
      box.textContent = el.getAttribute('data-tip'); box.hidden = false;
      var r = el.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
      var left = Math.min(Math.max(8, r.left + r.width / 2 - bw / 2), window.innerWidth - bw - 8);
      var top = r.top - bh - 8; if (top < 8) top = r.bottom + 8;
      box.style.left = left + 'px'; box.style.top = top + 'px'; cur = el;
    }
    function hide() { box.hidden = true; cur = null; }
    $all('.tbd[data-tip]').forEach(function (el) {
      el.addEventListener('mouseenter', function () { place(el); });
      el.addEventListener('mouseleave', hide);
      el.addEventListener('focus', function () { place(el); });
      el.addEventListener('blur', hide);
      el.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); if (cur === el) hide(); else place(el); });
    });
    document.addEventListener('click', function () { if (cur) hide(); });
    window.addEventListener('scroll', function () { if (cur) hide(); }, { passive: true });
  }


  // ---- 手機表格：為 3 欄以上的表格加上欄位標籤，手機版 CSS 會把每列改成直式卡片（電腦版不受影響）----
  function initMobileTables() {
    $all('.tbl table, .doc table').forEach(function (t) {
      var heads = $all('thead th', t).map(function (th) { return th.textContent.trim(); });
      if (heads.length < 3) return;
      t.classList.add('mt');
      $all('tbody tr', t).forEach(function (tr) {
        var i = 0;
        Array.prototype.forEach.call(tr.children, function (td) {
          var span = parseInt(td.getAttribute('colspan') || '1', 10);
          if (span === 1 && heads[i]) td.setAttribute('data-label', heads[i]);
          if (td.textContent.trim().length > 16) td.classList.add('long');
          if (!td.textContent.trim() && !td.children.length) td.classList.add('blank');
          i += span;
        });
      });
    });
  }

  // ---- 分頁（三層巢狀：主分頁 → 子分頁 → 子分頁）----
  function kids(el, cls) { return Array.prototype.filter.call(el.children, function (c) { return c.classList.contains(cls); }); }
  function navOf(scope) { var n = kids(scope, 'subtabs'); return n.length ? n[0] : null; }
  function openSub(scope, id) {
    var nav = navOf(scope); if (!nav) return;
    var panes = kids(scope, 'subpanel');
    if (!panes.some(function (p) { return p.id === id; })) {
      var cur = panes.filter(function (p) { return p.classList.contains('on'); })[0];
      id = cur ? cur.id : nav.querySelector('button[data-tab]').getAttribute('data-tab');
    }
    $all('button[data-tab]', nav).forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === id ? 'true' : 'false'); });
    panes.forEach(function (p) { p.classList.toggle('on', p.id === id); });
    var on = document.getElementById(id); if (on) openSub(on, null);
  }
  function openMain(id) {
    var nav = document.querySelector('nav.maintabs');
    var tgt = document.getElementById(id);
    if (!tgt || !nav.querySelector('[data-tab="' + id + '"]') || (tgt.classList.contains('vault') && !vaultOn())) id = nav.querySelector('button[data-tab]').getAttribute('data-tab');
    $all('button[data-tab]', nav).forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === id ? 'true' : 'false'); });
    $all('section.panel').forEach(function (p) { p.classList.toggle('on', p.id === id); });
    var btn = nav.querySelector('[data-tab="' + id + '"]');
    if (btn && btn.scrollIntoView) { try { btn.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {} }
    var panel = document.getElementById(id); openSub(panel, null); return panel;
  }
  function route(scroll) {
    var h = decodeURIComponent((location.hash || '').slice(1));
    var t = h ? document.getElementById(h) : null;
    var chain = [];
    for (var el = t; el; el = el.parentElement) { if (el.classList && (el.classList.contains('subpanel') || el.classList.contains('panel'))) chain.unshift(el); }
    if (!chain.length || !chain[0].classList.contains('panel')) { openMain(h || 'overview'); }
    else {
      openMain(chain[0].id);
      for (var i = 1; i < chain.length; i++) openSub(chain[i].parentElement, chain[i].id);
    }
    if (scroll) { var bar = document.querySelector('.tabbar'); window.scrollTo(0, bar ? bar.offsetTop : 0); }
  }
  function initTabs() {
    document.querySelector('nav.maintabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]'); if (!b) return;
      history.replaceState(null, '', '#' + b.getAttribute('data-tab')); route(true);
    });
    $all('nav.subtabs').forEach(function (nav) {
      nav.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-tab]'); if (!b) return;
        history.replaceState(null, '', '#' + b.getAttribute('data-tab'));
        openSub(nav.parentElement, b.getAttribute('data-tab'));
      });
    });
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href^="#"]'); if (!a || a.closest('nav')) return;
      var id = a.getAttribute('href').slice(1); if (!document.getElementById(id)) return;
      e.preventDefault(); history.replaceState(null, '', '#' + id); route(true);
    });
    window.addEventListener('hashchange', function () { route(true); });
    route(false);
  }

  // ---- 篩選（新聞、行事曆共用）：.fbar / .newsbar > button[data-filter]，對同一分頁內的 [data-mkt] 元素 ----
  function initNews() {
    $all('.fbar, .newsbar').forEach(function (bar) {
      var scope = bar.closest('section.panel') || document;
      var items = $all('[data-mkt]', scope);
      function has(n, f) { return (' ' + n.getAttribute('data-mkt') + ' ').indexOf(' ' + f + ' ') >= 0; }
      function apply(f) {
        $all('button', bar).forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-filter') === f ? 'true' : 'false'); });
        items.forEach(function (n) { n.hidden = !(f === 'all' || has(n, f)); });
      }
      $all('button', bar).forEach(function (b) {
        var f = b.getAttribute('data-filter');
        var c = f === 'all' ? items.length : items.filter(function (n) { return has(n, f); }).length;
        b.textContent = b.textContent + '（' + c + '）';
      });
      bar.addEventListener('click', function (e) { var b = e.target.closest('button[data-filter]'); if (b) apply(b.getAttribute('data-filter')); });
      apply('all');
    });
  }

  // ---- 上一篇／下一篇 ----
  function initPrevNext(reports) {
    var prev = document.getElementById('prevBtn'), next = document.getElementById('nextBtn');
    if (!prev && !next) return;
    var id = document.body.getAttribute('data-report'), i = -1;
    var me = reports.filter(function (r) { return r.id === id; })[0];
    var kind = me ? (me.kind || 'am') : (/-pm$/.test(id) ? 'pm' : /-wk$/.test(id) ? 'wk' : 'am');
    reports = reports.filter(function (r) { return (r.kind || 'am') === kind; });
    reports.forEach(function (r, k) { if (r.id === id) i = k; });
    function wire(el, r) {
      if (!el) return;
      if (r) { el.href = r.id + '.html'; el.title = r.date; } else { el.setAttribute('aria-disabled', 'true'); el.removeAttribute('href'); }
    }
    wire(prev, i >= 0 ? reports[i + 1] : null);
    wire(next, i > 0 ? reports[i - 1] : null);
  }

  // ---- 首頁 ----
  function line(v) {
    v = v || {};
    var h = '';
    MKTS.forEach(function (m) {
      var x = v[m[0]]; if (!x) return;
      h += '<div class="vline"><b>' + m[1] + '</b>' +
        (x.s ? '<span>短 ' + chip(x.s) + '</span>' : '') +
        (x.m ? '<span>中 ' + chip(x.m) + '</span>' : '') +
        (x.l ? '<span>長 ' + chip(x.l) + '</span>' : '') + '</div>';
    });
    return h;
  }
  function card(r, label, kind) {
    var tag = '<div class="hc-tag"><span class="hc-badge">' + label + '</span>' + (r ? '<span class="hc-date">' + esc(r.date.slice(5).replace('-', '/')) + '（' + esc(r.weekday) + '）</span><span class="hc-year">' + esc(r.date.slice(0, 4)) + '</span>' : '') + '</div>';
    if (!r) return '<div class="hcard ' + kind + '">' + tag + '<p class="muted">尚無報告。</p></div>';
    var href = 'reports/' + r.id + '.html';
    // 首頁只放 2–3 條短重點（keys）；沒有 keys 的舊報告只顯示標題
    var keys = (r.keys || []).slice(0, 3).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
    return '<div class="hcard ' + kind + '">' + tag +
      '<h2><a href="' + href + '">' + esc(r.headline) + '</a></h2>' +
      (keys ? '<ul class="keys-s">' + keys + '</ul>' : '') +
      '<div class="vlines">' + line(r.views) + '</div>' +
      '<a class="cta" href="' + href + '">閱讀' + label + '</a></div>';
  }
  function list(arr) {
    if (!arr.length) return '<p class="muted small">尚無報告。</p>';
    return arr.map(function (x) {
      var v = x.views || {}, tags = '';
      var S = { bull: '偏多', lbull: '中性偏多', neutral: '中性', lbear: '中性偏空', bear: '偏空' };
      var cls = { bull: 'up', lbull: 'up', neutral: 'flat', lbear: 'dn', bear: 'dn' };
      function t(lbl, k) { return k ? '<span class="hs-i">' + lbl + '短期 <b class="' + cls[k] + '">' + S[k] + '</b></span>' : ''; }
      if (v.tw) tags += t('台股', v.tw.s);
      if (v.us) tags += t('美股', v.us.s);
      return '<a class="row-link" href="reports/' + x.id + '.html" title="' + esc(x.headline) + '"><span class="d">' + esc(x.date) + '<small>' + esc(x.weekday) + '</small></span>' +
        '<span class="h"><span class="ht">' + esc(x.headline) + '</span><span class="hs">' + tags + '</span></span></a>';
    }).join('');
  }
  function buildHome(reports) {
    var am = reports.filter(function (r) { return (r.kind || 'am') === 'am'; });
    var pm = reports.filter(function (r) { return r.kind === 'pm'; });
    var wk = reports.filter(function (r) { return r.kind === 'wk'; });
    document.getElementById('latest').innerHTML = card(am[0], '早報', 'am') + card(pm[0], '盤後午報', 'pm') + card(wk[0], '週報', 'wk');
    document.getElementById('list-am').innerHTML = list(am);
    document.getElementById('list-pm').innerHTML = list(pm);
    var lw = document.getElementById('list-wk'); if (lw) lw.innerHTML = list(wk);
    // 清單分頁：早報／午報／週報，記住上次選的（瀏覽器不允許時就用預設）
    var arc = document.getElementById('archive'); if (!arc) return;
    var n = { am: am.length, pm: pm.length, wk: wk.length };
    function show(k) {
      $all('.arc-tabs button', arc).forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-kind') === k ? 'true' : 'false'); });
      $all('.arc-list', arc).forEach(function (l) { l.hidden = l.getAttribute('data-kind') !== k; });
      try { localStorage.setItem('md-arc', k); } catch (e) {}
    }
    $all('.arc-tabs button', arc).forEach(function (b) {
      b.insertAdjacentHTML('beforeend', '<small>' + n[b.getAttribute('data-kind')] + '</small>');
      b.addEventListener('click', function () { show(b.getAttribute('data-kind')); });
    });
    var k0 = 'am'; try { k0 = localStorage.getItem('md-arc') || 'am'; } catch (e) {}
    show(n[k0] !== undefined ? k0 : 'am');
  }
})();
