# -*- coding: utf-8 -*-
"""市場日報：由腳本輸出（official-tw-*.md、official-us-*.md）直接產生報告用的表格 HTML，主筆不用手打數字。

用法（在 C:\\Users\\User\\Desktop\\news 執行）：
  python daily/tools/snapshot.py am-table --tw _research/D/official-tw-前一交易日.md --us _research/D/official-us-D.md --night D
      早報總覽的「行情快照」表（股市；利率、匯率、商品）。--night 是夜盤標的日期（早報＝報告日 D）。
  python daily/tools/snapshot.py pm-kpis --tw _research/D/official-tw-D.md
      午報總覽的數據列（加權、成交金額、三大法人、外資台指期淨空、台指期近月、漲跌家數）。

規則：
- 美債殖利率（口徑是 CNBC）與新台幣官方收盤（台北外匯經紀 16:00）腳本沒有，會輸出「【待填】」，主筆一定要填，發布前全文不可留下「【待」。
- 腳本寫「尚未公布」「抓取失敗」的項目會輸出「【待確認】」。
- 產生後只可以補說明文字，不要改數字；要改數字就先查是不是腳本錯了。
"""
import argparse
import re
import sys


def sections(path):
    """把 Markdown 依「## 」切節，每節取第一張表（list of dict）與全文。"""
    txt = open(path, encoding="utf-8").read()
    out = {}
    for blk in re.split(r"^## ", txt, flags=re.M)[1:]:
        title, body = blk.split("\n", 1)
        key = title.split(" ")[0].rstrip(".")
        rows, hdr = [], None
        for line in body.splitlines():
            if not line.startswith("|"):
                if rows:
                    break
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if hdr is None:
                hdr = cells
            elif set(line.replace("|", "").strip()) <= set("-: "):
                continue
            else:
                rows.append(dict(zip(hdr, cells)))
        out[key] = {"title": title, "rows": rows, "text": body}
    return out


def num(s):
    s = (s or "").replace(",", "").replace("−", "-").replace("%", "").replace("+", "").strip()
    m = re.match(r"^-?\d+(\.\d+)?", s)
    return float(m.group(0)) if m else None


def cls(v):
    x = num(v)
    if x is None or x == 0:
        return "num"
    return "num up" if x > 0 else "num dn"


def flat(v):
    x = num(v)
    return "flat" if not x else ("up" if x > 0 else "dn")


def md(s):
    return s.replace("-", "−") if s and s[0] == "-" else s


def us_rows(path):
    rows = {}
    for sec in sections(path).values():
        for r in sec["rows"]:
            if "名稱" in r:
                rows[r["名稱"]] = r
    return rows


def am_table(a):
    tw = sections(a.tw)
    us = us_rows(a.us)
    out = []

    def row(name, val, d, w, date, color=True):
        out.append(f'        <tr><td>{name}</td><td class="num">{val}</td><td class="{cls(d) if color else "num"}">{d}</td>'
                   f'<td class="{cls(w) if color else "num"}">{w}</td><td class="nw">{date}</td></tr>')

    out.append('    <div class="tbl"><table>')
    out.append('      <thead><tr><th>項目</th><th class="num">最新</th><th class="num">日變動</th><th class="num">週變動</th><th>日期</th></tr></thead>')
    out.append("      <tbody>")
    out.append('        <tr class="grp"><td colspan="5">股市</td></tr>')
    t1 = tw.get("1", {}).get("rows", [])
    if t1:
        last = t1[-1]
        wk = t1[-6] if len(t1) >= 6 else None
        wchg = f"{(num(last['收盤']) / num(wk['收盤']) - 1) * 100:+.2f}%".replace("-", "−") if wk else "—"
        row("台灣加權指數", last["收盤"], last["漲跌幅"], wchg, f"{int(last['日期'][5:7])}/{int(last['日期'][8:])}")
    else:
        row("台灣加權指數", "【待確認】", "", "", "")
    t7 = tw.get("7", {}).get("rows", [])
    if t7:
        last = t7[-1]
        row("櫃買指數", last["櫃買指數"], last.get("漲跌幅") or "【待確認】", "—", f"{int(last['日期'][5:7])}/{int(last['日期'][8:])}")
    night = [r for r in tw.get("8", {}).get("rows", []) if r.get("時段") == "盤後" and r.get("交易日期", "").replace("/", "-") == a.night]
    if night:
        r = night[0]
        row(f"台指期夜盤（{int(r['月份'][4:])} 月）", f"{int(r['收盤']):,}", md(f"{int(r['漲跌']):+,}"), "—", f"{int(a.night[5:7])}/{int(a.night[8:])} 05:00")
    else:
        row("台指期夜盤", "【待確認】", "", "", "")
    for name, label in (("S&P 500", "S&amp;P 500"), ("Nasdaq 綜合", "Nasdaq 綜合"), ("道瓊", "道瓊"), ("費城半導體", "費城半導體"),
                        ("台積電 ADR", "台積電 ADR（美元）"), ("日經 225", "日經 225"), ("KOSPI", "KOSPI")):
        r = us.get(name)
        if not r or r.get("價格") in (None, ""):
            row(label, "【待確認】", "", "", "")
            continue
        dt = r["資料時間"].split(" ")[0]
        row(label, r["價格"], r["日漲跌"], r["週漲跌"], f"{int(dt[5:7])}/{int(dt[8:10])}")
    out.append('        <tr class="grp"><td colspan="5">利率、匯率、商品</td></tr>')
    for name, label in (("10 年", "美債 10 年"), ("2 年", "美債 2 年")):  # usdata.py 已輸出 CNBC 日線收盤
        r = us.get(name)
        if not r or r.get("價格") in (None, "") or "CNBC 日線收盤" not in r.get("備註", ""):
            row(label, "【待填：CNBC 日線收盤】", "【待填】", "—", "【待填】", color=False)
            continue
        dt = r["資料時間"].split(" ")[0]
        row(label, r["價格"] + "%", r["日漲跌"].replace(" bp", "bp"), r["週漲跌"].replace(" bp", "bp"), f"{int(dt[5:7])}/{int(dt[8:10])}", color=False)
    for name, label, color in (("美元指數", "美元指數", False), ("美元兌日圓", "美元／日圓", False), ("布蘭特原油", "布蘭特原油", True),
                               ("WTI 原油", "WTI 原油", True), ("黃金", "黃金", True), ("比特幣", "比特幣", True), ("VIX", "VIX", True)):
        r = us.get(name)
        if not r or r.get("價格") in (None, ""):
            row(label, "【待確認】", "", "", "", color)
            continue
        dt = r["資料時間"]
        when = dt.replace(" 台北", "") if "台北" in dt else f"{int(dt[5:7])}/{int(dt[8:10])}"
        d = r["日漲跌"] + ("（24 小時）" if "台北" in dt else "")
        row(label, r["價格"], d, r["週漲跌"], when, color)
    row("美元／新台幣", "【待填：16:00 官方收盤】", "【待填】", "—", "【待填】", color=False)
    out.append("      </tbody>")
    out.append("    </table></div>")
    out.append('    <p class="cap">資料來源：證交所、櫃買中心、期交所、Yahoo Finance（twdata.py、usdata.py）；美債殖利率為 CNBC 日線收盤（美東約 15:00）；新台幣為台北外匯經紀 16:00 收盤。'
               '商品、匯率為台北 07:00 的價格，日變動和 24 小時前比、週變動和約 7 天前比；其他項目的週變動和 5 個交易日前的收盤比。</p>')
    print("\n".join(out))


def pm_kpis(a):
    tw = sections(a.tw)
    head = open(a.tw, encoding="utf-8").readline()
    m = re.search(r"台股官方資料 (\d{4}-\d{2}-\d{2})", head)
    D = m.group(1) if m else None
    t1, tb = tw.get("1", {}).get("rows", []), tw.get("1b", {}).get("rows", [])
    t4, t9 = tw.get("4", {}).get("rows", []), tw.get("9", {}).get("rows", [])
    t8 = [r for r in tw.get("8", {}).get("rows", []) if r.get("時段") == "一般"]
    s2 = tw.get("2", {}).get("text", "")
    t2 = tw.get("2", {}).get("rows", [])
    k = []

    def kpi(l, v, c, n, vcls=""):
        k.append(f'    <div class="kpi"><div class="k-l">{l}</div><div class="k-v{(" " + vcls) if vcls else ""}">{v}</div>'
                 f'<div class="k-c {c[1]}">{c[0]}</div><div class="k-n">{n}</div></div>')

    if t1 and t1[-1]["日期"] != D:
        kpi("加權指數", "【待確認】", (f"{D} 尚未公布", "flat"), f"最新一筆是 {t1[-1]['日期']}")
        t1 = []
    if t1:
        last, prev = t1[-1], (t1[-2] if len(t1) > 1 else None)
        hl = f"低 {tb[-1]['最低']}／高 {tb[-1]['最高']}" if tb and tb[-1]["日期"] == last["日期"] else "【待確認】開高低"
        kpi("加權指數", last["收盤"], (f"{last['漲跌']}（{last['漲跌幅']}）", flat(last["漲跌"])), hl)
        amt = num(last["成交金額（億元，證交所總計）"])
        cmp = f"比前一交易日{'多' if amt >= num(prev['成交金額（億元，證交所總計）']) else '少'}約 {abs(amt / num(prev['成交金額（億元，證交所總計）']) - 1) * 100:.1f}%" if prev else ""
        normal = re.search(r"一般股票：成交金額 ([\d,.]+) 億元", s2)
        late = "抓取時間晚於截止時間超過 30 分鐘" in open(a.tw, encoding="utf-8").read()
        kpi("成交金額", f"{last['成交金額（億元，證交所總計）']} 億", ("證交所總計口徑", "flat"),
            ("【待確認】腳本抓取晚於截止，可能已被修正；" if late else "") + cmp + (f"；一般股票 {normal.group(1)} 億" if normal else ""))
    if t4 and t4[-1].get("日期") == D and "尚未公布" not in t4[-1].get("外資", "") and "抓取失敗" not in t4[-1].get("外資", ""):
        r = t4[-1]
        late = "抓取時間晚於截止時間超過 30 分鐘" in open(a.tw, encoding="utf-8").read()
        kpi("三大法人", f"{r['三大法人合計']} 億", (f"外資 {r['外資']}", "flat"),
            ("【待確認】腳本抓取晚於截止，可能已是修正版，要改用 15:30 前的版本" if late else "證交所 15:30 前初版")
            + f"；投信 {r['投信']}／自營 {r['自營商合計']}", vcls=cls(r["三大法人合計"]).replace("num ", ""))
    else:
        kpi("三大法人", "【待確認】", ("15:30 時尚未公布", "flat"), "")
    if len(t9) >= 2 and t9[-1].get("日期") == D and "尚未公布" not in t9[-1]["外資淨未平倉"] and "抓取失敗" not in t9[-1]["外資淨未平倉"]:
        a_, b_ = num(t9[-1]["外資淨未平倉"]), num(t9[-2]["外資淨未平倉"])
        ch = a_ - b_
        word = "減" if (a_ < 0 and ch > 0) or (a_ > 0 and ch < 0) else "增"
        prevd = t9[-2]["日期"]
        good = (a_ - b_) > 0  # 淨部位往多方移動＝偏多（紅）
        kpi("外資台指期淨空" if a_ < 0 else "外資台指期淨多", f"{abs(a_):,.0f} 口",
            (f"較 {int(prevd[5:7])}/{int(prevd[8:10])} {word} {abs(ch):,.0f} 口", "flat" if ch == 0 else ("up" if good else "dn")),
            f"投信淨{'多' if num(t9[-1]['投信淨未平倉']) > 0 else '空'} {abs(num(t9[-1]['投信淨未平倉'])):,.0f} 口")
    else:
        kpi("外資台指期淨空", "【待確認】", ("期交所尚未公布", "flat"), "")
    if t8 and t8[-1]["交易日期"].replace("/", "-") != D:
        kpi("台指期近月", "【待確認】", (f"{D} 一般時段尚未公布", "flat"), "")
        t8 = []
    if t8:
        lastd = t8[-1]["交易日期"]
        near = [r for r in t8 if r["交易日期"] == lastd][0]
        kpi(f"台指期 {int(near['月份'][4:])} 月", f"{int(near['收盤']):,}", (md(f"{int(near['漲跌']):+,}") + "（較前日結算價）", flat(near["漲跌"])),
            f"結算價 {int(near['結算價']):,}；未沖銷 {int(near['未沖銷']):,} 口")
    up = next((r for r in t2 if r.get("類型", "").startswith("上漲")), None)
    dn = next((r for r in t2 if r.get("類型", "").startswith("下跌")), None)
    if not (up and dn) or "尚未公布" in s2 or "抓取失敗" in s2:
        kpi("漲跌家數（上市股票）", "【待確認】", ("尚未公布或抓取失敗", "flat"), "")
        up = dn = None
    if up and dn:
        pu, pd = re.match(r"([\d,]+)\(([\d,]+)\)", up["股票"]), re.match(r"([\d,]+)\(([\d,]+)\)", dn["股票"])
        kpi("漲跌家數（上市股票）", f"{pu.group(1)}／{pd.group(1)}", (f"漲停 {pu.group(2)}／跌停 {pd.group(2)}", "flat"), "證交所")
    print('  <div class="kpis">\n' + "\n".join(k) + "\n  </div>")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("am-table"); s.add_argument("--tw", required=True); s.add_argument("--us", required=True); s.add_argument("--night", required=True)
    s = sp.add_parser("pm-kpis"); s.add_argument("--tw", required=True)
    a = p.parse_args()
    {"am-table": am_table, "pm-kpis": pm_kpis}[a.cmd](a)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
