# -*- coding: utf-8 -*-
"""市場日報：早報與午報的執行鎖，避免兩份報告同時改 reports.js、view-log.md、lessons.md。

鎖檔：C:\\Users\\User\\Desktop\\news\\_research\\.lock（不進 git）。超過 120 分鐘的鎖視為過期（中途當掉沒解鎖時，下一次執行不會被卡住）；同一種報告再 acquire 一次會刷新時間。
用法（在 C:\\Users\\User\\Desktop\\news 執行）：
  python daily/tools/runlock.py acquire am|pm|wk # 沒有別人的鎖就上鎖，印出 OK（結束碼 0）；有別人的有效鎖就印出 BUSY（結束碼 3）
  python daily/tools/runlock.py wait am|pm|wk     # 等最多 9 分鐘，每 60 秒檢查一次；等到就上鎖印 OK，否則印 BUSY（結束碼 3）
  python daily/tools/runlock.py release am|pm|wk  # 發布完成（或決定不產出）後解鎖
  python daily/tools/runlock.py status
  python daily/tools/runlock.py stash am|pm|wk    # 上鎖後、git pull 之前執行：前一次中斷留下的未 commit 殘檔（含已 add 未 commit 的）
                                                  # 存到 _research/interrupted/時間-kind/（diff 與原檔），再把這些檔案還原成最新 commit，印出 CLEAN 或 STASHED
                                                  # 範圍也包含 daily/RULES*.md 與 daily/tools/（週報改規則到一半中斷時）；沒做完的 rebase／merge 會先中止
"""
import json
import os
import shutil
import subprocess
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


def git(*args, check=False):
    return subprocess.run(["git", "-c", "core.quotepath=false", *args], capture_output=True, text=True, encoding="utf-8", check=check)


def stash(kind):
    """前一次中斷的殘檔：存到 _research/interrupted/，再把工作目錄與 index 還原成 HEAD（只限下面這些路徑）。"""
    paths = ["daily/reports.js", "daily/state", "daily/reports", "daily/tools", ":(glob)daily/RULES*.md"]
    gd = git("rev-parse", "--git-dir").stdout.strip() or ".git"
    note = []
    if os.path.isdir(os.path.join(gd, "rebase-merge")) or os.path.isdir(os.path.join(gd, "rebase-apply")):
        git("rebase", "--abort")
        note.append("中止了沒做完的 rebase")
    if os.path.exists(os.path.join(gd, "MERGE_HEAD")):
        git("merge", "--abort")
        note.append("中止了沒做完的 merge")
    raw = git("status", "--porcelain", "-z", "--untracked-files=all", "--", *paths).stdout
    ent, it = [], iter(raw.split("\0"))
    for e in it:
        if not e:
            continue
        code, f = e[:2], e[3:]
        if code[0] in "RC":  # rename／copy：後面還跟著原路徑
            old = next(it, "")
            ent.append((code, old))
        ent.append((code, f))
    if not ent:
        print("CLEAN 沒有殘檔" + ("（" + "、".join(note) + "）" if note else ""))
        return
    d = os.path.join("_research", "interrupted", datetime.now().strftime("%Y%m%d-%H%M") + "-" + kind)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "tracked.diff"), "w", encoding="utf-8") as fh:
        fh.write(git("diff", "HEAD", "--", *paths).stdout)
    lt = git("ls-tree", "-r", "-z", "--name-only", "HEAD", "--", "daily")  # ls-tree 不支援 :(glob)，直接列整個 daily/
    if lt.returncode != 0 or not lt.stdout:
        sys.exit("ERROR 讀不到 HEAD 的檔案清單，沒有還原任何檔案（殘檔已存到 " + d + "），要停止並回報：" + lt.stderr.strip())
    in_head = set(lt.stdout.split("\0"))
    for code, f in ent:
        if os.path.isfile(f):
            shutil.copy2(f, os.path.join(d, f.replace("/", "__")))
        git("reset", "-q", "--", f)
        if f in in_head:
            git("checkout", "HEAD", "--", f)
        elif os.path.isfile(f):
            os.remove(f)
    left = git("status", "--porcelain", "--untracked-files=all", "--", *paths).stdout.strip()
    msg = f"STASHED {len(ent)} 個檔案 → {d}：" + "、".join(f for _, f in ent)
    if note:
        msg += "（" + "、".join(note) + "）"
    if left:
        msg += "；**還原後仍有殘檔，要停止並回報**：" + left.replace("\n", "；")
    print(msg)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd = sys.argv[1]
    kind = sys.argv[2] if len(sys.argv) > 2 else ""
    cur = read()
    if cmd == "status":
        print(cur or "沒有有效的鎖")
        return
    if cmd == "stash":
        if not cur or cur["kind"] != kind:
            sys.exit("要先上鎖（acquire／wait）才可以 stash")
        stash(kind)
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
