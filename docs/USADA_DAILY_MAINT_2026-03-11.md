# USADA 每日維運報告（2026-03-11, A2 現行主機）

執行時間（台灣）: 2026-03-11 00:15 ~ 00:38

## 本輪執行
1. 前檢查
- `status`
- `source_health_raw`
- `http_health_scan sample=30`

2. 完整 cycle（server profile）
- 腳本：`usadanews-code-snapshot/ops/run_maint_cycle.py`
- 設定：`VT_MAINT_PROFILE=server`, `VT_CYCLE_MAX_SECONDS=1200`
- 完整跑完（含翻譯、去重、補圖、metrics、來源健康、sitemap 生成、http 健康掃描）

3. 收尾補強
- `avatar_diagnose_raw sample=12000`
- `metrics_diagnose_raw`
- `fillthumbs`
- `fix_tiny_thumb_fallback_raw`
- `cleanup_no_avatar_no_social_raw`
- `fill_metrics_raw` x2（專項補值）

## 關鍵結果
- VTuber 總數：`54,576`
- 缺圖診斷：`need_fix = 0`（抽樣 8,000）
- HTTP 健康掃描：`bad_count = 0`（sample 45）
- Sources 健康：7/7 OK（Google Sheet 各 gid 正常）
- 去重：本輪刪除重複 1 筆（其後 no-op）
- 完整介紹補齊：`enrich_full_intro_raw` 本輪共更新 160
- 內部連結補齊：`internal_links_raw` 本輪更新 5
- 翻譯內容同步：`sync_translation_content_raw` 本輪更新 48

## 尚待條件（非故障）
- `gsc_export_queries` 跳過：本機未注入 GSC 憑證環境變數
- `upload_gsc_queries` / `upload_dynamic_sitemap_assets` 跳過：本機未注入 FTP 環境變數
- 上述不影響主站維運動作，但會影響「本地端匯出與上傳」步驟

## 產出檔案
- `C:\Users\User\hsieh\reports\maint_cycle_20260311_001613.log`
- `C:\Users\User\hsieh\reports\maint_cycle_live_stdout_20260311.txt`
- `C:\Users\User\hsieh\reports\maint_actions_20260311_003115.log`
- `C:\Users\User\hsieh\reports\maint_actions_20260311_003517.log`
- `C:\Users\User\hsieh\reports\health_scan_latest.json`

## 安全修正（本輪新增）
- `run_maint_actions.py` 已修改：log 內的 `?key=` 參數自動遮罩為 `***`
- 已同步清理既有 `maint_actions_*.log` 的 key 明文

---

## 第二輪（流量停滯改善：索引層 + CTR 層）
執行時間（台灣）: 2026-03-11 01:30 ~ 01:57

### 已執行
1. server 維運 cycle 重跑（`VT_CYCLE_MAX_SECONDS=1500`）
- `status_fix` 更新 30（第二迭代歸零）
- `enrich_full_intro_raw` 更新 160
- `sync_translation_content_raw` 更新 48
- `http_health_scan bad_count=0`
- `stats: VTubers=54,578`

2. sitemap 資產上傳（補跑）
- `upload_dynamic_sitemap_assets.py` 成功上傳：
  - `sitemap.xml`
  - `sitemap_index.xml`
  - `vtuber-sitemap-index.php`
  - `vtuber-sitemap-dynamic.php`

3. GSC 查詢檔上傳（補跑）
- `upload_gsc_queries.py` 成功上傳：
  - `reports/gsc_queries_latest.json`
  - 遠端位置：`/public_html/wp-content/uploads/vt-logs/gsc-queries.json`

4. 低 CTR 第一輪強化（定向）
- `build_gsc_low_ctr_targets.py`：
  - `source_rows=4405`
  - `opportunity_rows=27`
  - `target_ids_count=25`
- `enrich_moegirl_ids_raw`（target IDs）：
  - `processed=25`
  - `updated=1`
  - `skipped=24`
  - `errors=0`

5. Google Sitemap 刷新檢查
- `google_sitemap_refresh.py` 檢查通過：
  - `sitemap_index.xml` / `sitemap.xml` 可讀、格式正確、`loc_count=40`
  - `site_audit_raw: pass=27 fail=0`
  - 使用 service account 提交 GSC 成功（HTTP 204）

### 本輪程式修正（已提交）
- `usadanews-code-snapshot/ops/run_maint_cycle.py`
  - `run_proc` 增加敏感資訊遮罩（`--app-pass`/token/password 等）
  - low-CTR 管線新增 fallback：即使缺 `VT_WP_USER/VT_WP_APP_PASS`，仍可使用既有 `gsc_low_ctr_targets.json` 執行定向 `enrich_moegirl_ids_raw`

---

## 第三輪（全參數 cycle：FTP + GSC + WP Auth）
執行時間（台灣）: 2026-03-11 02:10 ~ 02:33

### 執行設定
- `VT_MAINT_PROFILE=server`
- `VT_CYCLE_MAX_SECONDS=1800`
- FTP / GSC service account / WP App Password 全部注入

### 核心成果
1. 低 CTR 管線完整執行（不再 skip）
- `build_gsc_low_ctr_targets` 成功（輸出 `reports/gsc_low_ctr_targets.json`）
- `enrich_low_ctr_from_hololist` 成功
- `enrich_moegirl_ids_raw low_ctr` 成功（ids=20）

2. 多語與內容補強有實質新增
- `ensure_translations_raw` 連續多輪新增：
  - 最高單輪 `created=72`, `linked=12`
- `sync_translation_content_raw` 每輪更新 12，連跑 4 輪
- `internal_links_raw` 本輪更新 55（35 + 20）
- `enrich_full_intro_raw` 本輪更新 160

3. 索引與健康檢查
- `stats: VTubers=54,924`
- `avatar_diagnose_raw`：`need_fix=0`
- `http_health_scan`：`bad_count=0`
- `site_audit_raw`：`pass=27`, `fail=0`

4. sitemap / GSC
- `upload_dynamic_sitemap_assets` 成功上傳
- `google_sitemap_refresh.py` 檢查結果：
  - `sitemap_index.xml` / `sitemap.xml` 可讀、格式正確、`loc_count=40`
  - GSC submit 成功（`status=204`）

### 仍待持續改善（非故障）
- `metrics_diagnose_raw` 顯示：
  - YouTube `with_url=52161`, `missing_subs=280`
  - Twitch `with_url=32586`, `unavailable=1897`
- 這類屬於來源側限制（頻道不可得 / 平台側不可取），維持在例行循環持續補值。
