import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone


def read_key() -> str:
    s = open("vt-maint.php", "r", encoding="utf-8", errors="ignore").read()
    m = re.search(r'\$secret\s*=\s*"([^"]+)"', s)
    if not m:
        raise SystemExit("secret_not_found")
    return m.group(1)


def fetch(url: str, timeout: int = 240) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "vt-maint-client/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8-sig", "ignore")


key = read_key()
base = "https://usadanews.com/vt-maint.php?key=" + urllib.parse.quote(key) + "&action="

loops = int(os.environ.get("AVATAR_FILL_LOOPS", "180"))
sleep_s = float(os.environ.get("AVATAR_FILL_SLEEP", "1.2"))
sample = int(os.environ.get("AVATAR_DIAG_SAMPLE", "8000"))

os.makedirs("reports", exist_ok=True)
ts = datetime.now().strftime("%Y%m%d_%H%M%S")
report_path = os.path.join("reports", f"avatar_fill_{ts}.json")

events = []
last_need_fix = None
stagnant = 0

for i in range(1, loops + 1):
    t0 = time.time()
    try:
        txt = fetch(base + "fillthumbs", timeout=240).strip()
        ok = True
        err = ""
    except Exception as e:  # noqa: BLE001
        txt = ""
        ok = False
        err = str(e)
    events.append(
        {
            "i": i,
            "utc": datetime.now(timezone.utc).isoformat(),
            "action": "fillthumbs",
            "ok": ok,
            "sec": round(time.time() - t0, 2),
            "head": txt[:200],
            "err": err,
        }
    )

    if i % 10 == 0 or i == 1:
        t1 = time.time()
        try:
            diag = fetch(base + "avatar_diagnose_raw&sample=" + str(sample), timeout=240)
            data = json.loads(diag)
            need_fix = int(data.get("need_fix") or 0)
            checked = int(data.get("checked") or 0)
            ok2 = True
            err2 = ""
        except Exception as e:  # noqa: BLE001
            need_fix = -1
            checked = -1
            ok2 = False
            err2 = str(e)
            data = {}

        events.append(
            {
                "i": i,
                "utc": datetime.now(timezone.utc).isoformat(),
                "action": "avatar_diagnose_raw",
                "ok": ok2,
                "sec": round(time.time() - t1, 2),
                "checked": checked,
                "need_fix": need_fix,
                "reasons": data.get("reasons"),
            }
        )

        if need_fix == 0:
            break
        if last_need_fix is not None and need_fix == last_need_fix:
            stagnant += 1
        else:
            stagnant = 0
        last_need_fix = need_fix
        if stagnant >= 4:
            # Prevent infinite loop if remote resolver is currently blocked.
            break

    time.sleep(max(0.0, sleep_s))

out = {
    "utc": datetime.now(timezone.utc).isoformat(),
    "loops": loops,
    "sleep_s": sleep_s,
    "sample": sample,
    "events": events,
}
with open(report_path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print("ok report", report_path)

