import urllib.request
import re

vid = 'JkaxUblCGz0'
req = urllib.request.Request(f'https://www.youtube.com/watch?v={vid}', headers={
    'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+478',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0'
})
html = urllib.request.urlopen(req).read().decode('utf-8')

match = re.search(r'"captionTracks":\s*(\[.*?\])', html)
if match:
    print('Found captionTracks!')
else:
    print('NOT FOUND captionTracks')
    # look for playerResponse
    pr_match = re.search(r'ytInitialPlayerResponse\s*=\s*(\{.*?\});', html)
    if pr_match:
        print('Found ytInitialPlayerResponse')
    else:
        print('NOT FOUND ytInitialPlayerResponse')
