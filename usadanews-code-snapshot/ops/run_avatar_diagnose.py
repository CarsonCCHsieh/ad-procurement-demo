import json
import os
import re
import urllib.parse
import urllib.request


def read_key() -> str:
    s = open("vt-maint.php", "r", encoding="utf-8", errors="ignore").read()
    m = re.search(r'\$secret\s*=\s*"([^"]+)"', s)
    if not m:
        raise SystemExit("secret_not_found")
    return m.group(1)


sample = int(os.environ.get("AVATAR_DIAG_SAMPLE", "8000"))
key = read_key()
url = (
    "https://usadanews.com/vt-maint.php?action=avatar_diagnose_raw&sample="
    + str(sample)
    + "&key="
    + urllib.parse.quote(key)
)
req = urllib.request.Request(url, headers={"User-Agent": "vt-maint-client/1.0"})
with urllib.request.urlopen(req, timeout=240) as r:
    body = r.read().decode("utf-8-sig", "ignore")

d = json.loads(body)
print("utc", d.get("utc"))
print("checked", d.get("checked"), "need_fix", d.get("need_fix"))
print("reasons", d.get("reasons"))

