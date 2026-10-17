/* 舊版資料（純文字標記格式）→ 新版（圖文格式）的一次性轉換
 * 只在讀到 v < 2 的行程時執行，轉完會存回雲端。 */
(function () {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const FONT_SIZE = { 1: .75, 2: .875, 3: 1, 4: 1.125, 5: 1.375, 6: 1.625, 7: 2 };
  const CONT = 'spoiler|warning|info|success|danger|tip|note';
  const LINK_RE = /\[((?:\[[^\]]*\]|[^\[\]])*)\]\(\s*([^\s)]+)(?:\s+"[^"]*")?\s*\)/g;

  function inline(src, noLinks) {
    const store = [];
    const keep = h => `\u0001${store.push(h) - 1}\u0002`;
    let s = src;
    s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
    s = s.replace(/!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+=(\d+%?|)x(\d+%?|))?(?:\s+"[^"]*")?\s*\)/g, (_, alt, url, w) =>
      keep(`<img src="${esc(url)}" alt="${esc(alt)}"${w ? ` style="width:${/%$/.test(w) ? w : w + 'px'}"` : ''}>`));
    if (!noLinks) {
      s = s.replace(LINK_RE, (_, label, url) => keep(`<a href="${esc(url)}">${inline(label.replace(/^\[(.*)\]$/, '$1') || url, true)}</a>`));
      s = s.replace(/https?:\/\/[\w\-.~:/?#@!$&'*+,;=%\[\]]+/g, url => {
        let tail = '';
        while (/[.,;:!?'\]]$/.test(url)) { tail = url.slice(-1) + tail; url = url.slice(0, -1); }
        const short = url.replace(/^https?:\/\/(www\.)?/, '');
        return keep(`<a href="${esc(url)}">${esc(short.length > 48 ? short.slice(0, 45) + '…' : short)}</a>`) + tail;
      });
    }
    s = s.replace(/<br\s*\/?>/gi, () => keep('<br>'));
    s = s.replace(/<(\/?)(b|strong|i|em|u|mark|sub|sup|s)\s*>/gi, (_, c, t) => keep(`<${c}${t.toLowerCase()}>`));
    s = s.replace(/<(\/?)(big|small)\s*>/gi, (_, c, t) => keep(c ? '</span>' : `<span style="font-size:${t.toLowerCase() === 'big' ? 1.25 : .85}em">`));
    s = s.replace(/<font\b([^>]*)>/gi, (_, attrs) => {
      const st = [];
      const col = attrs.match(/color\s*=\s*["']?([#\w]+)/i);
      const size = attrs.match(/size\s*=\s*["']?(\d)/i);
      if (col && !/^black$/i.test(col[1])) st.push(`color:${col[1]}`);
      if (size && FONT_SIZE[size[1]]) st.push(`font-size:${FONT_SIZE[size[1]]}em`);
      return keep(`<span style="${st.join(';')}">`);
    });
    s = s.replace(/<\/font\s*>/gi, () => keep('</span>'));
    s = esc(s);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>').replace(/==(.+?)==/g, '<mark>$1</mark>').replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');
    let g = 0;
    while (/\u0001\d+\u0002/.test(s) && g++ < 5) s = s.replace(/\u0001(\d+)\u0002/g, (_, n) => store[n]);
    return s;
  }

  const isBlockStart = t => /^(#{1,6}\s|>|```|:::|\|)/.test(t) || /^([-*+]|\d+[.)])\s+/.test(t) || /^(-{3,}|\*{3,})$/.test(t);

  function blocks(lines) {
    const out = [];
    let para = [];
    const flush = () => { if (para.length) out.push(`<p>${para.map(l => inline(l.trim())).join('<br>')}</p>`); para = []; };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i], t = line.trim();
      if (!t) { flush(); i++; continue; }
      let m = t.match(new RegExp(`^:::\\s*(${CONT})\\b\\s*(.*)$`, 'i'));
      if (m) {
        flush();
        let depth = 1, j = i + 1;
        for (; j < lines.length; j++) {
          const tj = lines[j].trim();
          if (new RegExp(`^:::\\s*(${CONT})\\b`, 'i').test(tj)) depth++;
          else if (/^:::\s*$/.test(tj)) { depth--; if (!depth) break; }
        }
        const body = blocks(lines.slice(i + 1, j));
        const kind = m[1].toLowerCase();
        if (kind === 'spoiler') { if (body.trim()) out.push(`<div class="fold"><div class="fold-title">${m[2] ? inline(m[2]) : '詳細內容'}</div><div class="fold-body">${body}</div></div>`); }
        else out.push(`<div class="callout ${kind === 'warning' || kind === 'danger' ? 'warn' : 'note'}">${body}</div>`);
        i = j + 1; continue;
      }
      if (/^:::\s*$/.test(t)) { i++; continue; }
      if (/^```/.test(t)) {
        flush(); let j = i + 1; const buf = [];
        while (j < lines.length && !/^```/.test(lines[j].trim())) buf.push(lines[j++]);
        out.push(`<pre>${esc(buf.join('\n'))}</pre>`); i = j + 1; continue;
      }
      m = t.match(/^(#{1,6})(?:\s+(.*))?$/);
      if (m) { flush(); const lv = m[1].length <= 2 ? 2 : m[1].length === 3 ? 3 : 4; if (m[2]?.trim()) out.push(`<h${lv}>${inline(m[2])}</h${lv}>`); i++; continue; }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t.replace(/\s/g, ''))) { flush(); out.push('<hr>'); i++; continue; }
      if (t.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
        flush();
        const cells = r => r.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
        const head = cells(t);
        let j = i + 2; const rows = [];
        while (j < lines.length && lines[j].trim().startsWith('|')) { const r = cells(lines[j]); if (r.some(c => c)) rows.push(r); j++; }
        out.push(`<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => `<td>${inline(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        i = j; continue;
      }
      if (t.startsWith('>')) {
        flush(); const buf = []; let j = i;
        while (j < lines.length) {
          const tj = lines[j].trim();
          if (tj.startsWith('>')) buf.push(tj.replace(/^>\s?/, ''));
          else if (tj && !isBlockStart(tj) && buf.length) buf.push(tj);
          else break;
          j++;
        }
        out.push(`<blockquote>${blocks(buf)}</blockquote>`); i = j; continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        flush(); const items = []; let j = i;
        while (j < lines.length) {
          const mm = lines[j].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (mm) items.push({ ind: mm[1].replace(/\t/g, '    ').length, ord: /\d/.test(mm[2]), text: [mm[3]] });
          else if (lines[j].trim() && !isBlockStart(lines[j].trim()) && items.length) items[items.length - 1].text.push(lines[j].trim());
          else break;
          j++;
        }
        out.push(listHtml(items)); i = j; continue;
      }
      para.push(line); i++;
    }
    flush();
    return out.join('');
  }

  function listHtml(items) {
    let html = '', stack = [];
    for (const it of items) {
      while (stack.length && it.ind < stack[stack.length - 1].ind) html += `</li></${stack.pop().tag}>`;
      const top = stack[stack.length - 1];
      const cb = it.text[0].match(/^\[( |x|X)\]\s*/);
      if (cb) it.text[0] = it.text[0].slice(cb[0].length);
      const li = cb ? `<li class="task${cb[1] !== ' ' ? ' done' : ''}">` : '<li>';
      if (!top || it.ind > top.ind) {
        const tag = it.ord ? 'ol' : 'ul';
        html += `<${tag}${cb ? ' class="checklist"' : ''}>${li}`;
        stack.push({ ind: it.ind, tag });
      } else html += `</li>${li}`;
      html += it.text.map(x => inline(x)).join('<br>');
    }
    while (stack.length) html += `</li></${stack.pop().tag}>`;
    return html;
  }

  const toHtml = md => blocks(String(md || '').replace(/\r\n?/g, '\n').split('\n'));
  const plain = md => String(md || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(LINK_RE, (_, l) => l.replace(/^\[(.*)\]$/, '$1'))
    .replace(/<[^>]+>/g, '').replace(/[*_`=~]/g, '').replace(/\s+/g, ' ').trim();
  const firstUrl = md => { const m = String(md || '').match(/\]\(\s*(https?:[^\s)]+)/) || String(md || '').match(/https?:\/\/[^\s)\]]+/); return m ? (m[1] || m[0]) : ''; };

  /** 一天的內容：箭頭串起來的行 → 景點清單，其餘 → 備註 */
  function splitRoute(md) {
    const stops = [], rest = [];
    for (const line of String(md || '').split('\n')) {
      const t = line.trim();
      if (/→|->|➝/.test(t) && !/^(>|[-*+]\s|\d+\.\s|https?:|\|)/.test(t)) {
        for (const st of t.split(/\s*(?:→|->|➝)\s*/)) {
          if (!st.trim()) continue;
          const m = st.match(/^(\d{1,2}[:：]\d{2})(?:\s*[-~–]\s*(\d{1,2}[:：]\d{2}))?\s*(.*)$/);
          const body = m ? m[3] : st;
          stops.push({ id: TA.u.uid('p'), time: m ? m[1].replace('：', ':').padStart(5, '0') : '', name: plain(body) || plain(st), url: firstUrl(body) });
        }
      } else rest.push(line);
    }
    return { stops, notes: toHtml(rest.join('\n').trim()) };
  }

  function convertTrip(t) {
    if (t.v >= 2 || t.deleted) return t;
    const days = (t.days || []).map(d => {
      const { stops, notes } = splitRoute(d.content);
      const titleLinks = [...String(d.title || '').matchAll(/\]\(\s*(https?:[^\s)]+)/g)].map(m => m[1]);
      const hotelUrl = firstUrl(d.hotel);
      return {
        id: d.id, date: d.date, title: plain(String(d.title || '').replace(LINK_RE, '')), stops,
        notes: (titleLinks.length ? `<p>${titleLinks.map(u => `<a href="${esc(u)}">${esc(u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 45))}</a>`).join('<br>')}</p>` : '') + notes,
        hotel: plain(d.hotel), hotelUrl: /^https?:/.test(hotelUrl) ? hotelUrl : '',
        blocks: (d.blocks || []).map(b => ({ id: b.id, title: plain(b.title) || '詳細內容', body: toHtml(b.body), open: !!b.open })),
      };
    });
    return {
      ...t, v: 2,
      intro: toHtml(t.intro),
      facts: (t.facts || []).map(f => ({ label: f.label, value: plain(f.value) })),
      days,
      sections: (t.sections || []).map(s => ({ id: s.id, title: plain(s.title), body: toHtml(s.body) })),
      source: undefined,
    };
  }

  window.TA = window.TA || {};
  TA.legacy = { convertTrip, toHtml };
})();
