# -*- coding: utf-8 -*-
"""市場日報：午報「個股專題」的計算與圖表產生器（只用 Python 標準函式庫）。

用法（在 C:\\Users\\User\\Desktop\\news 執行）：
  python daily/tools/stockviz.py stats  CSV
      印出：最後收盤、日漲跌、均線（5/10/20/60/120/240，簡單平均，含最後一天）與相對位置、
      52 週高低點、1/3/6 個月與今年以來報酬、20 日與 60 日均量、RSI(14)。
  python daily/tools/stockviz.py price  CSV [--days 120] [--ma 20,60,120] [--title 標題]
      輸出股價走勢圖（收盤線＋均線＋成交量）的 HTML（div.viz > svg.cv）。
  python daily/tools/stockviz.py target --cur 現價 --pts "券商A=價,券商B=價" [--avg 共識平均] [--unit 元]
      輸出目標價區間圖的 HTML；沒給 --avg 時用 pts 平均並標「自算」。
  python daily/tools/stockviz.py trend  --labels "Q1'25,Q2'25,…" [--bars "數值,…" --bar-name 營收 --bar-fmt ,.0f --bar-scale 1]
                                       [--line "數值,…" --line-name 毛利率 --line-unit %] [--line2 … --line2-name …] [--est "Q4'26 財測"]
      輸出時間序列圖：直條（下）＋折線（上），每個點直接標數字。基本面的營收、EPS、利益率、月營收一律用這個，不用橫條。
  python daily/tools/stockviz.py bars   --items "標籤=數值,標籤=數值" [--unit 億元] [--signed] [--fmt ,.0f]
      輸出長條圖 HTML（div.bars），寬度自動依最大值計算；--signed 用 div.bars.center（正負）。

CSV 欄位固定：date,open,high,low,close,volume（date 為 YYYY-MM-DD，由舊到新或新到舊都可）。
所有圖上的數字都由資料算出，不要手改 SVG 座標或寬度；要改就改資料重跑。
"""
import argparse
import csv
import html
import sys
from datetime import date


def load(path):
    rows = []
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                rows.append({
                    "date": r["date"].strip(),
                    "open": float(r["open"]), "high": float(r["high"]),
                    "low": float(r["low"]), "close": float(r["close"]),
                    "volume": float(r["volume"] or 0),
                })
            except (ValueError, KeyError):
                continue
    rows.sort(key=lambda x: x["date"])
    if not rows:
        sys.exit("CSV 沒有可用的資料列")
    return rows


def sma(vals, n, i):
    if i + 1 < n:
        return None
    return sum(vals[i + 1 - n:i + 1]) / n


def rsi(closes, n=14):
    if len(closes) <= n:
        return None
    gains = losses = 0.0
    for i in range(1, n + 1):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0)
        losses += max(-d, 0)
    ag, al = gains / n, losses / n
    for i in range(n + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        ag = (ag * (n - 1) + max(d, 0)) / n
        al = (al * (n - 1) + max(-d, 0)) / n
    if al == 0:
        return 100.0
    return 100 - 100 / (1 + ag / al)


def pct(a, b):
    return (a / b - 1) * 100


def cmd_stats(a):
    rows = load(a.csv)
    c = [r["close"] for r in rows]
    v = [r["volume"] for r in rows]
    i = len(rows) - 1
    last = rows[-1]
    print(f"資料筆數 {len(rows)}；期間 {rows[0]['date']} 至 {last['date']}")
    print(f"最後收盤 {last['close']:,.2f}（{last['date']}）")
    if i >= 1:
        print(f"日漲跌 {last['close'] - c[-2]:+,.2f}（{pct(last['close'], c[-2]):+.2f}%），前收 {c[-2]:,.2f}")
    print("均線（簡單平均，含最後一天）：")
    for n in (5, 10, 20, 60, 120, 240):
        m = sma(c, n, i)
        if m is None:
            print(f"  {n} 日：資料不足")
        else:
            prev = sma(c, n, i - 1)
            slope = "" if prev is None else ("上彎" if m > prev else "下彎" if m < prev else "持平")
            print(f"  {n} 日：{m:,.2f}；收盤在其{'上' if last['close'] >= m else '下'}方 {pct(last['close'], m):+.2f}%；{slope}")
    w = rows[-252:]
    hi = max(w, key=lambda r: r["high"])
    lo = min(w, key=lambda r: r["low"])
    print(f"52 週（最近 {len(w)} 個交易日）最高 {hi['high']:,.2f}（{hi['date']}），最低 {lo['low']:,.2f}（{lo['date']}）")
    print(f"  收盤距 52 週高點 {pct(last['close'], hi['high']):+.2f}%，距低點 {pct(last['close'], lo['low']):+.2f}%")
    for label, n in (("1 個月（21 日）", 21), ("3 個月（63 日）", 63), ("6 個月（126 日）", 126)):
        if len(c) > n:
            print(f"報酬 {label}：{pct(c[-1], c[-1 - n]):+.2f}%（基期 {rows[-1 - n]['date']} 收 {c[-1 - n]:,.2f}）")
    y = last["date"][:4]
    prev_year = [r for r in rows if r["date"][:4] < y]
    if prev_year:
        b = prev_year[-1]
        print(f"今年以來：{pct(c[-1], b['close']):+.2f}%（基期 {b['date']} 收 {b['close']:,.2f}）")
    if len(v) >= 60:
        v20 = sum(v[-20:]) / 20
        v60 = sum(v[-60:]) / 60
        print(f"20 日均量 {v20:,.0f}；60 日均量 {v60:,.0f}；最後一天量 {v[-1]:,.0f}（為 20 日均量的 {v[-1] / v20:.2f} 倍）")
    r = rsi(c)
    if r is not None:
        print(f"RSI(14，Wilder)：{r:.1f}")


def nice_ticks(lo, hi, k=4):
    span = hi - lo
    if span <= 0:
        return [lo]
    raw = span / k
    mag = 10 ** len(str(int(raw))) / 10 if raw >= 1 else 1
    for m in (1, 2, 2.5, 5, 10):
        step = m * mag
        if span / step <= k + 1:
            break
    start = (int(lo / step) + 1) * step
    out = []
    t = start
    while t < hi:
        out.append(t)
        t += step
    return out


def fmt_num(x):
    if abs(x) >= 1000:
        return f"{x:,.0f}"
    if abs(x) >= 100:
        return f"{x:,.0f}"
    return f"{x:,.1f}"


def cmd_price(a):
    rows = load(a.csv)
    c = [r["close"] for r in rows]
    mas = [int(x) for x in a.ma.split(",") if x.strip()]
    n = min(a.days, len(rows))
    s = len(rows) - n
    view = rows[s:]
    ma_series = {m: [sma(c, m, i) for i in range(s, len(rows))] for m in mas}
    vals = [r["close"] for r in view] + [x for m in mas for x in ma_series[m] if x is not None]
    lo, hi = min(vals), max(vals)
    pad = (hi - lo) * 0.06 or 1
    lo, hi = lo - pad, hi + pad
    W, H = 560, 300
    L, R, T, PB = 8, 56, 14, 204
    VT, VB = 216, 262
    pw = W - L - R

    def x(i):
        return L + (pw * i / (n - 1) if n > 1 else pw / 2)

    def y(p):
        return PB - (p - lo) / (hi - lo) * (PB - T)

    out = [f'<svg class="cv" viewBox="0 0 {W} {H}" role="img" aria-label="{html.escape(a.title)}">']
    ly_last = y(view[-1]["close"])
    for t in nice_ticks(lo, hi):
        yy = y(t)
        out.append(f'<line class="cv-grid" x1="{L}" y1="{yy:.1f}" x2="{W - R}" y2="{yy:.1f}"/>')
        if abs(yy - ly_last) > 16:  # 避免和最後價格標籤重疊
            out.append(f'<text class="cv-ax" x="{W - R + 6}" y="{yy + 4:.1f}">{fmt_num(t)}</text>')
    # 月份標籤
    lastm = None
    for i, r in enumerate(view):
        m = r["date"][:7]
        if m != lastm:
            if lastm is not None and i < n - 6:
                xx = x(i)
                out.append(f'<line class="cv-grid" x1="{xx:.1f}" y1="{T}" x2="{xx:.1f}" y2="{VB}"/>')
                out.append(f'<text class="cv-ax" x="{xx + 3:.1f}" y="{H - 10}">{int(m[5:])}月</text>')
            lastm = m
    # 成交量
    vmax = max(r["volume"] for r in view) or 1
    bw = max(pw / n * 0.7, 0.8)
    for i, r in enumerate(view):
        prev = rows[s + i - 1]["close"] if s + i >= 1 else r["open"]
        cls = "cv-vu" if r["close"] >= prev else "cv-vd"
        h = (VB - VT) * r["volume"] / vmax
        out.append(f'<rect class="{cls}" x="{x(i) - bw / 2:.1f}" y="{VB - h:.1f}" width="{bw:.1f}" height="{h:.1f}"/>')
    out.append(f'<text class="cv-ax" x="{W - R + 6}" y="{VT + 10}">量</text>')
    # 均線
    for k, m in enumerate(mas):
        pts = [f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(ma_series[m]) if v is not None]
        if len(pts) > 1:
            out.append(f'<polyline class="cv-ma{k + 1}" points="{" ".join(pts)}"/>')
    pts = [f"{x(i):.1f},{y(r['close']):.1f}" for i, r in enumerate(view)]
    out.append(f'<polyline class="cv-px" points="{" ".join(pts)}"/>')
    lx, ly = x(n - 1), y(view[-1]["close"])
    out.append(f'<circle class="cv-last" cx="{lx:.1f}" cy="{ly:.1f}" r="3.5"/>')
    lv = view[-1]["close"]
    last_lbl = f"{lv:,.2f}" if lv < 1000 else f"{lv:,.0f}"
    out.append(f'<rect class="cv-lbox" x="{W - R + 1}" y="{ly - 11:.1f}" width="{R - 1}" height="22"/>')
    out.append(f'<text class="cv-ltxt" x="{W - R / 2 + 0.5:.1f}" y="{ly + 4.5:.1f}" text-anchor="middle">{last_lbl}</text>')
    out.append("</svg>")
    leg = ['<span><i class="k-px"></i>收盤</span>']
    for k, m in enumerate(mas):
        leg.append(f'<span><i class="k-ma{k + 1}"></i>{m} 日線</span>')
    leg.append('<span><i class="k-vol"></i>成交量</span>')
    print(f'<div class="viz"><div class="viz-h">{html.escape(a.title)}</div>')
    print(f'  <div class="cv-leg">{"".join(leg)}</div>')
    print("  " + "".join(out))
    note = a.note or f"{view[0]['date']} 至 {view[-1]['date']}，{n} 個交易日；均線為簡單平均（AI 自算）。"
    print(f'  <p class="viz-note">{html.escape(note)}</p>')
    print("</div>")


def cmd_target(a):
    pts = []
    for part in a.pts.split(","):
        if "=" in part:
            k, v = part.rsplit("=", 1)
            pts.append((k.strip(), float(v)))
    if not pts:
        sys.exit("--pts 沒有資料")
    vals = [v for _, v in pts]
    avg = a.avg if a.avg is not None else sum(vals) / len(vals)
    lo_t, hi_t = min(vals), max(vals)
    lo = min(lo_t, a.cur)
    hi = max(hi_t, a.cur)
    pad = (hi - lo) * 0.08 or 1
    lo, hi = lo - pad, hi + pad
    W, H = 560, 132
    L, R = 20, 20
    Y = 70

    def x(p):
        return L + (W - L - R) * (p - lo) / (hi - lo)

    u = a.unit

    def anc(px):
        return "start" if px < 70 else ("end" if px > W - 70 else "middle")

    out = [f'<svg class="cv" viewBox="0 0 {W} {H}" role="img" aria-label="目標價區間">']
    out.append(f'<line class="cv-tr" x1="{x(lo_t):.1f}" y1="{Y}" x2="{x(hi_t):.1f}" y2="{Y}"/>')
    for name, v in pts:
        out.append(f'<circle class="cv-tp" cx="{x(v):.1f}" cy="{Y}" r="5"><title>{html.escape(name)} {v:,.0f}</title></circle>')
    out.append(f'<text class="cv-ax" x="{x(lo_t):.1f}" y="{Y + 26}" text-anchor="{anc(x(lo_t))}">最低 {lo_t:,.0f}</text>')
    out.append(f'<text class="cv-ax" x="{x(hi_t):.1f}" y="{Y + 26}" text-anchor="{anc(x(hi_t))}">最高 {hi_t:,.0f}</text>')
    cx = x(a.cur)
    out.append(f'<line class="cv-cur" x1="{cx:.1f}" y1="{Y - 30}" x2="{cx:.1f}" y2="{Y + 12}"/>')
    out.append(f'<text class="cv-tag" x="{cx:.1f}" y="{Y - 36}" text-anchor="{anc(cx)}">現價 {a.cur:,.2f}</text>')
    ax = x(avg)
    out.append(f'<path class="cv-avg" d="M{ax:.1f},{Y + 8} l-7,12 h14 z"/>')
    out.append(f'<text class="cv-tag2" x="{ax:.1f}" y="{Y + 50}" text-anchor="{anc(ax)}">平均 {avg:,.0f}</text>')
    out.append("</svg>")
    up = pct(avg, a.cur)
    src = "AI 依下表各家目標價自算" if a.avg is None else (a.src or "共識平均")
    print('<div class="viz"><div class="viz-h">' + html.escape(a.title) + '</div>')
    print('  <div class="cv-leg"><span><i class="k-cur"></i>現價</span><span><i class="k-tp"></i>各家目標價</span><span><i class="k-avg"></i>平均</span></div>')
    print("  " + "".join(out))
    print(f'  <p class="viz-note">{len(pts)} 家目標價；平均 {avg:,.0f}{u}（{html.escape(src)}），較現價 {up:+.1f}%；最低 {lo_t:,.0f}、最高 {hi_t:,.0f}{u}。</p>')
    print("</div>")


def cmd_bars(a):
    items = []
    for part in a.items.split(","):
        if "=" in part:
            k, v = part.rsplit("=", 1)
            items.append((k.strip(), float(v)))
    m = max(abs(v) for _, v in items) or 1
    cls = "bars center" if a.signed else "bars"
    print(f'<div class="{cls}">')
    for k, v in items:
        if a.signed:
            w = abs(v) / m * 50
            left = 50 if v >= 0 else 50 - w
            col = "up" if v >= 0 else "dn"
            bar = f'<span class="bf {col}" style="left:{left:.1f}%;width:{w:.1f}%"></span>'
        else:
            w = abs(v) / m * 100
            col = f" {a.color}" if a.color else ""
            bar = f'<span class="bf{col}" style="width:{w:.1f}%"></span>'
        val = format(v, a.fmt)
        if a.signed and v > 0:
            val = "+" + val
        val = val.replace("-", "−")
        print(f'  <div class="bar-row"><span class="bl">{html.escape(k)}</span><span class="bt">{bar}</span><span class="bv">{val}{a.unit}</span></div>')
    print("</div>")


def _nums(txt):
    if not txt:
        return []
    out = []
    for x in txt.split(","):
        x = x.strip()
        out.append(None if x in ("", "-", "na") else float(x))
    return out


def _fmtv(v, f):
    return format(v, f).replace("-", "−")


def cmd_trend(a):
    """時間序列圖：直條（下半）＋折線（上半），每個點直接標數字。"""
    labels = [x.strip() for x in a.labels.split(",")]
    n = len(labels)
    bars = _nums(a.bars)
    lines = [(_nums(a.line), a.line_name, "cv-ln1", "cv-ll1"), (_nums(a.line2), a.line2_name, "cv-ln2", "cv-ll2")]
    lines = [l for l in lines if l[0]]
    for seq in [bars] + [l[0] for l in lines]:
        if seq and len(seq) != n:
            sys.exit("數值個數和 --labels 不一致")
    est = set(x.strip() for x in a.est.split(",") if x.strip())
    W, H = 560, 300
    L, R = 14, 14
    pw = W - L - R
    step = pw / n

    def cx(i):
        return L + step * (i + 0.5)

    # 版面：有直條又有折線時，折線在上、直條在下
    if bars and lines:
        LT, LB, BT, BB = 26, 96, 136, 262
    elif bars:
        LT = LB = None
        BT, BB = 30, 262
    else:
        LT, LB, BT, BB = 30, 250, None, None
    dense = n > 8
    out = [f'<svg class="cv" viewBox="0 0 {W} {H}" role="img" aria-label="{html.escape(a.title)}">']
    # x 軸標籤
    for i, lab in enumerate(labels):
        if dense and (n - 1 - i) % 2:
            continue
        out.append(f'<text class="cv-ax" x="{cx(i):.1f}" y="{H - 10}" text-anchor="middle">{html.escape(lab)}</text>')
    if bars:
        vals = [v for v in bars if v is not None]
        bmax = max(vals) if vals else 1
        bmin = min(0, min(vals)) if vals else 0
        span = (bmax - bmin) or 1

        def by(v):
            return BB - (v - bmin) / span * (BB - BT - 18)

        out.append(f'<line class="cv-grid" x1="{L}" y1="{by(0):.1f}" x2="{W - R}" y2="{by(0):.1f}"/>')
        bw = step * (0.5 if dense else 0.58)
        for i, v in enumerate(bars):
            if v is None:
                continue
            y0, y1 = by(0), by(v)
            top, h = min(y0, y1), abs(y0 - y1)
            cls = "cv-col est" if labels[i] in est else ("cv-col last" if i == n - 1 else "cv-col")
            out.append(f'<rect class="{cls}" x="{cx(i) - bw / 2:.1f}" y="{top:.1f}" width="{bw:.1f}" height="{max(h, 0.5):.1f}"/>')
            if not dense or (n - 1 - i) % 2 == 0 or i == n - 1:
                ty = top - 5 if v >= 0 else top + h + 13
                out.append(f'<text class="cv-vl" x="{cx(i):.1f}" y="{ty:.1f}" text-anchor="middle">{_fmtv(v / a.bar_scale, a.bar_fmt)}</text>')
    if lines:
        allv = [v for l in lines for v in l[0] if v is not None]
        lo, hi = min(allv), max(allv)
        pad = (hi - lo) * 0.15 or abs(hi) * 0.1 or 1
        lo, hi = lo - pad, hi + pad

        def ly(v):
            return LB - (v - lo) / (hi - lo) * (LB - LT)

        for k, (seq, name, lcls, tcls) in enumerate(lines):
            pts = [(cx(i), ly(v)) for i, v in enumerate(seq) if v is not None]
            out.append(f'<polyline class="{lcls}" points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in pts)}"/>')
            for i, v in enumerate(seq):
                if v is None:
                    continue
                out.append(f'<circle class="{lcls}p" cx="{cx(i):.1f}" cy="{ly(v):.1f}" r="3"/>')
                if dense and (n - 1 - i) % 2 and i != n - 1:
                    continue
                other = lines[1 - k][0][i] if len(lines) == 2 else None
                dy = -8 if (other is None or v > other or (v == other and k == 0)) else 15  # 兩條線時，較高的標在上方、較低的標在下方
                out.append(f'<text class="{tcls}" x="{cx(i):.1f}" y="{ly(v) + dy:.1f}" text-anchor="middle">{_fmtv(v, a.line_fmt)}{a.line_unit}</text>')
    out.append("</svg>")
    leg = []
    if bars:
        leg.append(f'<span><i class="k-col"></i>{html.escape(a.bar_name)}</span>')
        if est:
            leg.append('<span><i class="k-est"></i>預估或財測</span>')
    for k, (seq, name, lcls, tcls) in enumerate(lines):
        leg.append(f'<span><i class="k-ln{k + 1}"></i>{html.escape(name)}</span>')
    print(f'<div class="viz"><div class="viz-h">{html.escape(a.title)}</div>')
    print(f'  <div class="cv-leg">{"".join(leg)}</div>')
    print("  " + "".join(out))
    if a.note:
        print(f'  <p class="viz-note">{html.escape(a.note)}</p>')
    print("</div>")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("stats"); s.add_argument("csv")
    s = sp.add_parser("price"); s.add_argument("csv"); s.add_argument("--days", type=int, default=120)
    s.add_argument("--ma", default="20,60,120"); s.add_argument("--title", default="股價走勢"); s.add_argument("--note", default="")
    s = sp.add_parser("target"); s.add_argument("--cur", type=float, required=True); s.add_argument("--pts", required=True)
    s.add_argument("--avg", type=float); s.add_argument("--src", default=""); s.add_argument("--unit", default="")
    s.add_argument("--title", default="市場預期目標價")
    s = sp.add_parser("bars"); s.add_argument("--items", required=True); s.add_argument("--unit", default="")
    s.add_argument("--signed", action="store_true"); s.add_argument("--fmt", default=",.0f"); s.add_argument("--color", default="")
    s = sp.add_parser("trend"); s.add_argument("--labels", required=True); s.add_argument("--bars", default="")
    s.add_argument("--bar-name", default=""); s.add_argument("--bar-fmt", default=",.0f"); s.add_argument("--bar-scale", type=float, default=1)
    s.add_argument("--line", default=""); s.add_argument("--line-name", default=""); s.add_argument("--line2", default="")
    s.add_argument("--line2-name", default=""); s.add_argument("--line-fmt", default=".1f"); s.add_argument("--line-unit", default="")
    s.add_argument("--est", default=""); s.add_argument("--title", default=""); s.add_argument("--note", default="")
    a = p.parse_args()
    {"stats": cmd_stats, "price": cmd_price, "target": cmd_target, "bars": cmd_bars, "trend": cmd_trend}[a.cmd](a)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
