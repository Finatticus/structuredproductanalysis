/* 功能區登錄表
 * 之後要加新功能：在 TOOLS 加一筆，status 改成 'ready' 並提供 render(container, ctx)。
 * render 可回傳 cleanup 函式。路由為 #/tool/<id>，或 #/tool/<id>/<tripId>（綁定某趟行程）。 */
(function () {
  const TOOLS = [
    { id: 'packing', name: '行李打包清單', desc: '依天數、天氣、目的地產生清單，可存成模板重複使用', status: 'soon', perTrip: true,
      plan: ['常用模板（商務 / 海島 / 冬季 / 自駕）', '依旅行天數自動計算衣物數量', '每趟行程獨立勾選進度', '「上次忘記帶」提醒'] },
    { id: 'split', name: '多人分帳', desc: '記錄誰付了什麼，自動算出最少轉帳次數', status: 'soon', perTrip: true,
      plan: ['成員管理、多幣別記帳', '依匯率自動換算台幣', '平分 / 依比例 / 指定人分攤', '最佳化結算（最少轉帳）', '分享連結給同行旅伴'] },
    { id: 'budget', name: '旅費記帳 & 預算', desc: '機票、住宿、餐飲分類統計，對照預算', status: 'soon', perTrip: true,
      plan: ['每筆花費可拍照存收據', '分類圓餅圖、每日花費', '預算超支提醒', '歷年旅費統計'] },
    { id: 'converter', name: '匯率換算器', desc: '依行程國家快速換算，支援離線最後匯率', status: 'soon',
      plan: ['多幣別同時換算', '殺價 / 刷卡手續費試算', '離線可用'] },
    { id: 'checklist', name: '行前檢查清單', desc: '護照效期、簽證、保險、eSIM、轉接頭、入境申報', status: 'soon', perTrip: true,
      plan: ['依國家帶入簽證 / 入境申報（如 VJW、ESTA、eTA）', '出發前 N 天提醒', '護照效期檢查'] },
    { id: 'docs', name: '票券 & 訂位中心', desc: '機票 PNR、飯店確認碼、門票 QR 一頁看完', status: 'soon', perTrip: true,
      plan: ['從各行程彙整訂位代號', '離線查看 QR Code', '取消期限倒數提醒'] },
    { id: 'map', name: '足跡地圖', desc: '世界地圖標出去過的國家與城市', status: 'soon',
      plan: ['已去過 / 計畫中 不同顏色', '點國家看相關行程', '旅行統計（國家數、天數、里程）'] },
    { id: 'emergency', name: '緊急資訊', desc: '各國駐外館處、報警/急救電話、保險理賠', status: 'soon',
      plan: ['依行程國家自動列出', '一鍵撥號', '信用卡掛失電話'] },
    { id: 'wishlist', name: '願望清單', desc: '想去的地方、看到的好店先收藏，排行程時拉進來', status: 'soon',
      plan: ['收藏網址 / Google Maps 連結', '依國家城市分類', '一鍵加入某天行程'] },
    { id: 'weather', name: '旅途天氣', desc: '出發前一週顯示各城市天氣預報', status: 'soon',
      plan: ['依行程日期與城市', '穿搭建議連動行李清單'] },
  ];

  window.TA = window.TA || {};
  const PREFS = '__prefs';
  TA.tools = {
    list: TOOLS,
    get: id => TOOLS.find(t => t.id === id),
    /** 依使用者排列的順序（存在雲端，所有裝置共用） */
    ordered() {
      const order = TA.store.record(PREFS)?.toolOrder || [];
      const idx = id => { const i = order.indexOf(id); return i < 0 ? 999 + TOOLS.findIndex(t => t.id === id) : i; };
      return TOOLS.slice().sort((a, b) => idx(a.id) - idx(b.id));
    },
    saveOrder(ids) {
      const cur = TA.store.record(PREFS) || {};
      TA.store.saveRecord(PREFS, 'prefs', '偏好設定（非旅程）', { ...cur, toolOrder: ids });
    },
  };
})();
