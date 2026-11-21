# -*- coding: utf-8 -*-
"""市場日報：台股官方資料一次抓完（證交所、櫃買中心、期交所）。只用 Python 標準函式庫。

用法（在 C:\\Users\\User\\Desktop\\news 執行）：
  python daily/tools/twdata.py market YYYY-MM-DD [--out _research/YYYY-MM-DD]
      台股大盤：加權指數近 10 日、自算均線、52 週高低（收盤）、開高低與缺口與盤中高點（1b）、成交值、漲跌家數、類股（含未含電子等）、
      成交金額前 20 名（3b）、三大法人（近 5 日、連續天數、月累計）、上市櫃融資（億元）、外資買賣超（個股與 ETF 分開）、櫃買指數、
      台指期（一般與盤後）、三大法人期貨未平倉、P/C 比、前 20 大權值股貢獻點數（11）。
      日期＝要抓的交易日。午報用今天；早報寫成 prev-今天（例：prev-2026-11-18），腳本會自動找前一個台股交易日（週一、連假都會處理）。
  python daily/tools/twdata.py stock 代號 YYYY-MM-DD [--chips-until YYYY-MM-DD] [--out 資料夾]
      個股：近 14 個月日資料存成 px-tw-代號.csv；近 20 個交易日法人買賣超、融資融券；本益比、殖利率、淨值比；外資持股。
      法人與融資只抓到 --chips-until（午報寫 --chips-until prev，自動用前一個交易日，因為 15:30 時當天還沒公布）。

輸出：Markdown 印到螢幕，並存成 out 資料夾裡的 official-tw-YYYYMMDD.md（或 stock-tw-代號.md）；原始回應存在 out/raw-tools/。
每一項都會檢查回傳日期；還沒公布或日期不符時寫「尚未公布」，絕不拿其他日期代替。
"""
import argparse
import csv
import json
import os
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
TWSE = "https://www.twse.com.tw/rwd/zh/"
OUT = []
RAW = None
FN = [None]
STATS = {"ok": 0, "none": 0, "fail": 0}
PACE = os.path.join(tempfile.gettempdir(), "twse-pace.txt")  # 跨行程共用的請求間隔紀錄，避免同時跑兩支腳本被證交所擋


def emit(s=""):
    OUT.append(s)


def flush():
    if FN[0]:
        with open(FN[0], "w", encoding="utf-8") as f:
            f.write("\n".join(OUT) + "\n")


def _pace(pause):
    try:
        last = float(open(PACE).read().strip() or 0)
    except (OSError, ValueError):
        last = 0.0
    wait = pause - (time.time() - last)
    if wait > 0:
        time.sleep(min(wait, pause))
    try:
        with open(PACE, "w") as f:
            f.write(str(time.time()))
    except OSError:
        pass


def get(url, data=None, enc="utf-8", name=None, pause=1.6):
    """抓網址，失敗重試 3 次；證交所有頻率限制，所有行程合計每 pause 秒一次。失敗回傳 None。"""
    body = urllib.parse.urlencode(data).encode() if data else None
    for k in range(3):
        _pace(pause)
        try:
            req = urllib.request.Request(url, data=body, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                txt = r.read().decode(enc, errors="replace")
            if RAW and name:
                with open(os.path.join(RAW, name), "w", encoding="utf-8") as f:
                    f.write(txt)
            return txt
        except Exception:  # noqa
            if k == 2:
                return None
            time.sleep(3 + 3 * k)


_CACHE = {}


def getj(url, name=None):
    """回傳 dict；連線失敗回傳 None（和「官方沒有這一天的資料」分開）。"""
    if url in _CACHE:
        return _CACHE[url]
    t = get(url, name=name)
    if t is None:
        return None
    try:
        j = json.loads(t)
    except ValueError:
        return None
    if j.get("stat") == "OK":
        _CACHE[url] = j
    return j


def chk(j, dd):
    """ok＝有這一天的資料；none＝官方回應沒有這一天（尚未公布或休市）；fail＝連線失敗或被擋。"""
    if j is None:
        return "fail"
    if j.get("stat") != "OK" or (dd and j.get("date") != dd):
        return "none"
    return "ok"


def miss(state, ds, extra=""):
    if state == "fail":
        STATS["fail"] += 1
        emit(f"**抓取失敗（連線失敗或被證交所擋）**：這一項請手動到官方網站確認，不可寫成「尚未公布」。{extra}\n")
    else:
        STATS["none"] += 1
        emit(f"**{ds} 尚未公布**（官方回應沒有這一天的資料）{extra}\n")


def num(s):
    if s is None:
        return None
    s = re.sub("<[^>]+>", "", str(s)).replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def roc2iso(s):
    y, m, d = s.strip().split("/")
    return f"{int(y) + 1911:04d}-{int(m):02d}-{int(d):02d}"


def ymd(d):
    return d.strftime("%Y%m%d")


def months_back(d, n):
    out = []
    y, m = d.year, d.month
    for _ in range(n):
        out.append(date(y, m, 1))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


def fmt(v, f=",.2f"):
    return "—" if v is None else format(v, f).replace("-", "−")


def sgn(v, f=",.2f"):
    if v is None:
        return "—"
    return ("+" if v > 0 else "") + fmt(v, f)


# ---------------------------------------------------------------- 大盤
def fmtqik_series(d, months=14):
    rows = []
    for m in months_back(d, months):
        j = getj(f"{TWSE}afterTrading/FMTQIK?response=json&date={ymd(m)}", f"FMTQIK_{m:%Y%m}.json")
        if not j or j.get("stat") != "OK":
            continue
        for r in j["data"]:
            rows.append({"date": roc2iso(r[0]), "amt": num(r[2]) / 1e8, "close": num(r[4]), "chg": num(r[5])})
    rows = sorted({r["date"]: r for r in rows}.values(), key=lambda r: r["date"])
    return [r for r in rows if r["date"] <= d.isoformat()]


def ma_table(closes, dates, label="加權指數"):
    last = closes[-1]
    emit(f"| 均線 | 數值 | 收盤相對位置 | 方向（和前一日比） |\n|---|---|---|---|")
    for n in (5, 10, 20, 60, 120, 240):
        if len(closes) < n + 1:
            emit(f"| {n} 日 | 資料不足 | | |")
            continue
        m = sum(closes[-n:]) / n
        p = sum(closes[-n - 1:-1]) / n
        emit(f"| {n} 日 | {fmt(m)} | {sgn((last / m - 1) * 100)}% | {'上彎' if m > p else '下彎' if m < p else '持平'} |")
    emit(f"\n均線為簡單平均，含 {dates[-1]}（AI 用證交所資料自算）。")


def section(title, fn):
    emit(f"## {title}\n")
    try:
        fn()
    except Exception as e:  # noqa
        STATS["fail"] += 1
        emit(f"**腳本錯誤（{type(e).__name__}: {e}）**：這一項請手動到官方網站抓取並確認；可能是官方網站改版。這次改用手動抓取的值，並寫進 lessons.md 最下面「待使用者處理」（排程中不可修改腳本）。\n")
    flush()


def market(d, cut):
    ds = d.isoformat()
    cutd = cut.date()
    now = datetime.now()
    emit(f"# 台股官方資料 {ds}（twdata.py 產生，{now:%Y-%m-%d %H:%M} 抓取；報告截止 {cut:%Y-%m-%d %H:%M}）\n")
    emit("每一項都檢查過回傳日期。「尚未公布」＝官方回應沒有這一天的資料；「抓取失敗」＝連線失敗或被擋，要手動確認。\n")
    if now > cut + timedelta(minutes=30):
        emit("**注意：抓取時間晚於截止時間超過 30 分鐘。** 官方可能在截止後修正數字（例如成交金額、三大法人），也可能已經公布截止時還沒有的資料（外資個股、P/C、融資）。"
             "報告以截止時已公布的版本為準：查核重跑時和主筆的數字不同，先比對主筆的 raw-tools 原始檔與抓取時間，截止後的修正不算錯誤。\n")
    rows = []
    PRICES = {}

    def s1():
        nonlocal rows
        rows = fmtqik_series(d)
        if not rows or rows[-1]["date"] != ds:
            STATS["none"] += 1
            emit(f"**{ds} 沒有資料**（最新一筆：{rows[-1]['date'] if rows else '無'}）。以下數字到最新一筆為止。\n")
            if d < date.today() or (d == date.today() and now.hour >= 15):
                emit(f"**注意：{ds} 應該已經收盤卻沒有資料，可能是休市日。** 請照 RULES.md 4.7「休市判斷」確認。\n")
        else:
            STATS["ok"] += 1
        if not rows:
            return
        emit("| 日期 | 收盤 | 漲跌 | 漲跌幅 | 成交金額（億元，證交所總計） |\n|---|---|---|---|---|")
        for r in rows[-10:]:
            prev = r["close"] - r["chg"]
            emit(f"| {r['date']} | {fmt(r['close'])} | {sgn(r['chg'])} | {sgn(r['chg'] / prev * 100)}% | {fmt(r['amt'])} |")
        closes = [r["close"] for r in rows]
        emit("")
        ma_table(closes, [r["date"] for r in rows])
        w = rows[-252:]
        hi = max(w, key=lambda r: r["close"])
        lo = min(w, key=lambda r: r["close"])
        emit(f"\n52 週（最近 {len(w)} 個交易日，收盤）：最高 {fmt(hi['close'])}（{hi['date']}），最低 {fmt(lo['close'])}（{lo['date']}）；"
             f"收盤距高點 {sgn((closes[-1] / hi['close'] - 1) * 100)}%。盤中高低請另查。")
        a = [r["amt"] for r in rows]
        emit(f"成交金額：5 日均 {fmt(sum(a[-5:]) / 5)} 億、20 日均 {fmt(sum(a[-20:]) / 20)} 億（都含當天）。"
             "午報抓到的當天成交金額是 15:30 前的數字，晚間可能因盤後交易併入而變大，隔天早報用最終值並註明。")
        if len(a) >= 21:
            p20 = sum(a[-21:-1]) / 20
            emit(f"比較用均量（不含當天）：前 5 日均 {fmt(sum(a[-6:-1]) / 5)} 億、前 20 日均 {fmt(p20)} 億；"
                 f"{rows[-1]['date']} {fmt(a[-1])} 億＝前 20 日均的 {a[-1] / p20:.2f} 倍。寫「量是均量的幾倍」一律用這一行。\n")
        else:
            emit("")
        emit(f"來源：https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?response=json&date={ymd(d)}\n")

    def s1b():
        bars = []
        for m in months_back(d, 13):
            j = getj(f"{TWSE}TAIEX/MI_5MINS_HIST?response=json&date={ymd(m)}", f"MI_5MINS_HIST_{m:%Y%m}.json")
            if not j or j.get("stat") != "OK":
                continue
            for r in j["data"]:
                bars.append({"date": roc2iso(r[0]), "o": num(r[1]), "h": num(r[2]), "l": num(r[3]), "c": num(r[4])})
        bars = sorted({b["date"]: b for b in bars if b["date"] <= ds}.values(), key=lambda b: b["date"])
        if not bars or bars[-1]["date"] != ds:
            return miss("none" if bars else "fail", ds)
        STATS["ok"] += 1
        emit("| 日期 | 開盤 | 最高 | 最低 | 收盤 | 振幅（點） | 收在全日區間的位置 |\n|---|---|---|---|---|---|---|")
        for b in bars[-10:]:
            rng = b["h"] - b["l"]
            pos = (b["c"] - b["l"]) / rng * 100 if rng else 50
            emit(f"| {b['date']} | {fmt(b['o'])} | {fmt(b['h'])} | {fmt(b['l'])} | {fmt(b['c'])} | {fmt(rng)} | 由下往上 {pos:.0f}% |")
        # 缺口：今天最低 > 前一天最高（向上缺口），今天最高 < 前一天最低（向下缺口）；之後價格回到缺口內就算回補
        gaps = []
        for i in range(max(1, len(bars) - 120), len(bars)):
            a, b = bars[i - 1], bars[i]
            if b["l"] > a["h"]:
                lo_, hi_ = a["h"], b["l"]
                filled = any(x["l"] <= lo_ for x in bars[i + 1:])
                gaps.append(("向上", b["date"], lo_, hi_, filled))
            elif b["h"] < a["l"]:
                lo_, hi_ = b["h"], a["l"]
                filled = any(x["h"] >= hi_ for x in bars[i + 1:])
                gaps.append(("向下", b["date"], lo_, hi_, filled))
        open_g = [g for g in gaps if not g[4] and g[1] != ds]
        emit("\n**還沒回補的缺口（最近 120 個交易日，AI 依官方開高低判斷）：**" + ("無" if not open_g else ""))
        for g in open_g:
            emit(f"- {g[1]} {g[0]}缺口 {fmt(g[2])}–{fmt(g[3])}")
        new = [g for g in gaps if g[1] == ds]
        if new:
            emit(f"- **今天（{ds}）留下新的{new[0][0]}缺口 {fmt(new[0][2])}–{fmt(new[0][3])}**")
        hi = max(bars, key=lambda b: b["h"])
        lo = min(bars[-252:], key=lambda b: b["l"])
        emit(f"\n近 13 個月盤中最高 {fmt(hi['h'])}（{hi['date']}），52 週盤中最低 {fmt(lo['l'])}（{lo['date']}）；收盤距盤中最高 {sgn((bars[-1]['c'] / hi['h'] - 1) * 100)}%。")
        emit("口徑：「距歷史高點」一律用盤中最高（RULES.md 4.7）；收盤高點見第 1 節。")
        emit(f"\n來源：https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?response=json&date={ymd(d)}\n")

    def s2():
        j = getj(f"{TWSE}afterTrading/MI_INDEX?response=json&date={ymd(d)}&type=MS", f"MI_MS_{ymd(d)}.json")
        st = chk(j, ymd(d))
        if st != "ok":
            return miss(st, ds)
        STATS["ok"] += 1
        for t in j.get("tables", []):
            title = t.get("title") or ""
            if "大盤統計" in title:
                for r in t["data"]:
                    if "總計" in r[0] or "一般股票" in r[0]:
                        emit(f"- {re.sub('<[^>]+>', '', r[0])}：成交金額 {fmt(num(r[1]) / 1e8)} 億元")
            if "漲跌證券數" in title:
                emit("\n| 類型 | 整體市場 | 股票 |\n|---|---|---|")
                for r in t["data"]:
                    emit(f"| {r[0]} | {r[1]} | {r[2]} |")
        emit(f"\n來源：https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date={ymd(d)}&type=MS\n")

    def s3():
        j = getj(f"{TWSE}afterTrading/MI_INDEX?response=json&date={ymd(d)}&type=IND", f"MI_IND_{ymd(d)}.json")
        st = chk(j, ymd(d))
        if st != "ok":
            return miss(st, ds)
        STATS["ok"] += 1
        items = []
        for t in j.get("tables", []):
            if (t.get("title") or "").endswith("價格指數(臺灣證券交易所)"):
                for r in t["data"]:
                    if num(r[3]) is None or num(r[4]) is None:
                        continue
                    sign = -1 if "green" in r[2] or "-" in re.sub("<[^>]+>", "", r[2]) else 1
                    items.append((r[0], num(r[1]), sign * abs(num(r[3])), sign * abs(num(r[4]))))
        items = [x for x in items if (x[0] == "發行量加權股價指數" or x[0].startswith("未含") or "類指數" in x[0])
                 and not any(k in x[0] for k in ("反向", "兩倍", "槓桿"))]
        items.sort(key=lambda x: -x[3])
        emit("| 指數 | 收盤 | 漲跌點數 | 漲跌幅 |\n|---|---|---|---|")
        for n_, c, p, pc in items:
            emit(f"| {n_} | {fmt(c)} | {sgn(p)} | {sgn(pc)}% |")
        emit(f"\n來源：https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date={ymd(d)}&type=IND\n")

    def s3b():
        j = getj(f"{TWSE}afterTrading/MI_INDEX?response=json&date={ymd(d)}&type=ALLBUT0999", f"MI_ALL_{ymd(d)}.json")
        st = chk(j, ymd(d))
        if st != "ok":
            return miss(st, ds)
        STATS["ok"] += 1
        t = next(t for t in j["tables"] if "證券代號" in (t.get("fields") or []))
        f_ = t["fields"]
        ix = {k: f_.index(k) for k in ("證券代號", "證券名稱", "成交金額", "收盤價", "漲跌(+/-)", "漲跌價差")}
        lst = []
        for r in t["data"]:
            code = r[ix["證券代號"]].strip()
            if not re.fullmatch(r"[1-9]\d{3}", code):  # 只留一般股票，排除 ETF（00 開頭）、權證等
                continue
            c, dif, amt = num(r[ix["收盤價"]]), num(r[ix["漲跌價差"]]), num(r[ix["成交金額"]])
            if c is None or dif is None or amt is None:
                continue
            sign = -1 if "green" in r[ix["漲跌(+/-)"]] or "-" in re.sub("<[^>]+>", "", r[ix["漲跌(+/-)"]]) else 1
            dif = sign * abs(dif)
            lst.append((code, r[ix["證券名稱"]].strip(), c, dif / (c - dif) * 100 if c != dif else 0, amt / 1e8))
            PRICES[code] = lst[-1]
        lst.sort(key=lambda x: -x[4])
        emit("| 排名 | 個股 | 收盤 | 漲跌幅 | 成交金額（億元） |\n|---|---|---|---|---|")
        for i, x in enumerate(lst[:20], 1):
            emit(f"| {i} | {x[1]}（{x[0]}） | {fmt(x[2])} | {sgn(x[3])}% | {fmt(x[4])} |")
        top = lst[:100]
        up = sorted(top, key=lambda x: -x[3])[:5]
        dn = sorted(top, key=lambda x: x[3])[:5]
        emit("\n成交金額前 100 名裡漲幅最大：" + "、".join(f"{x[1]} {sgn(x[3])}%" for x in up))
        emit("成交金額前 100 名裡跌幅最大：" + "、".join(f"{x[1]} {sgn(x[3])}%" for x in dn))
        emit(f"\n只列一般股票（不含 ETF、權證）。來源：https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date={ymd(d)}&type=ALLBUT0999\n")

    def s4():
        emit("外資＝「外資及陸資（不含外資自營商）」那一列（RULES.md 4.7 口徑）。午報時是 15:30 前的初版，晚間可能修正。\n")
        tdays = [r["date"] for r in rows if r["date"] <= ds][-30:] if rows else []
        if ds not in tdays:
            tdays = (tdays + [ds])[-30:]
        vals = []
        for td in tdays:
            dd = td.replace("-", "")
            j = getj(f"{TWSE}fund/BFI82U?response=json&type=day&dayDate={dd}", f"BFI82U_{dd}.json")
            st = chk(j, dd)
            if st != "ok":
                vals.append((td, st, None))
                continue
            v = {re.sub(r"\s", "", r[0]): num(r[3]) / 1e8 for r in j["data"]}
            g = lambda k: next((x for kk, x in v.items() if kk.startswith(k)), None)  # noqa
            vals.append((td, "ok", {k: g(k) for k in ("外資及陸資", "外資自營商", "投信", "自營商(自行", "自營商(避險", "合計")}))
        last = vals[-1]
        if last[1] != "ok":
            miss(last[1], ds)
        else:
            STATS["ok"] += 1
        emit("| 日期 | 外資 | 外資自營商 | 投信 | 自營商（自行） | 自營商（避險） | 自營商合計 | 三大法人合計 |\n|---|---|---|---|---|---|---|---|")
        for td, st, v in vals[-5:]:
            if st != "ok":
                emit(f"| {td} | {'抓取失敗' if st == 'fail' else '尚未公布'} | | | | | | |")
            else:
                emit(f"| {td} | {sgn(v['外資及陸資'])} | {sgn(v['外資自營商'])} | {sgn(v['投信'])} | {sgn(v['自營商(自行'])} | {sgn(v['自營商(避險'])} | "
                     f"{sgn(v['自營商(自行'] + v['自營商(避險'])} | {sgn(v['合計'])} |")
        for k, label in (("外資及陸資", "外資"), ("投信", "投信")):
            if vals[-1][1] != "ok":
                continue
            sign = 1 if vals[-1][2][k] > 0 else -1
            n, broken = 0, False
            for td, st, v in reversed(vals):
                if st != "ok":
                    broken = True
                    break
                if v[k] * sign > 0:
                    n += 1
                else:
                    break
            if broken:
                streak = f"連續{'買超' if sign > 0 else '賣超'}至少 {n} 天（中間有一天抓不到，無法確定）"
            elif n == len(vals):
                streak = f"連續{'買超' if sign > 0 else '賣超'} {n} 天以上（超過抓取範圍）"
            else:
                streak = f"連續{'買超' if sign > 0 else '賣超'} {n} 天"
            mon = [(td, st, v) for td, st, v in vals if td[:7] == ds[:7]]
            first_month_day = next((r["date"] for r in rows if r["date"][:7] == ds[:7]), ds)
            if any(st != "ok" for _, st, _ in mon) or (mon and mon[0][0] != first_month_day):
                mtd = "無法確定（缺資料）"
            else:
                mtd = sgn(sum(v[k] for _, _, v in mon)) + " 億元"
            emit(f"\n{label}：{streak}；{ds[:7]} 月累計 {mtd}。")
        isow = lambda t: date.fromisoformat(t).isocalendar()[:2]  # noqa
        wk = [(td, st, v) for td, st, v in vals if isow(td) == isow(ds)]
        wk_first = next((r["date"] for r in rows if isow(r["date"]) == isow(ds)), ds)
        if wk and wk[0][0] == wk_first and all(st == "ok" for _, st, _ in wk):
            tot = lambda f: sgn(sum(f(v) for _, _, v in wk))  # noqa
            emit(f"\n本週累計（{wk[0][0]} 到 {ds}，{len(wk)} 個交易日，用未四捨五入的原始值加總，億元）：外資 {tot(lambda v: v['外資及陸資'])}、"
                 f"投信 {tot(lambda v: v['投信'])}、自營商 {tot(lambda v: v['自營商(自行'] + v['自營商(避險'])}"
                 f"（自行 {tot(lambda v: v['自營商(自行'])}、避險 {tot(lambda v: v['自營商(避險'])}）、三大法人 {tot(lambda v: v['合計'])}。"
                 "一週合計一律用這一行，不要把表格裡四捨五入後的日數字相加。")
        else:
            emit("\n本週累計：無法確定（缺資料）。")
        emit(f"\n連續天數與月累計用最近 {len(vals)} 個交易日算（AI 推算）。來源：https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&type=day&dayDate={ymd(d)}\n")

    def s5():
        j = getj(f"{TWSE}marginTrading/MI_MARGN?response=json&selectType=MS&date={ymd(d)}", f"MI_MARGN_MS_{ymd(d)}.json")
        st = chk(j, ymd(d))
        if st != "ok":
            return miss(st, ds, "（融資融券通常晚間才公布）")
        STATS["ok"] += 1
        t = j["tables"][0] if j.get("tables") else {"fields": j.get("fields"), "data": j.get("data")}
        emit("| 項目 | " + " | ".join(t["fields"][1:]) + " |\n|" + "---|" * len(t["fields"]))
        for r in t["data"]:
            emit("| " + " | ".join(r) + " |")
        f_ = [x.strip() for x in t["fields"]]
        ip, it = f_.index("前日餘額"), f_.index("今日餘額")
        row = next(r for r in t["data"] if "融資金額" in r[0])
        twse_prev, twse_now = num(row[ip]) / 1e5, num(row[it]) / 1e5
        emit(f"\n**上市融資餘額 {fmt(twse_now)} 億元（{sgn(twse_now - twse_prev)} 億）**（官方單位仟元，已換算）。")
        tp = get(f"https://www.tpex.org.tw/www/zh-tw/margin/balance?date={d:%Y/%m/%d}&response=json", name=f"TPEX_MARGIN_{ymd(d)}.json", pause=0.5)
        try:
            jt = json.loads(tp)
            tb = jt["tables"][0]
            rr = next(r for r in (tb.get("summary") or []) + tb["data"] if "融資金" in (r[1] or ""))
            ftp = [x.strip() for x in tb["fields"]]
            tp_prev, tp_now = num(rr[ftp.index("前資餘額(張)")]) / 1e5, num(rr[ftp.index("資餘額")]) / 1e5
            if jt.get("date") and jt["date"] != ymd(d):
                emit(f"上櫃融資：櫃買中心回傳日期 {jt['date']}，和 {ds} 不同，尚未公布。")
            else:
                emit(f"**上櫃融資餘額 {fmt(tp_now)} 億元（{sgn(tp_now - tp_prev)} 億）；上市櫃合計 {fmt(twse_now + tp_now)} 億元（{sgn(twse_now + tp_now - twse_prev - tp_prev)} 億）。**")
        except Exception:  # noqa
            emit("上櫃融資：抓取失敗，請手動到櫃買中心確認。")
        emit("融資維持率官方沒有提供，要另外查（媒體或券商估算，註明來源）。")
        emit(f"來源：https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&selectType=MS&date={ymd(d)}\n")

    def s6():
        j = getj(f"{TWSE}fund/TWT38U?response=json&date={ymd(d)}", f"TWT38U_{ymd(d)}.json")
        st = chk(j, ymd(d))
        if st != "ok":
            return miss(st, ds, "（通常收盤後一段時間才公布）")
        STATS["ok"] += 1
        f_ = j["fields"]
        ic = next(i for i, x in enumerate(f_) if "證券代號" in x)
        inet = min(i for i, x in enumerate(f_) if "買賣超" in x)  # 第一組＝外資及陸資（不含外資自營商），和 BFI82U 口徑一致
        allr = [(r[ic].strip(), r[ic + 1].strip(), num(r[inet]) / 1000) for r in j["data"] if num(r[inet]) is not None]
        stk = sorted([x for x in allr if re.fullmatch(r"[1-9]\d{3}", x[0])], key=lambda x: -x[2])
        etf = sorted([x for x in allr if x[0].startswith("00")], key=lambda x: -x[2])
        emit(f"外資買賣超合計（張）：一般股票 {sgn(sum(x[2] for x in stk), ',.0f')}；ETF {sgn(sum(x[2] for x in etf), ',.0f')}。"
             "判斷外資賣壓在個股還是 ETF（ETF 多半是造市與套利部位），兩張表都要看。\n")
        emit("**一般股票**\n\n| 買超 | 張 | 賣超 | 張 |\n|---|---|---|---|")
        for a_, b_ in zip(stk[:10], sorted(stk, key=lambda x: x[2])[:10]):
            emit(f"| {a_[1]}（{a_[0]}） | {sgn(a_[2], ',.0f')} | {b_[1]}（{b_[0]}） | {sgn(b_[2], ',.0f')} |")
        emit("\n**ETF**\n\n| 買超 | 張 | 賣超 | 張 |\n|---|---|---|---|")
        for a_, b_ in zip(etf[:10], sorted(etf, key=lambda x: x[2])[:10]):
            emit(f"| {a_[1]}（{a_[0]}） | {sgn(a_[2], ',.0f')} | {b_[1]}（{b_[0]}） | {sgn(b_[2], ',.0f')} |")
        emit(f"\n口徑：外資及陸資（不含外資自營商），和三大法人表一致。來源：https://www.twse.com.tw/rwd/zh/fund/TWT38U?response=json&date={ymd(d)}\n")

    def s7():
        t = get(f"https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingIndex?date={d:%Y/%m/%d}&response=json", name=f"TPEX_{ymd(d)}.json", pause=0.5)
        if t is None:
            return miss("fail", ds)
        data = [r for r in json.loads(t)["tables"][0]["data"] if roc2iso(r[0]) <= ds]
        if not data or roc2iso(data[-1][0]) != ds:
            miss("none", ds)
        else:
            STATS["ok"] += 1
        emit("| 日期 | 櫃買指數 | 漲跌 | 漲跌幅 | 成交金額（億元） |\n|---|---|---|---|---|")
        for r in data[-5:]:
            c, ch = num(r[4]), num(r[5])
            emit(f"| {roc2iso(r[0])} | {fmt(c)} | {sgn(ch)} | {sgn(ch / (c - ch) * 100)}% | {fmt(num(r[2]) / 1e5)} |")
        emit(f"\n來源：https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingIndex?date={d:%Y/%m/%d}&response=json\n")

    def s8():
        emit("期交所把夜盤（盤後）標在**下一個交易日**：例如標 11/16 的盤後列，是 11/13 15:00 到 11/14 05:00 的夜盤。"
             "早報要用標為報告日（今天）的盤後列。每個交易日列出最近的兩個未到期月份。\n")
        st_, en = d - timedelta(days=12), cutd + timedelta(days=1)
        t = get("https://www.taifex.com.tw/cht/3/futDataDown",
                {"down_type": "1", "commodity_id": "TX", "commodity_id2": "",
                 "queryStartDate": f"{st_:%Y/%m/%d}", "queryEndDate": f"{en:%Y/%m/%d}"}, enc="big5", name=f"TX_{ymd(d)}.csv")
        if not t or "交易日期" not in t:
            return miss("fail", ds)
        rd = [r for r in csv.reader(t.strip().splitlines())][1:]
        rr = []
        for r in rd:
            if len(r) <= 17 or "/" in r[2]:
                continue
            day = datetime.strptime(r[0], "%Y/%m/%d").date()
            # 一般時段只到資料日 d；盤後（夜盤）可以到截止日（早報需要標為今天的夜盤）
            if (r[17] == "一般" and day <= d) or (r[17] == "盤後" and day <= cutd):
                rr.append(r)
        dates = sorted({r[0] for r in rr})[-4:]
        emit("| 交易日期 | 月份 | 時段 | 收盤 | 漲跌 | 結算價 | 未沖銷 | 成交量 |\n|---|---|---|---|---|---|---|---|")
        for dt in dates:
            months = sorted({r[2].strip() for r in rr if r[0] == dt})[:2]
            for r in rr:
                if r[0] == dt and r[2].strip() in months:
                    emit(f"| {r[0]} | {r[2].strip()} | {r[17]} | {r[6]} | {r[7]} | {r[10]} | {r[11]} | {r[9]} |")
        if not any(r[0] == f"{d:%Y/%m/%d}" and r[17] == "一般" for r in rr):
            miss("none", ds, "（一般交易時段）")
        else:
            STATS["ok"] += 1
        emit("\n來源：https://www.taifex.com.tw/cht/3/futDataDown（期貨每日交易行情下載，商品 TX）\n")

    def s9():
        tdays2 = [r["date"] for r in rows if r["date"] <= ds][-2:] if rows else []
        if ds not in tdays2:
            tdays2 = (tdays2 + [ds])[-2:]
        emit("| 日期 | 外資淨未平倉 | 投信淨未平倉 | 自營商淨未平倉 | 外資當日交易淨額 |\n|---|---|---|---|---|")
        last_state = "ok"
        for td in tdays2:
            q = td.replace("-", "/")
            t = get("https://www.taifex.com.tw/cht/3/futContractsDate",
                    {"queryType": "1", "goDay": "", "doQuery": "1", "dateaddcnt": "", "queryDate": q, "commodityId": "TXF"},
                    name=f"futContracts_{td}.html")
            if not t:
                emit(f"| {td} | 抓取失敗 | | | |")
                last_state = "fail"
                continue
            s = re.sub(r"<script.*?</script>|<style.*?</style>", "", t, flags=re.S)
            s = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))
            if f"日期{q}" not in s.replace(" ", ""):
                emit(f"| {td} | 尚未公布 | | | |")
                last_state = "none"
                continue
            last_state = "ok"
            seg = s[s.find("臺股期貨"):]
            res = {}
            for who in ("自營商", "投信", "外資"):
                m = re.search(who + r" ((?:-?[\d,]+ ){12})", seg)
                if m:
                    v = [num(x) for x in m.group(1).split()]
                    res[who] = (v[10], v[4])
            if "外資" not in res:
                raise ValueError("期交所表格格式改變，找不到外資列")
            emit(f"| {td} | {sgn(res['外資'][0], ',.0f')} | {sgn(res.get('投信', (None,))[0], ',.0f')} | "
                 f"{sgn(res.get('自營商', (None,))[0], ',.0f')} | {sgn(res['外資'][1], ',.0f')} |")
        if last_state == "ok":
            STATS["ok"] += 1
        else:
            STATS[last_state] += 1
        emit("\n口徑：臺股期貨（大台）的未平倉多空淨額（RULES.md 4.7）。來源：https://www.taifex.com.tw/cht/3/futContractsDate（依日期查詢，臺股期貨）\n")

    def s10():
        t = get("https://www.taifex.com.tw/cht/3/pcRatio", name=f"pcRatio_{ymd(d)}.html")
        if not t:
            return miss("fail", ds)
        s = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>", "", t, flags=re.S)))
        rows_pc = [r for r in re.findall(r"(\d{4}/\d{1,2}/\d{1,2}) ([\d,]+) ([\d,]+) ([\d.]+) ([\d,]+) ([\d,]+) ([\d.]+)", s)
                   if datetime.strptime(r[0], "%Y/%m/%d").date() <= d]
        if not rows_pc or datetime.strptime(rows_pc[0][0], "%Y/%m/%d").date() != d:
            miss("none", ds)
        else:
            STATS["ok"] += 1
        emit("| 日期 | 成交量比率 | 未平倉量比率 |\n|---|---|---|")
        for r in rows_pc[:5]:
            emit(f"| {r[0]} | {r[3]}% | {r[6]}% |")
        emit("\n來源：https://www.taifex.com.tw/cht/3/pcRatio\n")

    def s11():
        t = get("https://www.taifex.com.tw/cht/9/futuresQADetail", name=f"weights_{ymd(d)}.html")
        if not t:
            return miss("fail", ds)
        tx = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>", "", t, flags=re.S)))
        w = [(m.group(1), m.group(2), m.group(3), float(m.group(4))) for m in re.finditer(r" (\d{1,3}) (\d{4}) (\S+) ([\d.]+)%", tx)]
        w = sorted({x[1]: x for x in w}.values(), key=lambda x: -x[3])[:20]
        if not w or not PRICES or not rows:
            return miss("fail" if not w else "none", ds, "（權重或個股價格缺資料）")
        STATS["ok"] += 1
        base = rows[-1]["close"] - rows[-1]["chg"]
        emit(f"前一日加權指數 {fmt(base)}。貢獻點數＝前一日指數 × 市值權重 × 個股漲跌幅（AI 估算，權重用期交所公布的最新市值比重，和當天實際權重略有差異）。\n")
        emit("| 個股 | 權重 | 收盤 | 漲跌幅 | 貢獻點數 |\n|---|---|---|---|---|")
        tot = 0
        for _, code, name, wt in w:
            pz = PRICES.get(code)
            if not pz:
                emit(f"| {name}（{code}） | {wt:.2f}% | 查無 | | |")
                continue
            ctb = base * wt / 100 * pz[3] / 100
            tot += ctb
            emit(f"| {name}（{code}） | {wt:.2f}% | {fmt(pz[2])} | {sgn(pz[3])}% | {sgn(ctb, ',.0f')} |")
        emit(f"\n前 20 大權值股合計貢獻約 {sgn(tot, ',.0f')} 點；當天加權漲跌 {sgn(rows[-1]['chg'])} 點。")
        emit("\n來源：期交所「臺灣證券交易所發行量加權股價指數成分股暨市值比重」https://www.taifex.com.tw/cht/9/futuresQADetail ；個股價格同 3b 節。\n")

    for title, fn in (("1. 加權指數（證交所 FMTQIK）", s1), ("1b. 加權指數開高低、振幅與缺口（證交所 MI_5MINS_HIST）", s1b),
                      ("2. 成交統計與漲跌家數（證交所 MI_INDEX type=MS）", s2),
                      ("3. 類股指數（證交所 MI_INDEX type=IND，依漲跌幅排序）", s3), ("3b. 成交金額前 20 名個股（證交所 MI_INDEX）", s3b),
                      ("4. 三大法人買賣超（證交所 BFI82U，億元）", s4), ("5. 融資融券（證交所 MI_MARGN）", s5),
                      ("6. 外資個股買賣超前 10 名（證交所 TWT38U，張）", s6), ("7. 櫃買指數（櫃買中心）", s7),
                      ("8. 台指期（期交所，一般與盤後交易時段）", s8), ("9. 三大法人台指期未平倉（期交所，臺股期貨＝大台，口）", s9),
                      ("10. 臺指選擇權 Put/Call 比（期交所）", s10), ("11. 前 20 大權值股與指數貢獻點數（AI 估算）", s11)):
        section(title, fn)
    emit(f"## 總結\n\n成功 {STATS['ok']}／尚未公布 {STATS['none']}／抓取失敗或腳本錯誤 {STATS['fail']}。")
    if d < cutd and (STATS["none"] or STATS["fail"]):
        emit("**早報用的是前一個交易日的資料，照理全部都應該已公布：任何「尚未公布」「抓取失敗」都是異常，要先手動到官方網站確認，不可照寫。**")
    if STATS["fail"]:
        emit("**有抓取失敗或腳本錯誤的項目：手動抓取並確認，不可寫成「尚未公布」。**")
    flush()


# ---------------------------------------------------------------- 個股
def stock(code, d, until, outdir):
    ds = d.isoformat()
    emit(f"# 個股官方資料 {code}（twdata.py 產生，{datetime.now():%Y-%m-%d %H:%M} 抓取；股價到 {ds}，法人與融資到 {until.isoformat()}）\n")
    rows, name = [], ""
    for m in months_back(d, 14):
        j = getj(f"{TWSE}afterTrading/STOCK_DAY?date={ymd(m)}&stockNo={code}&response=json", f"STOCK_DAY_{code}_{m:%Y%m}.json")
        if not j or j.get("stat") != "OK":
            continue
        name = name or (j.get("title") or "")
        for r in j["data"]:
            try:
                rows.append({"date": roc2iso(r[0]), "open": num(r[3]), "high": num(r[4]), "low": num(r[5]),
                             "close": num(r[6]), "volume": round(num(r[1]) / 1000)})
            except (TypeError, ValueError):
                continue
    rows = sorted({r["date"]: r for r in rows if r["close"] is not None}.values(), key=lambda r: r["date"])
    rows = [r for r in rows if r["date"] <= ds]
    if not rows:
        emit("抓不到日資料（上櫃股票請改用櫃買中心）。")
        return
    p = os.path.join(outdir, f"px-tw-{code}.csv")
    with open(p, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "open", "high", "low", "close", "volume"])
        for r in rows:
            w.writerow([r["date"], r["open"], r["high"], r["low"], r["close"], r["volume"]])
    last = rows[-1]
    emit(f"## 1. 日資料（證交所 STOCK_DAY）\n\n{name.strip()}；{len(rows)} 筆，{rows[0]['date']} 至 {last['date']}，存成 `{p}`（成交量單位：張；未還原除權息）。")
    if last["date"] != ds:
        emit(f"\n**{ds} 尚未公布**（最新 {last['date']}）")
    emit(f"\n最後一筆：{last['date']} 開 {last['open']} 高 {last['high']} 低 {last['low']} 收 {last['close']} 量 {last['volume']:,} 張；"
         f"前收 {rows[-2]['close']}，漲跌 {sgn(last['close'] - rows[-2]['close'])}（{sgn((last['close'] / rows[-2]['close'] - 1) * 100)}%）。")
    emit("均線、報酬、52 週高低、RSI 請跑 `python daily/tools/stockviz.py stats " + p.replace("\\", "/") + "`。\n")

    flush()
    tdays = [r["date"] for r in rows if r["date"] <= until.isoformat()][-20:]
    section(f"2. 三大法人買賣超（證交所 T86，張；{tdays[0]} 至 {tdays[-1]}）", lambda: _t86(code, tdays))
    section("3. 融資融券（證交所 MI_MARGN，張）", lambda: _margin(code, tdays))
    section("4. 本益比、殖利率、股價淨值比（證交所 BWIBBU_d）", lambda: _bwibbu(code, d, ds, rows))
    section("5. 外資持股比率（證交所 MI_QFIIS）", lambda: _qfiis(code, until))


def _t86(code, tdays):
    emit("| 日期 | 外資 | 投信 | 自營商 | 合計 |\n|---|---|---|---|---|")
    tot = [0, 0, 0, 0]
    for td in tdays:
        dd = td.replace("-", "")
        j = getj(f"{TWSE}fund/T86?date={dd}&selectType=ALLBUT0999&response=json", f"T86_{dd}.json")
        st = chk(j, None)
        if st != "ok":
            emit(f"| {td} | {'抓取失敗' if st == 'fail' else '尚未公布'} | | | |")
            STATS[st] += 1
            continue
        f_ = j["fields"]
        r = next((x for x in j["data"] if x[0].strip() == code), None)
        if not r:
            emit(f"| {td} | 0 | 0 | 0 | 0 |")
            continue
        def col(k):  # noqa
            i = next(i for i, x in enumerate(f_) if x.replace(" ", "").startswith(k))
            return num(r[i])
        fx = col("外陸資買賣超股數(不含外資自營商)")
        fxd = col("外資自營商買賣超股數") or 0
        if fxd:
            emit(f"| {td} | 注意：外資自營商 {sgn(fxd / 1000, ',.0f')} 張（不含在外資欄） | | | |")
        it = col("投信買賣超股數")
        dl = col("自營商買賣超股數")
        al = col("三大法人買賣超股數")
        for k, v in enumerate((fx, it, dl, al)):
            tot[k] += v
        emit(f"| {td} | {sgn(fx / 1000, ',.0f')} | {sgn(it / 1000, ',.0f')} | {sgn(dl / 1000, ',.0f')} | {sgn(al / 1000, ',.0f')} |")
    emit(f"| **{len(tdays)} 日累計** | **{sgn(tot[0] / 1000, ',.0f')}** | **{sgn(tot[1] / 1000, ',.0f')}** | **{sgn(tot[2] / 1000, ',.0f')}** | **{sgn(tot[3] / 1000, ',.0f')}** |")
    emit("\n累計以股數加總後換算為張。外資＝外陸資（不含外資自營商），和三大法人表口徑一致；外資自營商不為 0 時另列一行。來源：https://www.twse.com.tw/rwd/zh/fund/T86?date=YYYYMMDD&selectType=ALLBUT0999&response=json\n")



def _margin(code, tdays):
    emit("| 日期 | 融資餘額 | 融券餘額 |\n|---|---|---|")
    pick = [tdays[0], tdays[len(tdays) // 2], tdays[-1]] if len(tdays) >= 3 else tdays
    for td in sorted(set(pick)):
        dd = td.replace("-", "")
        j = getj(f"{TWSE}marginTrading/MI_MARGN?date={dd}&selectType=ALL&response=json", f"MI_MARGN_{dd}.json")
        st = chk(j, None)
        if st != "ok":
            emit(f"| {td} | {'抓取失敗' if st == 'fail' else '尚未公布'} | |")
            STATS[st] += 1
            continue
        tb = j["tables"][1] if len(j.get("tables", [])) > 1 else j["tables"][0]
        fl = [x.strip() for x in tb["fields"]]
        if not (fl[6] == "今日餘額" and fl[12] == "今日餘額"):
            raise ValueError(f"MI_MARGN 欄位改變：{fl[:14]}")
        r = next((x for x in tb["data"] if x[0].strip() == code), None)
        if r:
            emit(f"| {td} | {r[6]} | {r[12]} |")
    emit("\n欄位：融資今日餘額、融券今日餘額。來源：https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=YYYYMMDD&selectType=ALL&response=json\n")



def _bwibbu(code, d, ds, rows):
    j = getj(f"{TWSE}afterTrading/BWIBBU_d?date={ymd(d)}&selectType=ALL&response=json", f"BWIBBU_{ymd(d)}.json")
    used = ymd(d)
    if not j or j.get("stat") != "OK" or j.get("date") != ymd(d):
        prev = rows[-2]["date"] if rows[-1]["date"] == ds else rows[-1]["date"]
        used = prev.replace("-", "")
        emit(f"**{ds} 尚未公布**，以下改列前一交易日 {prev} 的資料（引用時要寫明日期）。\n")
        j = getj(f"{TWSE}afterTrading/BWIBBU_d?date={used}&selectType=ALL&response=json", f"BWIBBU_{used}.json")
    if j and j.get("stat") == "OK":
        r = next((x for x in j["data"] if x[0].strip() == code), None)
        if r:
            emit(" ／ ".join(f"{a}：{b}" for a, b in zip(j["fields"], r)))
        emit(f"\n來源：https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_d?date={used}&selectType=ALL&response=json\n")



def _qfiis(code, until):
    dd = until.strftime("%Y%m%d")
    j = getj(f"{TWSE}fund/MI_QFIIS?date={dd}&selectType=ALLBUT0999&response=json", f"MI_QFIIS_{dd}.json")
    st = chk(j, None)
    if st != "ok":
        miss(st, until.isoformat())
    else:
        r = next((x for x in j["data"] if x[0].strip() == code), None)
        if r:
            emit(f"{until.isoformat()}：" + " ／ ".join(f"{a}：{b}" for a, b in zip(j["fields"], r) if "持股" in a or "發行" in a))
        emit(f"\n來源：https://www.twse.com.tw/rwd/zh/fund/MI_QFIIS?date={dd}&selectType=ALLBUT0999&response=json\n")


def main():
    global RAW
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("market"); s.add_argument("date"); s.add_argument("--out"); s.add_argument("--cutoff")
    s = sp.add_parser("stock"); s.add_argument("code"); s.add_argument("date"); s.add_argument("--chips-until"); s.add_argument("--out")
    a = p.parse_args()
    if a.date.startswith("prev-"):
        # 「prev-YYYY-MM-DD」：該日之前最近一個台股交易日（早報用，自動處理週一、連假）
        base = datetime.strptime(a.date[5:], "%Y-%m-%d").date()
        prev = [r["date"] for r in fmtqik_series(base) if r["date"] < base.isoformat()]
        d = datetime.strptime(prev[-1], "%Y-%m-%d").date()
        print(f"前一個台股交易日：{d}")
        a.out = a.out or os.path.join("_research", base.isoformat())
    else:
        d = datetime.strptime(a.date, "%Y-%m-%d").date()
    out = a.out or os.path.join("_research", d.isoformat())
    os.makedirs(out, exist_ok=True)
    RAW = os.path.join(out, "raw-tools")
    os.makedirs(RAW, exist_ok=True)
    if a.cmd == "market":
        cut = datetime.strptime(a.cutoff, "%Y-%m-%d %H:%M") if a.cutoff else datetime.now()
        FN[0] = os.path.join(out, f"official-tw-{ymd(d)}.md")
        market(d, cut)
        fn = FN[0]
    else:
        if a.chips_until == "prev":
            # 前一個台股交易日（午報用：當天的法人與融資 15:30 時還沒公布）
            prev = [r["date"] for r in fmtqik_series(d) if r["date"] < d.isoformat()]
            until = datetime.strptime(prev[-1], "%Y-%m-%d").date()
        else:
            until = datetime.strptime(a.chips_until, "%Y-%m-%d").date() if a.chips_until else d
        FN[0] = os.path.join(out, f"stock-tw-{a.code}.md")
        stock(a.code, d, until, out)
        fn = FN[0]
    txt = "\n".join(OUT) + "\n"
    with open(fn, "w", encoding="utf-8") as f:
        f.write(txt)
    print(txt)
    print(f"（已存成 {fn}）")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
