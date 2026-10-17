# 旅行誌 Travel Journal

純 HTML / CSS / JavaScript 的個人旅行網站，資料存在自己的 Google 試算表與 Drive。

## 使用

1. 照 [`../gas/README.md`](../gas/README.md) 部署或更新 Apps Script（gas 資料夾在 site 外面，因為含有密碼）。
2. 把 Apps Script 網址貼進 [`js/config.js`](js/config.js) 的 `gasUrl`。之後任何裝置只要輸入密碼就能進入。
3. 打開 `index.html`，或把整個資料夾放到 GitHub Pages / Netlify / Cloudflare Pages。
4. 第一次登入後，到「設定 → 圖片保存」按「開始搬移圖片」，把舊圖片存進自己的 Drive。

網站檔案裡沒有任何旅程資料，所以放到公開網址也只看得到登入畫面。

## 功能

| 區域 | 內容 |
| --- | --- |
| 登入 | 管理者輸入 TOKEN；訪客輸入 guest 只能瀏覽；同一瀏覽器之後免輸入 |
| 主頁 | 下一段旅程倒數、旅行統計（移動距離、繞地球幾圈…）、旅程清單（安排中／已完成、搜尋、複製、刪除） |
| 旅程頁 | 每日行程時間軸、住宿總覽、機票／飯店／花費等分頁、可勾選的待辦清單、列印 |
| 編輯器 | 所見即所得：行程站點清單、圖文備註（粗體、顏色、清單、表格、收合區塊、圖片貼上即上傳）、拖曳排序、草稿自動暫存、Ctrl+S |
| 旅行工具箱 | 行李清單、多人分帳…等預留入口（`js/tools.js`） |
| 世界時鐘與匯率 | 依旅程中的國家自動列出；跑馬燈同步顯示 |

## 檔案結構

```
index.html
css/style.css
js/
  config.js       雲端網址、網站名稱
  util.js / ui.js 共用工具、圖示
  countries.js    國家 → 國旗／貨幣／時區
  geo.js          城市座標、旅行統計
  rich.js         圖文編輯器
  legacy.js       舊格式資料的一次性轉換
  store.js        資料存取、同步、登入、圖片搬移
  ticker.js       匯率與時差
  tools.js        工具箱登錄表
  views/          home / trip / editor / misc
  app.js          路由
../gas/Code.gs    Apps Script 後端（含密碼，不放在 site 裡）
```
