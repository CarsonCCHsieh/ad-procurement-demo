import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone


def int_env(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return int(default)
    try:
        return int(raw)
    except Exception:  # noqa: BLE001
        return int(default)


def load_cycle_config() -> dict:
    profile = (os.environ.get("VT_MAINT_PROFILE") or "local").strip().lower()
    if profile not in {"local", "server"}:
        profile = "local"

    cfg = {
        "profile": profile,
        "max_seconds": 3600 if profile == "local" else 1200,
        "status_fix_iters": 20 if profile == "local" else 6,
        "sync_translation_meta_iters": 3 if profile == "local" else 2,
        "sync_translation_meta_batch": 10 if profile == "local" else 6,
        "enrich_terms_iters": 30 if profile == "local" else 8,
        "fillthumbs_iters": 20 if profile == "local" else 8,
        "fill_metrics_iters": 12 if profile == "local" else 4,
        "fill_metrics_batch": 120 if profile == "local" else 80,
        "fix_avatar_quality_iters": 3 if profile == "local" else 1,
        "fix_tiny_thumb_iters": 3 if profile == "local" else 1,
        "enrich_social_bio_iters": 10 if profile == "local" else 4,
        "enrich_moegirl_iters": 8 if profile == "local" else 3,
        "enrich_full_intro_iters": 8 if profile == "local" else 4,
        "internal_links_iters": 8 if profile == "local" else 4,
        "ensure_translations_iters": 20 if profile == "local" else 6,
        "ensure_translations_batch": 25 if profile == "local" else 12,
        "sync_translation_content_iters": 8 if profile == "local" else 4,
        "sync_translation_content_batch": 25 if profile == "local" else 12,
        "news_refresh_iters": 6 if profile == "local" else 3,
        "news_refresh_batch": 6 if profile == "local" else 4,
        "dedupe_iters": 10 if profile == "local" else 3,
        "dedupe_batch": 200 if profile == "local" else 120,
        "run_site_audit": profile == "local",
        "run_http_health_scan": True,
        "run_gsc_sync": True,
        # Run low-CTR enrichment on both local/server.
        # Server mode is still bounded by max_seconds and stricter time budget.
        "run_low_ctr_enrich": True,
    }

    # Optional overrides (for CI/server tuning without code change).
    cfg["max_seconds"] = int_env("VT_CYCLE_MAX_SECONDS", cfg["max_seconds"])
    cfg["fillthumbs_iters"] = int_env("VT_CYCLE_FILLTHUMBS_ITERS", cfg["fillthumbs_iters"])
    cfg["fill_metrics_iters"] = int_env("VT_CYCLE_FILL_METRICS_ITERS", cfg["fill_metrics_iters"])
    cfg["enrich_full_intro_iters"] = int_env("VT_CYCLE_ENRICH_FULL_INTRO_ITERS", cfg["enrich_full_intro_iters"])
    cfg["ensure_translations_iters"] = int_env("VT_CYCLE_ENSURE_TRANSLATIONS_ITERS", cfg["ensure_translations_iters"])
    cfg["sync_translation_content_iters"] = int_env("VT_CYCLE_SYNC_TRANSLATION_CONTENT_ITERS", cfg["sync_translation_content_iters"])
    cfg["run_site_audit"] = (os.environ.get("VT_CYCLE_RUN_SITE_AUDIT", "1" if cfg["run_site_audit"] else "0").strip() == "1")
    cfg["run_http_health_scan"] = (os.environ.get("VT_CYCLE_RUN_HEALTH_SCAN", "1" if cfg["run_http_health_scan"] else "0").strip() == "1")
    cfg["run_gsc_sync"] = (os.environ.get("VT_CYCLE_RUN_GSC_SYNC", "1" if cfg["run_gsc_sync"] else "0").strip() == "1")
    cfg["run_low_ctr_enrich"] = (os.environ.get("VT_CYCLE_RUN_LOW_CTR", "1" if cfg["run_low_ctr_enrich"] else "0").strip() == "1")
    return cfg


def read_key() -> str:
    # Prefer env-injected secrets (GitHub-safe / CI-friendly).
    k = (os.environ.get("VT_MAINT_KEY") or "").strip()
    if k:
        return k

    # Legacy local dev fallback: read from vt-maint.php if present.
    try:
        s = open("vt-maint.php", "r", encoding="utf-8", errors="ignore").read()
    except FileNotFoundError as e:
        raise SystemExit("missing VT_MAINT_KEY and no vt-maint.php to read from") from e

    m = re.search(r'\$secret\s*=\s*"([^"]+)"', s)
    if not m:
        raise SystemExit("secret_not_found_in_vt-maint.php")
    return m.group(1)


def fetch(action: str, timeout: int = 180, extra: dict | None = None) -> str:
    key = read_key()
    params = {"key": key, "action": action}
    if extra:
        for k, v in extra.items():
            params[str(k)] = str(v)
    url = "https://usadanews.com/vt-maint.php?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "vt-maint-cycle/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    return body.decode("utf-8-sig", "ignore").strip()


def log_write(fp, s: str) -> None:
    fp.write(s + "\n")
    fp.flush()


def progress(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {msg}\n"
    try:
        sys.stdout.write(line)
        sys.stdout.flush()
    except UnicodeEncodeError:
        # Windows consoles may use legacy code pages (e.g., cp950/cp936).
        # Replace unencodable characters so maintain cycles don't crash.
        safe = line.encode(sys.stdout.encoding or "utf-8", errors="replace")
        sys.stdout.buffer.write(safe)
        sys.stdout.flush()


def run_proc(cmd: list[str], timeout_s: int = 300) -> str:
    try:
        p = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
        return (p.stdout or p.stderr or "").strip()
    except subprocess.TimeoutExpired:
        return f"TIMEOUT {' '.join(cmd)} after {timeout_s}s"
    except Exception as e:  # noqa: BLE001
        return f"ERROR {' '.join(cmd)} {e}"


def resolve_script(*candidates: str) -> str:
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return candidates[0]


def head_line(txt: str) -> str:
    for line in (txt or "").splitlines():
        line = line.strip()
        if line:
            return line[:240]
    return ""

def parse_updated_count(txt: str) -> int | None:
    """
    Extract updated count from vt-maint action output.
    Supports either JSON-like (`"updated": 12`) or plain text (`updated=12`).
    """
    if not txt:
        return None
    m = re.search(r'"updated"\s*:\s*(\d+)', txt)
    if not m:
        m = re.search(r'\bupdated\b\s*[=:]\s*(\d+)\b', txt)
    if not m:
        return None
    try:
        return int(m.group(1))
    except Exception:  # noqa: BLE001
        return None


def parse_named_count(txt: str, key: str) -> int | None:
    if not txt or not key:
        return None
    m = re.search(r'"' + re.escape(key) + r'"\s*:\s*(\d+)', txt)
    if not m:
        return None
    try:
        return int(m.group(1))
    except Exception:  # noqa: BLE001
        return None


def contains_all(txt: str, needles: list[str]) -> bool:
    if not txt:
        return False
    low = txt.lower()
    return all(n.lower() in low for n in needles)


def read_target_ids_from_json(path: str, limit: int = 80) -> list[str]:
    try:
        import json

        if not os.path.exists(path):
            return []
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            data = json.load(f)
        ids = data.get("target_ids") or []
        out: list[str] = []
        for x in ids:
            s = str(x).strip()
            if not s or not s.isdigit():
                continue
            out.append(s)
            if len(out) >= limit:
                break
        return out
    except Exception:
        return []


def main() -> int:
    cfg = load_cycle_config()
    os.makedirs("reports", exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = os.path.join("reports", f"maint_cycle_{ts}.log")
    cycle_start = time.time()

    with open(log_path, "w", encoding="utf-8") as log:
        log_write(log, f"utc={datetime.now(timezone.utc).isoformat()}")
        log_write(log, f"profile={cfg['profile']} max_seconds={cfg['max_seconds']}")
        progress(
            f"maint cycle start profile={cfg['profile']} max_seconds={cfg['max_seconds']} log={log_path}"
        )

        def time_left() -> float:
            return float(cfg["max_seconds"]) - (time.time() - cycle_start)

        def can_run(stage: str, reserve_s: int = 60) -> bool:
            left = time_left()
            if left < reserve_s:
                msg = f"budget_low skip={stage} left={left:.1f}s reserve={reserve_s}s"
                progress(msg)
                log_write(log, msg)
                return False
            return True

        def budget_timeout(requested_s: int, reserve_s: int = 60, floor_s: int = 30) -> int:
            left = time_left()
            allowed = int(max(floor_s, left - reserve_s))
            return max(floor_s, min(int(requested_s), allowed))

        # -1) Prevent quota-related 5xx by pruning oversized remote logs (best-effort).
        if can_run("cleanup_remote_logs", 40):
            t0 = time.time()
            cleanup_remote_logs_script = resolve_script(
                "maintain/cleanup_remote_logs.py",
                "maintain/github_private_repo/tools/cleanup_remote_logs.py",
                "tools/cleanup_remote_logs.py",
            )
            try:
                if os.environ.get("USADA_FTP_USER") and os.environ.get("USADA_FTP_PASS"):
                    progress("action cleanup_remote_logs start")
                    txt = run_proc(["python", cleanup_remote_logs_script], timeout_s=180)
                else:
                    txt = "SKIP cleanup_remote_logs (missing USADA_FTP_USER/USADA_FTP_PASS)"
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR cleanup_remote_logs {e}"
            progress(f"action cleanup_remote_logs done: {head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=cleanup_remote_logs seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))

        # 0) Polylang URL mode + required languages (idempotent)
        if can_run("polylang_setup", 60):
            t0 = time.time()
            progress("action polylang_setup start")
            try:
                txt = fetch("polylang_setup", timeout=240)
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR polylang_setup {e}"
            progress(f"action polylang_setup done: {head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=polylang_setup seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))

        # 0.1) Ensure portal page translations exist (front page per-language)
        if can_run("ensure_page_translations", 60):
            t0 = time.time()
            progress("action ensure_page_translations start")
            try:
                txt = fetch("ensure_page_translations", timeout=240)
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR ensure_page_translations {e}"
            progress(f"action ensure_page_translations done: {head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=ensure_page_translations seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))

        # 1) Normalize/cleanup terms (includes term renames + core slugs)
        if can_run("cleanup_terms", 60):
            t0 = time.time()
            progress("action cleanup_terms start")
            try:
                txt = fetch("cleanup_terms", timeout=240)
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR cleanup_terms {e}"
            progress(f"action cleanup_terms done: {head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=cleanup_terms seconds={time.time()-t0:.1f}")
            log_write(log, txt)

        # 1.2) Remove non-profile HoloList noise pages accidentally imported as VTubers.
        if can_run("cleanup_hololist_noise_raw", 50):
            t0 = time.time()
            progress("action cleanup_hololist_noise_raw start")
            try:
                txt = fetch("cleanup_hololist_noise_raw", timeout=180, extra={"batch": 120 if cfg["profile"] == "server" else 180})
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR cleanup_hololist_noise_raw {e}"
            progress(f"action cleanup_hololist_noise_raw done: {head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=cleanup_hololist_noise_raw seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))

        # 1.3) Remove entries with no avatar + no social links + nearly empty summary.
        if can_run("cleanup_no_avatar_no_social_raw", 50):
            t0 = time.time()
            progress("action cleanup_no_avatar_no_social_raw start")
            try:
                txt = fetch("cleanup_no_avatar_no_social_raw", timeout=180, extra={"batch": 120 if cfg["profile"] == "server" else 180})
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR cleanup_no_avatar_no_social_raw {e}"
            progress(f"action cleanup_no_avatar_no_social_raw done: {head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=cleanup_no_avatar_no_social_raw seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))

        # 1.5) Fix lifecycle conflicts (ex: excerpt says "鍋滄娲诲嫊" but life-status still active).
        # Run in small loops until it converges (updated=0) to make the frontend consistent.
        for i in range(1, int(cfg["status_fix_iters"]) + 1):
            if not can_run("status_fix_loop", 80):
                break
            t0 = time.time()
            progress(f"action status_fix iter={i}/{cfg['status_fix_iters']} start")
            try:
                txt = fetch("status_fix", timeout=240)
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR status_fix {e}"
            upd = parse_updated_count(txt)
            progress(f"action status_fix iter={i}/{cfg['status_fix_iters']} done updated={upd} msg={head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=status_fix iter={i} seconds={time.time()-t0:.1f} updated={upd}")
            log_write(log, head_line(txt))
            if upd == 0:
                break
            time.sleep(0.7)

        # 1.6) Sync translation meta/terms with small batches to avoid timeout lockups.
        # This prevents per-language drift (ex: ZH says Hiatus, EN shows Graduated).
        for i in range(1, int(cfg["sync_translation_meta_iters"]) + 1):
            if not can_run("sync_translation_meta_loop", 80):
                break
            t0 = time.time()
            progress(f"action sync_translation_meta iter={i}/{cfg['sync_translation_meta_iters']} start")
            try:
                txt = fetch(
                    "sync_translation_meta",
                    timeout=180,
                    extra={"batch": int(cfg["sync_translation_meta_batch"]), "hours": 24},
                )
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR sync_translation_meta {e}"
            progress(
                f"action sync_translation_meta iter={i}/{cfg['sync_translation_meta_iters']} done msg={head_line(txt)}"
            )
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=sync_translation_meta iter={i} seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
            # Avoid hammering when another worker holds the lock.
            if "locked" in (txt or "").lower():
                break
            time.sleep(0.5)

        # 1.7) Export GSC queries (if OAuth token exists) + upload to server (if FTP env exists),
        # then import hot keywords from the uploaded JSON (best-effort).
        if cfg.get("run_gsc_sync", True) and can_run("gsc_export_queries", 120):
            t0 = time.time()
            try:
                token_path = os.environ.get("GSC_TOKEN_PATH") or os.path.join("maintain", "gsc_token.json")
                has_service_account = bool((os.environ.get("GSC_SERVICE_ACCOUNT_JSON") or "").strip())
                if has_service_account or os.path.exists(token_path):
                    progress("action gsc_export_queries start")
                    txt = run_proc(
                        ["python", "maintain/gsc_export_queries.py"],
                        timeout_s=budget_timeout(420, reserve_s=120, floor_s=60),
                    )
                else:
                    txt = "SKIP gsc_export_queries (missing GSC_SERVICE_ACCOUNT_JSON and GSC token file)"
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR gsc_export_queries {e}"
            progress(f"action gsc_export_queries done: {head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=gsc_export_queries seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
        elif not cfg.get("run_gsc_sync", True):
            progress("action gsc_export_queries skipped by profile")
            log_write(log, "action=gsc_export_queries skip=profile")

        if cfg.get("run_gsc_sync", True) and can_run("upload_gsc_queries", 90):
            t0 = time.time()
            try:
                if os.environ.get("USADA_FTP_USER") and os.environ.get("USADA_FTP_PASS"):
                    progress("action upload_gsc_queries start")
                    txt = run_proc(
                        ["python", "maintain/upload_gsc_queries.py"],
                        timeout_s=budget_timeout(300, reserve_s=90, floor_s=45),
                    )
                else:
                    txt = "SKIP upload_gsc_queries (missing USADA_FTP_USER/USADA_FTP_PASS)"
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR upload_gsc_queries {e}"
            progress(f"action upload_gsc_queries done: {head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=upload_gsc_queries seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
        elif not cfg.get("run_gsc_sync", True):
            progress("action upload_gsc_queries skipped by profile")
            log_write(log, "action=upload_gsc_queries skip=profile")

        # 1.75) Build low-CTR target IDs from latest GSC export, then enrich weak summaries
        # with targeted sources (Moegirl -> HoloList fallback), best-effort.
        wp_user = (os.environ.get("VT_WP_USER") or "").strip()
        wp_app_pass = (os.environ.get("VT_WP_APP_PASS") or "").strip()
        if cfg.get("run_low_ctr_enrich", True):
            if wp_user and wp_app_pass and can_run("low_ctr_pipeline", 180):
                t0 = time.time()
                progress("action build_gsc_low_ctr_targets start")
                low_ctr_builder = resolve_script(
                    "maintain/build_gsc_low_ctr_targets.py",
                    "maintain/github_private_repo/tools/build_gsc_low_ctr_targets.py",
                    "tools/build_gsc_low_ctr_targets.py",
                )
                txt = run_proc(
                    [
                        "python",
                        low_ctr_builder,
                        "--gsc-json",
                        "reports/gsc_queries_latest.json",
                        "--out",
                        "reports/gsc_low_ctr_targets.json",
                        "--user",
                        wp_user,
                        "--app-pass",
                        wp_app_pass,
                        "--min-impr",
                        "25",
                        "--max-ctr",
                        "0.05",
                        "--max-pages",
                        str(40 if cfg["profile"] == "local" else 20),
                    ],
                    timeout_s=budget_timeout(240, reserve_s=150, floor_s=60),
                )
                progress(f"action build_gsc_low_ctr_targets done: {head_line(txt)}")
                log_write(log, "\n" + "=" * 70)
                log_write(log, f"action=build_gsc_low_ctr_targets seconds={time.time()-t0:.1f}")
                log_write(log, head_line(txt))

                ids = read_target_ids_from_json("reports/gsc_low_ctr_targets.json", limit=50)
                if ids and can_run("enrich_moegirl_ids_raw_low_ctr", 120):
                    t0 = time.time()
                    progress(f"action enrich_moegirl_ids_raw low_ctr start ids={len(ids)}")
                    try:
                        txt = fetch(
                            "enrich_moegirl_ids_raw",
                            timeout=budget_timeout(360, reserve_s=120, floor_s=90),
                            extra={"ids": ",".join(ids), "force": 0, "min_len": 110},
                        )
                    except Exception as e:  # noqa: BLE001
                        txt = f"ERROR enrich_moegirl_ids_raw {e}"
                    progress(f"action enrich_moegirl_ids_raw low_ctr done: {head_line(txt)}")
                    log_write(log, "\n" + "=" * 70)
                    log_write(log, f"action=enrich_moegirl_ids_raw(low_ctr) seconds={time.time()-t0:.1f}")
                    log_write(log, head_line(txt))

                if ids and can_run("enrich_low_ctr_from_hololist", 120):
                    t0 = time.time()
                    progress("action enrich_low_ctr_from_hololist start")
                    low_ctr_hololist = resolve_script(
                        "maintain/enrich_low_ctr_from_hololist.py",
                        "maintain/github_private_repo/tools/enrich_low_ctr_from_hololist.py",
                        "tools/enrich_low_ctr_from_hololist.py",
                    )
                    txt = run_proc(
                        [
                            "python",
                            low_ctr_hololist,
                            "--user",
                            wp_user,
                            "--app-pass",
                            wp_app_pass,
                            "--ids-file",
                            "reports/gsc_low_ctr_targets.json",
                            "--min-len",
                            "110",
                        ],
                        timeout_s=budget_timeout(420, reserve_s=120, floor_s=60),
                    )
                    progress(f"action enrich_low_ctr_from_hololist done: {head_line(txt)}")
                    log_write(log, "\n" + "=" * 70)
                    log_write(log, f"action=enrich_low_ctr_from_hololist seconds={time.time()-t0:.1f}")
                    log_write(log, head_line(txt))
                elif not ids:
                    progress("action enrich_low_ctr skip: no target ids")
                    log_write(log, "\n" + "=" * 70)
                    log_write(log, "action=enrich_low_ctr skip=no_target_ids")
                else:
                    progress("action enrich_low_ctr skip: budget")
                    log_write(log, "\n" + "=" * 70)
                    log_write(log, "action=enrich_low_ctr skip=budget")
            elif not (wp_user and wp_app_pass):
                progress("action enrich_low_ctr skip: missing VT_WP_USER/VT_WP_APP_PASS")
                log_write(log, "\n" + "=" * 70)
                log_write(log, "action=enrich_low_ctr skip=missing_wp_auth")
            else:
                progress("action enrich_low_ctr skip: budget")
                log_write(log, "\n" + "=" * 70)
                log_write(log, "action=enrich_low_ctr skip=budget")
        else:
            progress("action enrich_low_ctr skipped by profile")
            log_write(log, "\n" + "=" * 70)
            log_write(log, "action=enrich_low_ctr skip=profile")

        if can_run("seo_keywords_import_raw", 60):
            t0 = time.time()
            progress("action seo_keywords_import_raw start")
            try:
                txt = fetch("seo_keywords_import_raw", timeout=120, extra={"limit": 80})
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR seo_keywords_import_raw {e}"
            progress(f"action seo_keywords_import_raw done: {head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=seo_keywords_import_raw seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))

        # 2) Enrich terms in multiple passes (agency/platform/role/country/year)
        enrich_noop_streak = 0
        for i in range(1, int(cfg["enrich_terms_iters"]) + 1):
            if not can_run("enrich_terms_loop", 80):
                break
            t0 = time.time()
            progress(f"action enrich_terms iter={i}/{cfg['enrich_terms_iters']} start")
            try:
                txt = fetch("enrich_terms", timeout=240)
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR enrich_terms {e}"
            progress(f"action enrich_terms iter={i}/{cfg['enrich_terms_iters']} done msg={head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=enrich_terms iter={i} seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
            if contains_all(txt, ['"processed":0', '"updated":0']):
                enrich_noop_streak += 1
            else:
                enrich_noop_streak = 0
            if enrich_noop_streak >= 3:
                progress("action enrich_terms early-stop: 3 consecutive no-op iterations")
                break
            time.sleep(0.7)

        # 3) Fill avatars + fill missing followers/summary (our resolver now does both)
        for i in range(1, int(cfg["fillthumbs_iters"]) + 1):
            if not can_run("fillthumbs_loop", 80):
                break
            t0 = time.time()
            progress(f"action fillthumbs iter={i}/{cfg['fillthumbs_iters']} start")
            try:
                txt = fetch("fillthumbs", timeout=240)
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR fillthumbs {e}"
            progress(f"action fillthumbs iter={i}/{cfg['fillthumbs_iters']} done msg={head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=fillthumbs iter={i} seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
            if "locked" in (txt or "").lower():
                progress("action fillthumbs early-stop: locked")
                break
            time.sleep(0.7)

        # 3.0) Dedicated social-metrics fill pass (followers/subscribers) using ID cursor.
        # This is independent from avatar-first cursor logic and helps close large metric gaps.
        metrics_noop_streak = 0
        for i in range(1, int(cfg["fill_metrics_iters"]) + 1):
            if not can_run("fill_metrics_loop", 90):
                break
            t0 = time.time()
            progress(f"action fill_metrics_raw iter={i}/{cfg['fill_metrics_iters']} start")
            try:
                txt = fetch("fill_metrics_raw", timeout=240, extra={"batch": int(cfg["fill_metrics_batch"])})
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR fill_metrics_raw {e}"
            progress(f"action fill_metrics_raw iter={i}/{cfg['fill_metrics_iters']} done msg={head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=fill_metrics_raw iter={i} seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
            if "locked" in (txt or "").lower():
                progress("action fill_metrics_raw early-stop: locked")
                break
            upd_yt = parse_named_count(txt, "updated_yt")
            upd_tw = parse_named_count(txt, "updated_twitch")
            if upd_yt == 0 and upd_tw == 0:
                metrics_noop_streak += 1
            else:
                metrics_noop_streak = 0
            if metrics_noop_streak >= 2:
                progress("action fill_metrics_raw early-stop: consecutive no-op batches")
                break
            time.sleep(0.7)

        # 3.1) Try repairing tiny/unresolved avatars from social pages with strict caps.
        for i in range(1, int(cfg["fix_avatar_quality_iters"]) + 1):
            if not can_run("fix_avatar_quality_loop", 120):
                break
            t0 = time.time()
            progress(f"action fix_avatar_quality iter={i}/{cfg['fix_avatar_quality_iters']} start")
            txt = run_proc(
                [
                    "python",
                    "maintain/fix_avatar_quality.py",
                    "--sample",
                    "5000",
                    "--max-items",
                    "120",
                ],
                timeout_s=600,
            )
            progress(f"action fix_avatar_quality iter={i}/{cfg['fix_avatar_quality_iters']} done: {head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=fix_avatar_quality iter={i} seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
            if '"updated": 0' in (txt or ""):
                break
            time.sleep(0.7)

        # 3.2) If tiny local thumbnails still remain, fall back to valid remote source URLs.
        for i in range(1, int(cfg["fix_tiny_thumb_iters"]) + 1):
            if not can_run("fix_tiny_thumb_fallback_loop", 90):
                break
            t0 = time.time()
            progress(f"action fix_tiny_thumb_fallback_raw iter={i}/{cfg['fix_tiny_thumb_iters']} start")
            try:
                txt = fetch("fix_tiny_thumb_fallback_raw", timeout=180, extra={"batch": 120})
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR fix_tiny_thumb_fallback_raw {e}"
            progress(f"action fix_tiny_thumb_fallback_raw iter={i}/{cfg['fix_tiny_thumb_iters']} done msg={head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=fix_tiny_thumb_fallback_raw iter={i} seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
            if '"fixed": 0' in (txt or ""):
                break
            time.sleep(0.7)

        # 3.4) Enrich profile summaries from social pages (YouTube/Twitch/OG descriptions).
        for i in range(1, int(cfg["enrich_social_bio_iters"]) + 1):
            if not can_run("enrich_social_bio_loop", 90):
                break
            t0 = time.time()
            progress(f"action enrich_social_bio_raw iter={i}/{cfg['enrich_social_bio_iters']} start")
            try:
                txt = fetch("enrich_social_bio_raw", timeout=240, extra={"batch": 40})
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR enrich_social_bio_raw {e}"
            upd = parse_updated_count(txt)
            progress(
                f"action enrich_social_bio_raw iter={i}/{cfg['enrich_social_bio_iters']} done updated={upd} msg={head_line(txt)}"
            )
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=enrich_social_bio_raw iter={i} seconds={time.time()-t0:.1f} updated={upd}")
            log_write(log, head_line(txt))
            if upd == 0:
                break
            time.sleep(0.7)

        # 3.5) Enrich empty summaries from Moegirl (best-effort, non-overwrite)
        for i in range(1, int(cfg["enrich_moegirl_iters"]) + 1):
            if not can_run("enrich_moegirl_loop", 90):
                break
            t0 = time.time()
            progress(f"action enrich_moegirl iter={i}/{cfg['enrich_moegirl_iters']} start")
            try:
                txt = fetch("enrich_moegirl", timeout=240, extra={"batch": 40})
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR enrich_moegirl {e}"
            progress(f"action enrich_moegirl iter={i}/{cfg['enrich_moegirl_iters']} done msg={head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=enrich_moegirl iter={i} seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
            time.sleep(0.7)

        # 3.55) Fill/upgrade full intro block content (post_content) for single VTuber pages.
        # Keep this conservative: only empty/weak content unless force=1.
        for i in range(1, int(cfg["enrich_full_intro_iters"]) + 1):
            if not can_run("enrich_full_intro_loop", 90):
                break
            t0 = time.time()
            progress(f"action enrich_full_intro_raw iter={i}/{cfg['enrich_full_intro_iters']} start")
            try:
                txt = fetch("enrich_full_intro_raw", timeout=240, extra={"batch": 40, "force": 0, "min_len": 180})
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR enrich_full_intro_raw {e}"
            upd = parse_updated_count(txt)
            progress(
                f"action enrich_full_intro_raw iter={i}/{cfg['enrich_full_intro_iters']} done updated={upd} msg={head_line(txt)}"
            )
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=enrich_full_intro_raw iter={i} seconds={time.time()-t0:.1f} updated={upd}")
            log_write(log, head_line(txt))
            if upd == 0:
                break
            time.sleep(0.7)

        # 3.6) Build internal entity links in summaries (same-language target when available).
        for i in range(1, int(cfg["internal_links_iters"]) + 1):
            if not can_run("internal_links_loop", 90):
                break
            t0 = time.time()
            progress(f"action internal_links_raw iter={i}/{cfg['internal_links_iters']} start")
            try:
                txt = fetch("internal_links_raw", timeout=240, extra={"batch": 120})
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR internal_links_raw {e}"
            upd = parse_updated_count(txt)
            progress(
                f"action internal_links_raw iter={i}/{cfg['internal_links_iters']} done updated={upd} msg={head_line(txt)}"
            )
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=internal_links_raw iter={i} seconds={time.time()-t0:.1f} updated={upd}")
            log_write(log, head_line(txt))
            if upd == 0:
                break
            time.sleep(0.7)

        # 4) Ensure translations for vtuber posts (incremental cursor-based).
        # Use raw JSON response so we can early-stop on no-op iterations.
        ensure_locked_streak = 0
        ensure_noop_streak = 0
        for i in range(1, int(cfg["ensure_translations_iters"]) + 1):
            if not can_run("ensure_translations_loop", 110):
                break
            t0 = time.time()
            progress(f"action ensure_translations_raw iter={i}/{cfg['ensure_translations_iters']} start")
            try:
                txt = fetch(
                    "ensure_translations_raw",
                    timeout=300,
                    extra={"batch": int(cfg["ensure_translations_batch"])},
                )
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR ensure_translations_raw {e}"
            created = parse_named_count(txt, "created")
            linked = parse_named_count(txt, "linked")
            checked = parse_named_count(txt, "checked")
            progress(
                f"action ensure_translations_raw iter={i}/{cfg['ensure_translations_iters']} done "
                f"checked={checked} created={created} linked={linked} msg={head_line(txt)}"
            )
            log_write(log, "\n" + "=" * 70)
            log_write(
                log,
                f"action=ensure_translations_raw iter={i} seconds={time.time()-t0:.1f} "
                f"checked={checked} created={created} linked={linked}",
            )
            log_write(log, head_line(txt))
            if "locked=1" in (txt or "").lower() or " locked " in (f" {txt.lower()} " if txt else ""):
                ensure_locked_streak += 1
            else:
                ensure_locked_streak = 0
            if ensure_locked_streak >= 3:
                progress("action ensure_translations_raw early-stop: 3 consecutive locked responses")
                break
            if (created == 0 or created is None) and (linked == 0 or linked is None):
                ensure_noop_streak += 1
            else:
                ensure_noop_streak = 0
            if ensure_noop_streak >= 3:
                progress("action ensure_translations_raw early-stop: consecutive no-op batches")
                break
            time.sleep(0.7)

        # 4.2) Build language-specific intro/excerpt content for translated VTuber pages.
        # Strategy:
        # - Prefer existing source language content (e.g., HoloList EN) when available.
        # - Fallback to quick machine translation for missing language text.
        tr_noop_streak = 0
        tr_locked_streak = 0
        for i in range(1, int(cfg["sync_translation_content_iters"]) + 1):
            if not can_run("sync_translation_content_loop", 110):
                break
            t0 = time.time()
            progress(f"action sync_translation_content_raw iter={i}/{cfg['sync_translation_content_iters']} start")
            try:
                txt = fetch(
                    "sync_translation_content_raw",
                    timeout=300,
                    extra={"batch": int(cfg["sync_translation_content_batch"]), "force": 0, "min_len": 160},
                )
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR sync_translation_content_raw {e}"
            upd = parse_updated_count(txt)
            progress(
                f"action sync_translation_content_raw iter={i}/{cfg['sync_translation_content_iters']} done "
                f"updated={upd} msg={head_line(txt)}"
            )
            log_write(log, "\n" + "=" * 70)
            log_write(
                log,
                f"action=sync_translation_content_raw iter={i} seconds={time.time()-t0:.1f} updated={upd}",
            )
            log_write(log, head_line(txt))
            low = (txt or "").lower()
            if "locked" in low:
                tr_locked_streak += 1
            else:
                tr_locked_streak = 0
            if tr_locked_streak >= 2:
                progress("action sync_translation_content_raw early-stop: locked")
                break
            if upd == 0:
                tr_noop_streak += 1
            else:
                tr_noop_streak = 0
            if tr_noop_streak >= 2:
                progress("action sync_translation_content_raw early-stop: consecutive no-op batches")
                break
            time.sleep(0.7)

        # 4.5) Refresh external news cache in small batches to avoid timeout.
        for i in range(1, int(cfg["news_refresh_iters"]) + 1):
            if not can_run("news_refresh_loop", 90):
                break
            t0 = time.time()
            progress(f"action news_refresh_raw iter={i}/{cfg['news_refresh_iters']} start")
            try:
                txt = fetch("news_refresh_raw", timeout=180, extra={"batch": int(cfg["news_refresh_batch"])})
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR news_refresh_raw {e}"
            progress(f"action news_refresh_raw iter={i}/{cfg['news_refresh_iters']} done msg={head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=news_refresh_raw iter={i} seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
            if "locked" in (txt or "").lower():
                progress("action news_refresh_raw early-stop: locked")
                break
            time.sleep(0.5)

        # 5) Dedupe in small batches (group-based) to avoid timeouts.
        dedupe_noop_streak = 0
        for i in range(1, int(cfg["dedupe_iters"]) + 1):
            if not can_run("dedupe_loop", 120):
                break
            t0 = time.time()
            progress(f"action dedupe iter={i}/{cfg['dedupe_iters']} start")
            try:
                txt = fetch("dedupe", timeout=360, extra={"batch": int(cfg["dedupe_batch"])})
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR dedupe {e}"
            progress(f"action dedupe iter={i}/{cfg['dedupe_iters']} done msg={head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=dedupe iter={i} seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
            if contains_all(txt, ['"checked_groups":0', '"deleted":0', '"merged_fields":0']):
                dedupe_noop_streak += 1
            else:
                dedupe_noop_streak = 0
            if dedupe_noop_streak >= 2:
                progress("action dedupe early-stop: consecutive no-op batches")
                break
            time.sleep(0.7)

        # 6) Diagnostics snapshots
        diag_actions = [
            ("metrics_diagnose_raw", 240),
            ("avatar_diagnose_raw", 300),
            ("source_health_raw", 240),
        ]
        if cfg.get("run_site_audit", True):
            diag_actions.append(("site_audit_raw", 240))
        else:
            log_write(log, "action=site_audit_raw skip=profile")
            progress("action site_audit_raw skipped by profile")
        diag_actions.append(("stats", 120))

        for act, to in diag_actions:
            if not can_run(f"diag_{act}", 90):
                break
            t0 = time.time()
            progress(f"action {act} start")
            try:
                txt = fetch(act, timeout=to)
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR {act} {e}"
            progress(f"action {act} done: {head_line(txt)}")
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action={act} seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))

        # 7) Sitemap refresh.
        # Default to dynamic VTuber sitemap mode to avoid disk-quota failures on very large datasets.
        sitemap_mode = (os.environ.get("VT_SITEMAP_MODE") or "dynamic").strip().lower()
        if can_run("sitemap_refresh", 60) and sitemap_mode == "static":
            t0 = time.time()
            progress("action generate_static_sitemaps start")
            txt = run_proc(
                ["python", "maintain/generate_static_sitemaps.py", "--base", "https://usadanews.com", "--out-dir", "."],
                timeout_s=1800,
            )
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=generate_static_sitemaps seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
            progress(f"action generate_static_sitemaps done: {head_line(txt)}")

            t0 = time.time()
            try:
                if os.environ.get("USADA_FTP_USER") and os.environ.get("USADA_FTP_PASS"):
                    progress("action upload_static_sitemaps start")
                    txt = run_proc(["python", "maintain/upload_static_sitemaps.py", "--in-dir", "."], timeout_s=300)
                else:
                    txt = "SKIP upload_static_sitemaps (missing USADA_FTP_USER/USADA_FTP_PASS)"
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR upload_static_sitemaps {e}"
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=upload_static_sitemaps seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
            progress(f"action upload_static_sitemaps done: {head_line(txt)}")
        elif can_run("sitemap_refresh", 60):
            t0 = time.time()
            progress("action generate_dynamic_sitemap_index start")
            txt = run_proc(
                ["python", "maintain/generate_dynamic_sitemap_index.py", "--base", "https://usadanews.com", "--out-dir", "."],
                timeout_s=120,
            )
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=generate_dynamic_sitemap_index seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
            progress(f"action generate_dynamic_sitemap_index done: {head_line(txt)}")

            t0 = time.time()
            try:
                if os.environ.get("USADA_FTP_USER") and os.environ.get("USADA_FTP_PASS"):
                    progress("action upload_dynamic_sitemap_assets start")
                    txt = run_proc(["python", "maintain/upload_dynamic_sitemap_assets.py"], timeout_s=300)
                else:
                    txt = "SKIP upload_dynamic_sitemap_assets (missing USADA_FTP_USER/USADA_FTP_PASS)"
            except Exception as e:  # noqa: BLE001
                txt = f"ERROR upload_dynamic_sitemap_assets {e}"
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=upload_dynamic_sitemap_assets seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
            progress(f"action upload_dynamic_sitemap_assets done: {head_line(txt)}")

        # 8) HTTP health scan (sample sitemap URLs to catch intermittent 5xx).
        # This helps correlate GSC "server error (5xx)" without requiring GSC OAuth.
        if cfg.get("run_http_health_scan", True) and can_run("http_health_scan", 120):
            t0 = time.time()
            progress("action http_health_scan start")
            health_scan_script = resolve_script(
                "maintain/http_health_scan.py",
                "maintain/github_private_repo/tools/http_health_scan.py",
                "tools/http_health_scan.py",
            )
            txt = run_proc(
                [
                    "python",
                    health_scan_script,
                    "--sitemap-index",
                    "https://usadanews.com/sitemap_index.xml",
                    "--max-sitemaps",
                    "4",
                    "--per-sitemap-take",
                    "12",
                    "--max-urls",
                    "48",
                    "--timeout",
                    "6",
                    "--max-seconds",
                    "120",
                    "--sleep-ms",
                    "5",
                ],
                timeout_s=210,
            )
            log_write(log, "\n" + "=" * 70)
            log_write(log, f"action=http_health_scan seconds={time.time()-t0:.1f}")
            log_write(log, head_line(txt))
            progress(f"action http_health_scan done: {head_line(txt)}")
        elif not cfg.get("run_http_health_scan", True):
            log_write(log, "action=http_health_scan skip=profile")
            progress("action http_health_scan skipped by profile")

    progress(f"maint cycle done log={log_path}")
    print("log", log_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

