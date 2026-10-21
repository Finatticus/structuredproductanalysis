"""抓中華人民共和國外交部「駐外使館」「駐外總領館」的地址與電話"""
import json, os, re, html, time, urllib.request
os.chdir(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'Mozilla/5.0 (personal travel site data build)'}
BASE = 'https://www.mfa.gov.cn/web/zwjg_674741/'
REGIONS = [('zwsg_674743/' + r, 'embassy') for r in ['yz_674745', 'fz_674747', 'xo_674749', 'xybf_674751', 'dozy_674753', 'bmdyz_674755']] + \
          [('zwzlg_674757/' + r, 'consulate') for r in ['yz_674759', 'fz_674761', 'xo_674763', 'xybf_674765', 'dozy_674767', 'bmdyz_674769']]

def get(url):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read().decode('utf-8', 'ignore')
        except Exception:
            time.sleep(2 + 3 * i)
    return ''

out = json.load(open('cn.json', encoding='utf-8')) if os.path.exists('cn.json') else {}
for path, kind in REGIONS:
    page = get(BASE + path + '/')
    box = page[page.find('linkList2'):]
    for href, name in re.findall(r'<a href="\./([^"]+\.shtml)"[^>]*>([^<]+)</a>', box):
        url = BASE + path + '/' + href
        if url in out: continue
        s = get(url); time.sleep(0.3)
        t = re.sub(r'<script.*?</script>|<style.*?</style>', '', s, flags=re.S)
        t = html.unescape(re.sub(r'<br\s*/?>', '\n', t))
        t = re.sub(r'<[^>]+>', '\n', t)
        t = re.sub(r'[ \t　\xa0]+', ' ', t)
        lines = [l.strip() for l in t.split('\n') if l.strip()]
        rec = {'name': name.strip(), 'kind': kind, 'url': url}
        cur = None
        for l in lines:
            m = re.match(r'^(大\s*使|总\s*领\s*事|领\s*事|地\s*址|邮\s*编|电\s*话|传\s*真|网\s*址|电子邮箱|领事保护[^：:]*|领事证件[^：:]*)\s*[：:]\s*(.*)$', l)
            if m:
                cur = re.sub(r'\s', '', m.group(1)); rec[cur] = m.group(2).strip(); continue
            if cur and cur in ('地址', '电话', '传真', '网址') and not re.match(r'^(相关|中央部委|【)', l) and len(rec[cur]) < 300:
                rec[cur] = (rec[cur] + ' ' + l).strip() if rec[cur] else l
                continue
            cur = None
        out[url] = rec
        json.dump(out, open('cn.json', 'w', encoding='utf-8'), ensure_ascii=False)
        print(len(out), name, flush=True)
print('DONE', len(out))
