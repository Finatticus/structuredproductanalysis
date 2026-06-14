text = open('finance.html', encoding='utf-8').read()
lines = text.splitlines()
import re

depth = 0
for i in range(990, 1240):
    line = lines[i]
    o = len(re.findall(r'<div\b', line))
    c = len(re.findall(r'</div>', line))
    depth += o - c

print(f'Depth from insights-tab start to line 1239 = {depth}')
print('(Should be 0 or negative, meaning insights-tab is properly closed)')
print()

# Also remove the extra </div> at line 1438 (old dashboard close)
for i in range(1435, 1442):
    print(f'Line {i+1}: {repr(lines[i].strip())}')
