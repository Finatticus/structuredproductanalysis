content = open('c:/Users/User/Desktop/ENAPP/vcl.html', 'r', encoding='utf-8').read()
idx = content.find('<section id="sec-add">')
if idx != -1:
    print(content[idx:idx+800])
else:
    print("Not found")
