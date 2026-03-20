# USADA 主機搬移操作手冊

最後更新：2026-03-20

## 適用範圍
- 舊主機：A2 Hosting（WordPress）
- 新主機：Linode `usada-prod-01`
- DNS / CDN：Cloudflare

## 搬移目標
- 在不先切 DNS 的情況下，先把 Linode 端站點部署完成
- 透過預覽驗證功能正常
- 最後才進行 DNS / Nameserver 切換

## 搬移順序

### 第 1 階段：準備基準版本
1. 確認 GitHub 上已有可作為搬移基準的版本
2. 確認自訂程式碼來源：
   - `wp-content/plugins/vtuber-portal`
   - `wp-content/plugins/wp-vtuber-cpts.php`
   - `wp-content/mu-plugins/vt-portal-redirects.php`
3. 確認搬移報告與進度文件可讀

### 第 2 階段：建立新主機
1. 重建或建立 Linode 主機
2. 安裝：
   - Nginx
   - PHP-FPM
   - MariaDB
   - Redis
   - UFW
   - Fail2ban
3. 建立目錄：
   - `/var/www/usadanews/public_html`
   - `/opt/usada-migration`
   - `/var/backups/usada`

### 第 3 階段：還原資料
1. 從舊站匯出資料庫
2. 在新主機建立資料庫與使用者
3. 匯入資料庫
4. 同步網站檔案：
   - WordPress core
   - `wp-content/themes`
   - `wp-content/plugins`
   - `wp-content/mu-plugins`
   - `wp-content/uploads`

### 第 4 階段：套用 GitHub 基準版
1. 用 GitHub 版本覆蓋自訂外掛與自訂模板
2. 避免新主機只是一份「舊主機檔案快照」，而不是正式基準版

### 第 5 階段：預覽驗證
用 hosts / `--resolve` 驗證：
- 首頁
- VTuber 列表
- VTuber 單頁
- 多語列表
- `wp-login.php`
- `wp-admin/`
- 常用圖片與 CSS / JS

### 第 6 階段：切換 DNS
當新主機驗證通過後：
1. 將 Nameserver 改到 Cloudflare
2. 或將 A / CNAME 記錄改到新主機
3. 等待傳播

### 第 7 階段：切換後驗證
1. 驗證首頁與條目頁
2. 驗證登入頁
3. 驗證 sitemap
4. 驗證 canonical / hreflang / GA4
5. 再確認 Search Console 抓取是否正常

## 目前已知非阻塞問題
- 多語 clean URL / canonical 邏輯仍需繼續修
- 少量舊圖片或外部圖片來源已失效
- 這些不是主機搬移故障，但切站後要持續處理

## 切 DNS 前的最低完成標準
- 前台可正常開啟
- 後台登入頁可正常開啟
- 關鍵圖片、CSS、JS 正常
- 資料庫與主要外掛已完整
- 自訂程式碼已覆蓋成 GitHub 基準版

