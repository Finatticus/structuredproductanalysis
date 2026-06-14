import urllib.request
import re
import urllib.parse

vid = 'JkaxUblCGz0'
url = f'https://corsproxy.io/?{urllib.parse.quote("https://www.youtube.com/watch?v=" + vid)}'
req = urllib.request.Request(url, headers={
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
})
try:
    html = urllib.request.urlopen(req).read().decode('utf-8')
    match = re.search(r'"captionTracks":\s*(\[.*?\])', html)
    if match:
        print('SUCCESS:', match.group(1)[:100])
    else:
        print('ERROR: No captionTracks')
except Exception as e:
    print('ERROR:', str(e))
