# USADA 主機搬移執行手冊（Linode + Cloudflare）

最後更新：2026-03-20（Asia/Taipei）

## 目標
- 將 `usadanews.com` 從 A2 Hosting 搬移到 Linode。
- 維持 Cloudflare 作為 DNS / CDN / SSL 前端。
- 先完成「可部署、可驗證、可回滾」，再切正式流量。

## 目前架構重點
- 現站仍是 WordPress 客製化站，不是純靜態或純 API 架構。
- 核心邏輯位於：
  - `wp-content/plugins/wp-vtuber-cpts.php`
  - `wp-content/plugins/vt-maint-runner.php`
  - `wp-content/mu-plugins/vt-portal-redirects.php`
  - `wp-content/plugins/vtuber-portal/templates/*.php`
  - `wp-content/plugins/vtuber-portal/assets/vtuber-portal.css`
- 多語、canonical、rewrite、taxonomy、SEO head、模板渲染都仍依賴 WordPress 執行環境。

## 搬移前必要條件
1. Linode Instance 已建立
2. Cloudflare Zone 已建立
3. GitHub 版本已整理成可部署基準
4. 有現站完整備份
5. 可登入 Linode 主機 OS 層
6. 可在切換當天修改網域 Nameserver 或 DNS 導向

## 目前已具備
- Linode API 可用
- Cloudflare API 可用
- Cloudflare Zone / Zone ID 已可讀
- 現站 FTP / WordPress 維護權限可用
- GitHub remote 已存在

## 目前仍阻塞的項目
1. Linode 主機登入方式尚未補齊
   - 需要以下任一種：
   - `root password`
   - SSH 私鑰登入
   - 明確授權我重建 Instance 並注入 SSH key
2. GitHub 尚未完全整理到最新搬移基準
   - 需先 commit / push 本地最新版本
3. 多語 clean URL routing 尚未完全收斂
   - 這不阻止搬移，但會影響搬移後 SEO 驗證與 canonical 正確性

## 推薦切換順序
1. 整理 GitHub 版本
2. 在 Linode 佈署新站
3. 匯入資料庫與 `wp-content`
4. 驗證新站功能
5. 先用 hosts 或臨時網域驗證
6. 設定 Cloudflare DNS / SSL / 快取規則
7. 切 Nameserver 到 Cloudflare
8. 觀察 24-48 小時

## Linode 端預計佈署項目
- Ubuntu 24.04 LTS
- Nginx
- PHP-FPM
- MariaDB
- Redis（可選，但建議）
- Certbot 或 Cloudflare Origin Certificate
- UFW / Fail2ban
- cron 取代 WP-Cron

## Cloudflare 端預計設定
- DNS 記錄
- SSL 模式：`Full (strict)`
- 快取規則
- Brotli / HTTP3 / Auto Minify
- Page Rules / Rulesets（若需要）
- 確認 sitemap 與 API 路徑不被錯誤快取

## 主要驗證清單
- 首頁 `https://usadanews.com/`
- VTuber 列表 `https://usadanews.com/vtuber/`
- 多語列表 `/en/vtuber/`, `/ja/vtuber/`, `/ko/vtuber/`
- 單一條目頁
- taxonomy 頁
- 搜尋 API
- sitemap index 與子 sitemap
- GA4 / GSC / robots / canonical / hreflang

## 回滾策略
- 若切換後有重大錯誤：
  - 立即將 DNS / NS 指回原站
  - 保留 A2 Hosting 不立即刪除
  - 先修正 Linode 端，再重新切換

## 搬移基準來源
- 程式碼主基準：
  - `C:\Users\User\hsieh\maintain\github_private_repo`
- 搬移快照與文件：
  - `C:\Users\User\hsieh\repos\ad-procurement-demo\usadanews-code-snapshot`
  - `C:\Users\User\hsieh\repos\ad-procurement-demo\docs`
