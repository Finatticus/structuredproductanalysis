/* 共用小工具 */
(function () {
  window.TA = window.TA || {};
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  const U = {
    $: (sel, el = document) => el.querySelector(sel),
    $$: (sel, el = document) => Array.from(el.querySelectorAll(sel)),
    esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    uid(prefix = '') { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
    clone: o => JSON.parse(JSON.stringify(o)),

    // ---- 日期 ----
    todayStr() { return U.fmtISO(new Date()); },
    fmtISO(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
    parseISO(s) { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
    addDays(s, n) { const d = U.parseISO(s); d.setDate(d.getDate() + n); return U.fmtISO(d); },
    diffDays(a, b) { return Math.round((U.parseISO(b) - U.parseISO(a)) / 86400000); },
    weekday(s) { const d = U.parseISO(s); return d ? WEEK[d.getDay()] : ''; },
    md(s) { const d = U.parseISO(s); return d ? `${d.getMonth() + 1}/${d.getDate()}` : ''; },
    fmtRange(a, b) {
      if (!a) return '日期未定';
      const A = U.parseISO(a), B = U.parseISO(b || a);
      const p = d => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
      if (A.getFullYear() === B.getFullYear()) return `${p(A)} – ${String(B.getMonth() + 1).padStart(2, '0')}/${String(B.getDate()).padStart(2, '0')}`;
      return `${p(A)} – ${p(B)}`;
    },

    debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },

    hashColor(str) {
      let h = 0; for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
      return h % 360;
    },

    toast(msg, type = 'ok') {
      let box = U.$('#toasts');
      if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
      const t = document.createElement('div');
      t.className = 'toast ' + type; t.textContent = msg;
      box.appendChild(t);
      setTimeout(() => t.classList.add('out'), 2600);
      setTimeout(() => t.remove(), 3000);
    },

    /** 簡易對話框，回傳 Promise<boolean> */
    confirm(msg, { ok = '確定', cancel = '取消', danger = false } = {}) {
      return new Promise(res => {
        const m = U.modal(`<p class="confirm-msg">${U.esc(msg)}</p>
          <div class="modal-actions"><button class="btn ghost" data-x="0">${cancel}</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" data-x="1">${ok}</button></div>`, { small: true });
        m.el.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (b) { m.close(); res(b.dataset.x === '1'); } });
        m.onClose = () => res(false);
      });
    },

    modal(html, { title = '', small = false, wide = false } = {}) {
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = `<div class="modal ${small ? 'small' : ''} ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        ${title ? `<div class="modal-head"><h3>${U.esc(title)}</h3><button class="icon-btn" data-close aria-label="關閉">✕</button></div>` : ''}
        <div class="modal-body">${html}</div></div>`;
      document.body.appendChild(wrap);
      requestAnimationFrame(() => wrap.classList.add('in'));
      const api = {
        el: wrap.querySelector('.modal'),
        onClose: null,
        close() { wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 180); document.removeEventListener('keydown', onKey); },
      };
      const onKey = e => { if (e.key === 'Escape') { api.close(); api.onClose && api.onClose(); } };
      document.addEventListener('keydown', onKey);
      wrap.addEventListener('mousedown', e => { if (e.target === wrap) { api.close(); api.onClose && api.onClose(); } });
      wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) { api.close(); api.onClose && api.onClose(); } });
      return api;
    },

    download(filename, text, type = 'application/json') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type }));
      a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },

    autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 900) + 'px'; },
  };
  TA.u = U;
})();
