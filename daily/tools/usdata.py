# -*- coding: utf-8 -*-
"""市場日報：美股、利率、匯率、商品、亞股行情一次抓完（Yahoo Finance chart API；個股另用 Nasdaq 交叉比對）。

用法（在 C:\\Users\\User\\Desktop\\news 執行）：
  python daily/tools/usdata.py quotes --cutoff "YYYY-MM-DD HH:MM" [--out _research/YYYY-MM-DD] [--extra "代號=名稱,…"]
      主要指數、Mag 7 與 AI 股、台積電 ADR、美債殖利率、美元與匯率、原油黃金銅、比特幣、亞股。
      每項列出最後一個完整交易日的收盤、日／週漲跌、今年以來，以及資料日期。
      --cutoff 是台北時間的截止時間（早報 07:00、午報 15:30）：最後一筆在截止後才成交的，會被排除並註明。
  python daily/tools/usdata.py stock 代號 --until YYYY-MM-DD [--out 資料夾]
      美股個股近 14 個月日資料，存成 px-us-代號.csv（到 --until 為止）；最近 10 天收盤和 Nasdaq 交叉比對。

輸出：Markdown 印到螢幕，並存成 out 資料夾裡的 official-us-YYYYMMDD.md（或 stock-us-代號.md）。
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

TPE = timezone(timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "application/json"}
OUT = []

GROUPS = [
    ("美股指數", [("^GSPC", "S&P 500"), ("^IXIC", "Nasdaq 綜合"), ("^DJI", "道瓊"), ("^RUT", "羅素 2000"), ("^SOX", "費城半導體"), ("^VIX", "VIX")]),
    ("美股期貨（電子盤）", [("ES=F", "S&P 500 期貨"), ("NQ=F", "Nasdaq 100 期貨"), ("YM=F", "道瓊期貨")]),
    ("AI 與大型科技股", [("NVDA", "輝達"), ("TSM", "台積電 ADR"), ("AAPL", "蘋果"), ("MSFT", "微軟"), ("GOOGL", "Alphabet"), ("AMZN", "亞馬遜"),
                        ("META", "Meta"), ("AVGO", "博通"), ("AMD", "AMD"), ("TSLA", "特斯拉"), ("MU", "美光"), ("ORCL", "甲骨文")]),
    ("美債殖利率（%）", [("^IRX", "3 個月"), ("^FVX", "5 年"), ("^TNX", "10 年"), ("^TYX", "30 年")]),
    ("美元與匯率", [("DX-Y.NYB", "美元指數"), ("TWD=X", "美元兌新台幣"), ("JPY=X", "美元兌日圓"), ("KRW=X", "美元兌韓元"), ("CNY=X", "美元兌人民幣"), ("EURUSD=X", "歐元兌美元")]),
    ("商品與加密資產", [("CL=F", "WTI 原油"), ("BZ=F", "布蘭特原油"), ("NG=F", "天然氣"), ("GC=F", "黃金"), ("HG=F", "銅"), ("BTC-USD", "比特幣")]),
    ("亞股", [("^TWII", "台灣加權"), ("^N225", "日經 225"), ("^KS11", "KOSPI"), ("000001.SS", "上證"), ("399006.SZ", "創業板"), ("^HSI", "恆生")]),
]


def emit(s=""):
    OUT.append(s)


def fetch(url, headers=UA):
    for k in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:  # noqa
            time.sleep(2 + 2 * k)
    return None


def chart(sym, rng="1y"):
    j = fetch(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range={rng}&interval=1d")
    try:
        r = j["chart"]["result"][0]
    except (TypeError, KeyError, IndexError):
        return None, None
    tz = timezone(timedelta(seconds=r["meta"].get("gmtoffset", 0)))
    q = r["indicators"]["quote"][0]
    bars = []
    for i, t in enumerate(r.get("timestamp") or []):
        c = q["close"][i]
        if c is None:
            continue
        bars.append({"date": datetime.fromtimestamp(t, tz).date(), "open": q["open"][i], "high": q["high"][i],
                     "low": q["low"][i], "close": c, "volume": q["volume"][i] or 0})
    return r["meta"], bars


def f2(v, d=2):
    return "—" if v is None else f"{v:,.{d}f}".replace("-", "−")


def pc(a, b):
    return None if (a is None or not b) else (a / b - 1) * 100


def sg(v, d=2, unit="%"):
    return "—" if v is None else ("+" if v > 0 else "") + f2(v, d) + unit


def quotes(cutoff, extra):
    emit(f"# 美股與跨資產行情（usdata.py 產生，{datetime.now(TPE):%Y-%m-%d %H:%M} 台北抓取；截止 {cutoff:%Y-%m-%d %H:%M} 台北）\n")
    emit("來源：Yahoo Finance chart API（https://query1.finance.yahoo.com/v8/finance/chart/代號）。"
         "「資料日」是該市場當地的交易日。殖利率欄位是殖利率（%），漲跌用基點（bp）。\n")
    groups = list(GROUPS)
    if extra:
        groups.append(("其他", [tuple(x.split("=", 1)) for x in extra.split(",") if "=" in x]))
    for title, items in groups:
        y = "殖利率" in title
        emit(f"## {title}\n")
        emit("| 名稱 | 代號 | 資料日 | 收盤 | 日漲跌 | 週漲跌（5 日） | 今年以來 | 備註 |\n|---|---|---|---|---|---|---|---|")
        for sym, name in items:
            meta, bars = chart(sym)
            if not bars:
                emit(f"| {name} | {sym} | 查無 | | | | | 抓取失敗 |")
                continue
            note = ""
            rmt = meta.get("regularMarketTime")
            if rmt and datetime.fromtimestamp(rmt, TPE) > cutoff and bars and bars[-1]["date"] == datetime.fromtimestamp(rmt, timezone(timedelta(seconds=meta.get("gmtoffset", 0)))).date():
                bars = bars[:-1]
                note = "最新一筆在截止後，已排除"
            if len(bars) < 2:
                emit(f"| {name} | {sym} | 查無 | | | | | {note} |")
                continue
            last, prev = bars[-1], bars[-2]
            wk = bars[-6] if len(bars) >= 6 else None
            ybase = next((b for b in reversed(bars) if b["date"].year < last["date"].year), None)
            if y:
                dchg = sg((last["close"] - prev["close"]) * 100, 1, " bp")
                wchg = sg((last["close"] - wk["close"]) * 100, 1, " bp") if wk else "—"
                ytd = sg((last["close"] - ybase["close"]) * 100, 1, " bp") if ybase else "—"
                cl = f2(last["close"], 3)
            else:
                dchg = sg(pc(last["close"], prev["close"]))
                wchg = sg(pc(last["close"], wk["close"])) if wk else "—"
                ytd = sg(pc(last["close"], ybase["close"])) if ybase else "—"
                cl = f2(last["close"], 4 if last["close"] < 10 else 2)
            emit(f"| {name} | {sym} | {last['date']} | {cl} | {dchg} | {wchg} | {ytd} | {note} |")
            time.sleep(0.3)
        emit("")
    emit("截止判斷：最後成交時間晚於截止時間、而且是當天的那一筆（盤中或截止後的價格）會被排除；匯率與期貨的日線收盤時間和台北截止時間可能差一兩個小時，引用時寫「資料日」即可。")
    emit("注意：期貨與加密資產是 24 小時交易，「收盤」是 Yahoo 的日線收盤；引用時寫明資料日與時間。美債 2 年期 Yahoo 沒有，請另查（例如 CNBC、美國財政部）。")


def nasdaq_closes(sym, start, end):
    url = (f"https://api.nasdaq.com/api/quote/{sym}/historical?assetclass=stocks&fromdate={start}&todate={end}&limit=60")
    # Nasdaq 會擋 Python 內建的連線，改用 curl
    import subprocess
    try:
        txt = subprocess.run(["curl", "-s", "-m", "25", url, "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                              "(KHTML, like Gecko) Chrome/120.0 Safari/537.36", "-H", "Accept: application/json, text/plain, */*",
                              "-H", "Accept-Language: en-US,en;q=0.9"], capture_output=True, timeout=40).stdout.decode("utf-8", "replace")
        j = json.loads(txt)
    except Exception:  # noqa
        j = None
    try:
        rows = j["data"]["tradesTable"]["rows"]
    except (TypeError, KeyError):
        return {}
    out = {}
    for r in rows:
        d = datetime.strptime(r["date"], "%m/%d/%Y").date()
        out[d] = float(r["close"].replace("$", "").replace(",", ""))
    return out


def stock(sym, until, outdir):
    meta, bars = chart(sym, "2y")
    emit(f"# 美股個股資料 {sym}（usdata.py 產生，{datetime.now(TPE):%Y-%m-%d %H:%M} 台北抓取；到 {until}）\n")
    if not bars:
        emit("抓取失敗。")
        return
    start = until - timedelta(days=420)
    bars = [b for b in bars if start <= b["date"] <= until]
    p = os.path.join(outdir, f"px-us-{sym}.csv")
    with open(p, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "open", "high", "low", "close", "volume"])
        for b in bars:
            w.writerow([b["date"].isoformat(), round(b["open"], 4), round(b["high"], 4), round(b["low"], 4), round(b["close"], 4), b["volume"]])
    last, prev = bars[-1], bars[-2]
    emit(f"{meta.get('longName') or meta.get('shortName') or sym}（{meta.get('fullExchangeName', '')}）；{len(bars)} 筆，{bars[0]['date']} 至 {last['date']}，存成 `{p}`。")
    emit(f"最後一筆：{last['date']} 開 {f2(last['open'])} 高 {f2(last['high'])} 低 {f2(last['low'])} 收 {f2(last['close'])}，量 {last['volume']:,} 股；"
         f"前收 {f2(prev['close'])}，漲跌 {sg(last['close'] - prev['close'], 2, '')}（{sg(pc(last['close'], prev['close']))}）。")
    emit(f"52 週高低、均線、報酬請跑 `python daily/tools/stockviz.py stats {p.replace(chr(92), '/')}`。\n")
    nd = nasdaq_closes(sym, (until - timedelta(days=20)).isoformat(), until.isoformat())
    if nd:
        emit("## 和 Nasdaq 收盤交叉比對（最近 10 天）\n\n| 日期 | Yahoo | Nasdaq | 差 |\n|---|---|---|---|")
        for b in bars[-10:]:
            n = nd.get(b["date"])
            emit(f"| {b['date']} | {f2(b['close'])} | {f2(n)} | {f2(None if n is None else b['close'] - n)} |")
    else:
        emit("Nasdaq 交叉比對：抓取失敗，請另找一個來源抽查收盤。")
    emit("\n來源：Yahoo Finance chart API；Nasdaq historical API（https://api.nasdaq.com/api/quote/代號/historical）。價格已依股票分割調整。")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("quotes"); s.add_argument("--cutoff", required=True); s.add_argument("--out"); s.add_argument("--extra", default="")
    s = sp.add_parser("stock"); s.add_argument("sym"); s.add_argument("--until", required=True); s.add_argument("--out")
    a = p.parse_args()
    if a.cmd == "quotes":
        cut = datetime.strptime(a.cutoff, "%Y-%m-%d %H:%M").replace(tzinfo=TPE)
        out = a.out or os.path.join("_research", cut.date().isoformat())
        os.makedirs(out, exist_ok=True)
        quotes(cut, a.extra)
        fn = os.path.join(out, f"official-us-{cut:%Y%m%d}.md")
    else:
        until = datetime.strptime(a.until, "%Y-%m-%d").date()
        out = a.out or "."
        os.makedirs(out, exist_ok=True)
        stock(a.sym, until, out)
        fn = os.path.join(out, f"stock-us-{a.sym}.md")
    txt = "\n".join(OUT) + "\n"
    with open(fn, "w", encoding="utf-8") as f:
        f.write(txt)
    print(txt)
    print(f"（已存成 {fn}）")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
