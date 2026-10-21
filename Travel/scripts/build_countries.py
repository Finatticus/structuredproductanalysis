import json, os, time, urllib.parse, urllib.request
os.chdir(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open('rc.json', encoding='utf-8'))
cache = json.load(open('caps.json', encoding='utf-8')) if os.path.exists('caps.json') else {}

def get(url):
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.loads(r.read())

for c in d:
    iso = c['cca2']
    if iso in cache: continue
    cap = (c.get('capital') or [None])[0]
    res = None
    if cap:
        try:
            j = get('https://geocoding-api.open-meteo.com/v1/search?' + urllib.parse.urlencode({'name': cap, 'count': 1, 'countryCode': iso}))
            if j.get('results'):
                r = j['results'][0]; res = [round(r['latitude'], 2), round(r['longitude'], 2), r.get('timezone')]
        except Exception as e: print('err', iso, e)
    if not res or not res[2]:
        lat, lon = c['latlng'] if c.get('latlng') else (0, 0)
        if res: lat, lon = res[0], res[1]
        try:
            j = get(f'https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&timezone=auto&current=temperature_2m')
            res = [round(lat, 2), round(lon, 2), j.get('timezone')]
        except Exception as e: print('err2', iso, e); res = [lat, lon, None]
    cache[iso] = res
    time.sleep(0.15)
json.dump(cache, open('caps.json', 'w', encoding='utf-8'))

LEFT = set('AG AU BS BD BB BT BW BN CY DM FJ GD GY HK IN ID IE JM JP KE KI LS MO MW MY MV MT MU MZ NA NR NP NZ PK PG KN LC VC WS SC SG SB ZA LK SR SZ TZ TH TL TO TT TV UG GB ZM ZW VG KY FK GG JE IM AI MS TC CK NU NF CX CC PN SH VI BM'.split())
rows = []
for c in sorted(d, key=lambda x: x['cca2']):
    iso = c['cca2']
    if iso in ('AQ', 'BV', 'HM', 'UM', 'TF', 'GS', 'IO'): continue
    cur = next(iter(c.get('currencies') or {}), '')
    lat, lon, tz = cache.get(iso) or [None, None, None]
    rows.append([iso.lower(), c.get('ccn3') or '', cur, tz or '', lat, lon, c['name']['common'], 'L' if iso in LEFT else 'R'])
out = json.dumps(rows, ensure_ascii=False, separators=(',', ':')).replace('],[', '],\n[')
open('countries_rows.json', 'w', encoding='utf-8').write(out)
print(len(rows), sum(1 for r in rows if not r[3]), [r[0] for r in rows if not r[3]])
