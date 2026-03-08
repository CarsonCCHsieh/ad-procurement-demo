# USADA 今日維護報告（2026-03-09）

執行時間（本地）：2026-03-09 00:27:38 ~ 00:39:59（Asia/Taipei）
執行腳本：`run_maint_cycle.py`
Profile：`server`
最大執行秒數：`900`

## 本輪已完成重點
- `status_fix`：6 輪，合計更新 **47** 筆
- `sync_translation_meta`：2 輪（批次 metadata 對齊）
- `seo_keywords_import_raw`：更新 **80** 筆關鍵字
- `fillthumbs`：8 輪（補圖流程已跑完本輪批次）
- `fill_metrics_raw`：2 輪（追蹤數更新）
- `enrich_moegirl`：3 輪
- `enrich_full_intro_raw`：4 輪，合計更新 **160** 筆
- `sync_translation_content_raw`：4 輪，合計更新 **48** 筆
- `news_refresh_raw`：3 輪
- `dedupe`：2 輪（本輪無刪除）
- `http_health_scan`：樣本 45，`bad_count = 0`
- `stats`：VTubers = **54,563**

## 本輪跳過項目與原因
- `cleanup_remote_logs`：缺 `USADA_FTP_USER/USADA_FTP_PASS`
- `gsc_export_queries`：缺 `GSC_SERVICE_ACCOUNT_JSON` 與 GSC token file
- `upload_gsc_queries`：缺 FTP 帳密
- `upload_dynamic_sitemap_assets`：缺 FTP 帳密
- `site_audit_raw`：因 profile=server 預設跳過
- `enrich_low_ctr`：因 profile=server 預設跳過

## 風險與建議
1. 若要完整跑「GSC 關鍵字回灌 + sitemap 檔案自動上傳」，需要補齊 GSC/FTP 環境變數。
2. 現在流程已可穩定在 12 分鐘完成，不再出現長時間卡住；可維持這個 profile 當常態排程。
3. 下一輪可改用 `local` profile 跑一次深層審核（站點 audit + low CTR enrich）。

## 檔案位置
- 原始 log：`C:\Users\User\hsieh\reports\maint_cycle_20260309_002738.log`
- 健康檢查報告：`C:\Users\User\hsieh\reports\health_scan_latest.json`
