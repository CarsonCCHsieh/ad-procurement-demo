#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path


def build_index_xml(locs: list[str], lastmod: str) -> str:
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for loc in locs:
        lines.extend(
            [
                "  <sitemap>",
                f"    <loc>{loc}</loc>",
                f"    <lastmod>{lastmod}</lastmod>",
                "  </sitemap>",
            ]
        )
    lines.append("</sitemapindex>")
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Generate structured sitemap indexes (core/vtuber/taxonomy + master)."
    )
    ap.add_argument("--base", default="https://usadanews.com")
    ap.add_argument("--out-dir", default=".")
    ap.add_argument("--vtuber-max-part", type=int, default=26)
    args = ap.parse_args()

    base = args.base.rstrip("/")
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    lastmod = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    # 1) Core sitemap index (WordPress native)
    core_locs = [
        f"{base}/post-sitemap.xml",
        f"{base}/page-sitemap.xml",
        f"{base}/author-sitemap.xml",
    ]

    # 2) VTuber sitemap index (prefer static split XMLs for GSC compatibility)
    vtuber_parts = max(1, int(args.vtuber_max_part))
    vtuber_locs = [f"{base}/vtuber-sitemap{i}.xml" for i in range(1, vtuber_parts + 1)]
    # Keep dynamic index as fallback.
    vtuber_locs.append(f"{base}/vtuber-sitemap-index.php")

    # 3) Taxonomy sitemap index
    taxonomy_locs = [
        f"{base}/agency-sitemap.xml",
        f"{base}/platform-sitemap.xml",
        f"{base}/role-tag-sitemap.xml",
        f"{base}/country-sitemap.xml",
        f"{base}/debut-year-sitemap.xml",
        f"{base}/franchise-sitemap.xml",
        f"{base}/life-status-sitemap.xml",
    ]

    # 4) Master sitemap index
    master_locs = [
        f"{base}/sitemap-core.xml",
        f"{base}/sitemap-vtuber.xml",
        f"{base}/sitemap-taxonomy.xml",
    ]

    (out_dir / "sitemap-core.xml").write_text(build_index_xml(core_locs, lastmod), encoding="utf-8", newline="\n")
    (out_dir / "sitemap-vtuber.xml").write_text(build_index_xml(vtuber_locs, lastmod), encoding="utf-8", newline="\n")
    (out_dir / "sitemap-taxonomy.xml").write_text(build_index_xml(taxonomy_locs, lastmod), encoding="utf-8", newline="\n")

    master_xml = build_index_xml(master_locs, lastmod)
    # Keep standard names as master entry for GSC submission convenience.
    for name in ("sitemap_index.xml", "sitemap.xml", "sitemap-master.xml"):
        (out_dir / name).write_text(master_xml, encoding="utf-8", newline="\n")

    print(f"ok generated sitemap indexes out={out_dir}")
    print("generated: sitemap_index.xml, sitemap.xml, sitemap-master.xml, sitemap-core.xml, sitemap-vtuber.xml, sitemap-taxonomy.xml")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
