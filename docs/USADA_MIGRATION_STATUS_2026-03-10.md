# USADA 主機轉移狀態（2026-03-10）

## 結論
- Linode 新主機已完成還原與開站，技術上可上線。
- 目前外網仍指向 A2，尚未完成最終切流。
- 主要阻塞點是網域權威 DNS 仍為 A2 Nameserver，Cloudflare 區域設定尚未接管實際解析。

## 已完成項目
1. Linode 端環境完成：
   - `nginx + php8.3-fpm + mariadb + redis`
   - 網站根目錄：`/var/www/usadanews/public_html`
2. A2 完整備份已還原到 Linode：
   - WordPress 檔案已同步
   - `softsql.sql` 已匯入
3. DB 還原修復：
   - 已處理 SQL dump 中 transient 破損語句，核心資料可用
   - `home/siteurl` 已確認為 `https://usadanews.com`
4. Nginx vhost 與 HTTPS：
   - 已啟用 80/443
   - 已配置 origin 自簽憑證（適配 Cloudflare `SSL=full`）
5. Linode 站點健康檢查：
   - `/`、`/vtuber/`、`/sitemap_index.xml` 皆返回 200
6. Cloudflare 區域內已更新：
   - `A usadanews.com -> 172.105.219.46`
7. Linode 生產化強化：
   - 啟用 `ufw`（只開放 22/80/443）
   - 啟用 `fail2ban`
   - 啟用系統 cron 取代 WP 內建 cron
   - cron 加入 `flock + timeout 180s`（避免卡死/重入）
8. Linode 本機備份機制：
   - 每日 03:20 自動備份 DB + `wp-content`
   - DB 保留 7 份
   - 大型 `wp-content` 備份保留 1 份（避免磁碟爆滿）
   - 已清理遷移暫存檔，磁碟使用率已降回安全範圍

## 尚未完成（切流阻塞）
1. 目前權威 NS 仍是 A2：
   - `ns1.a2hosting.com`
   - `ns2.a2hosting.com`
   - `ns3.a2hosting.com`
   - `ns4.a2hosting.com`
2. 因為尚未切到 Cloudflare NS，Cloudflare DNS 變更不會對外生效。

## 待執行清單（完成切流）
1. 將網域 Nameserver 改為 Cloudflare 指定 NS。
2. 等待 DNS 傳播，驗證 `usadanews.com` 實際到達 Linode。
3. 驗證項目：
   - 首頁、`/vtuber/`、主要單頁
   - `sitemap_index.xml` 與 `vtuber-sitemap.xml`
   - 後台登入與 `vt-maint.php` 端點
4. 可用自動監看腳本（本機）：
   - `scripts/watch_dns_cutover.ps1`
   - 會持續檢查：
     - NS 是否改為 Cloudflare（`leia/rory.ns.cloudflare.com`）
     - 切流標記 URL 是否回應新站內容

## 風險與觀察
1. SQL dump 內有少量 transient 損壞語句（已跳過，不影響主功能）。
2. Cloudflare Purge API 權限目前回傳 403（不影響 DNS 設定，但影響主動清快取）。
3. 建議正式切流窗口選低流量時段，並保留 A2 回切方案 24 小時。
