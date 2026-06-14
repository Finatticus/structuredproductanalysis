import urllib.request
import re

vid = 'JkaxUblCGz0'
req = urllib.request.Request(f'https://youtubetranscript.com/?server_vid2={vid}', headers={
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
})
try:
    html = urllib.request.urlopen(req).read().decode('utf-8')
    print('SUCCESS:', html[:200])
except Exception as e:
    print('ERROR:', str(e))
