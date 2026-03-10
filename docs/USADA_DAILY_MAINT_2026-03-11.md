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
