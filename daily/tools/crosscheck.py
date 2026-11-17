# -*- coding: utf-8 -*-
"""市場日報：數字自動比對。把報告裡的數字和腳本輸出（官方資料）比，幾秒內列出「疑似抄錯」的地方，給數字查核員優先處理。

用法（在 C:\\Users\\User\\Desktop\\news 執行）：
  python daily/tools/crosscheck.py 報告.html 官方1.md [官方2.md …]
  例：python daily/tools/crosscheck.py daily/reports/D.html _research/D/official-tw-*.md _research/D/official-us-*.md

做法：
1. 取出官方檔表格裡的所有數字（附「哪一節、哪一列、哪一欄」）。
2. 取出報告內文（去掉 HTML 標籤、SVG 圖形座標）的所有數字（附前後文）。
3. 報告的數字和某個官方數字「很接近但不一樣」時列出來，例如 41,040.08 寫成 41,040.80、0.85% 寫成 0.86%、
   −21,506 寫成 −21,507。完全一樣的不列。
4. 這只是篩選工具：列出來的不一定是錯（可能是另一個口徑或自算數字），也不會發現「報告用了錯的那一個數字」。
   限制：比對取絕對值，正負號抄反（例如 +380.94 寫成 −380.94）抓不到；報告數字只要等於官方檔任何一個數字就略過；
   自算的百分比、新聞裡的數字都不在官方檔裡，要靠查核員。路徑可以用萬用字元（例如 _research/D/official-*.md），腳本會自己展開。
   數字查核員先看這份清單，再照 RULES.md 步驟 5 做其他檢查。
"""
import re
import sys
from html import unescape

NUM = re.compile(r"(?<![\d.])[-−+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\d.,])[-−+]?\d+\.\d+|(?<![\d.,])[-−+]?\d{3,}(?![\d.,])")


def val(tok):
    t = tok.replace(",", "").replace("−", "-").replace("+", "")
    try:
        return float(t)
    except ValueError:
        return None


def official(paths):
    out = []
    for p in paths:
        sec = ""
        hdr = None
        for line in open(p, encoding="utf-8"):
            if line.startswith("## "):
                sec, hdr = line[3:].strip(), None
                continue
            if not line.startswith("|"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if hdr is None:
                hdr = cells
                continue
            if set("".join(cells)) <= set("-: "):
                continue
            for i, c in enumerate(cells[1:], 1):
                for m in NUM.finditer(c):
                    v = val(m.group(0))
                    if v is not None:
                        col = hdr[i] if i < len(hdr) else ""
                        out.append((abs(v), m.group(0).lstrip("+−-"), f"{p.split('/')[-1].split(chr(92))[-1]}｜{sec[:18]}｜{cells[0]}｜{col}",
                                    keywords(cells[0]) | keywords(col)))
    return out


def report_numbers(path):
    s = open(path, encoding="utf-8").read()
    s = re.sub(r"<svg.*?</svg>", " ", s, flags=re.S)
    s = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", s, flags=re.S)
    s = re.sub(r'style="[^"]*"', " ", s)
    s = unescape(re.sub(r"<[^>]+>", " ", s))
    s = re.sub(r"\s+", " ", s)
    out = []
    for m in NUM.finditer(s):
        v = val(m.group(0))
        if v is not None:
            out.append((abs(v), m.group(0).lstrip("+−-"), s[max(0, m.start() - 28):m.end() + 12]))
    return out


GENERIC = {"日期", "收盤", "漲跌", "漲跌幅", "合計", "價格", "資料時間", "日漲跌", "週漲跌", "今年以來", "備註", "數值", "成交量", "張", "億元",
           "指數", "類指數", "買超", "賣超", "月份", "時段", "結算價", "未沖銷", "排名", "個股", "類型", "項目", "整體市場", "股票"}


def keywords(label):
    """官方標籤裡可以用來對應報告前後文的關鍵字（中文 2 字以上、英文代號）。"""
    t = re.sub(r"[*（）()｜|]", " ", label)
    t = t.replace("類指數", " ").replace("指數", " ").replace("買賣超", " ")
    ks = set()
    for w in re.findall(r"[一-鿿]{2,}|[A-Za-z&]{2,}[A-Za-z0-9&. ]*", t):
        w = w.strip()
        if w and w not in GENERIC:
            ks.add(w)
            if re.fullmatch(r"[一-鿿]{3,}", w):
                ks.update(w[i:i + 2] for i in range(len(w) - 1))
    return {k for k in ks if k not in GENERIC}


def close(a, b, sa, sb):
    """很接近但不一樣：同位數、只差最後一兩位；或四捨五入不一致。"""
    if a == b or a == 0 or b == 0:
        return False
    if abs(a - b) / max(a, b) > 0.003:
        return False
    da = len(sa.split(".")[1]) if "." in sa else 0
    db = len(sb.split(".")[1]) if "." in sb else 0
    if da != db:  # 小數位數不同：只有四捨五入後仍不一致才算
        d = min(da, db)
        return round(a, d) != round(b, d) and abs(round(a, d) - round(b, d)) <= 10 ** -d * 1.01
    unit = 10 ** -da
    return abs(a - b) <= unit * 10 + 1e-9


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    import glob
    rep = sys.argv[1]
    offs = [f for pat in sys.argv[2:] for f in (sorted(glob.glob(pat)) or [pat])]
    off = official(offs)
    offset = {round(v, 6) for v, _, _, _ in off}
    nums = report_numbers(rep)
    hits = []
    seen = set()
    for v, s, ctx in nums:
        if round(v, 6) in offset or v < 10 and "." not in s:
            continue
        if "." not in s and "," not in s and (1900 <= v <= 2100 or len(s) == 4):  # 年份、股票代號
            continue
        before = ctx[:30]
        for ov, os_, where, kws in off:
            if close(v, ov, s, os_) and any(k in before for k in kws):
                key = (s, os_)
                if key in seen:
                    break
                seen.add(key)
                hits.append((s, os_, where, ctx))
                break
    exact = sum(1 for v, _, _ in nums if round(v, 6) in offset)
    print(f"報告數字 {len(nums)} 個，其中 {exact} 個和官方檔完全一樣；疑似抄錯 {len(hits)} 處：\n")
    for s, os_, where, ctx in hits:
        print(f"- 報告「{s}」↔ 官方「{os_}」（{where}）\n  前後文：…{ctx}…")
    if not hits:
        print("（沒有發現）")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
