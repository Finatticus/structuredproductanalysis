# -*- coding: utf-8 -*-
"""市場日報：美股、利率、匯率、商品、歐股、亞股行情一次抓完（Yahoo Finance chart API；個股另用 Nasdaq 交叉比對）。

用法（在 C:\\Users\\User\\Desktop\\news 執行，一律用 Bash 工具，timeout 設 600000 或在背景執行）：
  python daily/tools/usdata.py quotes --cutoff "YYYY-MM-DD HH:MM" [--out _research/YYYY-MM-DD] [--extra "代號=名稱,…"]
      --cutoff 是台北時間的截止時間（早報 07:00、午報 15:30）。
      - 有固定收盤時間的市場（股票、指數）：只列「截止前已經收盤」的最後一個交易日；截止時還在盤中或截止後才收盤的那一天會排除。
      - 24 小時交易的商品（期貨、匯率、比特幣、美元指數）：列「截止時的價格」（15 分鐘線，取截止前最後一根），
        日漲跌是和 24 小時前比，週漲跌是和約 7 天前比。
  python daily/tools/usdata.py fund 代號 --cutoff "YYYY-MM-DD HH:MM" [--out 資料夾]
      SEC 官方資料：近 8 季 GAAP 財報（營收、毛利率、營益率、淨利、稀釋 EPS；第四季＝全年減前三季推算），
      以及近 90 天、截止前已收件的 Form 4（申報人、交易代碼、股數、自算加權平均價、是否 10b5-1）。存成 fund-us-代號.md。
  python daily/tools/usdata.py stock 代號 --cutoff "YYYY-MM-DD HH:MM" [--out 資料夾]
      美股個股近 14 個月日資料，存成 px-us-代號.csv，只到截止前已經收盤的最後一個交易日；最近 10 天收盤和 Nasdaq 交叉比對。

輸出：Markdown 印到螢幕，並存成 out 資料夾裡的 official-us-YYYYMMDD.md（或 stock-us-代號.md）。每一節完成就寫一次檔。
"""
import argparse
import csv
import json
import os
import re
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
                        ("META", "Meta"), ("AVGO", "博通"), ("AMD", "AMD"), ("TSLA", "特斯拉"), ("MU", "美光"), ("ORCL", "甲骨文"), ("CRWV", "CoreWeave")]),
    ("美債殖利率（%，CNBC 收盤報價）", "CNBC_YIELDS"),
    ("美債 2 年期貨（參考，非殖利率）", [("ZT=F", "2 年期美債期貨")]),
    ("美元與匯率（截止時價格）", [("DX-Y.NYB", "美元指數"), ("TWD=X", "美元兌新台幣（國際報價）"), ("JPY=X", "美元兌日圓"), ("KRW=X", "美元兌韓元"),
                          ("CNY=X", "美元兌人民幣"), ("EURUSD=X", "歐元兌美元")]),
    ("商品與加密資產（截止時價格）", [("CL=F", "WTI 原油"), ("BZ=F", "布蘭特原油"), ("NG=F", "天然氣"), ("GC=F", "黃金"), ("HG=F", "銅"), ("TTF=F", "歐洲天然氣 TTF"), ("BTC-USD", "比特幣")]),
    ("歐股", [("^STOXX", "歐洲 STOXX 600"), ("^STOXX50E", "歐洲 STOXX 50"), ("^GDAXI", "德國 DAX"), ("^FTSE", "英國 FTSE 100"), ("^FCHI", "法國 CAC 40")]),
    ("亞股", [("^TWII", "台灣加權"), ("^N225", "日經 225"), ("^KS11", "KOSPI"), ("^KQ11", "KOSDAQ"), ("000001.SS", "上證"),
             ("^HSI", "恆生"), ("^NSEI", "印度 Nifty 50")]),  # 創業板、科創 50 在 Yahoo 資料不穩，交給子代理
    ("日韓重點個股", [("8035.T", "東京威力"), ("6857.T", "愛德萬"), ("9984.T", "軟銀集團"), ("000660.KS", "SK 海力士"), ("005930.KS", "三星電子")]),
]


# Yahoo 代號 → CNBC 代號（Yahoo 日線過期時的備援、補值時的交叉確認）。美股個股代號兩邊相同。
CNBC_MAP = {"^GSPC": ".SPX", "^IXIC": ".IXIC", "^DJI": ".DJI", "^RUT": ".RUT", "^SOX": ".SOX", "^VIX": ".VIX",
            "^STOXX": ".STOXX", "^STOXX50E": ".STOXX50E", "^GDAXI": ".GDAXI", "^FTSE": ".FTSE", "^FCHI": ".FCHI",
            "^TWII": ".TWII", "^N225": ".N225", "^KS11": ".KS11", "^KQ11": ".KQ11", "000001.SS": ".SSEC", "^HSI": ".HSI", "^NSEI": ".NSEI"}
CNBC_YIELDS = [("US3M", "3 個月"), ("US2Y", "2 年"), ("US5Y", "5 年"), ("US10Y", "10 年"), ("US30Y", "30 年")]
CNBC = {}


def to_et(dt):
    """換成美東時間（自己算夏令：3 月第二個週日 02:00 到 11 月第一個週日 02:00，這台電腦沒有 tzdata）。"""
    u = dt.astimezone(timezone.utc)
    m = datetime(u.year, 3, 8, 7, tzinfo=timezone.utc)
    m += timedelta(days=(6 - m.weekday()) % 7)
    n = datetime(u.year, 11, 1, 6, tzinfo=timezone.utc)
    n += timedelta(days=(6 - n.weekday()) % 7)
    return u.astimezone(timezone(timedelta(hours=-4 if m <= u < n else -5)))


def cnbc_sym(sym):
    return CNBC_MAP.get(sym) or (sym if re.fullmatch(r"[A-Z]{1,5}", sym) else None)


def cnbc_num(v):
    return float(str(v).replace("%", "").replace(",", ""))


def cnbc_load(syms):
    """一次抓多個 CNBC 報價，存進 CNBC：{代號: {last, prev, time}}。抓不到的就不放。"""
    syms = [x for x in dict.fromkeys(syms) if x and x not in CNBC]
    for i in range(0, len(syms), 20):
        part = "|".join(syms[i:i + 20])
        j = fetch("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols="
                  + urllib.parse.quote(part) + "&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1")
        try:
            for q in j["FormattedQuoteResult"]["FormattedQuote"]:
                try:
                    CNBC[q["symbol"]] = {"last": cnbc_num(q["last"]), "prev": cnbc_num(q["previous_day_closing"]),
                                         "time": datetime.strptime(q["last_time"], "%Y-%m-%dT%H:%M:%S.%f%z")}
                except Exception:  # noqa
                    pass
        except Exception:  # noqa
            pass


def cnbc_hist(sym, end):
    """CNBC 日線收盤 [(美東日期, 收盤)]，到 end 為止約 13 個月。"""
    start = end - timedelta(days=400)
    j = fetch(f"https://ts-api.cnbc.com/harmony/app/bars/{urllib.parse.quote(sym)}/1D/{start:%Y%m%d}000000/{end:%Y%m%d}235959/adjusted/EST5EDT.json")
    try:
        return [(datetime.strptime(b["tradeTime"][:8], "%Y%m%d").date(), float(b["close"])) for b in j["barData"]["priceBars"]]
    except Exception:  # noqa
        return []


def expected_date(meta, cutoff):
    """截止時該市場「應該已經收盤」的最後一個平日。不知道各國假日，休市日會被當成過期（備註會寫「或休市」）。"""
    xtz = timezone(timedelta(seconds=meta.get("gmtoffset", 0)))
    reg = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    close_t = datetime.fromtimestamp(reg["end"], xtz).time() if reg.get("end") else datetime.strptime("16:00", "%H:%M").time()
    c = cutoff.astimezone(xtz)
    d = c.date() if c.time() >= close_t else c.date() - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d, close_t


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
    ts = r.get("timestamp") or []
    meta = r["meta"]
    for i, t in enumerate(ts):
        c = q["close"][i]
        if c is None:
            # Yahoo 有時收盤後很久，最後一根日線的收盤仍是空值（週末常見）。
            # 只在「最後一根」且最後成交時間就在同一天時，改用 regularMarketPrice，並標記 filled。
            rmt, rmp = meta.get("regularMarketTime"), meta.get("regularMarketPrice")
            if interval == "1d" and i == len(ts) - 1 and rmt and rmp and \
                    datetime.fromtimestamp(rmt, tz).date() == datetime.fromtimestamp(t, tz).date():
                bars.append({"ts": t, "date": datetime.fromtimestamp(t, tz).date(), "open": q["open"][i] or rmp,
                             "high": q["high"][i] or rmp, "low": q["low"][i] or rmp, "close": rmp,
                             "volume": q["volume"][i] or 0, "filled": True})
            continue
        bars.append({"ts": t, "date": datetime.fromtimestamp(t, tz).date(), "open": q["open"][i], "high": q["high"][i],
                     "low": q["low"][i], "close": c, "volume": q["volume"][i] or 0})
    return meta, bars


def completed(meta, bars, cutoff):
    """只留「截止前已經收盤」的日線。回傳 (bars, 備註)。"""
    if not bars:
        return bars, ""
    xtz = timezone(timedelta(seconds=meta.get("gmtoffset", 0)))
    reg = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    if reg.get("start") and bars[-1]["date"] == datetime.fromtimestamp(reg["start"], xtz).date():
        if reg["end"] > cutoff.timestamp() or reg["end"] > time.time():
            return bars[:-1], "已排除截止時尚未收盤的當日資料"
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
    note = "截止時價格；日漲跌＝和 24 小時前比"
    gap = (ct - (last["ts"] + 900)) / 3600
    u = cutoff.astimezone(timezone.utc)
    l_u = datetime.fromtimestamp(last["ts"] + 900, timezone.utc)
    # 期貨、匯率週五美東 17:00 收（21:00／22:00 UTC），週日晚上才陸續開（匯率第一根約週一 00:00 UTC）：
    # 週五 21:00 UTC 到週一 01:00 UTC 視為週末，只檢查有沒有週五白天（15:00 UTC 以後）的資料
    weekend = (u.weekday() == 4 and u.hour >= 21) or u.weekday() in (5, 6) or (u.weekday() == 0 and u.hour < 1)
    if weekend:
        fri = (u - timedelta(days=(u.weekday() - 4) % 7)).date()
        stale = l_u < datetime(fri.year, fri.month, fri.day, 15, 0, tzinfo=timezone.utc) and sym != "BTC-USD"
    else:
        # 收盤時間比較早的商品放寬門檻：人民幣境內 03:00 收、韓元、歐洲天然氣 TTF 18:00 CET 收
        stale = gap > {"CNY=X": 8, "KRW=X": 8, "TTF=F": 24}.get(sym, 1.5)
    if stale or (sym == "BTC-USD" and gap > 1):
        note += f"；**可能過期**：最後一筆離截止 {gap:.1f} 小時（假日休市時是正常的，否則要用 CNBC 確認）"
    return (f"| {name} | {sym} | {tstr} 台北 | {f2(last['close'], d)} | {sg(pc(last['close'], ago['close'])) if ago else '—'} | "
            f"{sg(pc(last['close'], wk['close'])) if wk else '—'} | {sg(pc(last['close'], yb['close'])) if yb else '—'} | {note} |")


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
    xtz = timezone(timedelta(seconds=meta.get("gmtoffset", 0)))
    exp, close_t = expected_date(meta, cutoff)
    q = CNBC.get(cnbc_sym(sym) or "")
    qd = q["time"].astimezone(xtz).date() if q else None
    if not yld and last["date"] < exp:
        # Yahoo 日線過期：CNBC 有截止前、日期就是預期交易日、而且是收盤後的報價才改用，否則標示可能過期（避免把盤中價當收盤）
        if q and q["time"] <= cutoff and qd == exp and q["time"].astimezone(xtz) >= datetime.combine(qd, close_t, xtz) - timedelta(minutes=5) and q["last"]:
            base = next((b for b in reversed(bars) if b["date"] <= qd - timedelta(days=7)), None)
            yb2 = next((b for b in reversed(bars) if b["date"].year < qd.year), None)
            src = f"Yahoo 日線停在 {last['date']}，改用 CNBC 報價（{q['time'].astimezone(TPE):%m/%d %H:%M} 台北）"
            return (f"| {name} | {sym} | {qd} 收盤 | {f2(q['last'], 2)} | {sg(pc(q['last'], q['prev']))} | "
                    f"{sg(pc(q['last'], base['close'])) if base else '—'} | {sg(pc(q['last'], yb2['close'])) if yb2 else '—'} | {src} |")
        note = (note + "；" if note else "") + f"**可能過期**：Yahoo 最新一筆是 {last['date']}，預期 {exp}（或該市場休市），要用 CNBC 等第二來源確認"
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
    if last.get("filled"):
        if q and qd == last["date"] and abs(q["last"] - last["close"]) <= max(0.01, abs(last["close"]) * 0.0002):
            note = (note + "；" if note else "") + "Yahoo 日線收盤缺值，用當天最後成交價補（和 CNBC 收盤一致）"
        else:
            note = (note + "；" if note else "") + "Yahoo 日線收盤缺值，用當天最後成交價補；" + \
                (f"CNBC 為 {f2(q['last'], 2)}，要確認" if q else "CNBC 查無，要用第二來源確認")
    return f"| {name} | {sym} | {last['date']} 收盤 | {cl} | {dchg} | {wchg} | {ytd} | {note} |"


def yield_rows(cutoff):
    """美債殖利率：CNBC 日線收盤（美東約 15:00，債市收盤；和 CBOE 指數同口徑）。
    只用「截止時已收盤」的日線，不用 CNBC 報價的 last（那是美東 17:05 前後的最後成交，和日線收盤不同口徑）。
    CNBC 日線抓不到時退回 CBOE 指數並標明。"""
    ce = to_et(cutoff)
    expd = ce.date() if (ce.hour, ce.minute) >= (15, 5) else ce.date() - timedelta(days=1)
    while expd.weekday() >= 5:
        expd -= timedelta(days=1)
    alt = {"US3M": "^IRX", "US5Y": "^FVX", "US10Y": "^TNX", "US30Y": "^TYX"}

    def bp(a, b):
        return sg((a - b) * 100, 1, " bp") if (a is not None and b is not None) else "—"
    for sym, name in CNBC_YIELDS:
        hist = [h for h in cnbc_hist(sym, expd) if h[0] <= expd]
        if len(hist) < 2:
            if sym in alt:
                cells = [c.strip() for c in rowday(alt[sym], name, cutoff, True).strip().strip("|").split("|")]
                cells[-1] = (cells[-1] + "；" if cells[-1] else "") + ("CNBC 日線抓取失敗，改列 ^IRX（貼現基礎，和 CNBC 口徑不同，只當參考）" if sym == "US3M"
                                                                     else "CNBC 日線抓取失敗，改列 CBOE 指數（同為美東約 15:00 收盤）")
                emit("| " + " | ".join(cells) + " |")
            else:
                emit(f"| {name} | {sym} | 查無 | | | | | CNBC 日線抓取失敗 |")
            continue
        (d0, last), prev = hist[-1], hist[-2][1]
        base = next((c for d, c in reversed(hist) if d <= d0 - timedelta(days=7)), None)
        yb = next((c for d, c in reversed(hist) if d.year < d0.year), None)
        label = "CNBC 日線收盤（美東約 15:00）"
        if d0 < expd:
            label += f"；**可能過期**：最新是美東 {d0}，預期 {expd}（或美債休市）"
        emit(f"| {name} | {sym} | {d0} 收盤 | {last:.3f} | {bp(last, prev)} | {bp(last, base)} | {bp(last, yb)} | {label} |")


def quotes(cutoff, extra):
    now = datetime.now(TPE)
    emit(f"# 美股與跨資產行情（usdata.py 產生，{now:%Y-%m-%d %H:%M} 台北抓取；截止 {cutoff:%Y-%m-%d %H:%M} 台北）\n")
    if now < cutoff + timedelta(minutes=5):
        emit("**警告：現在還沒過截止時間 5 分鐘。24 小時交易的商品、匯率、期貨抓到的不是截止價（報價也有幾分鐘延遲），這份輸出不可用於報告；請在截止 5 分鐘後重跑。**\n")
    if now > cutoff + timedelta(minutes=30):
        emit(f"**注意：抓取時間晚於截止時間超過 30 分鐘。** 腳本已排除截止後的價格，但 Yahoo 的資料可能在截止後被修正，引用時以截止時間為準。\n")
    emit("來源：Yahoo Finance chart API（https://query1.finance.yahoo.com/v8/finance/chart/代號）。\n")
    emit("- 「資料時間」寫「YYYY-MM-DD 收盤」的，是該市場當地的交易日收盤；寫「MM/DD HH:MM 台北」的，是 24 小時商品在截止時的價格。")
    emit("- 美債殖利率用 CNBC 日線收盤（美東約 15:00，債市收盤；和 CBOE 指數同口徑；RULES.md 4.7），只列截止時已收盤的那一天；CNBC 報價頁的 17:05 最後成交不用。")
    emit("- 股票與指數：Yahoo 日線比「截止時應該已收盤的交易日」舊時，改用 CNBC 報價並在備註寫明；CNBC 也沒有時標「可能過期」（休市日也會被標，要自己確認）。")
    emit("- 美元兌新台幣是國際報價，不是官方收盤；報告的新台幣收盤用台北外匯經紀公司 16:00 收盤價。\n")
    groups = list(GROUPS)
    if extra:
        groups.append(("其他", [tuple(x.split("=", 1)) for x in extra.split(",") if "=" in x]))
    cnbc_load([cnbc_sym(sym) for _, items in groups if isinstance(items, list) for sym, _ in items])
    for title, items in groups:
        yld = "殖利率" in title
        emit(f"## {title}\n")
        emit("| 名稱 | 代號 | 資料時間 | 價格 | 日漲跌 | 週漲跌 | 今年以來 | 備註 |\n|---|---|---|---|---|---|---|---|")
        if items == "CNBC_YIELDS":
            try:
                yield_rows(cutoff)
            except Exception as e:  # noqa
                emit(f"| 美債殖利率 | CNBC | 查無 | | | | | 腳本錯誤：{type(e).__name__} |")
            emit("")
            flush()
            continue
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


SEC_UA = {"User-Agent": "MarketDailyResearch research@example.com", "Accept": "application/json"}


def sec_json(url):
    time.sleep(0.15)
    return fetch(url, SEC_UA)


def sec_text(url):
    time.sleep(0.15)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=SEC_UA), timeout=25) as r:
            return r.read().decode("utf-8", "replace")
    except Exception:  # noqa
        return ""


def fund(sym, cutoff, outdir):
    """SEC 官方資料：近 8 季財報（XBRL companyfacts）與近 90 天 Form 4（只列截止前收件的）。"""
    emit(f"# 美股財報與內部人交易 {sym}（usdata.py fund，{datetime.now(TPE):%Y-%m-%d %H:%M} 台北抓取；只列台北 {cutoff:%Y-%m-%d %H:%M} 前已在 SEC 公開的資料）\n")
    tick = fetch("https://www.sec.gov/files/company_tickers.json", SEC_UA) or {}
    cik = next((str(v["cik_str"]).zfill(10) for v in tick.values() if v["ticker"].upper() == sym.upper()), None)
    if not cik:
        emit("找不到 CIK，請手動查 SEC。")
        return
    cutd = cutoff.astimezone(timezone.utc).date().isoformat()
    facts = sec_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json") or {}
    g = facts.get("facts", {}).get("us-gaap", {})
    concepts = [("營收", ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"], "USD"),
                ("毛利", ["GrossProfit"], "USD"), ("營業利益", ["OperatingIncomeLoss"], "USD"),
                ("淨利", ["NetIncomeLoss"], "USD"), ("稀釋 EPS（GAAP）", ["EarningsPerShareDiluted"], "USD/shares")]
    table = {}
    for label, names, unit in concepts:
        q, y = {}, {}
        for nm in names:
            for f in g.get(nm, {}).get("units", {}).get(unit, []):
                if f.get("filed", "9999") > cutd or "start" not in f:
                    continue
                days = (datetime.fromisoformat(f["end"]) - datetime.fromisoformat(f["start"])).days
                if 80 <= days <= 100:
                    q.setdefault(f["end"], f["val"])
                elif 350 <= days <= 380:
                    y.setdefault(f["end"], (f["start"], f["val"]))
            if q:
                break
        for end, (start, val) in y.items():  # 第四季＝全年減前三季（推算）
            if end in q:
                continue
            qs = [v for e, v in q.items() if start < e < end]
            if len(qs) == 3:
                q[end] = ("推算", val - sum(qs))
        for e, v in q.items():
            table.setdefault(e, {})[label] = v
    ends = sorted(table)[-8:]
    if ends:
        emit("## 1. 近 8 季財報（SEC XBRL，GAAP；金額單位百萬美元）\n")
        emit("| 季度結束日 | 營收 | 毛利率 | 營業利益 | 營益率 | 淨利 | 稀釋 EPS |\n|---|---|---|---|---|---|---|")
        for e in ends:
            r = table[e]
            def v(k):  # noqa
                x = r.get(k)
                return (x[1], True) if isinstance(x, tuple) else (x, False)
            rev, a1 = v("營收")
            gp, a2 = v("毛利")
            op, a3 = v("營業利益")
            ni, a4 = v("淨利")
            eps, a5 = v("稀釋 EPS（GAAP）")
            mark = "（第四季為全年減前三季推算）" if any((a1, a2, a3, a4, a5)) else ""
            emit(f"| {e}{mark} | {f2(rev / 1e6, 0) if rev else '—'} | {f2(gp / rev * 100, 1) + '%' if gp and rev else '—'} | "
                 f"{f2(op / 1e6, 0) if op else '—'} | {f2(op / rev * 100, 1) + '%' if op and rev else '—'} | {f2(ni / 1e6, 0) if ni else '—'} | {f2(eps) if eps else '—'} |")
        emit("\nGAAP 數字；non-GAAP 要看公司財報新聞稿（8-K 附件 99.1）。來源：https://data.sec.gov/api/xbrl/companyfacts/CIK" + cik + ".json\n")
    else:
        emit("## 1. 財報：XBRL 查無季度資料，請手動查 SEC。\n")
    flush()
    sub = sec_json(f"https://data.sec.gov/submissions/CIK{cik}.json") or {}
    rec = sub.get("filings", {}).get("recent", {})
    rows = []
    for form, acc, acct, doc in zip(rec.get("form", []), rec.get("accessionNumber", []), rec.get("acceptanceDateTime", []), rec.get("primaryDocument", [])):
        if form != "4":
            continue
        at = datetime.fromisoformat(acct.replace("Z", "+00:00"))
        if at > cutoff or at < cutoff - timedelta(days=90):
            continue
        rows.append((acc, at, doc))
    emit(f"## 2. 內部人交易（Form 4，近 90 天、截止前收件，共 {len(rows)} 份；最多解析 15 份）\n")
    emit("| 收件（台北） | 申報人 | 交易日 | 代碼 | 股數 | 加權平均價 | 10b5-1 |\n|---|---|---|---|---|---|---|")
    for acc, at, doc in rows[:15]:
        base = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}/"
        idx = sec_json(base + "index.json") or {}
        xml = next((i["name"] for i in idx.get("directory", {}).get("item", []) if i["name"].endswith(".xml")), None)
        x = sec_text(base + xml) if xml else ""
        owner = (re.search(r"<rptOwnerName>(.*?)</rptOwnerName>", x) or [None, "查無"])[1]
        plan = "是" if "10b5-1" in x else ""
        agg = {}
        for t in re.findall(r"<nonDerivativeTransaction>(.*?)</nonDerivativeTransaction>", x, re.S):
            gv = lambda tag: (re.search("<" + tag + r">\s*(?:<value>)?\s*([^<\s]*)", t) or [None, None])[1]  # noqa
            key = (gv("transactionDate"), gv("transactionCode"))
            sh, pr = float(gv("transactionShares") or 0), float(gv("transactionPricePerShare") or 0)
            a_ = agg.setdefault(key, [0.0, 0.0])
            a_[0] += sh
            a_[1] += sh * pr
        if not agg:
            emit(f"| {at.astimezone(TPE):%m/%d %H:%M} | {owner} | 查無非衍生交易 | | | | {plan} |")
        for (dt, code), (sh, amt) in agg.items():
            emit(f"| {at.astimezone(TPE):%m/%d %H:%M} | {owner} | {dt} | {code} | {sh:,.0f} | {f2(amt / sh) if sh and amt else '—'} | {plan} |")
    emit("\n代碼：S＝公開市場賣出、P＝公開市場買進、G＝贈與、F＝扣股繳稅、M＝執行選擇權、A＝獲配。加權平均價由各筆成交自算。"
         f"來源：SEC EDGAR（https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=4）。13F 機構持股請另查，並逐份確認收件時間。")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("quotes"); s.add_argument("--cutoff", required=True); s.add_argument("--out"); s.add_argument("--extra", default="")
    s = sp.add_parser("stock"); s.add_argument("sym"); s.add_argument("--cutoff", required=True); s.add_argument("--out")
    s = sp.add_parser("fund"); s.add_argument("sym"); s.add_argument("--cutoff", required=True); s.add_argument("--out")
    a = p.parse_args()
    cut = datetime.strptime(a.cutoff, "%Y-%m-%d %H:%M").replace(tzinfo=TPE)
    out = a.out or os.path.join("_research", cut.date().isoformat())
    os.makedirs(out, exist_ok=True)
    if a.cmd == "quotes":
        FN[0] = os.path.join(out, f"official-us-{cut:%Y%m%d}.md")
        quotes(cut, a.extra)
    elif a.cmd == "fund":
        FN[0] = os.path.join(out, f"fund-us-{a.sym}.md")
        fund(a.sym, cut, out)
    else:
        FN[0] = os.path.join(out, f"stock-us-{a.sym}.md")
        stock(a.sym, cut, out)
    flush()
    print("\n".join(OUT))
    print(f"（已存成 {FN[0]}）")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
