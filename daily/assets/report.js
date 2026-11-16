/* 每日市場報告 共用腳本：主題切換、目錄高亮、上一篇／下一篇、首頁清單 */
(function () {
  var root = document.documentElement;

  // ---- 主題 ----
  function getTheme() { try { return localStorage.getItem('daily-theme'); } catch (e) { return null; } }
  function setTheme(t) {
    if (t) root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    try { t ? localStorage.setItem('daily-theme', t) : localStorage.removeItem('daily-theme'); } catch (e) {}
  }
  var saved = getTheme();
  if (saved) root.setAttribute('data-theme', saved);

  document.addEventListener('DOMContentLoaded', function () {
    var tb = document.getElementById('themeBtn');
    if (tb) tb.addEventListener('click', function () {
      var cur = root.getAttribute('data-theme') ||
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      setTheme(cur === 'dark' ? 'light' : 'dark');
    });

    var reports = (window.REPORTS || []).slice().sort(function (a, b) {
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });

    buildToc();
    buildPrevNext(reports);
    if (document.getElementById('home')) buildHome(reports);
  });

  var STANCE = {
    bull: ['偏多', 's-bull'], lbull: ['中性偏多', 's-lbull'], neutral: ['中性', 's-neutral'],
    lbear: ['中性偏空', 's-lbear'], bear: ['偏空', 's-bear']
  };
  function chip(k) {
    var s = STANCE[k] || STANCE.neutral;
    return '<span class="stance ' + s[1] + '">' + s[0] + '</span>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---- 報告頁：目錄 ----
  function buildToc() {
    var toc = document.getElementById('toc');
    if (!toc) return;
    var secs = Array.prototype.slice.call(document.querySelectorAll('main section.sec[id]'));
    var html = '<div class="toc-title">目錄</div>';
    secs.forEach(function (s) {
      var label = s.getAttribute('data-toc') || (s.querySelector('h2') ? s.querySelector('h2').firstChild.textContent.trim() : s.id);
      html += '<a href="#' + s.id + '">' + esc(label) + '</a>';
    });
    toc.innerHTML = html;
    var links = Array.prototype.slice.call(toc.querySelectorAll('a'));
    function onScroll() {
      var y = window.scrollY + 130, cur = 0;
      secs.forEach(function (s, i) { if (s.offsetTop <= y) cur = i; });
      links.forEach(function (a, i) { a.classList.toggle('on', i === cur); });
      var on = links[cur];
      if (on && toc.scrollWidth > toc.clientWidth) {
        toc.scrollLeft = on.offsetLeft - toc.clientWidth / 2 + on.clientWidth / 2;
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---- 報告頁：上一篇／下一篇 ----
  function buildPrevNext(reports) {
    var prev = document.getElementById('prevBtn'), next = document.getElementById('nextBtn');
    if (!prev && !next) return;
    var id = document.body.getAttribute('data-report');
    var i = -1;
    reports.forEach(function (r, k) { if (r.id === id) i = k; });
    function wire(el, r) {
      if (!el) return;
      if (r) { el.href = r.id + '.html'; el.title = r.date; }
      else { el.setAttribute('aria-disabled', 'true'); el.removeAttribute('href'); }
    }
    wire(prev, i >= 0 ? reports[i + 1] : null);  // 較舊
    wire(next, i > 0 ? reports[i - 1] : null);   // 較新
  }

  // ---- 首頁 ----
  function viewsRow(label, v) {
    v = v || {};
    return '<div class="mini"><b>' + label + '</b><div class="row">' +
      '<span><span class="l">短期</span>' + chip(v.short) + '</span>' +
      '<span><span class="l">中期</span>' + chip(v.mid) + '</span>' +
      '<span><span class="l">長期</span>' + chip(v.long) + '</span></div></div>';
  }
  function buildHome(reports) {
    var latestEl = document.getElementById('latest'), archEl = document.getElementById('archive');
    if (!reports.length) {
      latestEl.innerHTML = '<p class="empty">還沒有報告。</p>';
      return;
    }
    var r = reports[0];
    var href = 'reports/' + r.id + '.html';
    latestEl.innerHTML =
      '<div class="tag">最新報告 · ' + esc(r.date) + '（' + esc(r.weekday) + '）' + (r.edition ? ' · ' + esc(r.edition) : '') + '</div>' +
      '<h2><a href="' + href + '">' + esc(r.headline) + '</a></h2>' +
      '<p class="sum">' + esc(r.summary) + '</p>' +
      '<div class="mini-views">' + viewsRow('全球市場', r.global) + viewsRow('台灣市場', r.taiwan) + '</div>' +
      (r.stats ? '<p class="small muted">' + esc(r.stats) + '</p>' : '') +
      '<a class="cta" href="' + href + '">閱讀完整報告</a>';

    var byMonth = {}, order = [];
    reports.forEach(function (x) {
      var m = x.date.slice(0, 7);
      if (!byMonth[m]) { byMonth[m] = []; order.push(m); }
      byMonth[m].push(x);
    });
    var html = '';
    order.forEach(function (m) {
      html += '<div class="month"><h3>' + m.replace('-', ' 年 ') + ' 月</h3><div class="rows">';
      byMonth[m].forEach(function (x) {
        html += '<a class="row-link" href="reports/' + x.id + '.html">' +
          '<span class="d">' + esc(x.date) + '<small>' + esc(x.weekday) + (x.edition ? ' ' + esc(x.edition) : '') + '</small></span>' +
          '<span class="h">' + esc(x.headline) + '</span>' +
          '<span class="st">全球 ' + chip((x.global || {}).short) + ' 台灣 ' + chip((x.taiwan || {}).short) + '</span></a>';
      });
      html += '</div></div>';
    });
    archEl.innerHTML = html;
    var cnt = document.getElementById('count');
    if (cnt) cnt.textContent = '共 ' + reports.length + ' 份';
  }
})();
