/* 報告索引。新報告加在陣列最前面。格式見 RULES.md 第七節。
   立場代碼：bull 偏多｜lbull 中性偏多｜neutral 中性｜lbear 中性偏空｜bear 偏空 */
window.REPORTS = [
  {
    id: "2026-11-16",
    date: "2026-11-16",
    weekday: "一",
    edition: "晨報",
    headline: "輝達財報週開局：美國晶片股週五轉弱，台日韓 AI 權值股開盤承壓",
    summary: "上週亞洲股市大幅反彈，但週五費半跌 3.43%、週末財長要求輝達大改組、高盛把台股降到中立。美債 10 年殖利率 5.15%，全球主要央行 12 月都可能升息。這週方向由週三清晨的輝達財報決定，同日台指期結算。",
    views: {
      tw: { s: "lbear", m: "lbear", l: "lbull" },
      us: { s: "lbear", m: "neutral", l: "lbull" },
      jp: { s: "lbear", m: "neutral", l: "lbull" },
      kr: { s: "lbear", m: "neutral", l: "lbull" }
    },
    stats: "加權 43,675（11/13）｜S&P 500 7,562｜日經 61,142｜KOSPI 5,291｜美債 10 年 5.15%"
  }
];
