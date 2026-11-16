/* 每日市場晨報 共用腳本：主分頁／子分頁（可用網址 #id 直接開啟）、新聞篩選、上一篇／下一篇、首頁清單 */
(function () {
  var STANCE = {
    bull: ['偏多', 'st-bull'], lbull: ['中性偏多', 'st-lbull'], neutral: ['中性', 'st-neutral'],
    lbear: ['中性偏空', 'st-lbear'], bear: ['偏空', 'st-bear']
  };
  var MKTS = [['tw', '台灣'], ['us', '美國']];
  function chip(k) { var s = STANCE[k] || STANCE.neutral; return '<span class="st ' + s[1] + '">' + s[0] + '</span>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  document.addEventListener('DOMContentLoaded', function () {
    var reports = (window.REPORTS || []).slice().sort(function (a, b) { return a.id < b.id ? 1 : a.id > b.id ? -1 : 0; });
    if (document.querySelector('nav.maintabs')) initTabs();
    initNews();
    initPrevNext(reports);
    if (document.getElementById('home')) buildHome(reports);
  });

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
    if (!document.getElementById(id) || !nav.querySelector('[data-tab="' + id + '"]')) id = nav.querySelector('button[data-tab]').getAttribute('data-tab');
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
    var kind = me ? (me.kind || 'am') : (/-pm$/.test(id) ? 'pm' : 'am');
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
        (x.s ? '<span>短期 ' + chip(x.s) + '</span>' : '') +
        (x.m ? '<span>中期 ' + chip(x.m) + '</span>' : '') +
        (x.l ? '<span>長期 ' + chip(x.l) + '</span>' : '') + '</div>';
    });
    return h;
  }
  function card(r, label) {
    if (!r) return '<div class="hcard empty"><div class="lbl">' + label + '</div><p class="muted">尚無報告。</p></div>';
    var href = 'reports/' + r.id + '.html';
    var pts = (r.points || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
    return '<div class="hcard"><div class="lbl">' + label + ' · ' + esc(r.date) + '（' + esc(r.weekday) + '）</div>' +
      '<h2><a href="' + href + '">' + esc(r.headline) + '</a></h2>' +
      (pts ? '<ul class="pts">' + pts + '</ul>' : '<p class="sum">' + esc(r.summary) + '</p>') +
      '<div class="vlines">' + line(r.views) + '</div>' +
      '<a class="cta" href="' + href + '">閱讀完整' + (r.kind === 'pm' ? '午報' : '早報') + '</a></div>';
  }
  function list(arr) {
    if (!arr.length) return '<p class="muted small">尚無報告。</p>';
    return arr.map(function (x) {
      var t = (x.views || {}).tw || {};
      return '<a class="row-link" href="reports/' + x.id + '.html"><span class="d">' + esc(x.date) + '<small>' + esc(x.weekday) + '</small></span>' +
        '<span class="h">' + esc(x.headline) + '</span><span class="s">台股短期 ' + chip(t.s) + '</span></a>';
    }).join('');
  }
  function buildHome(reports) {
    var am = reports.filter(function (r) { return (r.kind || 'am') === 'am'; });
    var pm = reports.filter(function (r) { return r.kind === 'pm'; });
    document.getElementById('latest').innerHTML = card(am[0], '最新早報') + card(pm[0], '最新盤後午報');
    document.getElementById('list-am').innerHTML = list(am);
    document.getElementById('list-pm').innerHTML = list(pm);
  }
})();
