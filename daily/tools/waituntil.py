# -*- coding: utf-8 -*-
"""市場日報：等到台北時間 HH:MM 才結束（早報 06:30 開始準備，07:00 以後才能抓截止價格與做最後新聞掃描）。

用法（在 C:\\Users\\User\\Desktop\\news 執行）：
  python daily/tools/waituntil.py 07:00
      現在已經過了指定時間：馬上印出 OK。還沒到：最多等 9 分鐘（配合 Bash 的 10 分鐘上限）；
      等到了印 OK（結束碼 0），還沒到印 WAIT 和剩餘分鐘數（結束碼 3），再執行一次即可。
不要乾等：等待前先把能寫的段落寫完，真的沒事做才用這支程式。
"""
import sys
import time
from datetime import datetime, timedelta, timezone

TPE = timezone(timedelta(hours=8))


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    hh, mm = map(int, sys.argv[1].split(":"))
    now = datetime.now(TPE)
    target = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if now >= target:
        print(f"OK 現在 {now:%H:%M}，已過 {sys.argv[1]}")
        return
    wait = (target - now).total_seconds()
    if wait <= 9 * 60:
        time.sleep(wait + 1)
        print(f"OK 已等到 {sys.argv[1]}")
        return
    time.sleep(9 * 60)
    left = (target - datetime.now(TPE)).total_seconds() / 60
    print(f"WAIT 還要約 {left:.0f} 分鐘才到 {sys.argv[1]}，再執行一次")
    sys.exit(3)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
