import argparse
import json
import os
import time
from datetime import datetime, timezone
from typing import Any

import requests


def load_registry(path: str) -> list[dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError("registry must be a list")
    return data


def score_source(source: dict[str, Any], healthy: bool) -> int:
    tier = int(source.get("priority_tier", 3))
    reliability = int(source.get("reliability_score", 3))
    freshness = int(source.get("freshness_score", 3))
    complexity = int(source.get("parse_complexity", 3))

    tier_weight = {1: 40, 2: 30, 3: 20}.get(tier, 20)
    health_weight = 15 if healthy else -20
    return tier_weight + reliability * 7 + freshness * 5 + health_weight - complexity * 3


def probe_source(source: dict[str, Any], timeout: int) -> dict[str, Any]:
    url = str(source.get("healthcheck_url") or "").strip()
    out: dict[str, Any] = {
        "id": source.get("id"),
        "name": source.get("name"),
        "url": url,
        "healthy": False,
        "status": None,
        "elapsed_ms": None,
        "error": None,
        "content_type": "",
        "response_bytes": 0,
    }
    if not url:
        out["error"] = "missing healthcheck_url"
        out["priority_score"] = score_source(source, False)
        return out

    headers = {"User-Agent": "USADA-Maint-SourceProbe/1.0"}
    t0 = time.time()
    try:
        resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
        out["status"] = int(resp.status_code)
        out["elapsed_ms"] = int((time.time() - t0) * 1000)
        out["content_type"] = resp.headers.get("content-type", "")
        out["response_bytes"] = len(resp.content or b"")
        out["healthy"] = bool(resp.status_code == 200)
    except Exception as e:  # noqa: BLE001
        out["elapsed_ms"] = int((time.time() - t0) * 1000)
        out["error"] = str(e)
        out["healthy"] = False

    out["priority_score"] = score_source(source, out["healthy"])
    return out


def build_language_plan(
    sources: list[dict[str, Any]], probe_map: dict[str, dict[str, Any]]
) -> dict[str, list[dict[str, Any]]]:
    targets = ["ja", "en", "zh-TW", "zh-CN", "ko", "es", "hi"]
    plan: dict[str, list[dict[str, Any]]] = {}

    intro_keys = {"profile_intro", "notable_events", "debut_history"}
    identity_keys = {"discovery", "official_name", "aliases", "group"}
    metrics_only_keys = {"avatar", "followers", "bio", "official_links"}

    for lang in targets:
        rows: list[dict[str, Any]] = []
        for s in sources:
            if not s.get("enabled", True):
                continue
            langs = s.get("languages") or []
            langs_norm = {str(x).strip() for x in langs}
            direct = lang in langs_norm or "multi" in langs_norm
            bridge = lang in {"zh-CN", "ko", "es", "hi"} and bool(s.get("can_seed_other_languages"))
            if not (direct or bridge):
                continue

            p = probe_map.get(str(s.get("id"))) or {}
            use_for = set(s.get("use_for") or [])
            language_score = int(p.get("priority_score", 0))
            if lang in langs_norm:
                language_score += 20
            if use_for & intro_keys:
                language_score += 12
            if use_for & identity_keys:
                language_score += 8
            if lang == "zh-TW" and str(s.get("id")) == "twvt_sheet_master":
                language_score += 30
            if lang in {"zh-CN", "ko", "es", "hi"} and bool(s.get("can_seed_other_languages")):
                language_score += 10
            if use_for and use_for.issubset(metrics_only_keys):
                language_score -= 8

            rows.append(
                {
                    "id": s.get("id"),
                    "name": s.get("name"),
                    "healthy": bool(p.get("healthy", False)),
                    "priority_score": int(p.get("priority_score", 0)),
                    "language_score": language_score,
                    "use_for": s.get("use_for") or [],
                    "source_languages": langs,
                }
            )
        rows.sort(key=lambda x: (x["healthy"], x["language_score"], x["priority_score"]), reverse=True)
        plan[lang] = rows
    return plan


def write_json(path: str, data: Any) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def write_markdown(path: str, report: dict[str, Any]) -> None:
    lines: list[str] = []
    lines.append("# JP/EN Source Health Report")
    lines.append("")
    lines.append(f"- generated_utc: `{report['generated_utc']}`")
    lines.append(f"- registry_count: `{report['registry_count']}`")
    lines.append(f"- healthy_count: `{report['healthy_count']}`")
    lines.append("")
    lines.append("## Sources")
    lines.append("")
    lines.append("| id | status | score | ms | languages | use_for |")
    lines.append("| --- | --- | ---: | ---: | --- | --- |")
    for r in report["sources"]:
        status = "ok" if r["healthy"] else f"fail({r.get('status')})"
        lines.append(
            "| {id} | {status} | {score} | {ms} | {langs} | {use_for} |".format(
                id=r.get("id", ""),
                status=status,
                score=r.get("priority_score", 0),
                ms=r.get("elapsed_ms") or 0,
                langs=",".join(r.get("source_languages") or []),
                use_for=",".join(r.get("use_for") or []),
            )
        )
    lines.append("")
    lines.append("## Language Priority (Top 5)")
    lines.append("")
    for lang, rows in report["language_plan"].items():
        lines.append(f"### {lang}")
        lines.append("")
        for row in rows[:5]:
            lines.append(
                "- `{id}` (lang_score={lang_score}, base={score}, healthy={healthy})".format(
                    id=row["id"],
                    lang_score=row.get("language_score", 0),
                    score=row["priority_score"],
                    healthy=str(row["healthy"]).lower(),
                )
            )
        lines.append("")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main() -> int:
    parser = argparse.ArgumentParser(description="Probe JP/EN source registry health")
    parser.add_argument("--registry", required=True, help="Path to source registry json")
    parser.add_argument("--out-dir", default="reports", help="Output directory")
    parser.add_argument("--timeout", type=int, default=18, help="Per-source timeout seconds")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    sources = load_registry(args.registry)

    probes: list[dict[str, Any]] = []
    for source in sources:
        if not source.get("enabled", True):
            continue
        p = probe_source(source, timeout=args.timeout)
        p["source_languages"] = source.get("languages") or []
        p["use_for"] = source.get("use_for") or []
        probes.append(p)

    probes.sort(key=lambda x: (x["healthy"], x["priority_score"]), reverse=True)
    probe_map = {str(x.get("id")): x for x in probes}
    plan = build_language_plan(sources, probe_map)
    now_utc = datetime.now(timezone.utc).isoformat()
    healthy_count = sum(1 for x in probes if x["healthy"])

    report = {
        "generated_utc": now_utc,
        "registry_count": len([x for x in sources if x.get("enabled", True)]),
        "healthy_count": healthy_count,
        "sources": probes,
        "language_plan": plan,
    }

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = os.path.join(args.out_dir, f"jpen_source_health_{ts}.json")
    latest_json = os.path.join(args.out_dir, "jpen_source_health_latest.json")
    md_path = os.path.join(args.out_dir, f"jpen_source_health_{ts}.md")
    latest_md = os.path.join(args.out_dir, "jpen_source_health_latest.md")

    write_json(json_path, report)
    write_json(latest_json, report)
    write_markdown(md_path, report)
    write_markdown(latest_md, report)

    print(
        "ok registry={registry} healthy={healthy}/{total} latest={latest}".format(
            registry=args.registry,
            healthy=healthy_count,
            total=report["registry_count"],
            latest=latest_json,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
