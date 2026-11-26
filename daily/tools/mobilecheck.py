# -*- coding: utf-8 -*-
"""市場日報：手機寬度檢查（不用預覽伺服器、不用瀏覽器面板，排程中也不會跳出要人允許的視窗）。

用法（在 C:\\Users\\User\\Desktop\\news 執行）：
  python daily/tools/mobilecheck.py daily/reports/YYYY-MM-DD.html [寬度，預設 375]

做法：在報告同一個資料夾放一份暫存副本（.mc-*.html，跑完自動刪掉），加一段檢查程式，
用無頭模式的 Chrome（找不到就用 Edge）在 375×812 的 iframe 裡開啟（無頭視窗最窄只有 500px）；把所有主分頁、子分頁同時打開，
確認頁面寬度 document.documentElement.scrollWidth 不超過視窗寬度（隱藏權限區塊也會打開一起檢查）。
超過時列出造成超寬的元素（已在可左右捲動容器裡的元素不算）。
結果第一行是 OK 或 FAIL；瀏覽器開不起來時印 ERROR，並以結束代碼 2 結束。
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]

PROBE = r"""
<script>
(function () {
  function run() {
    document.documentElement.classList.add('vault-on');  // 隱藏區塊（週報 AI 成績單）也要檢查
    document.querySelectorAll('section.panel, .subpanel').forEach(function (p) { p.classList.add('on'); });
    var W = window.innerWidth, sw = document.documentElement.scrollWidth, bad = [];
    function clipped(el) {
      for (var a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        var o = getComputedStyle(a).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
      }
      return false;
    }
    if (sw > W) {
      document.querySelectorAll('body *').forEach(function (el) {
        if (bad.length >= 15) return;
        var r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= W + 1 || clipped(el)) return;
        var kidOver = Array.prototype.some.call(el.children, function (c) { return c.getBoundingClientRect().right > W + 1; });
        if (kidOver) return;
        var sec = el.closest('.subpanel') || el.closest('section.panel');
        bad.push({ where: sec ? sec.id : '-', tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().replace(/\s+/g, '.') : ''),
                   right: Math.round(r.right), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) });
      });
    }
    if (sw > W && bad.length === 0) {
      // 元素本身沒有超寬時，可能是元素裡的文字溢出（例如不能斷行的長字串），逐一檢查文字節點
      var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), nd, rg = document.createRange();
      while ((nd = tw.nextNode()) && bad.length < 15) {
        if (!nd.textContent.trim() || !nd.parentElement || clipped(nd.parentElement)) continue;
        rg.selectNodeContents(nd);
        var rr = rg.getBoundingClientRect();
        if (rr.width === 0 || rr.right <= W + 1) continue;
        var p = nd.parentElement, sec2 = p.closest('.subpanel') || p.closest('section.panel');
        bad.push({ where: sec2 ? sec2.id : '-', tag: '文字於 ' + p.tagName.toLowerCase() + (typeof p.className === 'string' && p.className ? '.' + p.className.trim().replace(/\s+/g, '.') : ''),
                   right: Math.round(rr.right), text: nd.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) });
      }
    }
    var msg = JSON.stringify({ innerWidth: W, scrollWidth: sw, bad: bad });
    if (window.parent !== window) window.parent.postMessage(msg, '*');
  }
  if (document.readyState === 'complete') setTimeout(run, 800); else window.addEventListener('load', function () { setTimeout(run, 800); });
})();
</script>
"""


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    rep = os.path.abspath(sys.argv[1])
    width = int(sys.argv[2]) if len(sys.argv) > 2 else 375
    exe = next((b for b in BROWSERS if os.path.exists(b)), None)
    if not exe:
        print("ERROR 找不到 Chrome 或 Edge，無法做手機寬度檢查。")
        sys.exit(2)
    html = open(rep, encoding="utf-8").read()
    i = html.lower().rfind("</body>")
    html = (html[:i] + PROBE + html[i:]) if i >= 0 else html + PROBE
    tmp = os.path.join(os.path.dirname(rep), ".mc-" + os.path.basename(rep))
    wrap = os.path.join(os.path.dirname(rep), ".mc-wrap-" + os.path.basename(rep))
    prof = tempfile.mkdtemp(prefix="mc-profile-")
    try:
        open(tmp, "w", encoding="utf-8", newline="\n").write(html)
        # 無頭瀏覽器視窗最窄 500px，所以用 iframe 做出真正的 375px 視窗，結果用 postMessage 傳回外層
        open(wrap, "w", encoding="utf-8", newline="\n").write(
            '<!doctype html><html><body style="margin:0">'
            f'<iframe src="{os.path.basename(tmp)}" width="{width}" height="812" style="border:0"></iframe>'
            '<script>window.addEventListener("message",function(e){var p=document.createElement("pre");'
            'p.id="__mc";p.textContent=e.data;document.body.appendChild(p);});</script></body></html>')
        url = "file:///" + wrap.replace("\\", "/")
        cmd = [exe, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
               "--hide-scrollbars", f"--user-data-dir={prof}", f"--window-size={width},812",
               "--virtual-time-budget=10000", "--dump-dom", url]
        try:
            out = subprocess.run(cmd, capture_output=True, timeout=120).stdout.decode("utf-8", "replace")
        except subprocess.TimeoutExpired:
            print("ERROR 無頭瀏覽器逾時（120 秒），無法完成手機寬度檢查。")
            sys.exit(2)
    finally:
        for f in (tmp, wrap):
            try:
                os.remove(f)
            except OSError:
                pass
        shutil.rmtree(prof, ignore_errors=True)
    m = re.search(r'<pre id="__mc">(.*?)</pre>', out, re.S)
    if not m:
        print("ERROR 沒有拿到檢查結果（瀏覽器可能沒有執行頁面程式）。")
        sys.exit(2)
    import html as h
    r = json.loads(h.unescape(m.group(1)))
    note = "" if r["innerWidth"] == width else f"（注意：實際視窗寬度是 {r['innerWidth']}px，不是 {width}px）"
    if r["scrollWidth"] <= r["innerWidth"]:
        print(f"OK 手機寬度 {r['innerWidth']}px：頁面寬度 {r['scrollWidth']}px，所有分頁都不會左右捲動。{note}")
        return
    print(f"FAIL 手機寬度 {r['innerWidth']}px：頁面寬度 {r['scrollWidth']}px，會左右捲動。{note}造成超寬的元素：")
    for b in r["bad"]:
        print(f"- [{b['where']}] {b['tag']} 右緣 {b['right']}px：{b['text']}")
    sys.exit(1)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
