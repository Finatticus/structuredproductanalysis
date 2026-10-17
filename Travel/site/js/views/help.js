/* 設定 → 網站說明：每個區塊的使用方式與運作邏輯 */
(function () {
  const sec = (title, body) => `<div class="fold help-sec"><div class="fold-title">${title}</div><div class="fold-body rich">${body}</div></div>`;

  const HELP = [
    sec('網站架構總覽', `
      <p>這是一個不需要安裝、不需要伺服器的網站：網頁本身只是 HTML、CSS、JavaScript 檔案，<strong>資料全部存在你自己的 Google 帳號</strong>。</p>
      <table><thead><tr><th>位置</th><th>存放內容</th></tr></thead><tbody>
        <tr><td>Google 試算表 <code>trips</code> 工作表</td><td>每段旅程一列；另外還有「個人足跡」「行李模板」「願望清單」三列（標題註明「非旅程」）</td></tr>
        <tr><td>Google 試算表 <code>images</code> 工作表</td><td>外部圖片搬到 Drive 的對照紀錄</td></tr>
        <tr><td>Google Drive「TravelAtlas Images」</td><td>所有圖片檔</td></tr>
        <tr><td>瀏覽器</td><td>一份暫存（讓網站開得快）、登入狀態、草稿、匯率與天氣快取</td></tr>
      </tbody></table>
      <p>網頁和資料之間由 Google Apps Script 負責溝通，每次呼叫都要帶密碼。網站檔案裡沒有任何旅程資料，所以放在公開網址也只看得到登入畫面。</p>
      <p>Apps Script 程式放在電腦上 <code>Travel\gas\Code.gs</code>，<strong>刻意放在 site 資料夾外面</strong>：它含有密碼，不能跟網站一起公開。</p>`),

    sec('登入與同步', `
      <ul>
        <li><strong>登入</strong>：輸入管理者密碼（Code.gs 的 <code>TOKEN</code>）。驗證成功後存在這個瀏覽器，下次不用再輸入；清除瀏覽器資料或在設定按「登出」才需要重新輸入。</li>
        <li><strong>訪客模式</strong>：用訪客密碼登入的人可以看到和管理者一樣的內容，但不能新增、修改、刪除、上傳。限制是在 Apps Script 端執行的，訪客就算改網頁程式也寫不進資料。訪客模式下網站名稱旁會顯示「訪客瀏覽」，編輯按鈕都會隱藏。</li>
        <li><strong>管理訪客密碼</strong>：設定 →「訪客密碼」可以新增（可按「隨機產生」，並寫備註，例如「爸媽」）、查看每組密碼最後使用時間、刪除。密碼存在 Apps Script 專案的「指令碼屬性」，不在試算表裡。第一次使用會預設一組 <code>guest</code>，不需要可以刪掉。</li>
        <li><strong>刪除訪客密碼</strong>：用那組密碼登入的裝置，下次開啟網站時會被自動登出，並清除那台裝置上的暫存資料。管理者密碼改掉時，舊密碼登入的裝置也一樣會被登出。</li>
        <li><strong>注意</strong>：訪客看得到全部內容，包括訂位代號、姓名、電話等，只把訪客密碼給信任的人；建議一人（或一群人）一組，方便之後單獨取消。</li>
        <li><strong>雲端網址</strong>：寫在 <code>js/config.js</code> 的 <code>gasUrl</code>，所有裝置共用。換網址時改這裡即可。</li>
        <li><strong>同步規則</strong>：每次開啟網站時下載雲端資料；同一筆資料比較「最後修改時間」，較新的保留。按儲存會立刻寫回雲端。右上角圓形箭頭可以手動同步。</li>
        <li><strong>刪除</strong>：刪除的旅程在試算表會標記 <code>deleted = Y</code> 而不是真的刪掉，這樣其他裝置同步時才知道它被刪了。</li>
        <li><strong>注意</strong>：兩台裝置同時編輯同一筆資料，後儲存的會覆蓋先儲存的。</li>
      </ul>`),

    sec('主頁：地圖與統計', `
      <ul>
        <li><strong>足跡地圖</strong>：墨綠色是去過的國家，深灰是居住地，淡赭色是安排中的國家；古銅色圓點是去過的城市，空心圈是即將前往的城市。滑鼠移上去顯示名稱與次數，點國家或城市會篩選下方的旅程清單。香港、澳門、新加坡等太小的地區在地圖上沒有輪廓，只會顯示成圓點。</li>
        <li><strong>編輯足跡</strong>（地圖右下角）：設定居住地，以及「去過但沒有排行程」的地方（例如出差、轉機、很久以前的旅行），會一起算進統計與地圖。</li>
        <li><strong>統計怎麼算</strong>：只計算「已完成」的旅程加上手動足跡。
          <ul>
            <li>國家與地區、城市：不重複計算，居住地不算。</li>
            <li>在外的天數：每趟旅程的出發日到回程日（含頭尾），加上足跡裡填的天數。</li>
            <li>移動距離：台北（桃園機場）→ 依城市順序 → 回台北的大圓距離總和，是估算值；地球一圈以 40,075 公里計。</li>
            <li>住過的旅宿：每日行程裡填過的飯店名稱，不重複計算。</li>
          </ul></li>
        <li><strong>下一段旅程</strong>：最近一趟還沒結束的旅程，顯示倒數天數；旅行中則顯示第幾天。</li>
      </ul>`),

    sec('手機與安裝成 App', `
      <ul>
        <li><strong>安裝方式</strong>（網站必須放在 https 網址上，例如 GitHub Pages）：
          <ul>
            <li>iPhone／iPad：用 Safari 打開網站 → 分享按鈕 →「加入主畫面」。</li>
            <li>Android：用 Chrome 打開 → 右上角選單 →「安裝應用程式」或「加到主畫面」。</li>
            <li>電腦版 Chrome／Edge：網址列右邊的安裝圖示。</li>
          </ul></li>
        <li>安裝後會像一般 App 一樣全螢幕開啟，有自己的圖示。iPhone 上 App 與 Safari 的登入狀態分開保存，第一次開啟 App 需要再輸入一次密碼。</li>
        <li><strong>手機版面</strong>：寬度 720px 以下自動切換。主選單移到畫面下方；按鈕與輸入框都放大方便觸控，輸入文字時不會被自動放大；對話框從下方滑出；旅程頁上方有可橫向滑動的日期列；編輯器工具列可以左右滑動，行程站點改成上下排列。</li>
        <li><strong>離線</strong>：看過的頁面在沒有網路時仍可開啟（顯示上次同步的資料），連上網路後會自動同步。離線時不能儲存修改。</li>
        <li><strong>更新</strong>：網站更新後，App 下次開啟時會自動載入新版，不需要重新安裝。</li>
      </ul>`),

    sec('旅行工具箱', `
      <ul>
        <li>工具箱頁按「調整順序」後，拖曳左側把手排列，按「完成排序」結束。順序存在雲端，所有裝置相同。</li>
        <li>目前可以使用：行李打包清單、願望清單；其他標示「規劃中」的工具點進去可以看預計功能。</li>
      </ul>`),

    sec('旅程清單與狀態', `
      <ul>
        <li>狀態預設「依日期自動判斷」：回程日已過 → 已完成；出發日到回程日之間 → 旅行中；其餘 → 安排中。也可以在編輯頁手動指定。</li>
        <li>搜尋會比對旅程名稱、國家、城市、標籤、每天的景點與飯店。</li>
        <li>滑鼠移到旅程上會出現編輯、複製、刪除。複製適合拿舊行程當新行程的範本。</li>
      </ul>`),

    sec('旅程頁', `
      <ul>
        <li><strong>每日行程</strong>：左側是天數索引（手機版隱藏），右側每天依序顯示：當天標題、行程站點（時間軸）、備註、住宿、收合區塊。</li>
        <li><strong>地圖小圖示</strong>：每個沒有附 Google 地圖連結的站點與飯店旁邊都有地圖圖示，點了會用「名稱＋國家」在 Google 地圖搜尋，旅途中可以直接導航。</li>
        <li><strong>待辦清單</strong>：內容裡的核取方塊在閱讀頁也可以直接勾，勾了會自動儲存。</li>
        <li><strong>住宿分頁</strong>：自動把連續住同一間飯店的日子合併，算出入住、退房日與晚數。</li>
        <li><strong>其他分頁</strong>：編輯頁「其他資訊」裡的每一項（機票、飯店、花費…）各自成為一個分頁，空白的不會顯示。</li>
        <li><strong>列印</strong>：展開所有分頁與收合區塊後列印，可另存成 PDF 帶在身上。</li>
      </ul>`),

    sec('編輯旅程', `
      <ul>
        <li><strong>國家</strong>：輸入後按 Enter。可以輸入全球 243 個國家與地區，也接受常見別名（南韓、杜拜、臺灣、英文名）。紅框代表找不到這個國家名稱。</li>
        <li><strong>城市</strong>：請依造訪順序輸入（距離估算會照順序計算）。新城市會自動上網定位；紅框代表還沒找到位置，點一下可以搜尋並自己挑選正確的地點。</li>
        <li><strong>每日行程</strong>：
          <ul>
            <li>行程站點一列一個，可填時間與連結，按 Enter 自動新增下一站，拖曳左邊的點點排序。</li>
            <li>拖曳整天或按上下箭頭時，日期不動、內容換到另一天，方便調整順序。</li>
            <li>「依日期補齊天數」會依出發日到回程日自動補上缺少的日子；改了出發日後可以按「日期跟著出發日移動」。</li>
          </ul></li>
        <li><strong>圖文編輯器</strong>：工具列有粗體、顏色、螢光、標題、清單、待辦清單、引用、連結、圖片、表格、收合區塊、提醒框、分隔線、清除格式。游標在表格內時會多出新增列、欄的按鈕。圖片可以直接貼上或拖曳，會壓縮後上傳到 Google Drive。</li>
        <li><strong>草稿</strong>：編輯中的內容會自動暫存在瀏覽器，沒儲存就離開，下次打開會詢問是否還原。<kbd>Ctrl</kbd>＋<kbd>S</kbd> 可以儲存。</li>
      </ul>`),

    sec('行李打包清單', `
      <ul>
        <li><strong>模板</strong>：基本必備（每次套用）、商務／研討會、冬季、夏季／海島、自駕、長途飛行，都可以在「管理模板」修改或新增。數量可設「固定」或「每 1／2／3 天 1 件」並設上限。</li>
        <li><strong>自動建議模板</strong>：
          <ul>
            <li>冬季／夏季：查詢每個城市「去年同一段日期」的實際氣溫（Open-Meteo 歷史天氣資料）。平均最低溫低於 8°C 建議冬季，平均最高溫 28°C 以上建議夏季。查不到時改用緯度與月份推估。</li>
            <li>商務：旅程內容出現出差、研討會、名片、西裝等字。</li>
            <li>自駕：旅程內容出現自駕或租車。</li>
            <li>長途飛行：最遠城市距離台北超過 5,000 公里。</li>
          </ul></li>
        <li><strong>依目的地自動加入</strong>：該國需要的入境文件（例如 ESTA、越南電子簽證）；插頭不是台灣規格時加入轉接頭，多個國家合併成一項，插頭系統不只一種時建議萬用轉接頭。</li>
        <li><strong>打包</strong>：可調數量、切換隨身／託運（行動電源、鋰電池固定隨身）。「回程檢查」是另一組獨立的勾選。</li>
        <li>修改模板不會影響已經建立的清單。</li>
      </ul>`),

    sec('出發須知（簽證、入境、匯率）', `
      <ul>
        <li>以<strong>中華民國護照</strong>從台灣出發為準。約 75 個國家有整理簽證、入境手續與官方連結、插頭電壓、緊急電話、注意事項；其他國家顯示時差、行車方向、匯率，並附外交部領事事務局連結。</li>
        <li>資料是 2026 年整理的，<strong>入境規定常變動</strong>，標示「請確認」的項目特別要再查一次。要新增或修改國家資料，在 <code>js/countryinfo.js</code> 加一筆即可。</li>
        <li>匯率與換算器使用即時匯率；天氣參考是去年同期的實際氣溫。</li>
      </ul>`),

    sec('願望清單', `
      <ul>
        <li><strong>通用願望清單</strong>：還沒有安排的想去地點、想吃的店、想做的事、人生清單，依國家分組，可依類型、狀態篩選與搜尋。</li>
        <li><strong>新增</strong>：在上方輸入框貼上網址或直接輸入名稱。
          <ul>
            <li>Google 地圖連結：自動帶入地點名稱與座標，再自動查出所在國家與城市。</li>
            <li>一般網址：自動抓網頁標題（需要 Apps Script 有 <code>meta</code> 功能）。</li>
            <li>Google 地圖分享短網址（maps.app.goo.gl）需要 Apps Script 展開後才能解析。</li>
          </ul></li>
        <li><strong>連結旅程</strong>：在編輯視窗選擇旅程，或在旅程的願望清單頁把「同國家的其他願望」加入這趟。</li>
        <li><strong>排入行程</strong>：在旅程的願望清單頁選「排入行程 → Day N」，會把這個地點加到當天的行程站點（連結一起帶入），備註也會加到當天備註。</li>
        <li>勾選左邊方塊代表「去過了」，會移到「去過了」分類。</li>
      </ul>`),

    sec('世界時鐘與匯率', `
      <ul>
        <li>列出所有旅程（含安排中）出現過的國家，安排中的排在前面並標示「即將前往」。新增旅程時自動加入，不需要另外設定。</li>
        <li>時區：使用該國首都的時區；美國、加拿大、澳洲、俄羅斯等多時區國家，會依旅程城市挑選，例如洛杉磯用美西時間。</li>
        <li>匯率：open.er-api.com 每日更新，網站快取 6 小時。小幣值會換算成 100 或 1,000 單位顯示。本國貨幣與時區可以在設定修改。</li>
      </ul>`),

    sec('國家清單與城市定位（資料來源）', `
      <ul>
        <li><strong>國家清單</strong>：涵蓋 ISO 標準的 243 個國家與地區（<code>js/countries-data.js</code>），每筆有國碼、貨幣、首都時區、首都座標、行車方向。中文名稱使用瀏覽器內建的台灣正體譯名，習慣用法另外指定（韓國、香港、阿聯…），別名也可以搜尋。國旗圖片來自 flagcdn.com。</li>
        <li><strong>城市定位</strong>，依序查找：
          <ol>
            <li>旅程裡已經存好的座標。</li>
            <li>網站內建約 150 個常用城市座標（不用連網）。</li>
            <li>OpenStreetMap（Nominatim）線上查詢：會用旅程的國家縮小範圍，查到後存回旅程，不會重複查詢。這項服務每秒最多查一次，所以一次新增很多城市時會一個一個定位。</li>
          </ol></li>
        <li><strong>世界地圖</strong>：Natural Earth 1:110m 資料，連同繪圖程式放在網站的 <code>vendor</code> 資料夾，不依賴外部網站。</li>
      </ul>`),

    sec('圖片保存', `
      <ul>
        <li>新上傳的圖片：編輯器裡貼上或選擇圖片後，先壓縮成最長邊 1,800 像素的 JPEG，再存到 Google Drive。</li>
        <li>舊的外部圖片：設定 →「圖片保存」可以一次搬到 Drive，每批 12 張，可中斷、可接續；已經搬過的會記在試算表 <code>images</code> 工作表，不會重複搬。</li>
      </ul>`),

    sec('備份與更新', `
      <ul>
        <li><strong>備份</strong>：設定 →「下載備份」會下載一個包含全部旅程、足跡、模板、願望清單的 JSON 檔；「匯入備份」可以還原。</li>
        <li><strong>更新 Apps Script</strong>：把 <code>Travel\gas\Code.gs</code> 整份貼上 → 部署 → 管理部署作業 → 編輯（鉛筆）→ 版本選「新版本」→ 部署。不要按「新增部署作業」，那會產生新網址，網站仍會連到舊的。</li>
        <li><strong>改管理者密碼</strong>：修改 Code.gs 裡的 <code>TOKEN</code> 後重新部署新版本，再到網站用新密碼登入。訪客密碼則直接在設定頁管理，不需要改程式。</li>
        <li><strong>更新網站檔案</strong>：<code>index.html</code> 裡每個檔案後面有版本號（例如 <code>?v=20261017b</code>），改版時更新它，各裝置就會讀到新版，不會卡在舊的快取。</li>
      </ul>`),

    sec('檔案結構（給要修改程式的人）', `
      <table><thead><tr><th>檔案</th><th>負責</th></tr></thead><tbody>
        <tr><td><code>js/config.js</code></td><td>雲端網址、網站名稱</td></tr>
        <tr><td><code>js/store.js</code></td><td>資料讀寫、同步、登入、圖片搬移</td></tr>
        <tr><td><code>js/countries.js</code>、<code>countries-data.js</code></td><td>國家清單</td></tr>
        <tr><td><code>js/countryinfo.js</code></td><td>各國簽證、入境、插頭等出發須知</td></tr>
        <tr><td><code>js/geo.js</code></td><td>城市座標、線上定位、距離與統計</td></tr>
        <tr><td><code>js/map.js</code></td><td>首頁足跡地圖</td></tr>
        <tr><td><code>js/rich.js</code></td><td>圖文編輯器與內容安全過濾</td></tr>
        <tr><td><code>js/ticker.js</code></td><td>匯率、時差、跑馬燈</td></tr>
        <tr><td><code>js/tools.js</code>、<code>js/tools/*.js</code></td><td>工具箱登錄表、行李清單、願望清單</td></tr>
        <tr><td><code>js/views/*.js</code></td><td>各頁面：主頁、旅程、編輯、設定、說明</td></tr>
        <tr><td><code>manifest.json</code>、<code>sw.js</code>、<code>icons/</code></td><td>安裝成 App 所需的設定、離線快取、圖示</td></tr>
        <tr><td><code>js/legacy.js</code></td><td>舊格式資料的一次性轉換</td></tr>
        <tr><td><code>Travel\gas\Code.gs</code>（site 外面）</td><td>Apps Script 後端，含密碼，不要公開</td></tr>
      </tbody></table>
      <p>新增一個工具：在 <code>js/tools.js</code> 加一筆，寫一個 <code>js/tools/名稱.js</code> 把 <code>status</code> 設成 <code>'ready'</code> 並提供 <code>render</code>，再到 <code>index.html</code> 加上 script 標籤。</p>`),
  ];

  TA.views = TA.views || {};
  TA.views.helpHtml = () => `<div class="help">${HELP.join('')}</div>`;
})();
