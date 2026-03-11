import argparse
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from ftplib import FTP
from pathlib import Path


def now_ts() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def parse_secret_bundle(path: Path) -> dict:
    txt = path.read_text(encoding="utf-8", errors="ignore")
    m_secret = re.search(r"\$secret\s*=\s*['\"]([^'\"]+)['\"]", txt)
    m_user = re.search(r"\$basic_user\s*=\s*['\"]([^'\"]+)['\"]", txt)
    m_pass = re.search(r"\$basic_pass\s*=\s*['\"]([^'\"]+)['\"]", txt)
    if not (m_secret and m_user and m_pass):
        raise RuntimeError(f"cannot parse secret/basic auth from {path}")
    return {"secret": m_secret.group(1), "basic_user": m_user.group(1), "basic_pass": m_pass.group(1)}


def build_runtime_vtmaint(template_path: Path, bundle: dict) -> str:
    txt = template_path.read_text(encoding="utf-8", errors="ignore")
    txt = re.sub(r"\$secret\s*=\s*['\"][^'\"]+['\"]", f"$secret = '{bundle['secret']}'", txt, count=1)
    txt = re.sub(r"\$basic_user\s*=\s*['\"][^'\"]+['\"]", f"$basic_user = '{bundle['basic_user']}'", txt, count=1)
    txt = re.sub(r"\$basic_pass\s*=\s*['\"][^'\"]+['\"]", f"$basic_pass = '{bundle['basic_pass']}'", txt, count=1)
    return txt


def ftp_get_bytes(ftp: FTP, remote_path: str) -> bytes:
    chunks: list[bytes] = []
    ftp.retrbinary(f"RETR {remote_path}", chunks.append)
    return b"".join(chunks)


def ftp_put_bytes(ftp: FTP, remote_path: str, body: bytes) -> None:
    from io import BytesIO

    ftp.storbinary(f"STOR {remote_path}", BytesIO(body))


def verify(base_url: str, key: str) -> dict:
    params = {
        "action": "enrich_full_intro_raw",
        "key": key,
        "batch": "1",
        "force": "0",
        "min_len": "180",
        "origin": "hololist",
    }
    url = base_url.rstrip("?") + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "USADA-Maint-Deploy/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        body = r.read().decode("utf-8-sig", "ignore").strip()
    ok = '"origin_filter": "hololist"' in body or '"origin_filter":"hololist"' in body
    return {"ok": ok, "url": url, "head": (body[:500] if body else "")}


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy vt-maint.php + vt-maint-runner.php safely")
    parser.add_argument("--ftp-host", default="usadanews.com")
    parser.add_argument("--ftp-user", required=True)
    parser.add_argument("--ftp-pass", required=True)
    parser.add_argument("--remote-root", default="/public_html")
    parser.add_argument("--secure-vtmaint", default=r"C:\Users\User\hsieh\vt-maint.php")
    parser.add_argument("--base-url", default="https://usadanews.com/vt-maint.php")
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument("--out-dir", default=str(Path(__file__).resolve().parents[2] / "reports"))
    args = parser.parse_args()

    repo_root = Path(args.repo_root)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = now_ts()
    backup_dir = out_dir / f"deploy_backup_{ts}"
    backup_dir.mkdir(parents=True, exist_ok=True)

    vtmaint_template = repo_root / "usadanews-code-snapshot" / "plugin" / "vt-maint.php"
    runner_local = repo_root / "usadanews-code-snapshot" / "plugin" / "vt-maint-runner.php"
    secure_src = Path(args.secure_vtmaint)
    bundle = parse_secret_bundle(secure_src)
    runtime_vtmaint = build_runtime_vtmaint(vtmaint_template, bundle)

    remote_vtmaint = f"{args.remote_root.rstrip('/')}/vt-maint.php"
    remote_runner = f"{args.remote_root.rstrip('/')}/wp-content/plugins/vt-maint-runner.php"

    report = {
        "utc": datetime.now(timezone.utc).isoformat(),
        "ftp_host": args.ftp_host,
        "remote_vtmaint": remote_vtmaint,
        "remote_runner": remote_runner,
        "backup_dir": str(backup_dir),
        "steps": [],
    }

    with FTP(args.ftp_host, timeout=60) as ftp:
        ftp.login(args.ftp_user, args.ftp_pass)
        report["steps"].append({"step": "ftp_login", "ok": True})

        # 1) Pull remote backups
        remote_vtmaint_body = ftp_get_bytes(ftp, remote_vtmaint)
        remote_runner_body = ftp_get_bytes(ftp, remote_runner)
        (backup_dir / "vt-maint.php").write_bytes(remote_vtmaint_body)
        (backup_dir / "vt-maint-runner.php").write_bytes(remote_runner_body)
        report["steps"].append({"step": "backup_download", "ok": True})

        # 2) Push timestamped remote backups
        ftp_put_bytes(ftp, f"{remote_vtmaint}.bak.{ts}", remote_vtmaint_body)
        ftp_put_bytes(ftp, f"{remote_runner}.bak.{ts}", remote_runner_body)
        report["steps"].append({"step": "backup_upload_remote", "ok": True, "ts": ts})

        # 3) Deploy new files
        ftp_put_bytes(ftp, remote_vtmaint, runtime_vtmaint.encode("utf-8"))
        ftp_put_bytes(ftp, remote_runner, runner_local.read_bytes())
        report["steps"].append({"step": "deploy_upload", "ok": True})

    # 4) Verify action response supports origin filter
    v = verify(args.base_url, bundle["secret"])
    report["verify"] = v

    out = out_dir / f"deploy_maint_plugin_{ts}.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"ok report={out}")
    if not v.get("ok"):
        print("warn verify origin_filter not found in response head")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

