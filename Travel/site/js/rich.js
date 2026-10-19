/* 圖文編輯器（所見即所得，不需要寫任何語法）
 * - TA.rich.sanitize(html)：只保留安全的標籤與樣式
 * - TA.rich.editor(path, html, opts)：產生編輯器 HTML
 * - TA.rich.install(root, { onChange, upload })：在容器上掛上所有編輯行為
 * - TA.rich.view(html)：閱讀用 HTML */
(function () {
  const TAGS = {
    P: [], BR: [], DIV: ['class'], SPAN: ['style'], B: [], STRONG: [], I: [], EM: [], U: [], S: [], MARK: [], SUB: [], SUP: [],
    H2: [], H3: [], H4: [], UL: ['class'], OL: [], LI: ['class'], BLOCKQUOTE: [], A: ['href'], IMG: ['src', 'alt', 'style'],
    TABLE: [], THEAD: [], TBODY: [], TR: [], TH: ['colspan', 'rowspan'], TD: ['colspan', 'rowspan'], HR: [], PRE: [], CODE: [],
  };
  const RENAME = { H1: 'H2', H5: 'H4', H6: 'H4', STRIKE: 'S', DEL: 'S', INS: 'U', FONT: 'SPAN', SECTION: 'DIV', ARTICLE: 'DIV' };
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'META', 'LINK', 'TITLE', 'HEAD']);
  const CLASSES = new Set(['fold', 'fold-title', 'fold-body', 'callout', 'warn', 'note', 'checklist', 'task', 'done']);
  const STYLES = { SPAN: ['color', 'background-color', 'font-size', 'font-weight'], IMG: ['width'] };
  // 瀏覽器在合併段落（例如按 Backspace）時，會把段落本身的底色、文字色、字級抄成行內樣式，造成「莫名的底色」。
  // 只保留使用者真的設定的：螢光標記、調色盤顏色、舊資料的色碼與 em 字級、粗體。
  const HILITE = ['rgb(251,231,161)', '#fbe7a1'];
  const PALETTE = ['rgb(180,35,24)', 'rgb(196,87,13)', 'rgb(46,125,79)', 'rgb(31,95,168)', 'rgb(107,79,163)', 'rgb(122,122,122)'];
  function okStyle(prop, val) {
    const v = val.trim().toLowerCase().replace(/\s+/g, '');
    if (prop === 'background-color') return HILITE.includes(v);
    if (prop === 'color') return !/^rgba?\(/.test(v) || PALETTE.includes(v);
    if (prop === 'font-size') return /^\d*\.?\d+em$/.test(v);   // 舊資料用 em；px、rem 是瀏覽器抄的
    if (prop === 'font-weight') return /bold|^[6-9]00$/.test(v);
    return true;
  }
  /** 編輯中：把瀏覽器自己加上的樣式拿掉（只改屬性，不搬動節點，游標不會跳） */
  function tidySpans(body) {
    body.querySelectorAll('span[style]').forEach(sp => {
      const keep = sp.getAttribute('style').split(';').map(x => x.trim()).filter(x => { const i = x.indexOf(':'); return i > 0 && (STYLES.SPAN.includes(x.slice(0, i).trim().toLowerCase())) && okStyle(x.slice(0, i).trim().toLowerCase(), x.slice(i + 1)); });
      const v = keep.join(';');
      if (v !== sp.getAttribute('style')) v ? sp.setAttribute('style', v) : sp.removeAttribute('style');
    });
  }
  const okUrl = (u, img) => /^https?:\/\//i.test(u) || (!img && /^(mailto:|tel:)/i.test(u)) || (img && /^data:image\//i.test(u));

  function clean(src, doc, out) {
    for (const n of [...src.childNodes]) {
      if (n.nodeType === 3) { out.appendChild(doc.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      let tag = n.tagName.toUpperCase();
      if (DROP.has(tag)) continue;
      tag = RENAME[tag] || tag;
      if (!TAGS[tag]) { clean(n, doc, out); continue; } // 不認得的標籤：保留內容
      const el = doc.createElement(tag);
      for (const a of TAGS[tag]) {
        let v = n.getAttribute(a);
        if (v == null) continue;
        if (a === 'class') v = v.split(/\s+/).filter(c => CLASSES.has(c)).join(' ');
        if (a === 'style') {
          v = v.split(';').map(x => x.trim()).filter(x => { const k = x.split(':')[0].trim().toLowerCase(); return (STYLES[tag] || []).includes(k) && !/url\(|expression/i.test(x) && (tag !== 'SPAN' || okStyle(k, x.slice(x.indexOf(':') + 1))); }).join(';');
        }
        if ((a === 'href' || a === 'src') && !okUrl(v.trim(), a === 'src')) continue;
        if (v) el.setAttribute(a, v);
      }
      if (n.tagName === 'FONT' && n.getAttribute('color')) el.setAttribute('style', 'color:' + n.getAttribute('color').replace(/[^#\w]/g, ''));
      if (tag === 'IMG' && !el.getAttribute('src')) continue;
      if (tag === 'SPAN' && !el.getAttribute('style')) { clean(n, doc, out); continue; }
      clean(n, doc, el);
      out.appendChild(el);
    }
  }
  function sanitize(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const out = doc.createElement('div');
    clean(doc.body, doc, out);
    return out.innerHTML.replace(/(<p><br><\/p>)+$/, '');
  }
  const isEmpty = html => { if (!html) return true; if (/<img|<table|<hr/i.test(html)) return false; const d = document.createElement('div'); d.innerHTML = html; return !d.textContent.trim(); };
  const textOf = html => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent.replace(/\s+/g, ' ').trim(); };

  // ---------- 圖示（線條） ----------
  const I = p => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const ICON = {
    undo: I('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
    redo: I('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
    h: I('<path d="M6 5v14M18 5v14M6 12h12"/>'),
    ul: I('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
    ol: I('<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.5 14.5c.5-1 2.5-1 2.5.3 0 1-2.5 2-2.5 3.2h2.6"/>'),
    check: I('<rect x="3" y="4" width="6" height="6" rx="1"/><path d="M4.5 7l1.2 1.2L8 5.8M12 7h9M3 14h6v6H3zM12 17h9"/>'),
    quote: I('<path d="M6 17c-1.5 0-3-1-3-3.5C3 9 6 7 8 6.5M15 17c-1.5 0-3-1-3-3.5C12 9 15 7 17 6.5"/>'),
    link: I('<path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1"/>'),
    img: I('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 9"/>'),
    table: I('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>'),
    fold: I('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 10l4 4 4-4"/>'),
    callout: I('<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>'),
    hr: I('<path d="M3 12h18"/>'),
    color: I('<path d="M6 16L12 4l6 12M8.5 11h7"/><path d="M4 20h16" stroke-width="3" class="sw"/>'),
    mark: I('<path d="M14 4l6 6-8 8H6v-6z"/><path d="M4 21h8"/>'),
    clear: I('<path d="M5 5h11M10 5L7 19M14 15l6 6M20 15l-6 6"/>'),
    rowAdd: I('<rect x="3" y="4" width="18" height="10" rx="1.5"/><path d="M12 17v4M10 19h4"/>'),
    colAdd: I('<rect x="3" y="4" width="11" height="16" rx="1.5"/><path d="M19 10v4M17 12h4"/>'),
    rowDel: I('<rect x="3" y="4" width="18" height="10" rx="1.5"/><path d="M10 19h4"/>'),
  };
  const COLORS = [['', '預設'], ['#b42318', '紅'], ['#c4570d', '橘'], ['#2e7d4f', '綠'], ['#1f5fa8', '藍'], ['#6b4fa3', '紫'], ['#7a7a7a', '灰']];

  function editor(path, html, { placeholder = '在這裡輸入內容…', simple = false } = {}) {
    const b = (cmd, label, title) => `<button type="button" data-cmd="${cmd}" title="${title}" tabindex="-1">${label}</button>`;
    return `<div class="rte" data-path="${path}">
      <div class="rte-bar">
        ${b('undo', ICON.undo, '復原（上一步）')}${b('redo', ICON.redo, '重做')}
        <i class="sep"></i>
        ${b('bold', '<b>B</b>', '粗體')}${b('italic', '<i>I</i>', '斜體')}${b('underline', '<u>U</u>', '底線')}
        <span class="rte-pop">${b('color', ICON.color, '文字顏色')}
          <span class="rte-swatches">${COLORS.map(([c, n]) => `<button type="button" tabindex="-1" data-cmd="fore" data-v="${c}" title="${n}" style="--c:${c || 'var(--ink)'}"></button>`).join('')}</span></span>
        ${b('mark', ICON.mark, '螢光標記')}
        <i class="sep"></i>
        ${b('h', ICON.h, '小標題')}${b('ul', ICON.ul, '項目清單')}${b('ol', ICON.ol, '編號清單')}${b('check', ICON.check, '待辦清單（可勾選）')}${b('quote', ICON.quote, '引用')}
        <i class="sep"></i>
        ${b('link', ICON.link, '連結')}${b('img', ICON.img, '圖片（也可以直接貼上或拖曳）')}
        ${simple ? '' : `${b('table', ICON.table, '表格')}${b('fold', ICON.fold, '可收合區塊')}${b('callout', ICON.callout, '提醒框')}${b('hr', ICON.hr, '分隔線')}`}
        <span class="rte-tbl">${b('rowAdd', ICON.rowAdd, '表格：新增一列')}${b('colAdd', ICON.colAdd, '表格：新增一欄')}${b('rowDel', ICON.rowDel, '表格：刪除此列')}</span>
        ${b('clear', ICON.clear, '清除格式')}
      </div>
      <div class="rte-body rich" contenteditable="true" data-placeholder="${TA.u.esc(placeholder)}">${sanitize(html)}</div>
    </div>`;
  }

  function blockOf(node, root) {
    while (node && node !== root) { if (node.nodeType === 1 && /^(P|H2|H3|H4|BLOCKQUOTE|LI|DIV|TD|TH)$/.test(node.tagName)) return node; node = node.parentNode; }
    return null;
  }
  const closest = (node, sel, root) => { const el = node?.nodeType === 1 ? node : node?.parentElement; const c = el?.closest(sel); return c && root.contains(c) ? c : null; };

  function install(root, { onChange, upload }) {
    let lastRange = null, lastBody = null;
    const fire = body => { body.classList.toggle('empty', isEmpty(body.innerHTML)); onChange(body.closest('.rte').dataset.path, body.innerHTML); };
    const exec = (c, v = null) => document.execCommand(c, false, v);
    const sel = () => window.getSelection();
    const saveSel = () => { const s = sel(); if (s.rangeCount) { const r = s.getRangeAt(0); const b = closest(r.startContainer, '.rte-body', root); if (b) { lastRange = r.cloneRange(); lastBody = b; } } };
    const restore = body => { body.focus(); if (lastRange && lastBody === body) { const s = sel(); s.removeAllRanges(); s.addRange(lastRange); } };
    const insertHTML = (body, html) => { restore(body); exec('insertHTML', html); fire(body); };
    /** 區塊（表格、收合區塊、提醒框）一律插在目前段落之後，不會塞進清單或文字裡 */
    function insertBlock(body, html) {
      const s = sel();
      let node = s.rangeCount ? s.anchorNode : null, top = null;
      while (node && node !== body) {
        const par = node.parentNode;
        if (par === body || par?.classList?.contains('fold-body')) { top = node; break; }
        node = par;
      }
      const tpl = document.createElement('template');
      tpl.innerHTML = html + '<p><br></p>';
      const last = tpl.content.lastChild;
      if (top) top.after(tpl.content); else body.append(tpl.content);
      const r = document.createRange(); r.selectNodeContents(last); r.collapse(true); s.removeAllRanges(); s.addRange(r);
    }

    root.querySelectorAll('.rte-body').forEach(b => b.classList.toggle('empty', isEmpty(b.innerHTML)));
    const onSel = () => {
      saveSel();
      const s = sel();
      root.querySelectorAll('.rte.in-table').forEach(r => r.classList.remove('in-table'));
      if (s.rangeCount) { const td = closest(s.anchorNode, 'td,th', root); if (td) td.closest('.rte').classList.add('in-table'); }
    };
    document.addEventListener('selectionchange', onSel);

    root.addEventListener('mousedown', e => { if (e.target.closest('.rte-bar button')) e.preventDefault(); });
    // ---- 復原／重做：每個編輯框各自記錄（停頓半秒算一步，最多 100 步） ----
    const hist = new Map();
    const keyOf = body => body.closest('.rte')?.dataset.path || '';
    const H = (body, check = true) => {
      const k = keyOf(body);
      let h = hist.get(k);
      // 內容被別的方式改過（例如重新排序後換了內容）：重新開始記錄，避免復原成別的內容
      if (check && h && h.timer == null && h.stack[h.idx] !== body.innerHTML) h = null;
      if (!h) { h = { stack: [body.innerHTML], idx: 0, timer: null }; hist.set(k, h); }
      return h;
    };
    const record = body => {
      const h = H(body, false); clearTimeout(h.timer); h.timer = null;
      const cur = body.innerHTML;
      if (cur === h.stack[h.idx]) return;
      h.stack = h.stack.slice(0, h.idx + 1); h.stack.push(cur);
      if (h.stack.length > 100) h.stack.shift();
      h.idx = h.stack.length - 1;
    };
    const later = body => { const h = H(body, false); clearTimeout(h.timer); h.timer = setTimeout(() => record(body), 500); };
    root.addEventListener('focusin', e => { const b = e.target.closest?.('.rte-body'); if (b) H(b); });
    // 改動前一刻先記下原本的內容（以防沒有觸發 focus，例如從別處直接打字）
    root.addEventListener('beforeinput', e => { const b = e.target.closest?.('.rte-body'); if (b && !String(e.inputType).startsWith('history')) H(b); });
    function travel(body, dir) {
      record(body);
      const h = H(body), to = h.idx + dir;
      if (to < 0 || to >= h.stack.length) return TA.u.toast(dir < 0 ? '已經是最早的內容' : '沒有可以重做的步驟');
      h.idx = to; body.innerHTML = h.stack[to];
      body.focus();
      const r = document.createRange(); r.selectNodeContents(body); r.collapse(false);
      sel().removeAllRanges(); sel().addRange(r);
      fire(body);
    }

    root.addEventListener('input', e => {
      const b = e.target.closest?.('.rte-body'); if (!b) return;
      later(b);
      if (/^(delete|insertParagraph|insertLineBreak|formatBlock)/.test(e.inputType || '')) tidySpans(b);
      fire(b);
    });

    async function addImages(body, files) {
      for (const f of [...files].filter(f => f.type.startsWith('image/'))) {
        const tmp = 'up-' + Date.now() + Math.random().toString(36).slice(2, 6);
        insertHTML(body, `<img src="${URL.createObjectURL(f)}" data-tmp="${tmp}" alt=""><p><br></p>`);
        const img = body.querySelector(`[data-tmp="${tmp}"]`);
        img?.classList.add('uploading');
        try {
          const url = await upload(f);
          if (img) { img.src = url; img.removeAttribute('data-tmp'); img.classList.remove('uploading'); }
        } catch (err) { img?.remove(); TA.u.toast('圖片上傳失敗：' + err.message, 'err'); }
        record(body);
        fire(body);
      }
    }

    root.addEventListener('paste', e => {
      const body = e.target.closest?.('.rte-body');
      if (!body) return;
      const cd = e.clipboardData;
      if (cd.files?.length) { e.preventDefault(); return addImages(body, cd.files); }
      const html = cd.getData('text/html');
      e.preventDefault();
      if (html) exec('insertHTML', sanitize(html.replace(/<!--[\s\S]*?-->/g, '')));
      else exec('insertText', cd.getData('text/plain'));
      fire(body);
    });
    root.addEventListener('drop', e => {
      const body = e.target.closest?.('.rte-body');
      if (body && e.dataTransfer?.files?.length) { e.preventDefault(); addImages(body, e.dataTransfer.files); }
    });
    root.addEventListener('keydown', e => {
      const t = closest(e.target === document.activeElement ? sel().anchorNode : e.target, '.fold-title', root);
      if (t && e.key === 'Enter') { e.preventDefault(); const b = t.nextElementSibling; if (b) { const r = document.createRange(); r.selectNodeContents(b); r.collapse(true); sel().removeAllRanges(); sel().addRange(r); } }
    });
    root.addEventListener('click', e => {
      const li = e.target.closest?.('.rte-body li.task');
      if (li && e.offsetX < 24) { li.classList.toggle('done'); fire(li.closest('.rte-body')); return; }
      const btn = e.target.closest('.rte-bar button');
      if (!btn) return;
      const body = btn.closest('.rte').querySelector('.rte-body');
      restore(body);
      const cmd = btn.dataset.cmd;
      if (cmd === 'undo' || cmd === 'redo') return travel(body, cmd === 'undo' ? -1 : 1);
      if (cmd !== 'color') record(body);
      exec('styleWithCSS', cmd === 'fore' || cmd === 'mark');
      const cur = () => { const s = sel(); return s.rangeCount ? blockOf(s.anchorNode, body) : null; };
      switch (cmd) {
        case 'bold': case 'italic': case 'underline': exec(cmd); break;
        case 'color': btn.parentElement.classList.toggle('open'); return;
        case 'fore':
          // 「預設」= 拿掉顏色，而不是寫死目前的文字色（換深色配色時才不會看不到）
          if (btn.dataset.v) exec('foreColor', btn.dataset.v); else { exec('foreColor', getComputedStyle(body).color); tidySpans(body); }
          btn.closest('.rte-pop').classList.remove('open'); break;
        case 'mark': {
          const bg = closest(sel().anchorNode, 'span[style*="background"]', body);
          exec('hiliteColor', bg ? 'transparent' : '#fbe7a1'); break;
        }
        case 'h': exec('formatBlock', cur()?.tagName === 'H3' ? 'P' : 'H3'); break;
        case 'quote': exec('formatBlock', closest(sel().anchorNode, 'blockquote', body) ? 'P' : 'BLOCKQUOTE'); break;
        case 'ul': exec('insertUnorderedList'); break;
        case 'ol': exec('insertOrderedList'); break;
        case 'check': {
          let ul = closest(sel().anchorNode, 'ul', body);
          if (ul && ul.classList.contains('checklist')) { ul.classList.remove('checklist'); ul.querySelectorAll('li').forEach(l => l.classList.remove('task', 'done')); }
          else {
            if (!ul) { exec('insertUnorderedList'); ul = closest(sel().anchorNode, 'ul', body); }
            if (ul) { ul.classList.add('checklist'); ul.querySelectorAll(':scope > li').forEach(l => l.classList.add('task')); }
          }
          break;
        }
        case 'link': {
          const text = sel().toString();
          linkDialog(text).then(r => {
            if (!r) return;
            restore(body);
            if (text) exec('createLink', r.url); else exec('insertHTML', `<a href="${TA.u.esc(r.url)}">${TA.u.esc(r.text || r.url)}</a>&nbsp;`);
            fire(body);
          });
          return;
        }
        case 'img': imageDialog().then(r => {
          if (!r) return;
          if (r.files) addImages(body, r.files); else insertHTML(body, `<img src="${TA.u.esc(r.url)}" alt=""><p><br></p>`);
        }); return;
        case 'table': insertBlock(body, `<table><thead><tr><th>項目</th><th>內容</th><th>備註</th></tr></thead><tbody><tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table>`); break;
        case 'fold': insertBlock(body, `<div class="fold"><div class="fold-title">標題</div><div class="fold-body"><p>${TA.u.esc(sel().toString()) || '<br>'}</p></div></div>`); break;
        case 'callout': insertBlock(body, `<div class="callout warn"><p>${TA.u.esc(sel().toString()) || '注意事項'}</p></div>`); break;
        case 'hr': exec('insertHorizontalRule'); break;
        case 'clear': exec('removeFormat'); exec('formatBlock', 'P'); break;
        case 'rowAdd': case 'rowDel': case 'colAdd': {
          const td = closest(sel().anchorNode, 'td,th', body); if (!td) return;
          const tr = td.parentElement;
          if (cmd === 'rowAdd') { const n = tr.cloneNode(true); n.querySelectorAll('td,th').forEach(c => { const d = document.createElement('td'); d.innerHTML = '<br>'; c.replaceWith(d); }); (tr.parentElement.tagName === 'THEAD' ? tr.closest('table').tBodies[0] || tr.parentElement : tr.parentElement).insertBefore(n, tr.parentElement.tagName === 'THEAD' ? null : tr.nextSibling); }
          if (cmd === 'rowDel') { if (tr.parentElement.tagName !== 'THEAD') tr.remove(); }
          if (cmd === 'colAdd') { const idx = [...tr.children].indexOf(td); td.closest('table').querySelectorAll('tr').forEach(r => { const c = document.createElement(r.parentElement.tagName === 'THEAD' ? 'th' : 'td'); c.innerHTML = '<br>'; r.children[idx]?.after(c); }); }
          break;
        }
      }
      exec('styleWithCSS', false);   // 之後打字、合併段落不要再產生行內樣式
      record(body);
      fire(body);
    });
    // 鍵盤 Ctrl/⌘+Z、Ctrl+Y、⌘+Shift+Z 也用同一套紀錄
    root.addEventListener('keydown', e => {
      const b = e.target.closest?.('.rte-body'); if (!b || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); travel(b, -1); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); travel(b, 1); }
    });
    const onDown = e => { if (!e.target.closest('.rte-pop')) root.querySelectorAll('.rte-pop.open').forEach(p => p.classList.remove('open')); };
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('selectionchange', onSel); document.removeEventListener('mousedown', onDown); };
  }

  function linkDialog(text) {
    return new Promise(res => {
      const m = TA.u.modal(`
        ${text ? '' : '<label class="fld"><span>顯示文字</span><input type="text" id="lk-t" placeholder="例如：官網"></label>'}
        <label class="fld"><span>網址</span><input type="url" id="lk-u" placeholder="https://"></label>
        <div class="modal-actions"><button class="btn ghost" data-close>取消</button><button class="btn primary" id="lk-ok">加入連結</button></div>`, { title: '加入連結', small: true });
      setTimeout(() => m.el.querySelector(text ? '#lk-u' : '#lk-t').focus(), 50);
      const ok = () => { let url = m.el.querySelector('#lk-u').value.trim(); if (!url) return; if (!/^\w+:/.test(url)) url = 'https://' + url; m.close(); res({ url, text: m.el.querySelector('#lk-t')?.value.trim() }); };
      m.el.querySelector('#lk-ok').onclick = ok;
      m.el.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
      m.onClose = () => res(null);
    });
  }
  function imageDialog() {
    return new Promise(res => {
      const m = TA.u.modal(`
        <label class="drop-zone"><input type="file" accept="image/*" multiple hidden id="im-f"><span>點這裡選擇圖片</span><small>可一次選多張，會自動上傳到你的雲端</small></label>
        <div class="or">或貼上圖片網址</div>
        <div class="row-inline"><input type="url" id="im-u" placeholder="https://"><button class="btn" id="im-ok">插入</button></div>`, { title: '插入圖片', small: true });
      m.el.querySelector('#im-f').onchange = e => { m.close(); res({ files: e.target.files }); };
      m.el.querySelector('#im-ok').onclick = () => { const u = m.el.querySelector('#im-u').value.trim(); if (u) { m.close(); res({ url: u }); } };
      m.onClose = () => res(null);
    });
  }

  /** 閱讀用：連結開新視窗 */
  function view(html) {
    return sanitize(html).replace(/<a href=/g, '<a target="_blank" rel="noopener" href=');
  }

  window.TA = window.TA || {};
  TA.rich = { sanitize, editor, install, view, isEmpty, textOf, ICON };
})();
