# USADA 主機轉移執行手冊（Linode + Cloudflare）

最後更新：2026-03-09

## 1) 目的
- 以低風險方式把 `usadanews.com` 從 A2 Hosting 轉移到 Linode，並由 Cloudflare 接管 DNS/CDN/SSL。
- 先確保「可回滾」，再做正式切流。

## 2) 執行前條件
1. 已有 Linode 帳號 + Compute 建立完成。
2. 已有 Cloudflare 帳號 + `usadanews.com` zone 建立完成（但先不改 NS）。
3. 已提供 API token：
   - `LINODE_TOKEN`
   - `CF_API_TOKEN`
   - `CF_ZONE_ID`
   - `CF_ZONE_NAME`
4. 已完成本機 preflight：
   - `npm run migrate:preflight`
5. 已有最新備份：
   - DB dump（SQL）
   - `wp-content`（至少 uploads + plugin/theme 代碼）

## 3) 建議切換窗口
- 台灣時間凌晨 01:00~05:00（低流量窗口）。
- 切流前至少 24 小時把 DNS TTL 調低（建議 120 秒）。

## 4) 遷移步驟（零停機優先）
1. Linode 佈建：
   - Ubuntu 24.04
   - Nginx + PHP-FPM + MariaDB（若 DB 不外掛）
   - 啟用 UFW / Fail2ban
2. 還原站點：
   - 還原 DB
   - 還原 `wp-content`
   - 套用 `usadanews-code-snapshot` 的 plugin/theme/ops 代碼
3. 檢查新站（不影響舊站）：
   - 用 hosts 檔或暫時子網域連到新 Linode IP
   - 驗證首頁/條目/搜尋/API/多語言/sitemap
4. Cloudflare DNS 設定：
   - 先把 A/AAAA/CNAME 設好，代理模式（橘雲）按策略開啟
   - SSL 模式建議 `Full (strict)`
5. 切流：
   - 將網域 NS 改為 Cloudflare 指定 nameservers
   - 觀察 24~48 小時

## 5) 切流後驗證清單
1. 首頁與主要頁面 HTTP 200 正常
2. 單頁 LCP/TTFB 下降（至少優於舊主機）
3. `sitemap_index.xml` 與子 sitemap 可被存取
4. Search Console 重新提交 sitemap（必要時）
5. 維運腳本正常：
   - `run_maint_cycle.py`
   - `vt-maint.php?action=stats`

## 6) 回滾方案
若切流後發生重大問題：
1. 把 DNS 記錄切回 A2 IP（若仍在 Cloudflare）
2. 或把 NS 改回原 nameserver（A2）
3. 啟用 A2 舊站只讀維持服務

## 7) 已知阻塞項（目前）
- 若無 FTP 憑證，以下自動化會跳過：
  - 遠端 logs 清理
  - sitemap 資產上傳
- 若無 GSC 憑證，以下會跳過：
  - Search Console 關鍵字匯出與回灌

## 8) 你現在要做的事
1. 依 `INFRA_UPGRADE_PURCHASE_CHECKLIST_ZH_v2.md` 建好 token
2. 填 `.env.migration.example` 對應環境變數
3. 執行：
   - `npm run migrate:preflight`
4. 回傳 preflight 結果，我就直接進入實際遷移步驟

