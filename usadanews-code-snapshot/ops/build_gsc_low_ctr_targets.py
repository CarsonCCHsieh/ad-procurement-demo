import argparse
import json
import re
import urllib.parse
from pathlib import Path

import requests


BASE = "https://usadanews.com"
NOISE_QUERY_PATTERNS = [
    # Common low-value/garbage patterns observed in GSC exports.
    r"\byoutube\s*[-_:/]?\s*\d{4,}\b",
    r"\byoutuber\s*[-_:/]?\s*\d{4,}\b",
    r"\byt\s*[-_:/]?\s*\d{4,}\b",
    r"\bchannel\s*[-_:/]?\s*uc[a-z0-9_-]{6,}\b",
]


def load_gsc_rows(path: Path):
    raw = path.read_text(encoding="utf-8", errors="ignore")
    data = json.loads(raw)
    rows = data.get("rows") or []
    out = []
    for r in rows:
        # Supports both formats:
        # 1) {"keys":[query,page], ...}
        # 2) {"query": "...", "page": "...", ...}
        q = ""
        page = ""
        keys = r.get("keys") or []
        if len(keys) >= 2:
            q = (keys[0] or "").strip()
            page = (keys[1] or "").strip()
        else:
            q = (r.get("query") or "").strip()
            page = (r.get("page") or "").strip()
        if not q or not page:
            continue
        out.append(
            {
                "query": q,
                "page": page,
                "clicks": float(r.get("clicks") or 0),
                "impressions": float(r.get("impressions") or 0),
                "ctr": float(r.get("ctr") or 0),
                "position": float(r.get("position") or 0),
            }
        )
    return out


def is_noise_query(q: str):
    ql = (q or "").strip().lower()
    if not ql:
        return True
    ql = re.sub(r"\s+", " ", ql)
    for pat in NOISE_QUERY_PATTERNS:
        if re.search(pat, ql):
            return True
    if re.fullmatch(r"[\d\W_]+", ql):
        return True
    # Very digit-heavy one-token queries are usually noisy for our use case.
    digit_count = len(re.findall(r"\d", ql))
    token_count = len(re.findall(r"[a-z\u4e00-\u9fff]+", ql))
    if digit_count >= 5 and token_count <= 1:
        return True
    return False


def keep_page(url: str):
    try:
        p = urllib.parse.urlparse(url)
        if p.netloc and "usadanews.com" not in p.netloc:
            return False
        path = p.path or ""
        return "/vtuber/" in path
    except Exception:
        return False


def pick_opportunities(rows, min_impr=25.0, max_ctr=0.05):
    out = []
    for r in rows:
        if is_noise_query(r["query"]):
            continue
        if not keep_page(r["page"]):
            continue
        if r["impressions"] < min_impr:
            continue
        if r["ctr"] > max_ctr:
            continue
        out.append(r)
    out.sort(key=lambda x: (-x["impressions"], x["ctr"], x["position"]))
    return out


def fetch_post_id_by_path(path: str, auth):
    # Fast path: slug from URL, then query vtuber endpoint by slug.
    slug = (path or "").strip("/").split("/")[-1].strip()
    if not slug:
        return None
    try:
        r = requests.get(
            f"{BASE}/wp-json/wp/v2/vtuber",
            params={"slug": slug, "per_page": 1, "_fields": "id,link,slug"},
            auth=auth,
            timeout=20,
        )
        if r.status_code == 200:
            arr = r.json() if r.text else []
            if arr:
                return int(arr[0].get("id"))
    except Exception:
        pass
    # Fallback: raw URL lookup through WP posts endpoint (may still fail for CPT).
    return None


def resolve_pages_to_ids(opps, auth):
    by_page = {}
    for r in opps:
        page = r["page"]
        by_page.setdefault(page, {"rows": [], "impressions": 0.0, "clicks": 0.0})
        by_page[page]["rows"].append(r)
        by_page[page]["impressions"] += r["impressions"]
        by_page[page]["clicks"] += r["clicks"]

    resolved = []
    for page, v in by_page.items():
        p = urllib.parse.urlparse(page)
        pid = fetch_post_id_by_path(p.path, auth)
        if not pid:
            continue
        queries = []
        seen = set()
        for it in v["rows"]:
            q = it["query"]
            if q in seen:
                continue
            seen.add(q)
            queries.append(q)
        imp = v["impressions"]
        clk = v["clicks"]
        ctr = (clk / imp) if imp > 0 else 0.0
        resolved.append(
            {
                "page": page,
                "post_id": pid,
                "impressions": imp,
                "clicks": clk,
                "rows": len(v["rows"]),
                "queries": queries[:8],
                "ctr": ctr,
            }
        )

    resolved.sort(key=lambda x: (-x["impressions"], x["ctr"]))
    return resolved


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gsc-json", default="reports/gsc_queries_latest.json")
    ap.add_argument("--out", default="reports/gsc_low_ctr_targets.json")
    ap.add_argument("--user", required=True)
    ap.add_argument("--app-pass", required=True)
    ap.add_argument("--min-impr", type=float, default=25.0)
    ap.add_argument("--max-ctr", type=float, default=0.05)
    ap.add_argument("--max-pages", type=int, default=50)
    args = ap.parse_args()

    rows = load_gsc_rows(Path(args.gsc_json))
    opps = pick_opportunities(rows, min_impr=args.min_impr, max_ctr=args.max_ctr)
    auth = (args.user, args.app_pass)
    resolved = resolve_pages_to_ids(opps, auth)[: args.max_pages]
    target_ids = [str(int(x["post_id"])) for x in resolved]

    out = {
        "source_rows": len(rows),
        "opportunity_rows": len(opps),
        "resolved_pages": resolved,
        "target_ids": target_ids,
        "target_ids_count": len(target_ids),
    }
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(args.out)
    print(
        json.dumps(
            {
                "source_rows": len(rows),
                "opportunity_rows": len(opps),
                "target_ids_count": len(target_ids),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
