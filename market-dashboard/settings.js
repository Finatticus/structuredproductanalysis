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
  $('#diagStats').addEventListener('click', () => loadDiag(false));
  $('#diagProbe').addEventListener('click', () => loadDiag(true));
}

function renderSettings() {
  $('#setAccount').textContent = state.account || '';
  $('#setRole').innerHTML = state.admin ? '<span class="tag">管理員</span>' : '<span class="tag ok">一般使用者</span>';
  $('#setAdmin').classList.toggle('hidden', !state.admin);
  if (state.admin) loadUsers();
  loadDiag(false);
}

/* ---------- 連線診斷 ----------
 * 一次請求的時間 = 瀏覽器到 Google 的排隊／網路（總耗時 − 後端耗時）＋ 後端耗時（主要是外部來源）。
 * 依這兩段判斷慢在哪裡：外部來源慢 → 斷路器會暫停它並改用備援；後端排隊慢 → 同時開太多分頁或請求。 */
const diagMs = ms => (ms == null ? '—' : ms >= 1000 ? (ms / 1000).toFixed(1) + ' 秒' : ms + ' ms');
const diagCls = ms => (ms == null ? '' : ms > 8000 ? 'bad' : ms > 2500 ? 'warn' : 'ok');

async function loadDiag(probe) {
  const body = $('#diagBody');
  const btn = $('#diagProbe');
  if (probe) { btn.disabled = true; btn.textContent = '實測中…（約 10–60 秒）'; }
  if (!body.dataset.loaded || probe) body.insertAdjacentHTML('afterbegin', '<div class="panel-msg diag-loading">讀取中…</div>');
  try {
    const d = (await api('diag', { probe })).data;
    body.dataset.loaded = '1';
    renderDiag(d);
  } catch (err) {
    body.innerHTML = `<div class="panel-msg err">${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '實測各資料來源';
    const l = $('.diag-loading', body);
    if (l) l.remove();
  }
}

function renderDiag(d) {
  const now = Date.now();
  const down = Object.entries(d.down || {});
  const stats = Object.entries(d.stats || {}).map(([h, s]) => ({ h, ...s, avg: s.n - s.skip ? Math.round(s.sum / (s.n - s.skip)) : null }))
    .sort((a, b) => (b.max || 0) - (a.max || 0));
  // 瀏覽器端：最近的請求
  const recent = apiLog.slice(-30).reverse();
  const done = apiLog.filter(x => x.server != null);
  const avg = arr => (arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null);
  const avgTotal = avg(done.map(x => x.total)), avgServer = avg(done.map(x => x.server));
  const queue = avgTotal != null && avgServer != null ? avgTotal - avgServer : null;
  const slowHosts = stats.filter(s => (s.avg || 0) > 5000 || s.fail > 2 || s.skip > 0).map(s => s.h);
  const fails = apiLog.filter(x => !x.ok).length;
  const verdict = [];
  if (d.quotaOut) verdict.push(`Google Apps Script 今天的外部請求額度已用完（${new Date(d.quotaOut).toLocaleTimeString('zh-TW', { hour12: false })} 偵測到）：所有經後端的資料都會失敗，約 24 小時內自動恢復。${d.proxy ? '報價與走勢已改由瀏覽器經中繼站抓，不受影響。' : '建議設定資料中繼站（說明頁「資料中繼站」），報價與走勢改由瀏覽器抓，大幅減少後端用量。'}`);
  verdict.push(d.proxy
    ? '資料中繼站：已啟用。市場監控、投資組合的報價、走勢與歷史資料由瀏覽器直接經中繼站抓（下方「直連」紀錄），後端對外請求也經中繼站轉送。'
    : '資料中繼站：未設定。所有資料都由 Google 主機代抓，容易被 Yahoo／證交所限流，也會吃掉每日 20,000 次額度。強烈建議設定（5 分鐘，見說明頁）。');
  if (d.proxy) {
    verdict.push(engineOn()
      ? '瀏覽器資料引擎：已啟用。總經的跨資產、新聞、類股、美債、經濟數據、FOMC、資金流向，以及財金日曆全部字卡，都在瀏覽器背景計算（下方「瀏覽器」紀錄），不經 Google。'
      : location.protocol === 'file:'
        ? '瀏覽器資料引擎：未啟用（網頁是直接開啟檔案 file://，瀏覽器不允許載入背景程式）。把網頁放到 GitHub Pages 等網站上即可啟用；目前這些字卡改由後端處理。'
        : engine.failed
          ? '瀏覽器資料引擎：無法啟動（請確認 engine-worker.js、Code.gs、Macro.gs、Calendar.gs 有和網頁一起上傳）；目前改由後端處理。'
          : '瀏覽器資料引擎：未啟用（瀏覽器不支援）；目前改由後端處理。');
  }
  if (d.probe) {
    const bad = d.probe.filter(p => p.err || p.code !== 200), slow = d.probe.filter(p => !p.err && p.code === 200 && p.ms > 5000);
    if (bad.length) verdict.push(`實測連不上或被拒絕：${bad.map(p => `${p.name}（${p.err ? '連線失敗' : 'HTTP ' + p.code}）`).join('、')}。這些來源很可能限流或封鎖 Google 主機，相關資料會改用備援或沿用舊資料。`);
    if (slow.length) verdict.push(`實測回應很慢：${slow.map(p => `${p.name} ${diagMs(p.ms)}`).join('、')}。`);
    if (!bad.length && !slow.length) verdict.push('實測各資料來源都正常（皆在 5 秒內回應）。');
  }
  if (down.length) verdict.push(`有 ${down.length} 個資料來源暫停中（連不上或太慢），相關資料改用備援或舊資料，${Math.round(Math.max(...down.map(([, v]) => v.until - now)) / 60000) || 1} 分鐘內自動恢復嘗試。`);
  if (slowHosts.length) verdict.push(`近 1 小時較慢或常失敗的來源：${slowHosts.join('、')}。`);
  if (queue != null && queue > 4000) verdict.push(`請求在 Google 端的排隊／連線平均要 ${diagMs(queue)}（後端實際只跑 ${diagMs(avgServer)}）：可能同時開了多個分頁或裝置，或 Google 主機忙碌。`);
  if (fails) verdict.push(`本頁最近有 ${fails} 次請求失敗或逾時。`);
  if ((d.triggers || []).includes('screenerBackfill')) verdict.push('選股篩選器正在補歷史資料（每 5 分鐘一次，會持續查詢證交所）；補完會自動停止。若證交所一直很慢，可先到 Apps Script「觸發條件」暫停 screenerBackfill。');
  if (!verdict.length) verdict.push(apiLog.length ? '目前各來源回應正常。' : '尚無請求紀錄，使用網站一陣子後再看，或按「實測各資料來源」。');
  const hostCell = h => {
    const e = Object.entries(h || {}).sort((a, b) => b[1][1] - a[1][1])[0];
    return e ? `${esc(e[0])} <span class="${diagCls(e[1][1])}">${diagMs(e[1][1])}</span>${e[1][2] ? ` <span class="bad">失敗 ${e[1][2]}</span>` : ''}` : '<span class="muted">—（快取）</span>';
  };
  $('#diagBody').innerHTML = `
    <div class="diag-verdict">${verdict.map(v => `<div>• ${esc(v)}</div>`).join('')}</div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">本頁請求平均</div><div class="kpi-v ${diagCls(avgTotal)}">${diagMs(avgTotal)}</div><div class="kpi-s">${done.length} 次</div></div>
      <div class="kpi"><div class="kpi-l">其中後端執行</div><div class="kpi-v ${diagCls(avgServer)}">${diagMs(avgServer)}</div><div class="kpi-s">主要是抓外部資料</div></div>
      <div class="kpi"><div class="kpi-l">排隊與網路</div><div class="kpi-v ${diagCls(queue)}">${diagMs(queue)}</div><div class="kpi-s">Google 端啟動與傳輸</div></div>
      <div class="kpi"><div class="kpi-l">暫停中的來源</div><div class="kpi-v ${down.length ? 'bad' : 'ok'}">${down.length}</div></div>
    </div>
    ${d.probe ? `<div class="sub-h">實測結果（${new Date(d.at).toLocaleTimeString('zh-TW', { hour12: false })}）</div>
      <div class="tbl-wrap"><table class="mtbl"><thead><tr><th>資料來源</th><th>主機</th><th class="num">耗時</th><th>結果</th></tr></thead><tbody>
      ${d.probe.map(p => `<tr><td class="nm">${esc(p.name)}</td><td class="muted">${esc(p.host)}</td><td class="num ${diagCls(p.ms)}">${diagMs(p.ms)}</td>
        <td>${p.err ? `<span class="tag bad">連不上</span> <span class="muted">${esc(p.err)}</span>` : p.code === 200 ? `<span class="tag ok">正常</span> <span class="muted">${p.size.toLocaleString()} 字元</span>` : `<span class="tag warn">HTTP ${p.code}</span>`}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
    ${down.length ? `<div class="sub-h">暫停中的來源</div><div class="tbl-wrap"><table class="mtbl"><thead><tr><th>主機</th><th>原因</th><th class="num">剩餘</th></tr></thead><tbody>
      ${down.map(([h, v]) => `<tr><td class="nm">${esc(h)}</td><td>${esc(v.why || '')}</td><td class="num">${Math.max(0, Math.ceil((v.until - now) / 60000))} 分</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${d.triggers ? `<div class="foot-note">後端排程：${d.triggers.length ? d.triggers.map(esc).join('、') : '無'}</div>` : ''}
    <div class="sub-h">近 1 小時後端統計（所有使用者）</div>
    ${stats.length ? `<div class="tbl-wrap"><table class="mtbl"><thead><tr><th>主機</th><th class="num">次數</th><th class="num">平均</th><th class="num">最長</th><th class="num">失敗</th><th class="num">跳過</th></tr></thead><tbody>
      ${stats.map(s => `<tr><td class="nm">${esc(s.h)}</td><td class="num">${s.n}</td><td class="num ${diagCls(s.avg)}">${diagMs(s.avg)}</td><td class="num ${diagCls(s.max)}">${diagMs(s.max)}</td>
        <td class="num ${s.fail ? 'bad' : ''}">${s.fail || '—'}</td><td class="num">${s.skip || '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted">尚無紀錄</div>'}
    <div class="sub-h">本頁最近的請求</div>
    ${recent.length ? `<div class="tbl-wrap"><table class="mtbl"><thead><tr><th>時間</th><th>請求</th><th class="num">總耗時</th><th class="num">後端</th><th>最慢的來源</th><th>結果</th></tr></thead><tbody>
      ${recent.map(x => `<tr><td>${new Date(x.at).toLocaleTimeString('zh-TW', { hour12: false })}</td><td class="nm">${esc(x.action)}</td>
        <td class="num ${diagCls(x.total)}">${diagMs(x.total)}</td><td class="num">${diagMs(x.server)}</td><td>${hostCell(x.hosts)}</td>
        <td>${x.ok ? '<span class="tag ok">成功</span>' : `<span class="tag bad">${esc(x.err || '失敗')}</span>`}</td></tr>`).join('')}</tbody></table></div>` : '<div class="muted">尚無紀錄</div>'}
    <div class="foot-note">「平均」是批次請求的整批時間（同一批的來源共用）；「跳過」表示該來源暫停中而直接改用備援。
      平均超過 8 秒（紅色）的來源通常是對方限流或封鎖 Google 主機，斷路器會暫停 3 分鐘再試。實測會對每個來源各送 1 次請求。</div>`;
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
