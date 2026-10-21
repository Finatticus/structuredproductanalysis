"""合併外交部領事事務局、駐外館處入口網、中國外交部資料 → site/js/emergency-data.js"""
import json, os, re, time, urllib.parse, urllib.request, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
rc = json.load(open('../rc.json', encoding='utf-8'))
boca = json.load(open('boca.json', encoding='utf-8'))
cn = json.load(open('cn.json', encoding='utf-8'))
emb = json.load(open('embassy.json', encoding='utf-8-sig'))

# ---------- 名稱 → ISO ----------
en2iso, zh2iso = {}, {}
for c in rc:
    iso = c['cca2'].lower()
    for n in [c['name']['common'], c['name']['official'], *c.get('altSpellings', [])]:
        en2iso[n.lower()] = iso
    z = c.get('translations', {}).get('zho', {})
    for n in [z.get('common'), z.get('official')]:
        if n: zh2iso[n] = iso
EN_FIX = {'korea': 'kr', 'republic of korea': 'kr', 'the netherlands': 'nl', 'czech republic': 'cz', 'turkey': 'tr', 'türkiye': 'tr', 'viet nam': 'vn', 'vietnam': 'vn',
          'russia': 'ru', 'usa': 'us', 'u.s.a.': 'us', 'the united states': 'us', 'united states of america': 'us', 'uk': 'gb', 'the united kingdom': 'gb', 'great britain': 'gb',
          'hong kong': 'hk', 'macau': 'mo', 'macao': 'mo', 'laos': 'la', 'brunei': 'bn', 'myanmar': 'mm', 'burma': 'mm', 'swaziland': 'sz', 'eswatini': 'sz',
          'ivory coast': 'ci', "côte d'ivoire": 'ci', 'cape verde': 'cv', 'micronesia': 'fm', 'vatican': 'va', 'holy see': 'va', 'east timor': 'tl', 'timor-leste': 'tl',
          'palestine': 'ps', 'syria': 'sy', 'iran': 'ir', 'north macedonia': 'mk', 'macedonia': 'mk', 'moldova': 'md', 'bolivia': 'bo', 'venezuela': 've', 'tanzania': 'tz',
          'congo': 'cg', 'dr congo': 'cd', 'democratic republic of the congo': 'cd', 'the bahamas': 'bs', 'bahamas': 'bs', 'the gambia': 'gm', 'gambia': 'gm',
          'saint kitts and nevis': 'kn', 'st. kitts and nevis': 'kn', 'saint lucia': 'lc', 'st. lucia': 'lc', 'saint vincent and the grenadines': 'vc',
          'st. vincent and the grenadines': 'vc', 'new caledonia': 'nc', 'guam': 'gu', 'commonwealth of the northern mariana islands': 'mp', 'cook islands': 'ck',
          'italia': 'it', 'argentine': 'ar', 'dominican': 'do', 'the czech republic': 'cz', 'the slovak republic': 'sk', 'kingdom of eswatini': 'sz',
          'saint christopher and nevis': 'kn', 'the commonwealth of puerto rico': 'pr', 'bosnia': 'ba', 'niue': 'nu', 'french polynesia': 'pf', 'anguilla': 'ai',
          'falkland islands': 'fk', 'saba': 'bq', 'saint eustatius': 'bq', 'saint barthelemy': 'bl', 'virgin islands': 'vg'}
ZH_FIX = {'日本国': 'jp', '大韩民国': 'kr', '朝鲜民主主义人民共和国': 'kp', '美利坚合众国': 'us', '美国': 'us', '大不列颠及北爱尔兰联合王国': 'gb', '英国': 'gb', '韩国': 'kr', '朝鲜': 'kp',
          '泰王国': 'th', '老挝': 'la', '越南': 'vn', '菲律宾': 'ph', '马来西亚': 'my', '印度尼西亚': 'id', '印尼': 'id', '澳大利亚': 'au', '新西兰': 'nz', '俄罗斯联邦': 'ru', '俄罗斯': 'ru',
          '土耳其': 'tr', '土耳其共和国': 'tr', '法兰西共和国': 'fr', '法国': 'fr', '德意志联邦共和国': 'de', '德国': 'de', '意大利共和国': 'it', '意大利': 'it', '西班牙王国': 'es', '西班牙': 'es',
          '加拿大': 'ca', '巴西': 'br', '阿联酋': 'ae', '阿拉伯联合酋长国': 'ae', '南非': 'za', '印度': 'in', '巴基斯坦': 'pk', '哈萨克斯坦': 'kz', '缅甸': 'mm', '蒙古': 'mn', '蒙古国': 'mn',
          '比利时王国': 'be', '荷兰王国': 'nl', '瑞士联邦': 'ch', '奥地利共和国': 'at', '捷克共和国': 'cz', '匈牙利': 'hu', '波兰共和国': 'pl', '斯洛伐克共和国': 'sk', '希腊共和国': 'gr',
          '葡萄牙共和国': 'pt', '新加坡共和国': 'sg', '柬埔寨王国': 'kh', '尼泊尔': 'np', '马尔代夫共和国': 'mv', '斯里兰卡民主社会主义共和国': 'lk', '以色列国': 'il', '约旦哈希姆王国': 'jo',
          '埃及阿拉伯共和国': 'eg', '摩洛哥王国': 'ma', '格鲁吉亚': 'ge', '乌兹别克斯坦共和国': 'uz', '墨西哥合众国': 'mx', '秘鲁共和国': 'pe', '阿根廷共和国': 'ar', '智利共和国': 'cl',
          '古巴共和国': 'cu', '肯尼亚共和国': 'ke', '文莱达鲁萨兰国': 'bn', '爱尔兰': 'ie', '冰岛': 'is', '丹麦王国': 'dk', '瑞典王国': 'se', '挪威王国': 'no', '芬兰共和国': 'fi',
          '巴勒斯坦国': 'ps', '沙特阿拉伯王国': 'sa', '卡塔尔国': 'qa', '阿拉伯叙利亚共和国': 'sy', '阿尔及利亚民主人民共和国': 'dz', '北马其顿共和国': 'mk',
          '多米尼克国': 'dm', '圭亚那合作共和国': 'gy', '巴布亚新几内亚独立国': 'pg', '荷属加勒比地区': 'cw'}

def iso_from_en(s):
    s = s.strip().lower()
    s = re.sub(r'\s*-.*$', '', s)          # Australia-Brisbane → australia
    s = re.sub(r'\s*\(.*$', '', s).strip()
    return EN_FIX.get(s) or en2iso.get(s)

def iso_from_zh(s):
    s = s.strip()
    if s in ZH_FIX: return ZH_FIX[s]
    if s in zh2iso: return zh2iso[s]
    for suf in ['人民民主共和国', '民主共和国', '联邦共和国', '共和国', '王国', '联邦', '国', '大公国', '苏丹国']:
        if s.endswith(suf):
            b = s[:-len(suf)]
            if b in ZH_FIX: return ZH_FIX[b]
            if b in zh2iso: return zh2iso[b]
            for k, v in zh2iso.items():
                if k.startswith(b) and len(b) >= 2: return v
    return None

# ---------- 台灣駐外館處 ----------
def norm(n):
    n = (n or '').replace('臺', '台').replace(' ', '')
    for w in ['台北經濟文化', '台北商務文化', '台北商務', '台北代表處', '台北', '經濟文化', '商務', '代表處', '辦事處', '大使館', '分處', '總領事館', '駐']:
        n = n.replace(w, '')
    return n
emb_by_name = {}
for e in emb:
    for k in (e.get('name_ch'), e.get('name_ch_full')):
        if k: emb_by_name[k.strip()] = e; emb_by_name['N:' + norm(k)] = e
tw, info, unmatched = {}, {}, []
first_url = lambda s: (re.findall(r'https?://[^\s，、；;]+', s or '') or [''])[0]
for key, b in boca.items():
    # 標題可能有兩組括號，例如「日本-琉球(那霸) (Japan-Ryukyu…)」，取含英文字母的那組
    m = re.search(r'\s\(([A-Za-z][^)]*(?:\([^)]*\))?[^)]*)\)', b['title'])
    iso = iso_from_en(m.group(1)) if m else None
    if b['title'].startswith('美屬維京群島'): iso = 'vi'
    if b['title'].startswith('索馬利蘭'): iso = None
    if not iso: unmatched.append(('tw', b['title'])); continue
    mi = b['mission']
    name = (mi.get('駐外館處中文名稱') or '').strip()
    rec = {
        'name': name, 'url': first_url(mi.get('網址')), 'addr': (mi.get('館址') or '').strip(),
        'tel': (mi.get('電話') or '').strip(), 'emg': (mi.get('緊急聯絡電話(非急難重大事件請勿撥打)') or mi.get('緊急聯絡電話') or '').strip(),
        'email': (mi.get('電子郵件') or '').strip(), 'hours': (mi.get('服務時間 (當地時間)') or mi.get('服務時間') or '').strip(),
        'area': (mi.get('領務轄區') or '').strip(),
    }
    # 緊急電話只取最前面的號碼說明，長說明放在後面
    rec['emg'] = re.sub(r'\s*緊急聯絡電話係專供.*$', '', rec['emg'], flags=re.S).replace('\n', '；')
    e = emb_by_name.get(name) or emb_by_name.get('N:' + norm(name))
    if not e:
        for k, v in emb_by_name.items():
            if name and (k in name or name in k): e = v; break
    if e and e.get('lat'):
        try: rec['ll'] = [round(float(e['lat']), 4), round(float(e['lng']), 4)]
        except: pass
    covered = '兼轄館處' in b['title']
    if not name: continue
    lst = tw.setdefault(iso, [])
    if not any(x['name'] == rec['name'] for x in lst): lst.append(rec)
    inf = info.setdefault(iso, {})
    if b.get('safety') and not inf.get('safety'): inf['safety'] = b['safety'].strip()
    if b.get('medical') and not inf.get('medical'): inf['medical'] = b['medical'].strip()
    inf.setdefault('src', b['url'])
    if covered: inf['cover'] = f'本國沒有我國駐外館處，由「{name}」兼轄。'

# 沒有座標的館處：用地址查詢（有快取）
tgc = json.load(open('tw_geo.json', encoding='utf-8')) if os.path.exists('tw_geo.json') else {}
for iso, lst in tw.items():
    for r in lst:
        if 'll' in r or not r['addr']: continue
        q = re.sub(r'[（(][^)）]*[)）]', '', r['addr'].split(chr(10))[0])
        q = re.sub(r'(?i)(suite|unit|room|floor|fl\.?|rm\.?|\d+(st|nd|rd|th)\s*floor)[^,]*,', '', q).strip()
        k = q + '|' + iso
        if k not in tgc:
            try:
                u = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': q, 'countrycodes': iso, 'format': 'jsonv2', 'limit': 1})
                with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'travel-journal-build/1.0'}), timeout=20) as resp:
                    j = json.loads(resp.read())
                if not j:   # 退而求其次：只用地址最後兩段（城市、國家）
                    q2 = ', '.join([x.strip() for x in q.split(',') if x.strip()][-3:])
                    time.sleep(1.1)
                    u = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': q2, 'countrycodes': iso, 'format': 'jsonv2', 'limit': 1})
                    with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'travel-journal-build/1.0'}), timeout=20) as resp:
                        j = json.loads(resp.read())
                tgc[k] = [round(float(j[0]['lat']), 3), round(float(j[0]['lon']), 3)] if j else None
            except Exception:
                tgc[k] = None
            time.sleep(1.1)
            json.dump(tgc, open('tw_geo.json', 'w', encoding='utf-8'), ensure_ascii=False)
        if tgc.get(k): r['ll'] = tgc[k]

# 兼轄國家：換成負責館處的完整資料
allm = [x for v in tw.values() for x in v if x['name'].startswith(('駐', '台北', '臺北')) and x.get('emg')]
for key, b in boca.items():
    m = re.search(r'兼轄館處：([^，）)]+)', b['title'])
    if not m: continue
    mm = re.search(r'\s\(([A-Za-z][^)]*(?:\([^)]*\))?[^)]*)\)', b['title'])
    iso = iso_from_en(mm.group(1)) if mm else None
    if not iso or iso not in tw: continue
    cover = m.group(1).strip()
    found = next((x for x in allm if norm(x['name']) == norm(cover) or norm(cover) in norm(x['name'])), None)
    tw[iso] = [dict(found)] if found else [r for r in tw[iso] if r['name'].startswith(('駐', '台北', '臺北'))]
    info.setdefault(iso, {})['cover'] = f'這個國家沒有我國駐外館處，由「{cover}」兼轄。'

# 仍沒有座標的館處：用館名裡的城市定位（例如「駐大阪辦事處」「福岡分處」）
for iso, lst in tw.items():
    for r in lst:
        if 'll' in r: continue
        n = r['name']
        m = re.search(r'(?:處|部)([^處部駐]{2,4})(?:分處|辦事處)', n) or re.search(r'駐([^處部駐國]{2,4})(?:台北|臺北)?(?:經濟文化)?辦事處', n)
        city = m.group(1) if m else ''
        if not city or len(city) > 6: continue
        k = 'CITY:' + city + '|' + iso
        if k not in tgc:
            try:
                u = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': city, 'countrycodes': iso, 'format': 'jsonv2', 'limit': 1, 'accept-language': 'zh-TW'})
                with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'travel-journal-build/1.0'}), timeout=20) as resp:
                    j = json.loads(resp.read())
                tgc[k] = [round(float(j[0]['lat']), 3), round(float(j[0]['lon']), 3)] if j else None
            except Exception:
                tgc[k] = None
            time.sleep(1.1)
            json.dump(tgc, open('tw_geo.json', 'w', encoding='utf-8'), ensure_ascii=False)
        if tgc.get(k): r['ll'] = tgc[k]
    # 代表處（首都）沒有座標時用首都
    row = next((x for x in json.load(open('../countries_rows.json', encoding='utf-8')) if x[0] == iso), None)
    capll = [row[4], row[5]] if row and row[4] is not None else None
    for r in lst:
        if 'll' not in r and capll and re.search(r'代表(處|部)$', r['name']): r['ll'] = capll

# 香港、澳門、中國大陸：不屬外交部駐外館處
SEF = '海基會 24 小時緊急服務專線：+886-2-2533-9995'
for iso, txt in [('hk', '香港事務由陸委會駐香港的「台北經濟文化辦事處」服務，緊急狀況也可撥打海基會專線。'),
                 ('mo', '澳門事務由陸委會駐澳門的「台北經濟文化辦事處」服務，緊急狀況也可撥打海基會專線。'),
                 ('cn', '中國大陸沒有我國駐外館處，急難協助請洽海基會（財團法人海峽交流基金會）。')]:
    info.setdefault(iso, {}).update({'cover': txt, 'sef': SEF})

# ---------- 中國駐外使領館 ----------
cnout = {}
for url, r in cn.items():
    n = r['name']
    m = re.match(r'^驻(.+?)(?:大使馆|办事处|代办处|使馆)$', n)
    m2 = re.match(r'^驻(.+?)(?:总领事馆|领事馆|领事办公室)（(.+?)）$', n)
    iso = iso_from_zh(m2.group(2)) if m2 else (iso_from_zh(m.group(1)) if m else None)
    if '暂时闭馆' in n: continue
    if not iso: unmatched.append(('cn', n)); continue
    city = m2.group(1) if m2 else ''
    protect = next((r[k] for k in r if k.startswith('领事保护')), '')
    rec = {'name': n.replace('驻', '中國駐', 1), 'addr': (r.get('地址') or '').strip(), 'tel': (r.get('电话') or '').strip(),
           'emg': protect.strip(), 'email': (r.get('电子邮箱') or '').strip(), 'url': first_url(r.get('网址')) or url, 'city': city}
    if not rec['addr']: rec['addr'] = ''
    cnout.setdefault(iso, []).append(rec)

# ---------- 中國領館所在城市定位（Nominatim，每秒 1 次；有快取） ----------
gc = json.load(open('cn_geo.json', encoding='utf-8')) if os.path.exists('cn_geo.json') else {}
for iso, lst in cnout.items():
    capll = next(([c['latlng'][0], c['latlng'][1]] for c in rc if c['cca2'].lower() == iso and c.get('latlng')), None)
    for r in lst:
        q = r['city'] or ''
        if not q:   # 大使館：用首都
            cap = next((c.get('capital', [''])[0] for c in rc if c['cca2'].lower() == iso), '')
            q = cap
        if not q: continue
        k = f'{q}|{iso}'
        if k not in gc:
            try:
                u = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': q, 'countrycodes': iso, 'format': 'jsonv2', 'limit': 1})
                with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'travel-journal-build/1.0'}), timeout=20) as resp:
                    j = json.loads(resp.read())
                gc[k] = [round(float(j[0]['lat']), 3), round(float(j[0]['lon']), 3)] if j else None
            except Exception as e:
                gc[k] = None
            time.sleep(1.1)
            json.dump(gc, open('cn_geo.json', 'w', encoding='utf-8'), ensure_ascii=False)
        if gc.get(k): r['ll'] = gc[k]
        r.pop('city', None)

data = {'updated': datetime.date.today().strftime('%Y-%m-%d'), 'tw': tw, 'cn': cnout, 'info': info}
out = os.path.join(r'C:\Users\User\Desktop\Travel\site\js', 'emergency-data.js')
open(out, 'w', encoding='utf-8').write('/* 緊急資訊資料（自動產生）\n * 來源：外交部領事事務局、駐外館處入口網 taiwanembassy.org、中華人民共和國外交部網站 */\nwindow.TA_EMERGENCY = '
                                        + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
print('tw countries', len(tw), 'missions', sum(len(v) for v in tw.values()), 'with ll', sum(1 for v in tw.values() for x in v if 'll' in x))
print('cn countries', len(cnout), 'missions', sum(len(v) for v in cnout.values()), 'with ll', sum(1 for v in cnout.values() for x in v if 'll' in x))
print('info', len(info), 'unmatched', unmatched[:40], len(unmatched))
print('size', os.path.getsize(out))
