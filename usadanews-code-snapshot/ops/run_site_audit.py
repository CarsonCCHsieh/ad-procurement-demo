import re, json
import urllib.request

vtmaint = open('vt-maint.php','r',encoding='utf-8',errors='ignore').read()
m = re.search(r'\$secret\s*=\s*"([^"]+)"', vtmaint)
if not m:
    raise SystemExit('secret_not_found')
key = m.group(1)

url = f'https://usadanews.com/vt-maint.php?action=site_audit_raw&key={key}'
with urllib.request.urlopen(url, timeout=90) as r:
    body = r.read()
open('site_audit_after_hotfix.json','wb').write(body)

d = json.loads(body.decode('utf-8-sig'))
print('ok', d.get('ok'))
fails = d.get('fails') or []
print('fails', len(fails))
for f in fails[:20]:
    print('-', f.get('url'), f.get('code'), f.get('why'))
