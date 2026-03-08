import re, urllib.request
s=open('vt-maint.php','r',encoding='utf-8',errors='ignore').read()
key=re.search(r'\$secret\s*=\s*"([^"]+)"',s).group(1)
url=f'https://usadanews.com/vt-maint.php?action=sync_sheet_force&key={key}'
print(urllib.request.urlopen(url, timeout=600).read().decode('utf-8-sig','ignore'))
