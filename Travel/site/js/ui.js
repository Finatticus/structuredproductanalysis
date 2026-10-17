/* 共用介面元素：線條圖示、國旗、日期格式 */
(function () {
  const S = (p, w = 18) => `<svg class="ico" viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    print: '<path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2"/><rect x="7" y="14" width="10" height="6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    drag: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    bed: '<path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    // 工具箱
    packing: '<rect x="5" y="7" width="14" height="13" rx="2"/><path d="M9 7V4h6v3M5 12h14"/>',
    split: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 20c0-3 2.5-5 5-5s5 2 5 5M13 15.5c1-.3 2-.5 3-.5 2.5 0 5 2 5 5"/>',
    expense: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/>',
    budget: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/>',
    converter: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    checklist: '<path d="M4 6l2 2 3-3M4 13l2 2 3-3M12 7h8M12 14h8M4 20h16"/>',
    docs: '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 5v12" stroke-dasharray="2 2"/>',
    map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    emergency: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M7 12h10"/>',
    wishlist: '<path d="M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.2 7 19l1.2-5.6L4 9.6 9.6 9z"/>',
    weather: '<circle cx="9" cy="9" r="3"/><path d="M9 2v1.5M2 9h1.5M4 4l1 1M14 4l-1 1M8 20h9a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.5A3.3 3.3 0 0 0 8 20z"/>',
  };
  const icon = (name, w) => S(ICONS[name] || '', w);

  const pad = n => String(n).padStart(2, '0');
  const UI = {
    icon,
    flag(name, w = 40) {
      const c = TA.countries.find(name);
      return c ? `<img class="flag" src="${TA.countries.flagUrl(c, w)}" alt="${TA.u.esc(name)}" title="${TA.u.esc(name)}" loading="lazy">` : '';
    },
    nDays: t => (t.startDate && t.endDate ? TA.u.diffDays(t.startDate, t.endDate) + 1 : (t.days || []).length),
    /** 2027.03.27 */
    dot(s, withYear = true) { const d = TA.u.parseISO(s); return d ? `${withYear ? d.getFullYear() + '.' : ''}${pad(d.getMonth() + 1)}.${pad(d.getDate())}` : ''; },
    range(a, b) {
      if (!a) return '日期未定';
      const A = TA.u.parseISO(a), B = TA.u.parseISO(b || a);
      return `${UI.dot(a)} — ${A.getFullYear() === B.getFullYear() ? UI.dot(b || a, false) : UI.dot(b)}`;
    },
    week: s => '星期' + TA.u.weekday(s),
    num: n => Number(n).toLocaleString('en-US'),
    name: () => (window.TA_CONFIG && TA_CONFIG.siteName) || '旅行誌',
  };
  // ---- 網頁配色（每台裝置各自記住，管理者與訪客都能選） ----
  const THEMES = [
    { id: 'paper', name: '米棕', paper: '#f4f1ea', surface: '#fbfaf6', line: '#e1dbcf', primary: '#23403a', accent: '#9a6332' },
    { id: 'white', name: '純白', paper: '#f7f7f5', surface: '#ffffff', line: '#e6e6e3', primary: '#2e3236', accent: '#8a7a62' },
    { id: 'mist', name: '淺灰', paper: '#eff0f0', surface: '#f8f8f8', line: '#dfe1e2', primary: '#3e4649', accent: '#7a8a90' },
    { id: 'sky', name: '淺藍', paper: '#eef3f7', surface: '#f8fbfd', line: '#d9e3eb', primary: '#34536e', accent: '#6b8fae' },
    { id: 'sage', name: '淺綠', paper: '#f0f3ee', surface: '#f9fbf7', line: '#dde4da', primary: '#3d5a46', accent: '#8a9a6a' },
    { id: 'blush', name: '淺粉', paper: '#f8f1f0', surface: '#fdf9f8', line: '#ecdfdd', primary: '#6e4c54', accent: '#b0808a' },
    { id: 'lavender', name: '淺紫', paper: '#f3f2f7', surface: '#fbfafd', line: '#e3e1ec', primary: '#4b4a6b', accent: '#8c82ad' },
    { id: 'dark', name: '深色', paper: '#15181a', surface: '#1b1f21', line: '#2c3134', primary: '#c9b48f', accent: '#d39a62' },
  ];
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { } return null; };
  const theme = {
    list: THEMES,
    get: () => THEMES.find(t => t.id === ls('ta.theme')) ? ls('ta.theme') : 'paper',
    autoDark: () => ls('ta.theme.auto') !== '0',
    apply() {
      const id = theme.get(), auto = theme.autoDark() && id !== 'dark', root = document.documentElement;
      root.dataset.theme = id;
      root.classList.toggle('auto-dark', auto);
      const t = THEMES.find(x => x.id === id), dark = THEMES.find(x => x.id === 'dark');
      document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
        const isDarkMeta = /dark/.test(m.media);
        m.content = isDarkMeta && auto ? dark.paper : t.paper;
      });
    },
    set(id, autoDark) { ls('ta.theme', id); if (autoDark !== undefined) ls('ta.theme.auto', autoDark ? '1' : '0'); theme.apply(); },
  };
  UI.theme = theme;
  theme.apply();

  window.TA = window.TA || {};
  TA.ui = UI;
})();
