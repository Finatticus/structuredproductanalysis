/* 報告索引。新報告加在陣列最前面。
   立場代碼：bull 偏多｜lbull 中性偏多｜neutral 中性｜lbear 中性偏空｜bear 偏空
   id 對應 reports/<id>.html */
window.REPORTS = [
  {
    id: "2026-11-16",
    date: "2026-11-16",
    weekday: "一",
    edition: "晚間版",
    headline: "台股跌 2,635 點收在最低，全球都在等週三清晨的輝達財報",
    summary: "今天的下跌集中在 AI 硬體：台股 −6.03%、韓股 −3.59%、日經 −2.42%，但港股、印度、歐股沒跌，歐洲 STOXX 600 還在歷史高點。美債 10 年殖利率 5.15%、美元 19 個月高，全球主要央行 12 月都可能升息。輝達財報在台北週三 05:20 公布，同一天台指期結算。",
    global: { short: "lbear", mid: "neutral", long: "lbull" },
    taiwan: { short: "lbear", mid: "lbear", long: "lbull" },
    stats: "加權 41,040.08（−6.03%）｜S&P 500 7,561.67（11/13）｜美債 10 年 5.15%｜美元／新台幣 32.886｜布蘭特約 95 美元"
  }
];
