# USADA 主站代碼快照（遷移前）

建立時間：2026-03-09（Asia/Taipei）
來源：`C:\Users\User\hsieh` 本機主站維運檔案

## 目的
- 在主機轉移前，先把 USADA 主站關鍵代碼集中到版本庫。
- 避免「僅存在本機、未入版控」導致遷移時漏檔。
- 快照已做基本去敏（不含明文 API Key / App Password）。

## 目錄
- `plugin/`
  - `vt-maint.php`（已去敏，改環境變數）
  - `vt-maint-runner.php`
  - `wp-vtuber-cpts.php`
- `theme/`
  - `vt-portal-landing.php`, `archive-vtuber.php`, `single-vtuber.php`
  - `taxonomy-*.php`, `vt-*-index.php`, `vt-status.php`, `vt-contact.php`
  - `vtuber-portal.css`, `robots.txt`
- `ops/`
  - `run_maint_cycle.py`, `run_maint_actions.py`
  - `run_sync_sheet*.py`, `run_avatar_*.py`, `run_site_audit.py`
  - `build_gsc_low_ctr_targets.py`, `update_latest_vtubers.py`（已改環境變數）
- `docs/`
  - `MAINTAIN_SYSTEM.md`（原始快照）

## 快照去敏處理
- `theme/vt-status.php`
  - 明碼改為：`VT_MAINT_KEY / VT_MAINT_USER / VT_MAINT_PASS` 環境變數
- `ops/update_latest_vtubers.py`
  - 移除硬編碼 WordPress 帳密與 YouTube API Keys
  - 改為環境變數：
    - `USADA_WP_BASE`（可選）
    - `USADA_WP_USER`（必填）
    - `USADA_WP_PASS`（必填）
    - `USADA_YT_API_KEYS`（必填，逗號分隔）

## 不在此快照的內容
- 產生物：`sitemap*.xml`、reports、暫存與快取
- WordPress 媒體檔（`uploads`）與資料庫 dump
- 任何私密憑證檔（client_secret、service account JSON）

## 使用方式
1. 以此快照作為新主機部署的「代碼基線」。
2. 憑證與 key 一律走環境變數/私密檔注入。
3. 遷移完成後再由維運腳本產生 sitemap 與日誌。
