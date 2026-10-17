/* 功能區登錄表
 * 之後要加新功能：在 TOOLS 加一筆，status 改成 'ready' 並提供 render(container, ctx)。
 * render 可回傳 cleanup 函式。路由為 #/tool/<id>，或 #/tool/<id>/<tripId>（綁定某趟行程）。 */
(function () {
  const TOOLS = [
    { id: 'packing', name: '行李打包清單', desc: '依天數、天氣、目的地產生清單，可存成模板重複使用', status: 'soon', perTrip: true, plan: [] },
    { id: 'wishlist', name: '願望清單', desc: '想去的地方、看到的好店先收藏，排行程時拉進來', status: 'soon', plan: [] },
    { id: 'expense', name: '記帳與分帳', desc: '旅途中隨手記花費，自動換算台幣、算出每人分攤與誰該給誰', status: 'soon', perTrip: true, plan: [] },
    { id: 'weather', name: '旅途天氣', desc: '現在天氣、16 天預報、最近一個月與歷年同期氣溫', status: 'soon', perTrip: true, plan: [] },
    { id: 'emergency', name: '緊急資訊', desc: '當地緊急電話、駐外館處與中國使領館、治安與醫療、證件遺失處理', status: 'soon', perTrip: true, plan: [] },
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
