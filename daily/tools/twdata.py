# -*- coding: utf-8 -*-
"""市場日報：台股官方資料一次抓完（證交所、櫃買中心、期交所）。只用 Python 標準函式庫。

用法（在 C:\\Users\\User\\Desktop\\news 執行）：
  python daily/tools/twdata.py market YYYY-MM-DD [--out _research/YYYY-MM-DD]
      台股大盤：加權指數近 10 日、自算均線、52 週高低（收盤）、成交值、漲跌家數、類股、三大法人（近 5 日）、
      融資融券、外資買賣超前 10 名、櫃買指數、台指期（一般與盤後）、三大法人期貨未平倉、P/C 比。
      日期＝要抓的交易日（早報用前一個交易日，午報用今天）。
  python daily/tools/twdata.py stock 代號 YYYY-MM-DD [--chips-until YYYY-MM-DD] [--out 資料夾]
      個股：近 14 個月日資料存成 px-tw-代號.csv；近 20 個交易日法人買賣超、融資融券；本益比、殖利率、淨值比；外資持股。
      法人與融資只抓到 --chips-until（午報要設成前一個交易日，因為 15:30 時當天還沒公布）。

輸出：Markdown 印到螢幕，並存成 out 資料夾裡的 official-tw-YYYYMMDD.md（或 stock-tw-代號.md）；原始回應存在 out/raw-tools/。
每一項都會檢查回傳日期；還沒公布或日期不符時寫「尚未公布」，絕不拿其他日期代替。
"""
import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
TWSE = "https://www.twse.com.tw/rwd/zh/"
OUT = []
RAW = None
_last = [0.0]


def emit(s=""):
    OUT.append(s)


def get(url, data=None, enc="utf-8", name=None, pause=1.6):
    """抓網址，失敗重試 3 次；證交所有頻率限制，每次間隔 pause 秒。"""
    wait = pause - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    body = urllib.parse.urlencode(data).encode() if data else None
    for k in range(3):
        try:
            req = urllib.request.Request(url, data=body, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                txt = r.read().decode(enc, errors="replace")
            _last[0] = time.time()
            if RAW and name:
                with open(os.path.join(RAW, name), "w", encoding="utf-8") as f:
                    f.write(txt)
            return txt
        except Exception as e:  # noqa
            _last[0] = time.time()
            if k == 2:
                return None
            time.sleep(3 + 3 * k)


def getj(url, name=None):
    t = get(url, name=name)
    try:
        return json.loads(t) if t else None
    except ValueError:
        return None


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


def market(d, mode):
    ds = d.isoformat()
    emit(f"# 台股官方資料 {ds}（twdata.py 產生，{datetime.now():%Y-%m-%d %H:%M} 抓取）\n")
    emit("每一項都檢查過回傳日期；寫「尚未公布」的項目，代表抓取時官方還沒有這一天的資料。\n")

    # 1. 加權指數
    rows = fmtqik_series(d)
    emit("## 1. 加權指數（證交所 FMTQIK）\n")
    if not rows or rows[-1]["date"] != ds:
        emit(f"**{ds} 尚未公布**（最新一筆：{rows[-1]['date'] if rows else '無'}）。以下數字到最新一筆為止。\n")
    if rows:
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
        emit(f"成交金額：5 日均 {fmt(sum(a[-5:]) / 5)} 億、20 日均 {fmt(sum(a[-20:]) / 20)} 億。\n")
        emit(f"來源：https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?response=json&date={ymd(d)}\n")

    # 2. 大盤統計與漲跌家數
    emit("## 2. 成交統計與漲跌家數（證交所 MI_INDEX type=MS）\n")
    j = getj(f"{TWSE}afterTrading/MI_INDEX?response=json&date={ymd(d)}&type=MS", f"MI_MS_{ymd(d)}.json")
    if not j or j.get("stat") != "OK" or j.get("date") != ymd(d):
        emit(f"**{ds} 尚未公布**\n")
    else:
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

    # 3. 類股
    emit("## 3. 類股指數（證交所 MI_INDEX type=IND，依漲跌幅排序）\n")
    j = getj(f"{TWSE}afterTrading/MI_INDEX?response=json&date={ymd(d)}&type=IND", f"MI_IND_{ymd(d)}.json")
    if not j or j.get("stat") != "OK" or j.get("date") != ymd(d):
        emit(f"**{ds} 尚未公布**\n")
    else:
        items = []
        for t in j.get("tables", []):
            if (t.get("title") or "").endswith("價格指數(臺灣證券交易所)"):
                for r in t["data"]:
                    sign = -1 if "green" in r[2] or "-" in re.sub("<[^>]+>", "", r[2]) else 1
                    items.append((r[0], num(r[1]), sign * abs(num(r[3])), sign * abs(num(r[4]))))
        keep = ("發行量加權股價指數", "未含金融保險股指數", "未含電子股指數", "未含金融電子股指數")
        items = [x for x in items if (x[0] in keep or "類指數" in x[0]) and not any(k in x[0] for k in ("反向", "兩倍", "槓桿"))]
        items.sort(key=lambda x: -x[3])
        emit("| 指數 | 收盤 | 漲跌點數 | 漲跌幅 |\n|---|---|---|---|")
        for n_, c, p, pc in items:
            emit(f"| {n_} | {fmt(c)} | {sgn(p)} | {sgn(pc)}% |")
        emit(f"\n來源：https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date={ymd(d)}&type=IND\n")

    # 4. 三大法人（近 5 個交易日）
    emit("## 4. 三大法人買賣超（證交所 BFI82U，億元）\n")
    emit("外資＝「外資及陸資（不含外資自營商）」那一列（RULES.md 4.7 口徑）。午報時是 15:30 前的初版，晚間可能修正。\n")
    tdays = [r["date"] for r in rows][-5:] if rows else []
    if ds not in tdays:
        tdays = (tdays + [ds])[-5:]
    emit("| 日期 | 外資 | 外資自營商 | 投信 | 自營商（自行） | 自營商（避險） | 合計 |\n|---|---|---|---|---|---|---|")
    for td in tdays:
        dd = td.replace("-", "")
        j = getj(f"{TWSE}fund/BFI82U?response=json&type=day&dayDate={dd}", f"BFI82U_{dd}.json")
        if not j or j.get("stat") != "OK" or j.get("date") != dd:
            emit(f"| {td} | 尚未公布 | | | | | |")
            continue
        v = {re.sub(r"\s", "", r[0]): num(r[3]) / 1e8 for r in j["data"]}
        g = lambda k: next((x for kk, x in v.items() if kk.startswith(k)), None)  # noqa
        emit(f"| {td} | {sgn(g('外資及陸資'))} | {sgn(g('外資自營商'))} | {sgn(g('投信'))} | {sgn(g('自營商(自行'))} | {sgn(g('自營商(避險'))} | {sgn(g('合計'))} |")
    emit(f"\n來源：https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&type=day&dayDate={ymd(d)}\n")

    # 5. 融資融券
    emit("## 5. 融資融券（證交所 MI_MARGN）\n")
    j = getj(f"{TWSE}marginTrading/MI_MARGN?response=json&selectType=MS&date={ymd(d)}", f"MI_MARGN_MS_{ymd(d)}.json")
    if not j or j.get("stat") != "OK" or j.get("date") != ymd(d):
        emit(f"**{ds} 尚未公布**（通常晚間公布）\n")
    else:
        t = j["tables"][0] if j.get("tables") else {"fields": j.get("fields"), "data": j.get("data")}
        emit("| 項目 | " + " | ".join(t["fields"][1:]) + " |\n|" + "---|" * len(t["fields"]))
        for r in t["data"]:
            emit("| " + " | ".join(r) + " |")
        emit(f"\n來源：https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&selectType=MS&date={ymd(d)}\n")

    # 6. 外資買賣超前 10 名
    emit("## 6. 外資個股買賣超前 10 名（證交所 TWT38U，張）\n")
    j = getj(f"{TWSE}fund/TWT38U?response=json&date={ymd(d)}", f"TWT38U_{ymd(d)}.json")
    if not j or j.get("stat") != "OK" or j.get("date") != ymd(d):
        emit(f"**{ds} 尚未公布**（通常收盤後一段時間才公布）\n")
    else:
        f_ = j["fields"]
        ic = next(i for i, x in enumerate(f_) if "證券代號" in x)
        iname = ic + 1
        inet = max(i for i, x in enumerate(f_) if "買賣超" in x)
        lst = [(r[ic].strip(), r[iname].strip(), num(r[inet]) / 1000) for r in j["data"] if num(r[inet]) is not None]
        lst.sort(key=lambda x: -x[2])
        emit("| 買超 | 張 | 賣超 | 張 |\n|---|---|---|---|")
        for a_, b_ in zip(lst[:10], sorted(lst, key=lambda x: x[2])[:10]):
            emit(f"| {a_[1]}（{a_[0]}） | {sgn(a_[2], ',.0f')} | {b_[1]}（{b_[0]}） | {sgn(b_[2], ',.0f')} |")
        emit(f"\n來源：https://www.twse.com.tw/rwd/zh/fund/TWT38U?response=json&date={ymd(d)}\n")

    # 7. 櫃買指數
    emit("## 7. 櫃買指數（櫃買中心）\n")
    t = get(f"https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingIndex?date={d:%Y/%m/%d}&response=json", name=f"TPEX_{ymd(d)}.json", pause=0.5)
    try:
        jt = json.loads(t)
        data = jt["tables"][0]["data"]
        last5 = data[-5:]
        if roc2iso(data[-1][0]) != ds:
            emit(f"**{ds} 尚未公布**（最新 {roc2iso(data[-1][0])}）")
        emit("| 日期 | 櫃買指數 | 漲跌 | 成交金額（億元） |\n|---|---|---|---|")
        for r in last5:
            emit(f"| {roc2iso(r[0])} | {fmt(num(r[4]))} | {sgn(num(r[5]))} | {fmt(num(r[2]) / 1e5)} |")
        emit(f"\n來源：https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingIndex?date={d:%Y/%m/%d}&response=json\n")
    except Exception:  # noqa
        emit("抓取失敗，請改用中央社或鉅亨網的收盤報導並標「非官方來源」。\n")

    # 8. 台指期行情
    emit("## 8. 台指期（期交所，一般與盤後交易時段）\n")
    emit("期交所把夜盤（盤後）標在**下一個交易日**：例如標 11/16 的盤後列，是 11/13 15:00 到 11/14 05:00 的夜盤。\n")
    st = d - timedelta(days=10)
    en = d + timedelta(days=4)
    t = get("https://www.taifex.com.tw/cht/3/futDataDown",
            {"down_type": "1", "commodity_id": "TX", "commodity_id2": "",
             "queryStartDate": f"{st:%Y/%m/%d}", "queryEndDate": f"{en:%Y/%m/%d}"}, enc="big5", name=f"TX_{ymd(d)}.csv")
    if t and "交易日期" in t:
        rd = list(csv.reader(t.strip().splitlines()))
        hdr = rd[0]
        rr = [r for r in rd[1:] if len(r) > 17]
        months = sorted({r[2].strip() for r in rr if "/" not in r[2]})[:2]
        dates = sorted({r[0] for r in rr})[-4:]
        emit("| 交易日期 | 月份 | 時段 | 收盤 | 漲跌 | 結算價 | 未沖銷 | 成交量 |\n|---|---|---|---|---|---|---|---|")
        for r in rr:
            if r[0] in dates and r[2].strip() in months:
                emit(f"| {r[0]} | {r[2].strip()} | {r[17]} | {r[6]} | {r[7]} | {r[10]} | {r[11]} | {r[9]} |")
        if f"{d:%Y/%m/%d}" not in dates:
            emit(f"\n**{ds} 一般時段尚未公布**")
        emit("\n來源：https://www.taifex.com.tw/cht/3/futDataDown（期貨每日交易行情下載，商品 TX）\n")
    else:
        emit("抓取失敗。\n")

    # 9. 三大法人期貨（臺股期貨）
    emit("## 9. 三大法人台指期未平倉（期交所，臺股期貨＝大台，口）\n")
    tdays2 = ([r["date"] for r in rows][-2:] if rows else [])
    if ds not in tdays2:
        tdays2 = (tdays2 + [ds])[-2:]
    emit("| 日期 | 外資淨未平倉 | 投信淨未平倉 | 自營商淨未平倉 | 外資當日交易淨額 |\n|---|---|---|---|---|")
    for td in tdays2:
        q = td.replace("-", "/")
        t = get("https://www.taifex.com.tw/cht/3/futContractsDate",
                {"queryType": "1", "goDay": "", "doQuery": "1", "dateaddcnt": "", "queryDate": q, "commodityId": "TXF"},
                name=f"futContracts_{td}.html")
        if not t:
            emit(f"| {td} | 抓取失敗 | | | |")
            continue
        s = re.sub(r"<script.*?</script>|<style.*?</style>", "", t, flags=re.S)
        s = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))
        if f"日期{q}" not in s.replace(" ", ""):
            emit(f"| {td} | 尚未公布 | | | |")
            continue
        seg = s[s.find("臺股期貨"):]
        res = {}
        for who in ("自營商", "投信", "外資"):
            m = re.search(who + r" ((?:-?[\d,]+ ){12})", seg)
            if m:
                v = [num(x) for x in m.group(1).split()]
                res[who] = (v[10], v[4])
        emit(f"| {td} | {sgn(res.get('外資', (None,))[0], ',.0f')} | {sgn(res.get('投信', (None,))[0], ',.0f')} | "
             f"{sgn(res.get('自營商', (None,))[0], ',.0f')} | {sgn(res.get('外資', (None, None))[1], ',.0f')} |")
    emit("\n來源：https://www.taifex.com.tw/cht/3/futContractsDate（依日期查詢，臺股期貨）\n")

    # 10. P/C 比
    emit("## 10. 臺指選擇權 Put/Call 比（期交所）\n")
    t = get("https://www.taifex.com.tw/cht/3/pcRatio", name=f"pcRatio_{ymd(d)}.html")
    if t:
        s = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", re.sub(r"<script.*?</script>", "", t, flags=re.S)))
        rows_pc = re.findall(r"(\d{4}/\d{1,2}/\d{1,2}) ([\d,]+) ([\d,]+) ([\d.]+) ([\d,]+) ([\d,]+) ([\d.]+)", s)
        emit("| 日期 | 成交量比率 | 未平倉量比率 |\n|---|---|---|")
        for r in rows_pc[:5]:
            emit(f"| {r[0]} | {r[3]}% | {r[6]}% |")
        if not rows_pc or datetime.strptime(rows_pc[0][0], "%Y/%m/%d").date() != d:
            emit(f"\n**{ds} 尚未公布**")
        emit("\n來源：https://www.taifex.com.tw/cht/3/pcRatio\n")


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

    tdays = [r["date"] for r in rows if r["date"] <= until.isoformat()][-20:]
    emit(f"## 2. 三大法人買賣超（證交所 T86，張；{tdays[0]} 至 {tdays[-1]}）\n")
    emit("| 日期 | 外資 | 投信 | 自營商 | 合計 |\n|---|---|---|---|---|")
    tot = [0, 0, 0, 0]
    for td in tdays:
        dd = td.replace("-", "")
        j = getj(f"{TWSE}fund/T86?date={dd}&selectType=ALLBUT0999&response=json", f"T86_{dd}.json")
        if not j or j.get("stat") != "OK":
            emit(f"| {td} | 尚未公布 | | | |")
            continue
        f_ = j["fields"]
        r = next((x for x in j["data"] if x[0].strip() == code), None)
        if not r:
            emit(f"| {td} | 0 | 0 | 0 | 0 |")
            continue
        def col(k):  # noqa
            i = next(i for i, x in enumerate(f_) if x.replace(" ", "").startswith(k))
            return num(r[i])
        fx = col("外陸資買賣超股數(不含外資自營商)") + (col("外資自營商買賣超股數") or 0)
        it = col("投信買賣超股數")
        dl = col("自營商買賣超股數")
        al = col("三大法人買賣超股數")
        for k, v in enumerate((fx, it, dl, al)):
            tot[k] += v
        emit(f"| {td} | {sgn(fx / 1000, ',.0f')} | {sgn(it / 1000, ',.0f')} | {sgn(dl / 1000, ',.0f')} | {sgn(al / 1000, ',.0f')} |")
    emit(f"| **{len(tdays)} 日累計** | **{sgn(tot[0] / 1000, ',.0f')}** | **{sgn(tot[1] / 1000, ',.0f')}** | **{sgn(tot[2] / 1000, ',.0f')}** | **{sgn(tot[3] / 1000, ',.0f')}** |")
    emit("\n累計以股數加總後換算為張。外資＝外陸資（不含外資自營商）＋外資自營商。來源：https://www.twse.com.tw/rwd/zh/fund/T86?date=YYYYMMDD&selectType=ALLBUT0999&response=json\n")

    emit(f"## 3. 融資融券（證交所 MI_MARGN，張）\n")
    emit("| 日期 | 融資餘額 | 融券餘額 |\n|---|---|---|")
    pick = [tdays[0], tdays[len(tdays) // 2], tdays[-1]] if len(tdays) >= 3 else tdays
    for td in sorted(set(pick)):
        dd = td.replace("-", "")
        j = getj(f"{TWSE}marginTrading/MI_MARGN?date={dd}&selectType=ALL&response=json", f"MI_MARGN_{dd}.json")
        if not j or j.get("stat") != "OK":
            emit(f"| {td} | 尚未公布 | |")
            continue
        tb = j["tables"][1] if len(j.get("tables", [])) > 1 else j["tables"][0]
        r = next((x for x in tb["data"] if x[0].strip() == code), None)
        if r:
            emit(f"| {td} | {r[6]} | {r[12]} |")
    emit("\n欄位：融資今日餘額、融券今日餘額。來源：https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=YYYYMMDD&selectType=ALL&response=json\n")

    emit("## 4. 本益比、殖利率、股價淨值比（證交所 BWIBBU_d）\n")
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

    emit("## 5. 外資持股比率（證交所 MI_QFIIS）\n")
    dd = until.strftime("%Y%m%d")
    j = getj(f"{TWSE}fund/MI_QFIIS?date={dd}&selectType=ALLBUT0999&response=json", f"MI_QFIIS_{dd}.json")
    if not j or j.get("stat") != "OK":
        emit(f"**{until.isoformat()} 尚未公布**\n")
    else:
        r = next((x for x in j["data"] if x[0].strip() == code), None)
        if r:
            emit(f"{until.isoformat()}：" + " ／ ".join(f"{a}：{b}" for a, b in zip(j["fields"], r) if "持股" in a or "發行" in a))
        emit(f"\n來源：https://www.twse.com.tw/rwd/zh/fund/MI_QFIIS?date={dd}&selectType=ALLBUT0999&response=json\n")


def main():
    global RAW
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("market"); s.add_argument("date"); s.add_argument("--out"); s.add_argument("--mode", default="")
    s = sp.add_parser("stock"); s.add_argument("code"); s.add_argument("date"); s.add_argument("--chips-until"); s.add_argument("--out")
    a = p.parse_args()
    d = datetime.strptime(a.date, "%Y-%m-%d").date()
    out = a.out or os.path.join("_research", d.isoformat())
    os.makedirs(out, exist_ok=True)
    RAW = os.path.join(out, "raw-tools")
    os.makedirs(RAW, exist_ok=True)
    if a.cmd == "market":
        market(d, a.mode)
        fn = os.path.join(out, f"official-tw-{ymd(d)}.md")
    else:
        until = datetime.strptime(a.chips_until, "%Y-%m-%d").date() if a.chips_until else d
        stock(a.code, d, until, out)
        fn = os.path.join(out, f"stock-tw-{a.code}.md")
    txt = "\n".join(OUT) + "\n"
    with open(fn, "w", encoding="utf-8") as f:
        f.write(txt)
    print(txt)
    print(f"（已存成 {fn}）")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
