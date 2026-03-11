import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def read_key_from_php(path: str) -> str:
    p = Path(path)
    if not p.exists():
        return ""
    s = p.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r'\$secret\s*=\s*"([^"]+)"', s)
    return m.group(1).strip() if m else ""


def read_key(explicit: str, php_path: str) -> str:
    if explicit.strip():
        return explicit.strip()
    env_key = (os.environ.get("VT_MAINT_KEY") or "").strip()
    if env_key:
        return env_key
    return read_key_from_php(php_path)


def fetch(base_url: str, key: str, action: str, timeout: int = 220, extra: dict | None = None) -> str:
    params = {"key": key, "action": action}
    if extra:
        for k, v in extra.items():
            params[str(k)] = str(v)
    url = base_url.rstrip("?") + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "USADA-JPEN-Intro-Round/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    return body.decode("utf-8-sig", "ignore").strip()


def parse_named_int(text: str, key: str) -> int | None:
    if not text:
        return None
    m = re.search(r'"' + re.escape(key) + r'"\s*:\s*(\d+)', text)
    if not m:
        return None
    try:
        return int(m.group(1))
    except Exception:  # noqa: BLE001
        return None


def parse_updated(text: str) -> int | None:
    if not text:
        return None
    m = re.search(r'"updated"\s*:\s*(\d+)', text)
    if not m:
        m = re.search(r'\bupdated\b\s*[=:]\s*(\d+)', text)
    if not m:
        return None
    try:
        return int(m.group(1))
    except Exception:  # noqa: BLE001
        return None


def load_report(path: str) -> dict:
    try:
        if not os.path.exists(path):
            return {}
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def source_rank(report: dict, lang: str, source_id: str) -> int | None:
    rows = (report.get("language_plan") or {}).get(lang) or []
    if not isinstance(rows, list):
        return None
    for i, row in enumerate(rows):
        if str((row or {}).get("id") or "") == source_id:
            return i
    return None


def compute_plan(report: dict) -> dict:
    r_ja = source_rank(report, "ja", "hololist_category")
    r_en = source_rank(report, "en", "hololist_category")
    hololist_iters = 2
    if r_ja is not None and r_ja <= 2:
        hololist_iters += 1
    if r_en is not None and r_en <= 2:
        hololist_iters += 1
    hololist_iters = max(1, min(6, hololist_iters))
    origins = []
    if r_ja is not None or r_en is not None:
        origins.append("hololist")
    origins.extend(["global_import", "tw_sheet", "all"])
    dedup = []
    for x in origins:
        if x not in dedup:
            dedup.append(x)
    return {
        "hololist_rank_ja": r_ja,
        "hololist_rank_en": r_en,
        "hololist_iters": hololist_iters,
        "origins": dedup,
    }


def print_progress(msg: str) -> None:
    s = str(msg).replace("\ufeff", "")
    enc = getattr(sys.stdout, "encoding", None) or "utf-8"
    try:
        s.encode(enc)
    except Exception:  # noqa: BLE001
        s = s.encode(enc, "replace").decode(enc, "replace")
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {s}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Execute JP/EN-first intro enrichment round")
    parser.add_argument("--base-url", default="https://usadanews.com/vt-maint.php")
    parser.add_argument("--key", default="")
    parser.add_argument("--php-key-file", default=r"C:\Users\User\hsieh\vt-maint.php")
    parser.add_argument("--report", default="reports/jpen_source_health_latest.json")
    parser.add_argument("--out-dir", default="reports")
    parser.add_argument("--sync-sheet-iters", type=int, default=2)
    parser.add_argument("--sync-sheet-sources", type=int, default=2)
    parser.add_argument("--hololist-batch", type=int, default=80)
    parser.add_argument("--intro-iters", type=int, default=3)
    parser.add_argument("--intro-batch", type=int, default=40)
    parser.add_argument("--min-len", type=int, default=180)
    parser.add_argument("--translation-iters", type=int, default=2)
    parser.add_argument("--translation-batch", type=int, default=25)
    args = parser.parse_args()

    key = read_key(args.key, args.php_key_file)
    if not key:
        print("err missing key (provide --key or VT_MAINT_KEY or php secret file)")
        return 1

    os.makedirs(args.out_dir, exist_ok=True)
    report = load_report(args.report)
    plan = compute_plan(report)
    print_progress(
        "plan "
        + f"hololist_rank_ja={plan['hololist_rank_ja']} "
        + f"hololist_rank_en={plan['hololist_rank_en']} "
        + f"hololist_iters={plan['hololist_iters']} "
        + f"origins={','.join(plan['origins'])}"
    )

    steps = []

    def run(action: str, extra: dict | None = None, timeout: int = 240) -> str:
        t0 = time.time()
        out = fetch(args.base_url, key, action, timeout=timeout, extra=extra or {})
        elapsed = round(time.time() - t0, 2)
        steps.append(
            {
                "action": action,
                "extra": extra or {},
                "elapsed_s": elapsed,
                "updated": parse_updated(out),
                "processed": parse_named_int(out, "processed"),
                "head": (out.splitlines()[0][:260] if out else ""),
            }
        )
        return out

    # 1) TW authoritative source sync
    for i in range(1, max(1, args.sync_sheet_iters) + 1):
        print_progress(f"sync_sheet {i}/{args.sync_sheet_iters} start")
        txt = run("sync_sheet", {"sources": max(1, args.sync_sheet_sources)}, timeout=420)
        print_progress(f"sync_sheet {i}/{args.sync_sheet_iters} done: {(txt.splitlines()[0] if txt else '')[:180]}")
        if "locked" in txt.lower():
            break

    # 2) JP/EN high-coverage source sync
    for i in range(1, max(1, plan["hololist_iters"]) + 1):
        print_progress(f"sync_hololist_raw {i}/{plan['hololist_iters']} start")
        txt = run("sync_hololist_raw", {"batch": max(20, args.hololist_batch)}, timeout=420)
        p = parse_named_int(txt, "processed")
        u = parse_named_int(txt, "updated")
        print_progress(f"sync_hololist_raw {i}/{plan['hololist_iters']} done processed={p} updated={u}")
        if "locked" in txt.lower():
            break
        if (p == 0 or p is None) and (u == 0 or u is None):
            break

    # 3) Full intro enrichment by source order
    origin_supported = True
    for origin in plan["origins"]:
        if origin != "all" and not origin_supported:
            continue
        for i in range(1, max(1, args.intro_iters) + 1):
            print_progress(f"enrich_full_intro_raw origin={origin} {i}/{args.intro_iters} start")
            extra = {"batch": max(10, args.intro_batch), "force": 0, "min_len": max(100, args.min_len)}
            if origin != "all":
                extra["origin"] = origin
            txt = run("enrich_full_intro_raw", extra, timeout=300)
            upd = parse_updated(txt)
            print_progress(f"enrich_full_intro_raw origin={origin} {i}/{args.intro_iters} done updated={upd}")
            if origin != "all" and i == 1 and '"origin_filter"' not in txt:
                origin_supported = False
                print_progress("remote vt-maint does not support origin filter, fallback to origin=all only")
                break
            if upd == 0:
                break

    # 4) Sync translated intro/excerpt pages
    for i in range(1, max(1, args.translation_iters) + 1):
        print_progress(f"sync_translation_content_raw {i}/{args.translation_iters} start")
        txt = run(
            "sync_translation_content_raw",
            {"batch": max(8, args.translation_batch), "force": 0, "min_len": max(120, args.min_len - 20)},
            timeout=360,
        )
        upd = parse_updated(txt)
        print_progress(f"sync_translation_content_raw {i}/{args.translation_iters} done updated={upd}")
        if upd == 0:
            break
        if "locked" in txt.lower():
            break

    # 5) quick diagnose snapshots
    for action in ["source_health_raw", "stats"]:
        print_progress(f"{action} start")
        txt = run(action, timeout=180)
        print_progress(f"{action} done: {(txt.splitlines()[0] if txt else '')[:180]}")

    now_utc = datetime.now(timezone.utc).isoformat()
    report_out = {
        "generated_utc": now_utc,
        "base_url": args.base_url,
        "plan": plan,
        "steps": steps,
        "total_steps": len(steps),
    }

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_json = os.path.join(args.out_dir, f"jpen_intro_round_{ts}.json")
    latest_json = os.path.join(args.out_dir, "jpen_intro_round_latest.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(report_out, f, ensure_ascii=False, indent=2)
    with open(latest_json, "w", encoding="utf-8") as f:
        json.dump(report_out, f, ensure_ascii=False, indent=2)
    print_progress(f"done total_steps={len(steps)} report={out_json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
