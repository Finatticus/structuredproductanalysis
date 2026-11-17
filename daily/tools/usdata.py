# -*- coding: utf-8 -*-
"""市場日報：美股、利率、匯率、商品、歐股、亞股行情一次抓完（Yahoo Finance chart API；個股另用 Nasdaq 交叉比對）。

用法（在 C:\\Users\\User\\Desktop\\news 執行，一律用 Bash 工具，timeout 設 600000 或在背景執行）：
  python daily/tools/usdata.py quotes --cutoff "YYYY-MM-DD HH:MM" [--out _research/YYYY-MM-DD] [--extra "代號=名稱,…"]
      --cutoff 是台北時間的截止時間（早報 07:00、午報 15:30）。
      - 有固定收盤時間的市場（股票、指數）：只列「截止前已經收盤」的最後一個交易日；截止時還在盤中或截止後才收盤的那一天會排除。
      - 24 小時交易的商品（期貨、匯率、比特幣、美元指數）：列「截止時的價格」（15 分鐘線，取截止前最後一根），
        日漲跌是和 24 小時前比，週漲跌是和約 7 天前比。
  python daily/tools/usdata.py stock 代號 --cutoff "YYYY-MM-DD HH:MM" [--out 資料夾]
      美股個股近 14 個月日資料，存成 px-us-代號.csv，只到截止前已經收盤的最後一個交易日；最近 10 天收盤和 Nasdaq 交叉比對。

輸出：Markdown 印到螢幕，並存成 out 資料夾裡的 official-us-YYYYMMDD.md（或 stock-us-代號.md）。每一節完成就寫一次檔。
"""
import argparse
import csv
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

TPE = timezone(timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "application/json"}
OUT = []
FN = [None]

GROUPS = [
    ("美股指數", [("^GSPC", "S&P 500"), ("^IXIC", "Nasdaq 綜合"), ("^DJI", "道瓊"), ("^RUT", "羅素 2000"), ("^SOX", "費城半導體"), ("^VIX", "VIX")]),
    ("美股期貨（電子盤，截止時價格）", [("ES=F", "S&P 500 期貨"), ("NQ=F", "Nasdaq 100 期貨"), ("YM=F", "道瓊期貨")]),
    ("AI 與大型科技股", [("NVDA", "輝達"), ("TSM", "台積電 ADR"), ("AAPL", "蘋果"), ("MSFT", "微軟"), ("GOOGL", "Alphabet"), ("AMZN", "亞馬遜"),
                        ("META", "Meta"), ("AVGO", "博通"), ("AMD", "AMD"), ("TSLA", "特斯拉"), ("MU", "美光"), ("ORCL", "甲骨文")]),
    ("美債殖利率（%，CBOE 指數，參考用）", [("^IRX", "3 個月"), ("^FVX", "5 年"), ("^TNX", "10 年"), ("^TYX", "30 年")]),
    ("美元與匯率（截止時價格）", [("DX-Y.NYB", "美元指數"), ("TWD=X", "美元兌新台幣（國際報價）"), ("JPY=X", "美元兌日圓"), ("KRW=X", "美元兌韓元"),
                          ("CNY=X", "美元兌人民幣"), ("EURUSD=X", "歐元兌美元")]),
    ("商品與加密資產（截止時價格）", [("CL=F", "WTI 原油"), ("BZ=F", "布蘭特原油"), ("NG=F", "天然氣"), ("GC=F", "黃金"), ("HG=F", "銅"), ("BTC-USD", "比特幣")]),
    ("歐股", [("^STOXX50E", "歐洲 STOXX 50"), ("^GDAXI", "德國 DAX"), ("^FTSE", "英國 FTSE 100"), ("^FCHI", "法國 CAC 40")]),
    ("亞股", [("^TWII", "台灣加權"), ("^N225", "日經 225"), ("^KS11", "KOSPI"), ("^KQ11", "KOSDAQ"), ("000001.SS", "上證"),
             ("^HSI", "恆生"), ("^NSEI", "印度 Nifty 50")]),  # 創業板、科創 50 在 Yahoo 資料不穩，交給子代理
    ("日韓重點個股", [("8035.T", "東京威力"), ("6857.T", "愛德萬"), ("9984.T", "軟銀集團"), ("000660.KS", "SK 海力士"), ("005930.KS", "三星電子")]),
]


def emit(s=""):
    OUT.append(s)


def flush():
    if FN[0]:
        with open(FN[0], "w", encoding="utf-8") as f:
            f.write("\n".join(OUT) + "\n")


def fetch(url, headers=UA):
    for k in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:  # noqa
            time.sleep(2 + 2 * k)
    return None


def chart(sym, rng="1y", interval="1d"):
    j = fetch(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range={rng}&interval={interval}")
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
        bars.append({"ts": t, "date": datetime.fromtimestamp(t, tz).date(), "open": q["open"][i], "high": q["high"][i],
                     "low": q["low"][i], "close": c, "volume": q["volume"][i] or 0})
    return r["meta"], bars


def completed(meta, bars, cutoff):
    """只留「截止前已經收盤」的日線。回傳 (bars, 備註)。"""
    if not bars:
        return bars, ""
    xtz = timezone(timedelta(seconds=meta.get("gmtoffset", 0)))
    reg = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    if reg.get("start") and bars[-1]["date"] == datetime.fromtimestamp(reg["start"], xtz).date():
        if reg["end"] > cutoff.timestamp() or reg["end"] > time.time():
            return bars[:-1], "最新交易日在截止時尚未收盤，改列前一個收盤"
        return bars, ""
    # 最後一根不是 Yahoo 目前標示的交易時段：用最後成交時間判斷
    rmt = meta.get("regularMarketTime")
    if rmt and datetime.fromtimestamp(rmt, xtz).date() == bars[-1]["date"] and rmt > cutoff.timestamp():
        return bars[:-1], "最新一筆在截止後，已排除"
    return bars, ""


def is24(sym):
    return sym.endswith(("=X", "=F", "-USD")) or sym == "DX-Y.NYB"


def f2(v, d=2):
    return "—" if v is None else f"{v:,.{d}f}".replace("-", "−")


def pc(a, b):
    return None if (a is None or not b) else (a / b - 1) * 100


def sg(v, d=2, unit="%"):
    return "—" if v is None else ("+" if v > 0 else "") + f2(v, d) + unit


def row24(sym, name, cutoff):
    meta, m15 = chart(sym, "5d", "15m")
    _, daily = chart(sym, "1y", "1d")
    ct = cutoff.timestamp()
    m15 = [b for b in (m15 or []) if b["ts"] + 900 <= ct]
    if not m15:
        return f"| {name} | {sym} | 查無 | | | | | 15 分鐘線抓取失敗 |"
    last = m15[-1]
    ago = next((b for b in reversed(m15) if b["ts"] + 900 <= ct - 86400), None)
    daily = [b for b in (daily or []) if b["ts"] < ct]
    wk = next((b for b in reversed(daily) if b["ts"] <= ct - 7 * 86400), None)
    yb = next((b for b in reversed(daily) if b["date"].year < cutoff.year), None)
    tstr = datetime.fromtimestamp(last["ts"] + 900, TPE).strftime("%m/%d %H:%M")
    d = 4 if last["close"] < 10 else 2
    return (f"| {name} | {sym} | {tstr} 台北 | {f2(last['close'], d)} | {sg(pc(last['close'], ago['close'])) if ago else '—'} | "
            f"{sg(pc(last['close'], wk['close'])) if wk else '—'} | {sg(pc(last['close'], yb['close'])) if yb else '—'} | 截止時價格；日漲跌＝和 24 小時前比 |")


def rowday(sym, name, cutoff, yld):
    meta, bars = chart(sym)
    if bars and len(bars) < 30:
        meta, bars = chart(sym, "2y")
    if not bars:
        return f"| {name} | {sym} | 查無 | | | | | 抓取失敗 |"
    bars, note = completed(meta, bars, cutoff)
    if len(bars) < 2:
        return f"| {name} | {sym} | 查無 | | | | | {note or '資料不足'} |"
    last, prev = bars[-1], bars[-2]
    wk = bars[-6] if len(bars) >= 6 else None
    yb = next((b for b in reversed(bars) if b["date"].year < last["date"].year), None)
    if yld:
        dchg = sg((last["close"] - prev["close"]) * 100, 1, " bp")
        wchg = sg((last["close"] - wk["close"]) * 100, 1, " bp") if wk else "—"
        ytd = sg((last["close"] - yb["close"]) * 100, 1, " bp") if yb else "—"
        cl = f2(last["close"], 3)
    else:
        dchg = sg(pc(last["close"], prev["close"]))
        wchg = sg(pc(last["close"], wk["close"])) if wk else "—"
        ytd = sg(pc(last["close"], yb["close"])) if yb else "—"
        cl = f2(last["close"], 2)
    return f"| {name} | {sym} | {last['date']} 收盤 | {cl} | {dchg} | {wchg} | {ytd} | {note} |"


def quotes(cutoff, extra):
    now = datetime.now(TPE)
    emit(f"# 美股與跨資產行情（usdata.py 產生，{now:%Y-%m-%d %H:%M} 台北抓取；截止 {cutoff:%Y-%m-%d %H:%M} 台北）\n")
    if now > cutoff + timedelta(minutes=30):
        emit(f"**注意：抓取時間晚於截止時間超過 30 分鐘。** 腳本已排除截止後的價格，但 Yahoo 的資料可能在截止後被修正，引用時以截止時間為準。\n")
    emit("來源：Yahoo Finance chart API（https://query1.finance.yahoo.com/v8/finance/chart/代號）。\n")
    emit("- 「資料時間」寫「YYYY-MM-DD 收盤」的，是該市場當地的交易日收盤；寫「MM/DD HH:MM 台北」的，是 24 小時商品在截止時的價格。")
    emit("- 美債殖利率是 CBOE 指數，和財政部、CNBC 會差幾個 bp，只當參考；報告的殖利率口徑照 RULES.md 4.7（CNBC 收盤，2、10、30 年同一來源）。")
    emit("- 美元兌新台幣是國際報價，不是官方收盤；報告的新台幣收盤用台北外匯經紀公司 16:00 收盤價。\n")
    groups = list(GROUPS)
    if extra:
        groups.append(("其他", [tuple(x.split("=", 1)) for x in extra.split(",") if "=" in x]))
    for title, items in groups:
        yld = "殖利率" in title
        emit(f"## {title}\n")
        emit("| 名稱 | 代號 | 資料時間 | 價格 | 日漲跌 | 週漲跌 | 今年以來 | 備註 |\n|---|---|---|---|---|---|---|---|")
        for sym, name in items:
            try:
                emit(row24(sym, name, cutoff) if is24(sym) else rowday(sym, name, cutoff, yld))
            except Exception as e:  # noqa
                emit(f"| {name} | {sym} | 查無 | | | | | 腳本錯誤：{type(e).__name__} |")
            time.sleep(0.25)
        emit("")
        flush()


def nasdaq_closes(sym, start, end):
    url = f"https://api.nasdaq.com/api/quote/{sym}/historical?assetclass=stocks&fromdate={start}&todate={end}&limit=60"
    try:  # Nasdaq 會擋 Python 內建的連線，改用 curl
        txt = subprocess.run(["curl", "-s", "-m", "25", url, "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                              "(KHTML, like Gecko) Chrome/120.0 Safari/537.36", "-H", "Accept: application/json, text/plain, */*",
                              "-H", "Accept-Language: en-US,en;q=0.9"], capture_output=True, timeout=40).stdout.decode("utf-8", "replace")
        rows = json.loads(txt)["data"]["tradesTable"]["rows"]
    except Exception:  # noqa
        return {}
    return {datetime.strptime(r["date"], "%m/%d/%Y").date(): float(r["close"].replace("$", "").replace(",", "")) for r in rows}


def stock(sym, cutoff, outdir):
    meta, bars = chart(sym, "2y")
    emit(f"# 美股個股資料 {sym}（usdata.py 產生，{datetime.now(TPE):%Y-%m-%d %H:%M} 台北抓取；截止 {cutoff:%Y-%m-%d %H:%M} 台北）\n")
    if not bars:
        emit("抓取失敗，請改用 Nasdaq 或其他來源手動抓取。")
        return
    bars, note = completed(meta, bars, cutoff)
    until = bars[-1]["date"]
    bars = [b for b in bars if b["date"] >= until - timedelta(days=420)]
    p = os.path.join(outdir, f"px-us-{sym}.csv")
    with open(p, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "open", "high", "low", "close", "volume"])
        for b in bars:
            w.writerow([b["date"].isoformat(), round(b["open"], 4), round(b["high"], 4), round(b["low"], 4), round(b["close"], 4), b["volume"]])
    last, prev = bars[-1], bars[-2]
    emit(f"{meta.get('longName') or meta.get('shortName') or sym}（{meta.get('fullExchangeName', '')}）；{len(bars)} 筆，{bars[0]['date']} 至 {last['date']}，存成 `{p}`。{note}")
    emit(f"最後一筆（截止前最後一個收盤）：{last['date']} 開 {f2(last['open'])} 高 {f2(last['high'])} 低 {f2(last['low'])} 收 {f2(last['close'])}，量 {last['volume']:,} 股；"
         f"前收 {f2(prev['close'])}，漲跌 {sg(last['close'] - prev['close'], 2, '')}（{sg(pc(last['close'], prev['close']))}）。")
    emit(f"52 週高低、均線、報酬請跑 `python daily/tools/stockviz.py stats {p.replace(chr(92), '/')}`。\n")
    flush()
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
    s = sp.add_parser("stock"); s.add_argument("sym"); s.add_argument("--cutoff", required=True); s.add_argument("--out")
    a = p.parse_args()
    cut = datetime.strptime(a.cutoff, "%Y-%m-%d %H:%M").replace(tzinfo=TPE)
    out = a.out or os.path.join("_research", cut.date().isoformat())
    os.makedirs(out, exist_ok=True)
    if a.cmd == "quotes":
        FN[0] = os.path.join(out, f"official-us-{cut:%Y%m%d}.md")
        quotes(cut, a.extra)
    else:
        FN[0] = os.path.join(out, f"stock-us-{a.sym}.md")
        stock(a.sym, cut, out)
    flush()
    print("\n".join(OUT))
    print(f"（已存成 {FN[0]}）")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
