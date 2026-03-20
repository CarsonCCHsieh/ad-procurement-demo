#!/usr/bin/env python3
from __future__ import annotations

import ftplib
import os
from pathlib import Path


def main() -> int:
    host = os.environ.get("USADA_FTP_HOST", "usadanews.com")
    user = (os.environ.get("USADA_FTP_USER") or "").strip()
    pw = (os.environ.get("USADA_FTP_PASS") or "").strip()
    root = (os.environ.get("USADA_FTP_ROOT") or "/public_html").strip()
    in_dir = Path(os.environ.get("SITEMAP_ASSET_DIR") or ".")

    if not user or not pw:
        raise SystemExit("missing env: USADA_FTP_USER / USADA_FTP_PASS")

    required_files = [
        in_dir / "sitemap.xml",
        in_dir / "sitemap_index.xml",
        in_dir / "vtuber-sitemap-index.php",
        in_dir / "vtuber-sitemap-dynamic.php",
    ]
    optional_files = [
        in_dir / "sitemap-master.xml",
        in_dir / "sitemap-core.xml",
        in_dir / "sitemap-vtuber.xml",
        in_dir / "sitemap-taxonomy.xml",
    ]

    files = list(required_files)
    files.extend([p for p in optional_files if p.exists()])

    missing = [str(p) for p in required_files if not p.exists()]
    if missing:
        raise SystemExit("missing files: " + ", ".join(missing))

    ftp = ftplib.FTP()
    ftp.connect(host, 21, timeout=30)
    ftp.login(user, pw)
    ftp.set_pasv(True)
    ftp.cwd(root)

    uploaded = []
    for p in files:
        try:
            with p.open("rb") as f:
                ftp.storbinary("STOR " + p.name, f)
            uploaded.append(p.name)
            print("uploaded", p.name)
        except ftplib.error_perm as e:
            if p in optional_files:
                print("skip_optional_upload", p.name, str(e))
                continue
            raise

    ftp.quit()
    print("[ok] upload_dynamic_sitemap_assets", ",".join(uploaded))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
