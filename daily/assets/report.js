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

  // ---- 新聞篩選 ----
  function initNews() {
    var bar = document.querySelector('.newsbar'); if (!bar) return;
    var items = $all('.news[data-mkt]');
    function apply(f) {
      $all('button', bar).forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-filter') === f ? 'true' : 'false'); });
      items.forEach(function (n) { n.hidden = !(f === 'all' || n.getAttribute('data-mkt') === f); });
    }
    $all('button', bar).forEach(function (b) {
      var f = b.getAttribute('data-filter');
      var c = f === 'all' ? items.length : items.filter(function (n) { return n.getAttribute('data-mkt') === f; }).length;
      b.textContent = b.textContent + '（' + c + '）';
    });
    bar.addEventListener('click', function (e) { var b = e.target.closest('button[data-filter]'); if (b) apply(b.getAttribute('data-filter')); });
    apply('all');
  }

  // ---- 上一篇／下一篇 ----
  function initPrevNext(reports) {
    var prev = document.getElementById('prevBtn'), next = document.getElementById('nextBtn');
    if (!prev && !next) return;
    var id = document.body.getAttribute('data-report'), i = -1;
    reports.forEach(function (r, k) { if (r.id === id) i = k; });
    function wire(el, r) {
      if (!el) return;
      if (r) { el.href = r.id + '.html'; el.title = r.date; } else { el.setAttribute('aria-disabled', 'true'); el.removeAttribute('href'); }
    }
    wire(prev, i >= 0 ? reports[i + 1] : null);
    wire(next, i > 0 ? reports[i - 1] : null);
  }

  // ---- 首頁 ----
  function matrix(v) {
    v = v || {};
    var h = '<div class="tbl"><table class="matrix"><thead><tr><th>市場</th><th>短期</th><th>中期</th><th>長期</th></tr></thead><tbody>';
    MKTS.forEach(function (m) { var x = v[m[0]] || {}; h += '<tr><td>' + m[1] + '</td><td>' + chip(x.s) + '</td><td>' + chip(x.m) + '</td><td>' + chip(x.l) + '</td></tr>'; });
    return h + '</tbody></table></div>';
  }
  function buildHome(reports) {
    var el = document.getElementById('latest'), ar = document.getElementById('archive');
    if (!reports.length) { el.innerHTML = '<p class="muted">還沒有報告。</p>'; return; }
    var r = reports[0], href = 'reports/' + r.id + '.html';
    el.innerHTML =
      '<div class="lbl">最新 · ' + esc(r.date) + '（' + esc(r.weekday) + '）' + (r.edition ? ' · ' + esc(r.edition) : '') + '</div>' +
      '<h2><a href="' + href + '">' + esc(r.headline) + '</a></h2>' +
      '<p class="sum">' + esc(r.summary) + '</p>' + matrix(r.views) +
      (r.stats ? '<p class="small muted">' + esc(r.stats) + '</p>' : '') +
      '<a class="cta" href="' + href + '">閱讀完整晨報</a>';
    var by = {}, order = [];
    reports.forEach(function (x) { var m = x.date.slice(0, 7); if (!by[m]) { by[m] = []; order.push(m); } by[m].push(x); });
    var h = '';
    order.forEach(function (m) {
      h += '<div class="month"><h3>' + m.replace('-', ' 年 ') + ' 月</h3>';
      by[m].forEach(function (x) {
        var t = (x.views || {}).tw || {}, u = (x.views || {}).us || {};
        h += '<a class="row-link" href="reports/' + x.id + '.html"><span class="d">' + esc(x.date) + '<small>' + esc(x.weekday) + '</small></span>' +
          '<span class="h">' + esc(x.headline) + '</span><span class="s">台 ' + chip(t.s) + ' 美 ' + chip(u.s) + '</span></a>';
      });
      h += '</div>';
    });
    ar.innerHTML = h;
  }
})();
