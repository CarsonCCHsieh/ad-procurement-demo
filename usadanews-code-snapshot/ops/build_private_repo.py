#!/usr/bin/env python3
"""
Build a sanitized, GitHub-ready private repo snapshot.
"""

from __future__ import annotations

import os
import re
import stat
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "maintain" / "github_private_repo"

FILE_MAP = [
    ("MAINTAIN_SYSTEM.md", "docs/MAINTAIN_SYSTEM.md"),
    ("maintain/build_private_repo.py", "tools/build_private_repo.py"),
    ("maintain/repo_secret_scan.py", "tools/repo_secret_scan.py"),
    ("run_maint_cycle.py", "tools/run_maint_cycle.py"),
    ("run_maint_actions.py", "tools/run_maint_actions.py"),
    ("maintain/fix_avatar_quality.py", "tools/fix_avatar_quality.py"),
    ("maintain/google_sitemap_refresh.py", "tools/google_sitemap_refresh.py"),
    ("maintain/cleanup_remote_logs.py", "tools/cleanup_remote_logs.py"),
    ("maintain/generate_dynamic_sitemap_index.py", "tools/generate_dynamic_sitemap_index.py"),
    ("maintain/upload_dynamic_sitemap_assets.py", "tools/upload_dynamic_sitemap_assets.py"),
    ("vt-maint-runner.php", "wp-content/plugins/vt-maint-runner.php"),
    ("wp-vtuber-cpts.php", "wp-content/plugins/wp-vtuber-cpts.php"),
    ("vtuber-portal.css", "wp-content/plugins/vtuber-portal/assets/vtuber-portal.css"),
    ("vt-portal-landing.php", "wp-content/plugins/vtuber-portal/templates/vt-portal-landing.php"),
    ("archive-vtuber.php", "wp-content/plugins/vtuber-portal/templates/archive-vtuber.php"),
    ("single-vtuber.php", "wp-content/plugins/vtuber-portal/templates/single-vtuber.php"),
    ("vt-platform-index.php", "wp-content/plugins/vtuber-portal/templates/vt-platform-index.php"),
    ("vt-agency-index.php", "wp-content/plugins/vtuber-portal/templates/vt-agency-index.php"),
    ("vt-country-index.php", "wp-content/plugins/vtuber-portal/templates/vt-country-index.php"),
    ("vt-debut-year-index.php", "wp-content/plugins/vtuber-portal/templates/vt-debut-year-index.php"),
    ("vt-role-index.php", "wp-content/plugins/vtuber-portal/templates/vt-role-index.php"),
    ("vt-contact.php", "wp-content/plugins/vtuber-portal/templates/vt-contact.php"),
    ("taxonomy-platform.php", "wp-content/plugins/vtuber-portal/templates/taxonomy-platform.php"),
    ("taxonomy-agency.php", "wp-content/plugins/vtuber-portal/templates/taxonomy-agency.php"),
    ("taxonomy-role-tag.php", "wp-content/plugins/vtuber-portal/templates/taxonomy-role-tag.php"),
    ("taxonomy-life-status.php", "wp-content/plugins/vtuber-portal/templates/taxonomy-life-status.php"),
    ("taxonomy-franchise.php", "wp-content/plugins/vtuber-portal/templates/taxonomy-franchise.php"),
    ("taxonomy-country.php", "wp-content/plugins/vtuber-portal/templates/taxonomy-country.php"),
    ("taxonomy-debut-year.php", "wp-content/plugins/vtuber-portal/templates/taxonomy-debut-year.php"),
    ("mu-plugins/vt-portal-redirects.php", "wp-content/mu-plugins/vt-portal-redirects.php"),
    ("mu-plugins/vt-force-fs-direct.php", "wp-content/mu-plugins/vt-force-fs-direct.php"),
]


def sanitize_vt_maint_php(text: str) -> str:
    text = re.sub(
        r'\$secret\s*=\s*["\'][^"\']+["\'];',
        "$secret = getenv('VT_MAINT_KEY') ?: 'CHANGE_ME_VT_MAINT_KEY';",
        text,
        count=1,
    )
    text = re.sub(
        r"\$basic_user\s*=\s*['\"][^'\"]+['\"];",
        "$basic_user = getenv('VT_MAINT_BASIC_USER') ?: 'vtmaint';",
        text,
        count=1,
    )
    text = re.sub(
        r"\$basic_pass\s*=\s*['\"][^'\"]+['\"];",
        "$basic_pass = getenv('VT_MAINT_BASIC_PASS') ?: 'CHANGE_ME_VT_MAINT_BASIC_PASS';",
        text,
        count=1,
    )
    return text


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def _on_rm_error(func, path, exc_info) -> None:  # noqa: ANN001
    # Windows can mark git object files read-only; relax mode and retry.
    os.chmod(path, stat.S_IWRITE)
    func(path)


def clean_out_dir() -> None:
    if not OUT.exists():
        OUT.mkdir(parents=True, exist_ok=True)
        return

    git_dir = OUT / ".git"
    if git_dir.exists():
        for child in OUT.iterdir():
            if child.name == ".git":
                continue
            if child.is_dir():
                shutil.rmtree(child, onerror=_on_rm_error)
            else:
                child.chmod(stat.S_IWRITE)
                child.unlink()
        return

    shutil.rmtree(OUT, onerror=_on_rm_error)
    OUT.mkdir(parents=True, exist_ok=True)


def copy_tree() -> None:
    clean_out_dir()

    for src_rel, dst_rel in FILE_MAP:
        src = ROOT / src_rel
        dst = OUT / dst_rel
        if not src.exists():
            raise FileNotFoundError(f"missing required source: {src}")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

    vt_maint_src = ROOT / "vt-maint.php"
    vt_maint_dst = OUT / "tools/vt-maint.php"
    vt_maint_text = vt_maint_src.read_text(encoding="utf-8", errors="ignore")
    write_text(vt_maint_dst, sanitize_vt_maint_php(vt_maint_text))

    readme = """# USADA VTuber Portal 維護系統（私有備份 Repo）

這個 repo 是 usadanews.com 目前「Portal 版型」與「維護管線（maintain pipeline）」的**去敏快照**，用於長期保存、回溯與稽核。

它不是整個 WordPress 站點的完整備份（例如資料庫、uploads、cache 都不在這裡），主要保存「會影響前台顯示與 SEO 的程式碼」。

## 安全性（非常重要）
- **本 repo 不會提交任何密碼、金鑰、API secret、cookie、個資。**
- `tools/vt-maint.php` 的存取憑證一律使用環境變數注入（GitHub safe）：
  - `VT_MAINT_KEY`
  - `VT_MAINT_BASIC_USER`
  - `VT_MAINT_BASIC_PASS`
- 請參考 `.env.example`，實際值只放在你的本機或部署環境，不要 commit。

## maintain 流程實際跑在哪裡？（運行位置）
維護不是跑在 GitHub，而是跑在**伺服器端 WordPress**：
- `wp-content/plugins/vt-maint-runner.php`
  - 核心維護邏輯（同步資料、補圖、追蹤數、去重、語系補齊、狀態修正、輸出報表）。
  - 主要透過 **WP-Cron** 分批執行（shared hosting 也能跑，避免單次超時）。
- `vt-maint.php`（站台根目錄，這裡提供去敏版：`tools/vt-maint.php`）
  - 受保護的 maintenance endpoint：手動觸發 action、檢查狀態、解鎖卡住的鎖、輸出診斷 JSON。
- `wp-content/mu-plugins/vt-portal-redirects.php`
  - 舊主題頁/薄頁 301 重導回 Portal 最新 IA，避免 Google 繼續索引舊頁。

可選的本機/CI orchestrator（不直接改 WP 檔案，只是呼叫站上 endpoint）：
- `tools/run_maint_cycle.py`
  - 用 HTTP 依序呼叫多個 action，串成「完整維護一輪」，並把摘要寫到 `reports/`。

## 它會維護哪些頁面？（頁型覆蓋）
Portal 頁面都由 `vtuber-portal` templates 統一輸出：
- 首頁 `/`：`wp-content/plugins/vtuber-portal/templates/vt-portal-landing.php`
- VTuber 列表 `/vtuber/`：`wp-content/plugins/vtuber-portal/templates/archive-vtuber.php`
- VTuber 個人頁 `/vtuber/<slug>/`：`wp-content/plugins/vtuber-portal/templates/single-vtuber.php`
- Taxonomy 集合頁（SEO 入口頁）：
  - 平台：`taxonomy-platform.php`
  - 組織：`taxonomy-agency.php`
  - 特色標籤：`taxonomy-role-tag.php`
  - 狀態：`taxonomy-life-status.php`
  - 國家：`taxonomy-country.php`
  - 出道年：`taxonomy-debut-year.php`
  - 系列/企劃：`taxonomy-franchise.php`
- 索引頁（快速導覽）：`vt-*-index.php` 一系列（platform/agency/country/debut-year 等）
- 聯絡/合作頁：`vt-contact.php`

多語系（Polylang）策略：
- 預設語言繁中不加前綴。
- 其他語言採路徑前綴：`/cn /en /ko /es /hi`。
- maintain 會確保主要 Portal 頁面與 VTuber 條目在各語系至少有「骨架頁」存在，並同步關鍵欄位，避免語系間顯示漂移。

## maintain 會檢查/修正哪些問題？（你在前台看到的變化來源）
以下每一項都直接影響前台列表/個人頁的內容與 SEO：
- **資料同步**
  - 台灣 VTuber：以 Google Sheet 為主（多個 gid 分頁）。
  - 國外 VTuber：可用 Hololist 等來源補齊（不得覆蓋台灣條目）。
- **缺圖（大頭貼/首圖）補齊**
  - 優先 YouTube channel avatar；沒有再嘗試 Twitch profile image。
  - 平台預設 placeholder 會被視為「缺圖」，列入診斷與報表（避免看似有圖其實是預設圖）。
- **追蹤數（Followers）**
  - Twitch：用 API 更新 followers（用於排序與卡片顯示）。
  - 其他平台若無穩定/合法取得方式，會只顯示可點擊連結，避免「0」誤導。
- **去重（避免同人多筆）**
  - 依 stable keys（YouTube/Twitch/X）與名稱正規化合併：例如「Usada 兔田佩可拉 / 兔田佩可拉 / Usada Pekora」視為同一人。
  - 合併策略會保留內容較完整、圖片較好的那筆，並搬移缺失欄位。
- **狀態（life-status）修正與一致化**
  - 解析 note / twitch bio / summary / excerpt/content 的停更、休止、畢業等關鍵字。
  - 避免「簡介寫停止活動但列表標籤仍顯示活動中」。
  - 狀態會同步到所有語系翻譯頁（避免語系間漂移）。
- **Taxonomy 補齊（集合頁）**
  - country / debut-year / platform / agency / role-tag / life-status 等，形成 SEO 友善集合頁。
- **SEO**
  - canonical/hreflang：每個語系頁互相宣告，避免重複內容互相競爭。
  - robots：`?sort=` 等排序頁加 `noindex,follow`，避免薄頁被索引。
  - 圖片 alt：卡片頭像/封面圖使用顯示名作為 alt（避免空 alt）。
  - sitemap：靜態 sitemap（index + vtuber + taxonomy）定期更新並在 `robots.txt` 宣告。
- **舊頁重導**
  - 舊主題頁、舊分類頁、無意義薄頁：301 回 Portal 最新頁型，降低 `site:usadanews.com` 出現大量舊頁。

## 怎麼執行 / 怎麼看結果？
### 1) 手動觸發單一 action（站上 endpoint）
`vt-maint.php` 放在站台根目錄，呼叫方式如下（不要把 key 放進 repo）：
- `https://usadanews.com/vt-maint.php?action=fillthumbs&key=<VT_MAINT_KEY>`
- 常用 action：
  - `status`：目前狀態 + cron/lock 概覽
  - `sync_sheet` / `sync_sheet_force`：同步資料源
  - `fillthumbs`：補大頭貼 + 補部分欄位
  - `enrich_terms` / `cleanup_terms`：分類/標籤整理與補齊
  - `ensure_translations` / `ensure_page_translations`：補齊多語系骨架頁
  - `sync_translation_meta`：同步翻譯頁 meta/taxonomy（避免語系漂移）
  - `dedupe`：去重合併
  - `site_audit_raw` / `avatar_diagnose_raw` / `metrics_diagnose_raw`：輸出診斷報表

### 2) 跑一輪完整維護（建議）
在工作區根目錄執行：
```bash
python tools/run_maint_cycle.py
```
結果會寫到：`reports/maint_cycle_YYYYMMDD_HHMMSS.log`（可用於追蹤「這輪做了什麼、哪裡失敗、是否已收斂」）。

### 3) 7/24 運行建議
- 依賴 WP-Cron 時，shared hosting 可能不穩：建議用系統 cron（或外部健康檢查）每 5 分鐘打一次輕量 action 當 heartbeat。
- 重任務一律採「分批 + lock + 報表」設計，避免一次把站台打掛。

## Logs / 報表在哪？
- 站上：`wp-content/uploads/vt-logs/`（JSON + log）
- 本機：`reports/`（`tools/run_maint_cycle.py` 輸出）

## 這個快照 repo 怎麼更新到 GitHub？
在工作區根目錄執行（會重新生成 `maintain/github_private_repo/`，保留 `.git`）：
```bash
python maintain/build_private_repo.py
```
進入快照 repo 後做 secret scan（推送前必做）：
```bash
cd maintain/github_private_repo
python tools/repo_secret_scan.py .
```
最後 commit/push：
```bash
git add .
git commit -m "docs: expand README and clarify maintain coverage"
git push
```

第一次建立 repo（需要 GitHub CLI `gh`）：
```bash
gh auth setup-git
gh repo create <owner>/<repo> --private --source . --remote origin --push
```

## 完整文件
- `docs/MAINTAIN_SYSTEM.md`：包含更完整的架構說明、資料源與 action 規格。
"""
    write_text(OUT / "README.md", readme)

    gitignore = """# Secrets / runtime
.env
.env.*
secrets.local.json
*secret*.json
*credentials*.json
account_profiles.json
client_secret*.json
*token*.json
*.pem
*.key
*.p12
wp-config.php

# Logs / generated
*.log
*.tmp
*.bak
reports/
wp-content/uploads/
wp-content/cache/
wp-content/upgrade/

# Python
__pycache__/
*.pyc
.venv/
env/

# IDE
.idea/
.vscode/
"""
    write_text(OUT / ".gitignore", gitignore)

    write_text(
        OUT / ".env.example",
        "VT_MAINT_KEY=CHANGE_ME\nVT_MAINT_BASIC_USER=vtmaint\nVT_MAINT_BASIC_PASS=CHANGE_ME\n",
    )


def main() -> int:
    copy_tree()
    print(f"[ok] sanitized repo generated at: {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
