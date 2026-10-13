/* =========================================================
 * 設定 — 帳號資訊、登出；管理員另有帳號審核
 * 依賴 app.js（$, $$, api, esc, state, toast, logout）
 * ========================================================= */
const ST_LABEL = {
  admin: ['管理員', 'tag'], pending: ['待審核', 'tag warn'], '通過': ['已通過', 'tag ok'], '拒絕': ['已拒絕', 'tag bad'], '停用': ['已停用', 'tag bad'],
};

function initSettings() {
  $('.nav-btn[data-section="settings"]').addEventListener('click', renderSettings);
  $('#setReload').addEventListener('click', loadUsers);
}

function renderSettings() {
  $('#setAccount').textContent = state.account || '';
  $('#setRole').innerHTML = state.admin ? '<span class="tag">管理員</span>' : '<span class="tag ok">一般使用者</span>';
  $('#setAdmin').classList.toggle('hidden', !state.admin);
  if (state.admin) loadUsers();
}

async function loadUsers() {
  $('#setUsers').innerHTML = '<div class="panel-msg">載入中…</div>';
  try {
    renderUsers((await api('adminUsers')).users);
  } catch (err) {
    $('#setUsers').innerHTML = `<div class="panel-msg err">${esc(err.message)}</div>`;
  }
}

function renderUsers(users) {
  const pending = users.filter(u => u.status === 'pending');
  $('#setPendingCount').textContent = pending.length ? `${pending.length} 位待審核` : '目前沒有待審核帳號';
  $('#setPendingCount').className = pending.length ? 'tag warn' : 'muted';
  const order = { pending: 0, '通過': 1, '停用': 2, '拒絕': 3, admin: 4 };
  const sorted = users.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (b.created || 0) - (a.created || 0));
  const btn = (u, d, label, cls = 'btn-ghost') => `<button class="btn ${cls} btn-sm" data-u="${esc(u.account)}" data-d="${d}">${label}</button>`;
  const actions = u => {
    if (u.admin) return '<span class="muted">—</span>';
    if (u.status === 'pending') return btn(u, 'approve', '✓ 通過', 'btn-primary') + btn(u, 'reject', '拒絕') + btn(u, 'delete', '刪除');
    if (u.status === '通過') return btn(u, 'disable', '停用');
    return btn(u, 'approve', '改為通過') + btn(u, 'delete', '刪除');
  };
  $('#setUsers').innerHTML = `
    <div class="tbl-wrap"><table class="mtbl set-tbl">
      <thead><tr><th>帳號</th><th>註冊時間</th><th>狀態</th><th>操作</th></tr></thead>
      <tbody>${sorted.map(u => {
        const [label, cls] = ST_LABEL[u.status] || [u.status, 'tag'];
        return `<tr class="${u.status === 'pending' ? 'pending' : ''}"><td class="nm">${esc(u.account)}</td>
          <td>${u.created ? new Date(u.created).toLocaleString('zh-TW', { hour12: false }) : '—'}</td>
          <td><span class="${cls}">${label}</span></td><td class="set-act">${actions(u)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
  $$('#setUsers [data-d]').forEach(b => b.addEventListener('click', () => review(b.dataset.u, b.dataset.d)));
}

async function review(account, decision) {
  const word = { approve: '通過', reject: '拒絕', disable: '停用', delete: '刪除' }[decision];
  if (decision !== 'approve' && !confirm(`確定要${word}帳號「${account}」？${decision === 'delete' ? '\n刪除後該帳號可重新註冊。' : ''}`)) return;
  try {
    renderUsers((await api('adminReview', { account, decision })).users);
    toast(`已${word}：${account}`);
  } catch (err) {
    toast(`${word}失敗：${err.message}`);
  }
}

initSettings();
