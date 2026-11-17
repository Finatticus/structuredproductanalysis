# -*- coding: utf-8 -*-
"""市場日報：範本殘留檢查。把新報告和當作範本的舊報告逐段比對，列出「文字完全一樣」的段落（很可能忘了改）。

用法（在 C:\\Users\\User\\Desktop\\news 執行）：
  python daily/tools/residue.py 新報告.html 範本報告.html

比對單位：每個 section.panel 與 div.subpanel 裡的摘要（.summary）、段落（p、li）、表格列（tr）、圖說（.viz-note）。
只列 20 字以上、和範本一字不差的文字；固定文字（頁尾免責聲明、分頁按鈕）會自動略過。
發布前結果應該只剩真的不需要更新的固定說明；其他每一項都要改寫或確認。
"""
import re
import sys
from html.parser import HTMLParser

SKIP = ("本報告由 Claude 依公開資訊整理分析", "不構成投資建議")


class P(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack, self.ids, self.buf, self.out, self.cur = [], [], [], [], None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("section", "div") and a.get("id"):
            self.ids.append((tag, a["id"]))
        if tag in ("p", "li", "tr", "h1", "h4", "td") and self.cur is None:
            self.cur, self.buf = tag, []
        self.stack.append((tag, a.get("id")))

    def handle_endtag(self, tag):
        if self.cur == tag:
            t = re.sub(r"\s+", " ", "".join(self.buf)).strip()
            if len(t) >= 20 and not any(k in t for k in SKIP):
                self.out.append((self.ids[-1][1] if self.ids else "-", t))
            self.cur = None
        while self.stack:
            tg, i = self.stack.pop()
            if i and self.ids and self.ids[-1][1] == i:
                self.ids.pop()
            if tg == tag:
                break

    def handle_data(self, d):
        if self.cur:
            self.buf.append(d)


def parse(fn):
    p = P()
    p.feed(open(fn, encoding="utf-8").read())
    return p.out


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    new, old = parse(sys.argv[1]), parse(sys.argv[2])
    olds = {t for _, t in old}
    hits = [(i, t) for i, t in new if t in olds]
    if not hits:
        print("沒有和範本完全相同的文字。")
        return
    print(f"和範本完全相同的文字共 {len(hits)} 處（逐項確認：要嘛改寫，要嘛確定是不需要更新的固定說明）：")
    for i, t in hits:
        print(f"- [{i}] {t[:120]}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
