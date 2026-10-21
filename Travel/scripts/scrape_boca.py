"""抓外交部領事事務局各國「駐館位置及聯絡資訊」與「生活資訊（治安、醫療）」"""
import json, os, re, html, time, urllib.request
os.chdir(os.path.dirname(os.path.abspath(__file__)))
UA = {'User-Agent': 'Mozilla/5.0 (personal travel site data build)'}

def get(url):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read().decode('utf-8', 'ignore')
        except Exception as e:
            time.sleep(2 + i * 3)
    return ''

def table(s):
    i = s.find('<div class="cp_table">'); j = s.find('</section>', i)
    part = s[i:j]
    out = {}
    for th, td in re.findall(r'<th[^>]*>(.*?)</th>\s*<td[^>]*>(.*?)</td>', part, re.S):
        k = html.unescape(re.sub(r'<[^>]+>', '', th)).split('  ')[0].strip()
        v = re.sub(r'<br\s*/?>', '\n', td)
        v = html.unescape(re.sub(r'<[^>]+>', ' ', v))
        v = re.sub(r'[ \t\xa0]+', ' ', v)
        v = re.sub(r'\n\s*', '\n', v).strip()
        out[k] = v
    return out

lp = get('https://www.boca.gov.tw/sp-foof-countrylp-03-1.html')
entries = re.findall(r'href="(/sp-foof-countrycp-03-(\d+)-([0-9a-f]+)-1\.html)"[^>]*>\s*([^<]+)', lp)
seen = set(); result = json.load(open('boca.json', encoding='utf-8')) if os.path.exists('boca.json') else {}
for href, cid, h, title in entries:
    key = f'{cid}-{h}'
    if key in seen: continue
    seen.add(key)
    if key in result: continue
    title = html.unescape(title).replace('\xa0', ' ').strip()
    base = f'https://www.boca.gov.tw/sp-foof-countrycp-03-{cid}-{h}'
    mission = table(get(base + '-03-1.html')); time.sleep(0.4)
    life = table(get(base + '-05-1.html')); time.sleep(0.4)
    result[key] = {'title': title, 'url': base + '-03-1.html', 'mission': mission,
                   'safety': life.get('治安狀況', ''), 'medical': life.get('醫療及保險制度', ''), 'voltage': life.get('電壓', '')}
    json.dump(result, open('boca.json', 'w', encoding='utf-8'), ensure_ascii=False)
    print(len(result), title[:30], flush=True)
print('DONE', len(result))
