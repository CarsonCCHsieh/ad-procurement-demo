#!/usr/bin/env python3
"""
Sitemap + SEO refresh checker for usadanews.com.

What this script does:
1) Validate live sitemap endpoints and parse URL/lastmod stats.
2) Run vt-maint.php site_audit_raw (if local secret is available).
3) Check canonical/hreflang basics on key pages.
4) Try Google Search Console sitemap submit (official method) when OAuth scope allows it.
5) Write a single JSON report for maintain tracking.
"""

from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

import google.auth.transport.requests
from google.oauth2.service_account import Credentials as SACredentials
import requests


ROOT = Path(__file__).resolve().parents[1]
REPORT_DIR = ROOT / "reports"
REPORT_FILE = REPORT_DIR / "google_sitemap_refresh_report.json"
TOKEN_FILE = ROOT / "token_user.json"
VT_MAINT_CANDIDATES = [ROOT / "vt-maint.php", ROOT / "tools" / "vt-maint.php"]
GSC_WRITE_SCOPE = "https://www.googleapis.com/auth/webmasters"

SITE_HOME = "https://usadanews.com/"
SITEMAP_URLS = [
    "https://usadanews.com/sitemap_index.xml",
]
SEO_CHECK_URLS = [
    "https://usadanews.com/",
    "https://usadanews.com/vtuber/",
    "https://usadanews.com/cn/vtuber/",
    "https://usadanews.com/en/vtuber/",
    "https://usadanews.com/ko/vtuber/",
    "https://usadanews.com/es/vtuber/",
    "https://usadanews.com/hi/vtuber/",
]
GSC_PROPERTIES = [
    "sc-domain:usadanews.com",
]


@dataclass
class SitemapInfo:
    url: str
    ok: bool
    status: int
    bytes: int
    loc_count: int
    lastmod_count: int
    lastmod_min: str
    lastmod_max: str
    parse_error: str
    sample_locs: list[str]


def fetch_text(url: str, timeout: int = 60) -> tuple[bool, int, bytes, str, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "USADA-Maintain/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            text = raw.decode("utf-8-sig", "ignore").lstrip("\ufeff")
            return True, getattr(resp, "status", 200), raw, text, ""
    except Exception as exc:  # noqa: BLE001
        return False, 0, b"", "", str(exc)


def parse_sitemap(url: str) -> SitemapInfo:
    ok, status, raw, text, err = fetch_text(url, timeout=120)
    if not ok:
        return SitemapInfo(
            url=url,
            ok=False,
            status=status,
            bytes=len(raw),
            loc_count=0,
            lastmod_count=0,
            lastmod_min="",
            lastmod_max="",
            parse_error=err,
            sample_locs=[],
        )
    try:
        root = ET.fromstring(text)
        ns = ""
        if root.tag.startswith("{"):
            ns = root.tag.split("}")[0] + "}"
        locs = [(e.text or "").strip() for e in root.findall(f".//{ns}loc") if (e.text or "").strip()]
        lms = [(e.text or "").strip() for e in root.findall(f".//{ns}lastmod") if (e.text or "").strip()]
        return SitemapInfo(
            url=url,
            ok=True,
            status=status,
            bytes=len(raw),
            loc_count=len(locs),
            lastmod_count=len(lms),
            lastmod_min=min(lms) if lms else "",
            lastmod_max=max(lms) if lms else "",
            parse_error="",
            sample_locs=locs[:10],
        )
    except Exception as exc:  # noqa: BLE001
        return SitemapInfo(
            url=url,
            ok=False,
            status=status,
            bytes=len(raw),
            loc_count=0,
            lastmod_count=0,
            lastmod_min="",
            lastmod_max="",
            parse_error=str(exc),
            sample_locs=[],
        )


def run_site_audit() -> dict:
    key = (os.environ.get("VT_MAINT_KEY") or "").strip()
    if not key:
        vt_file = None
        for p in VT_MAINT_CANDIDATES:
            if p.exists():
                vt_file = p
                break
        if vt_file is None:
            return {"ok": False, "reason": "vt-maint.php not found"}
        text = vt_file.read_text(encoding="utf-8", errors="ignore")
        m = re.search(r"\$secret\s*=\s*(?:\"([^\"]+)\"|'([^']+)')", text)
        if not m:
            return {"ok": False, "reason": "secret_not_found"}
        key = (m.group(1) or m.group(2) or "").strip()
        if not key:
            return {"ok": False, "reason": "secret_empty"}
    url = f"https://usadanews.com/vt-maint.php?action=site_audit_raw&key={urllib.parse.quote(key)}"
    ok, status, raw, body, err = fetch_text(url, timeout=240)
    if not ok:
        return {"ok": False, "status": status, "reason": err}
    try:
        data = json.loads(body)
        return {
            "ok": True,
            "status": status,
            "pass": data.get("pass"),
            "fail": data.get("fail"),
            "keys": list(data.keys()),
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "status": status, "reason": f"json_parse_error: {exc}", "body_head": body[:400]}


def seo_probe(url: str) -> dict:
    ok, status, raw, html, err = fetch_text(url, timeout=45)
    if not ok:
        return {"url": url, "ok": False, "status": status, "error": err}
    return {
        "url": url,
        "ok": True,
        "status": status,
        "has_canonical": bool(re.search(r'rel=["\']canonical["\']', html, re.I)),
        "has_hreflang": bool(re.search(r"hreflang=", html, re.I)),
        "has_x_default": bool(re.search(r'hreflang=["\']x-default["\']', html, re.I)),
        "has_noindex_meta": bool(re.search(r'name=["\']robots["\']\s+content=["\'][^"\']*noindex', html, re.I)),
    }


def refresh_access_token(token_cfg: dict) -> tuple[bool, str, str]:
    resp = requests.post(
        token_cfg["token_uri"],
        data={
            "client_id": token_cfg["client_id"],
            "client_secret": token_cfg["client_secret"],
            "refresh_token": token_cfg["refresh_token"],
            "grant_type": "refresh_token",
        },
        timeout=40,
    )
    if resp.status_code != 200:
        return False, "", f"token_refresh_failed: {resp.status_code} {resp.text[:240]}"
    data = resp.json()
    return True, str(data.get("access_token", "")), ""


def load_submit_access_token() -> tuple[bool, str, dict]:
    # Preferred path for unattended jobs: service account.
    sa_path = (os.environ.get("GSC_SERVICE_ACCOUNT_JSON") or "").strip()
    if sa_path:
        p = Path(sa_path)
        if not p.exists():
            return False, "", {"reason": "service_account_json_not_found", "path": str(p)}
        try:
            creds = SACredentials.from_service_account_file(str(p), scopes=[GSC_WRITE_SCOPE])
            creds.refresh(google.auth.transport.requests.Request())
            token = str(getattr(creds, "token", "") or "")
            if not token:
                return False, "", {"reason": "service_account_refresh_failed", "path": str(p)}
            return True, token, {"auth_mode": "service_account", "auth_source": str(p)}
        except Exception as exc:  # noqa: BLE001
            return False, "", {"reason": "service_account_auth_error", "detail": str(exc), "path": str(p)}

    # Fallback path: OAuth user token JSON.
    token_candidates = []
    env_token = (os.environ.get("GSC_TOKEN_PATH") or "").strip()
    if env_token:
        token_candidates.append(Path(env_token))
    token_candidates.append(ROOT / "maintain" / "gsc_token.json")
    token_candidates.append(TOKEN_FILE)

    token_path = None
    for p in token_candidates:
        if p.exists():
            token_path = p
            break

    if token_path is None:
        return (
            False,
            "",
            {
                "reason": "token_user_json_not_found",
                "checked": [str(x) for x in token_candidates],
            },
        )

    cfg = json.loads(token_path.read_text(encoding="utf-8"))
    scopes = set(cfg.get("scopes") or [])
    if GSC_WRITE_SCOPE not in scopes:
        return (
            False,
            "",
            {
                "reason": "missing_webmasters_scope",
                "token_path": str(token_path),
                "scopes": sorted(scopes),
                "note": "Google 官方建議以 Search Console 提交 Sitemap；舊的 /ping?sitemap= 端點已停用（會回 404）。",
            },
        )

    ok, access_token, err = refresh_access_token(cfg)
    if not ok:
        return False, "", {"reason": err, "token_path": str(token_path)}
    return True, access_token, {"auth_mode": "oauth_token", "auth_source": str(token_path)}


def submit_sitemaps_to_google() -> dict:
    ok, access_token, meta = load_submit_access_token()
    if not ok:
        out = {"ok": False}
        out.update(meta)
        return out

    props_csv = (os.environ.get("GSC_PROPERTIES_CSV") or "").strip()
    props = [x.strip() for x in props_csv.split(",") if x.strip()] if props_csv else GSC_PROPERTIES

    results = []
    for prop in props:
        for sm in SITEMAP_URLS:
            endpoint = (
                "https://www.googleapis.com/webmasters/v3/sites/"
                + urllib.parse.quote(prop, safe="")
                + "/sitemaps/"
                + urllib.parse.quote(sm, safe="")
            )
            r = requests.put(endpoint, headers={"Authorization": f"Bearer {access_token}"}, timeout=40)
            results.append(
                {
                    "property": prop,
                    "sitemap": sm,
                    "status": r.status_code,
                    "ok": r.status_code in (200, 204),
                    "body_head": (r.text or "")[:260],
                }
            )
    out = {"ok": True, "results": results}
    out.update(meta)
    return out


def main() -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()

    sitemap_infos = [asdict(parse_sitemap(url)) for url in SITEMAP_URLS]
    site_audit = run_site_audit()
    seo_checks = [seo_probe(url) for url in SEO_CHECK_URLS]
    gsc_submit = submit_sitemaps_to_google()

    report = {
        "utc": now,
        "site": SITE_HOME,
        "sitemaps": sitemap_infos,
        "site_audit": site_audit,
        "seo_checks": seo_checks,
        "google_search_console_submit": gsc_submit,
    }
    REPORT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[ok] report written: {REPORT_FILE}")
    for item in sitemap_infos:
        print(
            f"- sitemap: {item['url']} ok={item['ok']} locs={item['loc_count']} lastmod_max={item['lastmod_max']}"
        )
    print(
        f"- site_audit: ok={site_audit.get('ok')} pass={site_audit.get('pass')} fail={site_audit.get('fail')}"
    )
    gsc_ok = gsc_submit.get("ok")
    print(f"- gsc_submit: ok={gsc_ok} reason={gsc_submit.get('reason', '')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
