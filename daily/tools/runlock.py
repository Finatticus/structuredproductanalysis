# -*- coding: utf-8 -*-
"""市場日報：早報與午報的執行鎖，避免兩份報告同時改 reports.js、view-log.md、lessons.md。

鎖檔：C:\\Users\\User\\Desktop\\news\\_research\\.lock（不進 git）。超過 120 分鐘的鎖視為過期（中途當掉沒解鎖時，下一次執行不會被卡住）。
用法（在 C:\\Users\\User\\Desktop\\news 執行）：
  python daily/tools/runlock.py acquire am|pm|wk # 沒有別人的鎖就上鎖，印出 OK（結束碼 0）；有別人的有效鎖就印出 BUSY（結束碼 3）
  python daily/tools/runlock.py wait am|pm|wk     # 等最多 9 分鐘，每 60 秒檢查一次；等到就上鎖印 OK，否則印 BUSY（結束碼 3）
  python daily/tools/runlock.py release am|pm|wk  # 發布完成（或決定不產出）後解鎖
  python daily/tools/runlock.py status
"""
import json
import os
import sys
import time
from datetime import datetime

LOCK = os.path.join("_research", ".lock")
STALE = 120 * 60


def read():
    try:
        with open(LOCK, encoding="utf-8") as f:
            j = json.load(f)
        if time.time() - j["ts"] > STALE:
            return None
        return j
    except (OSError, ValueError, KeyError):
        return None


def take(kind):
    os.makedirs("_research", exist_ok=True)
    with open(LOCK, "w", encoding="utf-8") as f:
        json.dump({"kind": kind, "ts": time.time(), "start": datetime.now().strftime("%Y-%m-%d %H:%M")}, f, ensure_ascii=False)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    kind = sys.argv[2] if len(sys.argv) > 2 else ""
    cur = read()
    if cmd == "status":
        print(cur or "沒有有效的鎖")
        return
    if cmd == "release":
        if cur and cur["kind"] == kind:
            os.remove(LOCK)
        print("OK 已解鎖")
        return
    if cmd in ("acquire", "wait"):
        end = time.time() + (9 * 60 if cmd == "wait" else 0)
        while True:
            cur = read()
            if not cur or cur["kind"] == kind:
                take(kind)
                print(f"OK 已上鎖（{kind}）")
                return
            if time.time() >= end:
                age = int((time.time() - cur["ts"]) / 60)
                print(f"BUSY {cur['kind']} 從 {cur['start']} 開始執行，已 {age} 分鐘")
                sys.exit(3)
            time.sleep(60)
    sys.exit(__doc__)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
