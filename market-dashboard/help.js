/* =========================================================
 * 說明頁 — 額度限制、網站說明（純靜態內容）
 * ========================================================= */
const HELP_QUOTA = `
<h2>額度限制總覽</h2>
<p>本網站的資料大多由後端（Google Apps Script，以下簡稱 GAS）代為向外部網站抓取，因此會受到三類限制：
<b>GAS 平台配額</b>、<b>各資料來源的次數限制</b>、<b>資料存放容量</b>。下列數字以一般免費 Google 帳號為準。</p>

<div class="help-callout">
  <b>真正需要留意的只有三項</b>
  <ol>
    <li><b>GAS 外部請求（UrlFetch）每天 20,000 次</b>：用量主要取決於「市場監控」的更新頻率與開啟時間。</li>
    <li><b>FinMind 每小時 600 次</b>：主要取決於「個股研究」查詢台股的次數。</li>
    <li><b>GAS 排程每天總執行時間 90 分鐘</b>：只有「選股篩選器」第一次建置歷史資料當天用得較多。</li>
  </ol>
  單人正常使用（白天開著、看幾次總經頁、查幾檔個股）：每天約用掉 UrlFetch 的 15–40%、FinMind 不到 5%、排程約 2%。
</div>

<h3 id="q-gas">一、Google Apps Script 平台配額</h3>
<p>這些是 Google 對「執行後端程式的帳號」（也就是部署 GAS 的你）所設的上限，所有使用者、所有分頁合計。</p>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>項目</th><th>免費帳號上限</th><th>用到它的功能</th><th>單人估計用量</th></tr></thead>
  <tbody>
    <tr><td class="nm">外部請求（UrlFetch）</td><td><b>每天 20,000 次</b><br><span class="muted">Workspace 帳號 100,000 次</span></td><td>所有經過後端的資料：報價、當日走勢、歷史走勢圖、總經頁、個股研究、選股器排程</td><td>一般約 3,000–8,000 次（見下方明細）</td></tr>
    <tr><td class="nm">排程（觸發條件）總執行時間</td><td><b>每天 90 分鐘</b></td><td>只有選股篩選器：每晚更新、第一次建置歷史</td><td>每晚約 1–2 分鐘；建置當天約 20–40 分鐘</td></tr>
    <tr><td class="nm">單次執行時間</td><td>每次最長 6 分鐘</td><td>選股器每次補資料（程式在 4.5 分鐘時主動停止）</td><td>不會超過</td></tr>
    <tr><td class="nm">同時執行數</td><td>30 個</td><td>打開總經頁時各字卡同時向後端要資料</td><td>最多約 15 個</td></tr>
    <tr><td class="nm">指令碼屬性讀寫</td><td>每天 50,000 次</td><td>「今日 API 呼叫」計數、上櫃與證交所逐日資料</td><td>每次更新報價約 1–2 次</td></tr>
    <tr><td class="nm">排程數量</td><td>每個專案 20 個</td><td>選股器使用 2 個</td><td>不會超過</td></tr>
  </tbody>
</table></div>

<h4>UrlFetch 用量明細（「今日 API 呼叫」顯示的就是這一項）</h4>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>功能</th><th>用量</th><th>說明</th></tr></thead>
  <tbody>
    <tr><td class="nm">市場監控（預設 30 秒更新）</td><td>停留 8 小時約 2,100 次<br>停留 24 小時約 6,200 次</td><td>Yahoo 標的每 20 檔合併 1 次、台股上市櫃每 40 檔合併 1 次；10 秒更新約為 3 倍</td></tr>
    <tr><td class="nm">當日走勢小圖</td><td>每天約 160–480 次</td><td>每 3 分鐘 1 次（Yahoo 每 20 檔 1 次）</td></tr>
    <tr><td class="nm">點開歷史走勢圖</td><td>每次 1–2 次</td><td>同一檔 10 分鐘內重開不另計</td></tr>
    <tr><td class="nm">新增標的</td><td>每次 1–2 次</td><td>驗證代碼是否存在</td></tr>
    <tr><td class="nm">總經與板塊分析</td><td>每次重新整理約 35–45 次</td><td>只在第一次開啟時自動抓，之後按「↻ 重新整理」才抓；各字卡另有暫存；隱藏的字卡不抓</td></tr>
    <tr><td class="nm">個股研究</td><td>每查一檔約 6–14 次</td><td>台股約 14 次、美股約 6 次</td></tr>
    <tr><td class="nm">選股篩選器</td><td>每晚約 10 次<br>第一次建置約 600 次</td><td>建置只發生一次，分散在多次排程；網頁上篩選本身不耗額度</td></tr>
    <tr><td class="nm">虛擬貨幣</td><td>0</td><td>瀏覽器直接連 Binance，不經過 GAS</td></tr>
  </tbody>
</table></div>

<h3 id="q-src">二、外部資料來源的限制</h3>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>來源</th><th>限制</th><th>用在哪裡</th><th>會不會碰到</th></tr></thead>
  <tbody>
    <tr><td class="nm">FinMind（使用你的 token）</td><td><b>每小時 600 次</b><br><span class="muted">免費註冊會員；未帶 token 為每 IP 每小時 300 次</span></td><td>個股研究的台股（每檔 8 次）、總經頁的上市信用交易與三大法人</td><td>一小時查超過約 70 檔台股才會碰到；超過時總經頁自動改用證交所，個股研究會缺部分資料</td></tr>
    <tr><td class="nm">臺灣證券交易所（含 MIS 即時行情）</td><td>未公開；請求太密集會暫時封鎖該 IP<br><span class="muted">經驗上數秒內連發多次就有風險</span></td><td>台股報價、類股指數、選股器、證交所備援資料</td><td>程式已控制間隔（逐日查詢間隔 1.2–1.5 秒），一般使用不會碰到</td></tr>
    <tr><td class="nm">櫃買中心</td><td>未公開，原則同證交所</td><td>上櫃信用交易、法人、資金流向、選股器</td><td>已控制間隔</td></tr>
    <tr><td class="nm">Yahoo Finance</td><td>未公開；被判定過量時回應「請求太多」（429）</td><td>匯率、國外股票、指數、歷史走勢圖、財報日曆、個股研究</td><td>有暫存，通常不會；Google 伺服器 IP 多人共用，偶爾可能短暫被擋</td></tr>
    <tr><td class="nm">Binance</td><td>每個 IP 每分鐘約 6,000 單位權重</td><td>虛擬貨幣（從你的瀏覽器直接連線）</td><td>用的是你自己的網路，不佔 GAS 額度，遠低於上限</td></tr>
    <tr><td class="nm">Forex Factory</td><td>官方要求不要頻繁抓取（每 5 分鐘不超過約 2 次）</td><td>經濟日曆（本週）</td><td>已暫存 1 小時，不會碰到</td></tr>
    <tr><td class="nm">alternative.me</td><td>每分鐘 60 次</td><td>加密恐懼貪婪指數</td><td>不會碰到</td></tr>
    <tr><td class="nm">FRED、紐約聯準銀行、聯準會、中央銀行、國發會、鉅亨網、CNBC</td><td>未公開限制</td><td>總經頁各字卡</td><td>皆有暫存（3 分鐘至 6 小時），不會碰到</td></tr>
  </tbody>
</table></div>

<h3 id="q-store">三、資料存放容量</h3>
<p>這些是「放得下多少」，不是次數，程式設計時已預留空間。</p>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>項目</th><th>上限</th><th>目前用量</th></tr></thead>
  <tbody>
    <tr><td class="nm">Google 試算表</td><td>整份 1,000 萬格；每格 5 萬字元</td><td>選股器每日快照每格約 3.4 萬字元（已壓縮）</td></tr>
    <tr><td class="nm">指令碼屬性</td><td>總共 500KB；每項 9KB</td><td>上櫃與證交所逐日資料各約 5KB</td></tr>
    <tr><td class="nm">暫存（CacheService）</td><td>每項 100KB；最多保存 6 小時</td><td>超過 100KB 的資料不暫存，改為每次重抓</td></tr>
  </tbody>
</table></div>

<h3 id="q-over">四、超過額度時會怎樣</h3>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>超過的項目</th><th>影響</th><th>恢復時間</th></tr></thead>
  <tbody>
    <tr><td class="nm">UrlFetch 每日上限</td><td>報價停在最後一筆並顯示「更新失敗」，總經頁、個股研究、走勢圖無法更新；虛擬貨幣不受影響</td><td>隔天自動恢復（Google 重置時間可能和台北午夜略有差距）</td></tr>
    <tr><td class="nm">FinMind 每小時上限</td><td>總經頁上市資料改用證交所備援；個股研究缺少估值歷史、財報、月營收等</td><td>下一個小時</td></tr>
    <tr><td class="nm">排程每日 90 分鐘</td><td>選股器當天停止補資料／更新</td><td>隔天自動繼續</td></tr>
    <tr><td class="nm">證交所／櫃買中心封鎖 IP</td><td>台股報價、類股、選股器暫時抓不到</td><td>通常數分鐘至數小時</td></tr>
    <tr><td class="nm">Yahoo 429</td><td>國外報價、走勢暫時失敗（保留最後報價）</td><td>通常數分鐘</td></tr>
  </tbody>
</table></div>

<h3 id="q-monitor">五、如何查看用量</h3>
<ul>
  <li><b>UrlFetch</b>：市場監控頁上方的「今日 API 呼叫」，達 70% 變黃、90% 變紅（程式自行計數，非 Google 官方數字）。</li>
  <li><b>FinMind</b>：登入 finmindtrade.com 的會員頁查看。</li>
  <li><b>排程執行時間</b>：Apps Script 左側「執行項目」，可看每次排程的執行時間。</li>
</ul>

<h3 id="q-save">六、省額度的做法</h3>
<ul>
  <li>市場監控更新頻率維持 30 秒；不需要的區塊按 ⏸ 停止，或用「⏸ 全部停止」。離開市場監控頁時本來就不會更新。</li>
  <li>同一時間只開一個分頁（多分頁會讓用量倍增）；分頁切到背景時會自動暫停更新。</li>
  <li>總經頁只在第一次開啟時自動抓，之後需要時再按「↻ 重新整理」。</li>
  <li>總經頁用「編輯版面」隱藏不看的字卡，隱藏的字卡不會抓資料。</li>
  <li>清單裡不要留下已下市或錯誤的代碼（每次更新都會額外逐檔補抓）。</li>
</ul>
`;

const HELP_GUIDE = `
<h2>網站說明</h2>
<nav class="help-toc">
  <a href="#g-overview">1. 功能總覽</a><a href="#g-account">2. 帳號與資料儲存</a><a href="#g-common">3. 畫面共通操作</a>
  <a href="#g-market">4. 市場監控</a><a href="#g-macro">5. 總經與板塊分析</a><a href="#g-research">6. 個股研究</a>
  <a href="#g-screener">7. 選股篩選器</a><a href="#g-sources">8. 資料來源與更新時間</a><a href="#g-deploy">9. 部署與更新</a>
  <a href="#g-sheet">10. 試算表結構</a><a href="#g-faq">11. 常見問題與疑難排解</a><a href="#g-disclaimer">12. 免責聲明</a>
</nav>

<h3 id="g-overview">1. 功能總覽</h3>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>頁面</th><th>用途</th><th>更新方式</th></tr></thead>
  <tbody>
    <tr><td class="nm">市場監控</td><td>自選標的即時報價（匯率、台股、國外、指數、虛擬貨幣），當日走勢小圖、歷史走勢圖與技術分析</td><td>只在停留於此頁、且瀏覽器分頁在前景時更新（每 5–60 秒，預設 30 秒）；各區塊可單獨停止；虛擬貨幣逐筆推播</td></tr>
    <tr><td class="nm">總經與板塊分析</td><td>新聞、跨資產、板塊輪動、經濟／財報日曆、美債、FOMC、台股籌碼、資金流向、景氣與央行、美國經濟數據</td><td>第一次開啟時自動更新，之後按「↻ 重新整理」；超過 1 小時會提醒</td></tr>
    <tr><td class="nm">個股研究</td><td>輸入代號，查看單一股票的完整檔案與各面向多空判斷</td><td>每次查詢時即時抓取</td></tr>
    <tr><td class="nm">選股篩選器</td><td>以 60 多項條件篩選上市＋上櫃股票，存常用條件、一鍵加入自選</td><td>後端每天 21:40 自動更新</td></tr>
    <tr><td class="nm">說明</td><td>額度限制與網站說明（本頁）</td><td>—</td></tr>
  </tbody>
</table></div>

<h3 id="g-account">2. 帳號與資料儲存</h3>
<ul>
  <li><b>註冊</b>：帳號 3–30 個英文、數字或 <code>_ . -</code>；密碼至少 6 個字元。<b>新註冊的帳號需等管理員審核通過後才能登入</b>；通過後第一次登入時，會建立一張以帳號命名的試算表工作頁，存放你的清單與設定。</li>
  <li><b>管理員</b>：帳號 <code>michael</code> 為管理員，不需審核。管理員在「⚙ 設定 → 帳號審核」可對新帳號按「通過／拒絕／刪除」，對已通過的帳號按「停用」；停用後該使用者最慢 5 分鐘內被登出。</li>
  <li><b>登出</b>：在右上「⚙ 設定」頁。</li>
  <li><b>密碼安全</b>：試算表裡存的是「隨機鹽 ＋ SHA-256 雜湊」，不是明碼，即使試算表外流也無法得知原密碼。</li>
  <li><b>登入有效期</b>：6 小時，使用中會自動延長；逾時會回到登入頁。</li>
  <li><b>後端網址</b>：寫在 <code>app.js</code> 的 <code>API_URL</code>，或在登入頁下方「後端網址設定」輸入（存在瀏覽器）。</li>
</ul>
<h4>哪些設定會跟著帳號走、哪些只存在這台瀏覽器</h4>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>存在帳號（試算表，換電腦也一樣）</th><th>只存在這台瀏覽器</th></tr></thead>
  <tbody><tr>
    <td>自選標的與順序、市場監控區塊順序、總經頁字卡順序／寬度／隱藏、選股器自訂常用條件</td>
    <td>更新頻率、漲跌顏色、走勢圖設定（週期、範圍、指標）、總經頁各字卡的分頁選擇（例如新聞分類、上市／上櫃）、個股研究最近查詢、登入狀態、後端網址</td>
  </tr></tbody>
</table></div>

<h3 id="g-common">3. 畫面共通操作</h3>
<ul>
  <li><b>上方選單</b>：切換各頁；右上顯示台北時間、帳號、「說明」與「⚙ 設定」（帳號資訊、登出；管理員另有帳號審核）。</li>
  <li><b>漲跌色</b>：市場監控右上可選「紅漲綠跌」（台灣習慣，預設）或「綠漲紅跌」，全站圖表、熱力圖、K 線一起套用。台灣景氣燈號顏色固定，不受影響。</li>
  <li><b>今日 API 呼叫</b>：顯示今天後端已用的外部請求次數與上限，旁邊「?」有計次規則。</li>
  <li><b>手機</b>：版面自動改為單欄，寬表格可在字卡內左右滑動，圖表可雙指縮放。</li>
</ul>

<h3 id="g-market">4. 市場監控</h3>
<h4>4.1 五個區塊與報價來源</h4>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>區塊</th><th>來源</th><th>即時性</th></tr></thead>
  <tbody>
    <tr><td class="nm">匯率</td><td>Yahoo Finance</td><td>外匯 24 小時報價</td></tr>
    <tr><td class="nm">台股（上市／上櫃）</td><td>證交所 MIS 即時行情</td><td>盤中即時，約 5 秒一筆</td></tr>
    <tr><td class="nm">台股（興櫃）</td><td>Yahoo Finance（.TWO）</td><td>MIS 不含興櫃，自動切換</td></tr>
    <tr><td class="nm">國外股票</td><td>Yahoo Finance</td><td>美股即時；日股等可能延遲約 20 分鐘</td></tr>
    <tr><td class="nm">指數／商品</td><td>Yahoo Finance</td><td>期貨（黃金 GC=F、原油 CL=F）可能延遲約 10 分鐘</td></tr>
    <tr><td class="nm">虛擬貨幣</td><td>Binance WebSocket（瀏覽器直連）</td><td>逐筆推播；漲跌幅為 24 小時滾動；TSMUSDT／NVDAUSDT 為 U 本位永續合約；斷線自動改用輪詢並重連</td></tr>
  </tbody>
</table></div>
<p>每列顯示：名稱、當日走勢小圖、價格（變動時閃爍）、當日漲跌幅。休市時停在最後成交價；連線失敗時保留上一次報價。滑鼠停在列上可看最後成交時間。</p>

<h4>4.2 何時會更新、如何停止</h4>
<ul>
  <li>只有<b>停留在市場監控頁、且瀏覽器分頁在前景</b>時才會抓報價；關閉網頁、切到其他頁（總經、個股研究、選股器、說明、設定）或把分頁切到背景，都會完全停止（含虛擬貨幣連線），回來時立即更新一次。</li>
  <li>每個區塊右上的 <b>⏸</b> 可停止該區塊的價格更新（變成 ▶ 繼續），工具列「⏸ 全部停止／▶ 全部繼續」一次控制全部；停止的區塊保留最後價格並變淡，設定存在帳號。</li>
  <li>個別標的抓取失敗時，狀態列只簡短顯示「失敗：名稱」，下一輪更新時自動再試，不會額外重試。</li>
</ul>
<h4>4.2-1 當日走勢小圖</h4>
<p>台股／國外／指數／匯率為當日 5 分線（每 3 分鐘更新），虛擬貨幣為近 24 小時 15 分線；虛線為昨收（基準），線在虛線上方顯示上漲色，尾端接上即時價格。</p>

<h4>4.3 新增標的</h4>
<p>按區塊右上「＋」，輸入代號（可另填顯示名稱）。旁邊「?」有完整規則，新增前後端會實際抓一次報價驗證；若資料來源暫時連線失敗，會自動重試最多 3 次（按鈕顯示「重試中」），代號錯誤則直接顯示「新增失敗：代號（原因）」。</p>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>區塊</th><th>輸入範例</th></tr></thead>
  <tbody>
    <tr><td class="nm">匯率</td><td><code>USD/TWD</code>、<code>EUR/USD</code>、<code>JPYTWD</code>（基準幣/報價幣，ISO 三碼，斜線可省略）</td></tr>
    <tr><td class="nm">台股</td><td><code>2330</code>、<code>0050</code>、<code>00878</code>、<code>3595</code>（自動判斷上市／上櫃／興櫃）</td></tr>
    <tr><td class="nm">國外</td><td>美股 <code>NVDA</code>、<code>BRK-B</code>；其他市場「代號 空格 市場碼」：<code>7011 JP</code>、<code>0700 HK</code>、<code>005930 KS</code>、<code>SAP GR</code>；或 Yahoo 代碼 <code>7011.T</code><br>
      <span class="muted">市場碼：US JP HK KS KQ CH SZ LN GR FP NA SW AU CN SP IN</span></td></tr>
    <tr><td class="nm">指數／商品</td><td>別名 <code>SPX</code> <code>NDX</code> <code>DJI</code> <code>SOX</code> <code>VIX</code> <code>TWII</code> <code>N225</code> <code>HSI</code> <code>KOSPI</code> <code>DAX</code> <code>DXY</code> <code>US10Y</code> <code>GOLD</code> <code>SILVER</code> <code>WTI</code> <code>BRENT</code> <code>NG</code> <code>COPPER</code>；中文 <code>黃金</code> <code>白銀</code> <code>原油</code> <code>加權</code> <code>日經</code>；或 Yahoo 代碼 <code>^GSPC</code>、<code>GC=F</code></td></tr>
    <tr><td class="nm">虛擬貨幣</td><td>Binance 交易對 <code>BTCUSDT</code>、<code>DOGEUSDT</code>；永續合約 <code>TSMUSDT</code>（先找現貨，找不到再找永續）</td></tr>
  </tbody>
</table></div>

<h4>4.4 編輯（排序與刪除）</h4>
<ul>
  <li>按工具列「✎ 編輯」進入編輯模式：拖曳標的調整順序、拖曳區塊標題（⠿）移動整個區塊、按紅色 × 刪除；完成後按「✓ 完成」。</li>
  <li>區塊採瀑布流排列，下一行會自動往上貼齊；排序存回試算表。</li>
</ul>

<h4>4.5 歷史走勢圖（點任一標的）</h4>
<ul>
  <li><b>週期</b>：日／週／月；<b>範圍</b>：3 月、6 月、1 年、3 年（預設）、全部；<b>圖型</b>：K 線／折線；成交量可開關（匯率等無成交量的標的自動停用）。</li>
  <li><b>操作</b>：滑鼠滾輪縮放、按住拖曳左右移動；手機雙指縮放。後端多抓了更早的歷史，往左拖可看超過 3 年。</li>
  <li><b>📈 技術分析</b>：SMA5／10／20／60／120 疊在主圖；KD(9,3,3)、MACD(12,26,9) 各一個副圖，每項可勾選開關；副圖分隔線可拖曳調整高度。左上角顯示游標所在日期的開高低收、量與各指標數值。</li>
  <li>按 Esc、右上 × 或點視窗外即可關閉；圖表設定會記在瀏覽器。</li>
</ul>
<h4>4.6 技術指標速查</h4>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>指標</th><th>算法</th><th>常見解讀</th></tr></thead>
  <tbody>
    <tr><td class="nm">SMA（移動平均）</td><td>N 日收盤價平均</td><td>股價在均線上方偏強；短均線在長均線上方且依序排列為「多頭排列」</td></tr>
    <tr><td class="nm">KD(9,3,3)</td><td>RSV = 9 日內收盤相對位置；K = ⅔前K + ⅓RSV；D = ⅔前D + ⅓K（台灣慣用）</td><td>K 由下往上穿越 D 為黃金交叉；&gt;80 高檔、&lt;20 低檔</td></tr>
    <tr><td class="nm">MACD(12,26,9)</td><td>DIF = EMA12 − EMA26；MACD = DIF 的 EMA9；柱 = DIF − MACD</td><td>柱狀體由負翻正代表動能轉強；DIF 在零軸上方偏多</td></tr>
    <tr><td class="nm">RSI(14)</td><td>Wilder 平滑的 14 日漲跌力道比</td><td>&gt;70 超買、&lt;30 超賣；50 為多空分界</td></tr>
    <tr><td class="nm">乖離率</td><td>（收盤 ÷ 均線 − 1）× 100%</td><td>乖離過大代表短線漲跌過頭，容易拉回或反彈</td></tr>
    <tr><td class="nm">歷史波動度（HV）</td><td>N 日對數報酬標準差 × √252</td><td>年化波動度；÷√12 約為一個月 1 個標準差的漲跌幅</td></tr>
  </tbody>
</table></div>

<h3 id="g-macro">5. 總經與板塊分析</h3>
<p>登入後<b>第一次</b>開啟此頁會自動抓資料，之後切回來不會重抓，需要最新資料時按「↻ 重新整理」；資料超過 1 小時，標題旁會出現「⚠ 資料已是 N 分鐘前」提醒。各字卡獨立載入，某個來源失敗只影響該字卡（可按「重試」）。</p>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>字卡</th><th>內容與解讀</th><th>來源</th><th>暫存</th></tr></thead>
  <tbody>
    <tr><td class="nm">跨資產與市場情緒</td><td>全球股市、匯率、美債殖利率（以 bp 表示）、商品、加密、VIX 的 1D／1W／1M／YTD 與 3 個月走勢。<br>情緒指標：VIX（&lt;15 低波動、15–20 正常、20–30 偏高、&gt;30 恐慌）；VIX 期限結構 VIX÷VIX3M（&gt;1 逆價差＝短期避險升溫）；10 年期殖利率；美元指數；加密恐懼貪婪指數</td><td>Yahoo、alternative.me</td><td>2 分鐘</td></tr>
    <tr><td class="nm">即時重大新聞</td><td>頭條、台股、國際股、總經、CNBC（英文）五個分頁，點標題開原文</td><td>鉅亨網、CNBC</td><td>3 分鐘</td></tr>
    <tr><td class="nm">板塊輪動熱力圖</td><td>美股 11 大產業 ETF＋6 個主題 ETF；台股 28 個類股指數。可切換 1D～YTD、方塊圖或輪動矩陣（點欄位排序）。上方列出最強／最弱板塊，以及「動能轉強／轉弱」（近 1 月排名較近 3 月上升或下降 3 名以上）</td><td>Yahoo；證交所（1D 盤中即時，其餘以歷史收盤比較）</td><td>2 分鐘</td></tr>
    <tr><td class="nm">經濟日曆</td><td>本週＋下週高影響事件（美、歐、日、中、英、台），台北時間、預期值、前值；已公布者變灰、今天標色</td><td>本週 Forex Factory；下週 FRED 公布日程＋FOMC＋台灣央行</td><td>1 小時</td></tr>
    <tr><td class="nm">財報日曆</td><td>自選清單中台股與國外股票的下次財報或法說日期，本週者標示「本週財報」；台股查無日期時顯示法定公告期限（年報 3/31、Q1 5/15、Q2 8/14、Q3 11/14）</td><td>Yahoo Finance</td><td>6 小時</td></tr>
    <tr><td class="nm">美債殖利率曲線與利差</td><td>1M～30Y 曲線（最新／1 週／1 月／1 年前比較，可勾選）；10Y−2Y、10Y−3M、30Y−5Y 利差與 3 年走勢。&lt;0 倒掛、0–50bp 平坦、&gt;50bp 正斜率；10Y−3M 倒掛常被視為衰退前兆</td><td>FRED（美國財政部資料，約落後 1 個交易日）</td><td>30 分鐘</td></tr>
    <tr><td class="nm">FOMC 利率預測</td><td>目前目標區間、有效聯邦基金利率、未來三次會議與倒數天數（SEP＝公布經濟預測與點陣圖）、下次會議升息／維持／降息機率、各次會議隱含利率與最可能區間</td><td>聯準會、紐約聯準銀行、CBOT 30 天期聯邦基金期貨（CME FedWatch 算法）</td><td>10 分鐘</td></tr>
    <tr><td class="nm">台股信用交易（上市／上櫃）</td><td>融資餘額（億）、融資／融券張數、券資比與日、20 日變化；融資餘額 vs 加權／櫃買指數走勢圖；近 14 個交易日明細。融資快速增加常代表散戶追價；指數下跌時融資大減可能是斷頭賣壓</td><td>上市：FinMind（失敗改用證交所）；上櫃：櫃買中心</td><td>30 分鐘</td></tr>
    <tr><td class="nm">三大法人買賣超（上市／上櫃）</td><td>當日外資、投信、自營商；本週、上週、近 5／20 日累計；近兩週每日明細（依週分組、至少 10 個交易日）</td><td>同上</td><td>30 分鐘</td></tr>
    <tr><td class="nm">資金流向排行</td><td>個股外資、投信買超／賣超前 10 名（依張數或金額、可排除 ETF），土洋同買／同賣，★ 標示自選股。金額以最近收盤價估算</td><td>證交所 T86／櫃買中心</td><td>30 分鐘</td></tr>
    <tr><td class="nm">台灣景氣與央行</td><td>國發會景氣對策信號（燈號、分數、領先與同時指標、近 24 個月燈號；藍 9–16 低迷、黃藍 17–22、綠 23–31 穩定、黃紅 32–37、紅 38–45 熱絡）；央行重貼現率、擔保放款與短期融通利率、歷次調整；下次理監事會（依慣例推估）</td><td>國發會（政府資料開放平臺）、中央銀行</td><td>6 小時</td></tr>
    <tr><td class="nm">美國經濟數據</td><td>CPI、核心 CPI、核心 PCE 年增率、失業率、非農新增、實質 GDP、初領失業金、密大消費者信心，含前值、變化與近 13 期走勢；點名稱開 FRED 完整歷史</td><td>FRED</td><td>6 小時</td></tr>
  </tbody>
</table></div>
<h4>編輯版面</h4>
<p>按「✎ 編輯版面」：字卡縮成清單，按住標題列拖曳調整順序；右側可設定寬度（1/3～全寬）或取消「顯示」隱藏字卡（隱藏的不抓資料）；「還原預設」回到原始排列；完成後按「✓ 完成」。版面存在帳號。</p>
<h4>注意事項</h4>
<ul>
  <li>FOMC 機率由期貨價格推算，與 CME FedWatch 網站可能有些微差異（期限溢酬、資料時間不同）。</li>
  <li>證交所信用交易與法人資料於交易日晚間公布，盤中看到的是前一交易日。</li>
  <li>上櫃（及上市備援）資料沒有歷史區間 API，後端逐日抓取並永久保存；第一次約 17–25 個交易日，之後每次開啟再補，補齊前字卡下方會顯示「歷史資料逐步補齊中」。</li>
  <li>台灣央行理監事會日期依慣例（每季末月第三個週四）推估，請以央行公告為準。</li>
  <li>下週經濟日曆只有美國數據日程與央行會議，預期值通常要到該週才會出現。</li>
</ul>

<h3 id="g-research">6. 個股研究</h3>
<ul>
  <li><b>輸入</b>：台股代號（<code>2330</code>、<code>6488</code>）、美股代號（<code>NVDA</code>、<code>TSM</code>），或其他市場（<code>7011 JP</code>、<code>0700 HK</code>）。下方有「最近查詢」與「自選」快捷鈕；也可從選股篩選器點代號進入。</li>
  <li><b>頁首</b>：股價、市值、本益比、淨值比、殖利率、下次財報、52 週位置、一鍵加入自選。</li>
  <li><b>各面向判斷總覽</b>：九個面向的結論，點擊跳到對應字卡；各面向彼此獨立，<b>不加總成買賣建議</b>。</li>
</ul>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>面向</th><th>判斷規則</th></tr></thead>
  <tbody>
    <tr><td class="nm">趨勢</td><td>股價對 20 日線、季線、年線（不足時半年線），20 日線對季線，季線 20 日斜率，各 ±1 分；≥3 多頭、≤−3 空頭，其餘盤整（偏多／偏空）</td></tr>
    <tr><td class="nm">動能</td><td>MACD 柱正負、DIF 與零軸、KD 方向、RSI（&gt;55 加分、&lt;45 減分）；≥2 偏多、≤−2 偏空。另標示超買（RSI≥70）、超賣（≤30）</td></tr>
    <tr><td class="nm">估值</td><td>本益比在自身歷史（台股近 5 年）的百分位：≤25 偏低、≥75 偏高；虧損時改用股價淨值比。只和自己過去比</td></tr>
    <tr><td class="nm">成長</td><td>最新一季營收與 EPS 對去年同季：兩者都 ≥10% 成長、都 ≤−5% 衰退，其餘持平／分歧</td></tr>
    <tr><td class="nm">獲利能力</td><td>最新一季毛利率、營業利益率對前 4 季平均：都提高 ≥1 個百分點改善、都下降 ≥1 惡化</td></tr>
    <tr><td class="nm">籌碼（台股）</td><td>外資＋投信 20 日淨買賣占成交量 &gt;3% 加分、&lt;−3% 減分；外資持股比例 20 日增減 &gt;0.3 個百分點加減分；融資 20 日增 &gt;5% 但股價下跌減分</td></tr>
    <tr><td class="nm">籌碼（美股）</td><td>放空比例 ≥10% 標示空單偏高；空單月減 ≥10% 偏多、月增 ≥10% 偏空</td></tr>
    <tr><td class="nm">相對強弱</td><td>近 3 個月與 6 個月相對大盤（加權指數／S&P 500／日經等）的超額報酬：都 &gt;3% 強於大盤、都 &lt;−3% 弱於大盤</td></tr>
    <tr><td class="nm">分析師</td><td>平均目標價較現價高 ≥15% 且平均評等 ≤2.2 為樂觀；目標價低於現價或評等 ≥3 為保守；不足 3 位標示「樣本少」</td></tr>
    <tr><td class="nm">波動度</td><td>20 日歷史波動度在近一年的百分位：≥80 偏高、≤20 偏低（只代表風險大小，不代表多空）</td></tr>
  </tbody>
</table></div>
<p>字卡內容：價格走勢（K 線、MA20／60／120／240、成交量，3 月～全部）、技術分析（指標表＋RSI／MACD 圖）、歷史波動度（HV20／HV60）、估值（本益比歷史與 10／25／50／75／90 百分位帶）、成長與獲利（單季 EPS 長條、三種利潤率走勢、近 8 季表）、月營收（台股，13 個月＋年增率）、籌碼、相對強弱（含強弱線）、分析師（目標價區間、評等分布、近期評等異動）、股利紀錄、公司簡介（Yahoo 英文）。</p>
<p class="muted">資料：台股 FinMind（需 token）＋證交所＋Yahoo；美股與其他市場 Yahoo Finance。美股的歷史本益比以「股價 ÷ 近四季 EPS」重建；興櫃股票沒有本益比資料，估值顯示「資料不足」。</p>

<h3 id="g-screener">7. 選股篩選器</h3>
<h4>7.1 啟用（只需一次）</h4>
<ol>
  <li>Apps Script 新增指令碼檔 <code>Research</code>、<code>Screener</code> 並重新部署。</li>
  <li>在編輯器上方函式選單選 <b>setupScreener</b> → 執行（會要求「管理觸發條件」等授權）。</li>
  <li>後端每 5 分鐘補一段歷史（上市＋上櫃約 2,300 檔、250 個交易日），約 20–40 分鐘完成後自動停止；之後每天 21:40 自動更新。建置期間打開此頁會顯示「資料建置中」。</li>
</ol>
<h4>7.2 篩選條件</h4>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>分類</th><th>條件</th></tr></thead>
  <tbody>
    <tr><td class="nm">基本條件</td><td>市場（上市／上櫃）、產業、排除 ETF、股價、今日成交量、20 日均量、今日成交值</td></tr>
    <tr><td class="nm">價值</td><td>本益比、股價淨值比、殖利率（交易所公布值）</td></tr>
    <tr><td class="nm">成長（月營收）</td><td>月營收年增率、月增率、累計營收年增率（最近一期公告）</td></tr>
    <tr><td class="nm">均線與趨勢</td><td>站上 5／20／60／120／240 日線、跌破季線、均線多頭／空頭排列、季線上揚、今日 5 日線黃金／死亡交叉 20 日線、20／60 日乖離率</td></tr>
    <tr><td class="nm">價量與突破</td><td>量比（今日 ÷ 20 日均量，≥2 常視為爆量）、創 20／60 日與 52 週新高、創 20／60 日新低、距 52 週高點／低點、1／5／20／60／120 日與一年漲跌幅</td></tr>
    <tr><td class="nm">技術指標</td><td>RSI(14)、K 值、今日 KD 黃金／死亡交叉、KD 低檔黃金交叉（K&lt;30）、MACD 柱為正、今日 MACD 柱翻正／翻負、20 日年化波動度</td></tr>
    <tr><td class="nm">籌碼</td><td>外資／投信連買、連賣天數；外資、投信今日／5 日／20 日買賣超（張）；今日土洋同買；融資 5 日增減；券資比</td></tr>
  </tbody>
</table></div>
<h4>7.3 常用條件（快速按鈕）</h4>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>內建按鈕</th><th>條件內容</th></tr></thead>
  <tbody>
    <tr><td class="nm">高殖利率價值股</td><td>殖利率 ≥5%、本益比 0–15、20 日均量 ≥300 張</td></tr>
    <tr><td class="nm">營收高成長</td><td>月營收年增 ≥20%、累計年增 ≥15%、20 日均量 ≥300 張</td></tr>
    <tr><td class="nm">外資連買 5 天</td><td>外資連買 ≥5 天、20 日均量 ≥300 張</td></tr>
    <tr><td class="nm">投信認養</td><td>投信連買 ≥3 天、投信 5 日買超 ≥200 張</td></tr>
    <tr><td class="nm">多頭排列＋爆量</td><td>均線多頭排列、量比 ≥2、今日成交量 ≥1,000 張</td></tr>
    <tr><td class="nm">站上季線＋均線金叉</td><td>站上季線、今日 5 日線黃金交叉 20 日線</td></tr>
    <tr><td class="nm">創 60 日新高</td><td>創 60 日新高、今日成交量 ≥1,000 張</td></tr>
    <tr><td class="nm">超跌反彈（KD 低檔金叉）</td><td>KD 低檔黃金交叉、RSI ≤40</td></tr>
    <tr><td class="nm">土洋同買</td><td>今日外資與投信皆買超，且 5 日皆為買超</td></tr>
  </tbody>
</table></div>
<p>所有內建條件都預設排除 ETF。設定好條件後按「★ 存為常用」可命名儲存成自己的按鈕（存在帳號，按 × 刪除）。</p>
<h4>7.4 結果表</h4>
<ul>
  <li>上方以標籤列出啟用中的條件，按 × 可單獨移除。篩選條件會自動成為表格欄位；點欄位名稱排序（再點一次反向）。</li>
  <li>點代號或「研究」開啟個股研究；「＋ 自選」直接加入市場監控的台股區塊。</li>
  <li>預設顯示前 100 檔，可按「顯示更多」。</li>
</ul>
<p class="muted">資料範圍：上市＋上櫃普通股與 ETF（不含興櫃）。資料為每日收盤後更新，非盤中即時；融資約 21:00 公布。歷史未滿 250 個交易日時，年線、52 週新高等條件暫時不完整，頁面上方會提示。</p>

<h3 id="g-sources">8. 資料來源與更新時間</h3>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>來源</th><th>提供的資料</th><th>大約更新時間（台北）</th></tr></thead>
  <tbody>
    <tr><td class="nm">臺灣證券交易所（MIS／網站／OpenAPI）</td><td>上市即時報價、類股指數、收盤行情、法人、融資券、本益比、月營收、產業別</td><td>盤中即時；收盤約 14:30；法人約 16:30；融資約 21:00</td></tr>
    <tr><td class="nm">櫃買中心</td><td>上櫃收盤行情、法人、融資券、本益比、月營收</td><td>同上</td></tr>
    <tr><td class="nm">FinMind</td><td>台股個股估值歷史、財報、月營收、法人、融資、外資持股、股利；全市場信用交易與法人</td><td>交易日晚間</td></tr>
    <tr><td class="nm">Yahoo Finance</td><td>匯率、國外股票、指數、期貨、歷史走勢、板塊 ETF、財報日期、美股基本面與分析師</td><td>依市場即時或延遲 10–20 分鐘</td></tr>
    <tr><td class="nm">Binance</td><td>虛擬貨幣即時價格與 K 線</td><td>即時</td></tr>
    <tr><td class="nm">FRED（聖路易聯準銀行）</td><td>美債殖利率、美國經濟數據、數據公布日程</td><td>依官方公布（殖利率約落後 1 個交易日）</td></tr>
    <tr><td class="nm">聯準會／紐約聯準銀行</td><td>FOMC 會議日期、有效聯邦基金利率與目標區間</td><td>每日</td></tr>
    <tr><td class="nm">國發會／中央銀行</td><td>景氣對策信號、政策利率</td><td>景氣燈號每月約 27 日</td></tr>
    <tr><td class="nm">鉅亨網、CNBC、Forex Factory、alternative.me</td><td>新聞、經濟日曆、加密恐懼貪婪指數</td><td>即時／每日</td></tr>
  </tbody>
</table></div>

<h3 id="g-deploy">9. 部署與更新</h3>
<h4>9.1 檔案</h4>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>放到 Apps Script（後端）</th><th>放到網頁資料夾（前端）</th></tr></thead>
  <tbody><tr>
    <td><code>Code.gs</code>（帳號、報價、走勢）<br><code>Macro.gs</code>（總經與板塊分析）<br><code>Research.gs</code>（個股研究）<br><code>Screener.gs</code>（選股篩選器）</td>
    <td><code>index.html</code>、<code>style.css</code>、<code>app.js</code>、<code>macro.js</code>、<code>research.js</code>、<code>screener.js</code>、<code>help.js</code></td>
  </tr></tbody>
</table></div>
<h4>9.2 第一次部署</h4>
<ol>
  <li>新建 Google 試算表 → 選單「擴充功能 → Apps Script」。</li>
  <li><code>Code.gs</code> 貼上覆蓋預設程式碼；其他 .gs 用左側「檔案 ＋ → 指令碼」新增（<b>不要選 HTML</b>），檔名輸入 Macro、Research、Screener 即可。</li>
  <li>上方函式選單選 <code>testQuotes</code> → 執行並允許授權，執行紀錄出現報價代表正常。</li>
  <li>「部署 → 新增部署作業」→ 類型「網頁應用程式」，執行身分「<b>我</b>」，存取權「<b>所有人</b>」（不是「任何擁有 Google 帳戶的使用者」）。</li>
  <li>複製網址（以 <code>/exec</code> 結尾）貼到 <code>app.js</code> 的 <code>API_URL</code> 或登入頁的「後端網址設定」。</li>
  <li>選股器：執行一次 <code>setupScreener</code>。</li>
  <li>（建議）到 finmindtrade.com 免費註冊，把 token 貼到 <code>Macro.gs</code> 的 <code>FINMIND_TOKEN</code>。</li>
</ol>
<h4>9.3 之後更新程式</h4>
<ul>
  <li>改了任何 .gs：要到「部署 → 管理部署作業 → 編輯（鉛筆）→ 版本：<b>新版本</b> → 部署」才會生效，網址不變。</li>
  <li>只改前端檔案：替換檔案後重新整理網頁即可。</li>
  <li>網頁可直接雙擊 <code>index.html</code> 使用，或放到 GitHub Pages／Netlify 等靜態空間。<b>公開網頁時只上傳前端檔案，不要上傳 .gs</b>（裡面有 FinMind token）。</li>
</ul>

<h3 id="g-sheet">10. 試算表結構</h3>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>位置</th><th>內容</th></tr></thead>
  <tbody>
    <tr><td class="nm">Account 工作頁</td><td>A 帳號｜B 密碼（加鹽雜湊）｜C 建立時間｜D 審核狀態（空白＝待審核、通過、拒絕、停用；管理員不需填寫）。也可以直接在試算表 D 欄填「通過」完成審核（最慢 5 分鐘生效）</td></tr>
    <tr><td class="nm">〈帳號名稱〉工作頁 A:E</td><td>監控清單：類別｜代碼｜顯示名稱｜資料來源｜新增時間（列的順序＝畫面順序）。可直接修改顯示名稱或調整列順序，重新整理網頁即生效；刪除請用網頁或只清除 A:E 內容，不要刪整列</td></tr>
    <tr><td class="nm">〈帳號名稱〉工作頁 G:H</td><td>個人設定：<code>cardOrder</code>（市場監控區塊順序）、<code>pausedCats</code>（停止更新的區塊）、<code>macroLayout</code>（總經頁版面）、<code>screenPresets</code>（選股器常用條件）</td></tr>
    <tr><td class="nm">_daily、_screen（隱藏）</td><td>選股器每日全市場快照與算好的篩選表（壓縮存放），請勿手動修改</td></tr>
    <tr><td class="nm">指令碼屬性（Apps Script 專案設定）</td><td><code>fetchUsage</code>（今日 API 呼叫計數）、<code>otc_margin</code>／<code>otc_inst</code>（上櫃逐日資料）、<code>tse_margin</code>／<code>tse_inst</code>（證交所備援逐日資料）</td></tr>
  </tbody>
</table></div>

<h3 id="g-faq">11. 常見問題與疑難排解</h3>
<div class="tbl-wrap"><table class="mtbl help-tbl">
  <thead><tr><th>狀況</th><th>原因與處理</th></tr></thead>
  <tbody>
    <tr><td class="nm">登入或註冊顯示「無法連線後端」／Failed to fetch</td><td>GAS 部署的存取權不是「所有人」，或網址不是 <code>/exec</code> 結尾。到「管理部署作業」修正存取權，選新版本後部署</td></tr>
    <tr><td class="nm">出現「未知的 action」或「xxx is not defined」</td><td>貼了新的 .gs 但沒有部署新版本；或新增檔案時選成 HTML。確認檔案都是 .gs 後重新部署</td></tr>
    <tr><td class="nm">帳號審核中／未通過審核／已被停用</td><td>新帳號需管理員在「⚙ 設定」按「通過」後才能登入；被拒絕或停用請聯絡管理員</td></tr>
    <tr><td class="nm">登入已逾時，請重新登入</td><td>登入超過 6 小時未使用，重新登入即可</td></tr>
    <tr><td class="nm">報價顯示「更新失敗（保留最後報價）」</td><td>可能是當日額度用完、資料來源暫時無回應或被限流；稍候會自動恢復。查看「今日 API 呼叫」是否已滿</td></tr>
    <tr><td class="nm">新增標的顯示「查無報價」</td><td>代碼格式不符，請參考輸入欄旁的「?」；國外股票需加市場碼（例：<code>7011 JP</code>）</td></tr>
    <tr><td class="nm">某些標的價格不動</td><td>該市場休市或該標的無成交；日股、期貨可能有延遲</td></tr>
    <tr><td class="nm">總經頁某張字卡載入失敗</td><td>該資料來源暫時無回應，按「重試」；其他字卡不受影響</td></tr>
    <tr><td class="nm">信用交易／法人下方寫「改用備援」</td><td>FinMind 暫時無法使用（常見原因：未設 token 或達每小時上限），已自動改用證交所資料</td></tr>
    <tr><td class="nm">上櫃資料只有十幾天</td><td>歷史逐日補齊中，多開幾次總經頁就會補滿</td></tr>
    <tr><td class="nm">選股器顯示「尚未啟用」</td><td>還沒在 Apps Script 執行 <code>setupScreener</code></td></tr>
    <tr><td class="nm">選股器顯示「資料建置中」</td><td>第一次建置約需 20–40 分鐘，請稍後再開</td></tr>
    <tr><td class="nm">個股研究某些字卡顯示「資料不足」</td><td>興櫃、新上市或資料來源未提供該項（例如美股的月營收、興櫃的本益比）</td></tr>
    <tr><td class="nm">今天的台股法人／融資還是前一天</td><td>交易所晚間才公布（法人約 16:30、融資約 21:00）</td></tr>
  </tbody>
</table></div>

<h3 id="g-disclaimer">12. 免責聲明</h3>
<p>本網站資料來自公開來源，可能有延遲、遺漏或錯誤；各項判斷為固定統計規則的結果，僅供研究參考，不構成任何投資建議。投資前請自行判斷並承擔風險。</p>
`;

function initHelp() {
  const sec = $('#section-help');
  const show = which => {
    $$('.help-tabs button', sec).forEach(b => b.classList.toggle('on', b.dataset.h === which));
    $('#helpDoc').innerHTML = which === 'quota' ? HELP_QUOTA : HELP_GUIDE;
    store.set('mw_help', which);
  };
  $$('.help-tabs button', sec).forEach(b => b.addEventListener('click', () => show(b.dataset.h)));
  // 目錄連結：在頁內平滑捲動
  $('#helpDoc').addEventListener('click', e => {
    const a = e.target.closest('.help-toc a');
    if (!a) return;
    e.preventDefault();
    const t = $(a.getAttribute('href'));
    if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
  });
  show(store.get('mw_help') === 'guide' ? 'guide' : 'quota');
}

initHelp();
