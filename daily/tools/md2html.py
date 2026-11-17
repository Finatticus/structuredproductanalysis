# -*- coding: utf-8 -*-
"""市場日報：把 twdata.py／usdata.py 輸出的 Markdown 表格轉成報告用的 HTML 表格（含 thead、數字欄、漲跌顏色）。

用法（在 C:\\Users\\User\\Desktop\\news 執行）：
  python daily/tools/md2html.py 檔案.md "## 4."            # 轉換標題以「## 4.」開頭那一節裡的第一張表
  python daily/tools/md2html.py 檔案.md "## 4." --cols 0,1,3,6   # 只保留指定欄（0 起算）
  python daily/tools/md2html.py 檔案.md "## 4." --rows -5        # 只保留最後 5 列（正數＝前 N 列）

規則：以 + 開頭的數字加 class="num up"（紅），以 −／- 開頭的加 class="num dn"（綠），其他數字加 class="num"。
輸出的 HTML 直接貼進報告，再自己補上表後的歸納（RULES.md 6.2）。
"""
import argparse
import html
import re
import sys

NUM = re.compile(r"^[+−\-]?[\d,]+(\.\d+)?\s*(%|bp| bp|億|張|口)?$")


def cell(tag, txt):
    t = txt.strip()
    bold = t.startswith("**") and t.endswith("**")
    t = t.strip("*")
    cls = ""
    if NUM.match(t.replace(" ", "")):
        cls = "num up" if t.startswith("+") else ("num dn" if t.startswith(("−", "-")) and t not in ("-", "−") else "num")
    body = html.escape(t)
    if bold:
        body = f"<b>{body}</b>"
    return f'<{tag}{f" class=\"{cls}\"" if cls else ""}>{body}</{tag}>'


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("file")
    p.add_argument("heading")
    p.add_argument("--cols", default="")
    p.add_argument("--rows", type=int, default=0)
    a = p.parse_args()
    lines = open(a.file, encoding="utf-8").read().splitlines()
    i = next((k for k, l in enumerate(lines) if l.startswith(a.heading)), None)
    if i is None:
        sys.exit("找不到標題：" + a.heading)
    tbl = []
    for l in lines[i + 1:]:
        if l.startswith("#"):
            break
        if l.startswith("|"):
            tbl.append([c for c in l.strip().strip("|").split("|")])
        elif tbl:
            break
    if len(tbl) < 3:
        sys.exit("這一節沒有表格")
    head, body = tbl[0], [r for r in tbl[2:]]
    if a.rows:
        body = body[:a.rows] if a.rows > 0 else body[a.rows:]
    cols = [int(x) for x in a.cols.split(",")] if a.cols else list(range(len(head)))
    out = ['<div class="tbl"><table>', "  <thead><tr>" + "".join(cell("th", head[c]).replace(' class="num up"', ' class="num"').replace(' class="num dn"', ' class="num"') for c in cols) + "</tr></thead>", "  <tbody>"]
    for r in body:
        out.append("    <tr>" + "".join(cell("td", r[c] if c < len(r) else "") for c in cols) + "</tr>")
    out += ["  </tbody>", "</table></div>"]
    print("\n".join(out))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
