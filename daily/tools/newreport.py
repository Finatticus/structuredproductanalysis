# -*- coding: utf-8 -*-
"""市場日報：建立新報告的骨架。複製最近一份同類報告當範本，自動換好固定欄位，需要人改的地方標上【待填】【待確認】。

用法（在 C:\\Users\\User\\Desktop\\news 執行）：
  python daily/tools/newreport.py am YYYY-MM-DD     # 早報：複製最近一份早報 → daily/reports/YYYY-MM-DD.html
  python daily/tools/newreport.py pm YYYY-MM-DD     # 午報：複製最近一份午報 → daily/reports/YYYY-MM-DD-pm.html

自動處理：<title>、body 的 data-report、刊頭 kicker 的日期與英文星期、「資料截至台北時間 MM/DD（X）HH:MM」、頁尾日期。
標成【待填】：<meta name="description">、刊頭標題 h1。
標成【待確認】：刊頭其他資料日期（例如「美股：MM/DD 收盤」）、每個分頁標題列的 .asof。
內文完全沒動：主筆照 RULES.md 5.9 改寫，發布前跑 residue.py 檢查殘留，並確認全文已經沒有「【待」。
目標檔已存在就停止，不會覆寫。
"""
import glob
import os
import re
import shutil
import sys
from datetime import date

EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
ZH = ["一", "二", "三", "四", "五", "六", "日"]
R = os.path.join("daily", "reports")


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("am", "pm"):
        sys.exit(__doc__)
    kind, ds = sys.argv[1], sys.argv[2]
    d = date.fromisoformat(ds)
    pm = kind == "pm"
    files = sorted(f for f in glob.glob(os.path.join(R, "*.html")) if f.endswith("-pm.html") == pm)
    files = [f for f in files if os.path.basename(f)[:10] < ds]
    if not files:
        sys.exit("找不到範本")
    tpl = files[-1]
    out = os.path.join(R, f"{ds}-pm.html" if pm else f"{ds}.html")
    if os.path.exists(out):
        sys.exit(f"{out} 已存在，停止（不覆寫）")
    od = os.path.basename(tpl)[:10]
    o = date.fromisoformat(od)
    s = open(tpl, encoding="utf-8").read()
    cut = "15:30" if pm else "07:00"
    edition = "盤後午報" if pm else "早報"
    n = {}

    def sub(pat, rep, flags=0, key=None):
        nonlocal s
        s, c = re.subn(pat, rep, s, flags=flags)
        n[key or pat[:20]] = c

    s, c = re.subn(r"<title>[^<]*</title>", f"<title>市場日報 {edition} {ds}</title>", s, count=1)  # 只換 <head> 裡的頁面標題（SVG 裡也有 <title>）
    n["title"] = c
    sub(r'(<meta name="description" content=")[^"]*(")', r"\1【待填：一句話寫當天重點】\2", key="description")
    sub(r'data-report="[^"]*"', f'data-report="{ds}-pm"' if pm else f'data-report="{ds}"', key="data-report")
    sub(r'(<div class="kicker">)[^<]*(</div>)', rf"\g<1>市場日報 · {edition} · {ds} {EN[d.weekday()]}\g<2>", key="kicker")
    s, c = re.subn(r"(<header class=\"mast\">.*?<h1>)[^<]*(</h1>)", r"\1【待填：一句話標題】\2", s, count=1, flags=re.S)
    n["h1"] = c
    # 刊頭 meta：資料截至自動換，其他日期標待確認
    m = re.search(r'(<div class="meta">)(.*?)(</div>)', s, flags=re.S)
    if m:
        spans = re.findall(r"<span>(.*?)</span>", m.group(2))
        new = []
        for sp in spans:
            if sp.startswith("資料截至台北時間"):
                new.append(f"<span>資料截至台北時間 {d.month}/{d.day}（{ZH[d.weekday()]}）{cut}</span>")
            else:
                new.append(f"<span>【待確認】{sp}</span>")
        s = s[:m.start(2)] + "".join(new) + s[m.end(2):]
        n["meta"] = len(spans)
    # .asof 標待確認
    s, c = re.subn(r'(<span class="asof">)(?!【待確認】)', r"\1【待確認】", s)
    n["asof"] = c
    # 頁尾日期
    s, c = re.subn(r"資料截至台北時間 \d{4}-\d{2}-\d{2} \d{2}:\d{2}", f"資料截至台北時間 {ds} {cut}", s)
    n["foot"] = c
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)
    print(f"已建立 {out}（範本：{tpl}，範本日期 {od}）")
    print("自動換好：" + "、".join(f"{k} {v} 處" for k, v in n.items()))
    print(f"全文【待填】【待確認】共 {s.count('【待')} 處；內文還是 {od} 的內容，要逐段改寫。發布前：")
    print(f"  python daily/tools/residue.py {out.replace(os.sep, '/')} {tpl.replace(os.sep, '/')}")
    print(f"  grep -c '【待' {out.replace(os.sep, '/')}    # 必須是 0")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
