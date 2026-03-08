import re, json
import urllib.request

s=open('vt-maint.php','r',encoding='utf-8',errors='ignore').read()
key=re.search(r'\$secret\s*=\s*"([^"]+)"',s).group(1)
url=f'https://usadanews.com/vt-maint.php?action=avatar_diagnose_raw&key={key}'
body=urllib.request.urlopen(url, timeout=120).read().decode('utf-8-sig','ignore')
d=json.loads(body)
print('checked',d.get('checked'))
print('need_fix',d.get('need_fix'))
print('reasons',d.get('reasons'))
