# USADA Linode 搬移進度報告

最後更新：2026-03-20 15:25（Asia/Taipei）

## 目標
- 將 `usadanews.com` 從 A2 Hosting 搬移到 Linode `usada-prod-01`
- 在尚未切換 DNS 前，先把新主機站點部署、還原、驗證完成
- 等你修改 DNS / Nameserver 後，再進行正式切流量

## 目前已完成

### 1. GitHub 搬移基準已整理完成
- 維護主 repo 與搬移工作 repo 都已整理到可作為搬移基準的版本
- 新主機已覆蓋 GitHub 基準版的自訂程式：
  - `wp-content/plugins/vtuber-portal`
  - `wp-content/plugins/wp-vtuber-cpts.php`
  - `wp-content/mu-plugins/vt-portal-redirects.php`

### 2. Linode 主機已建立並完成基礎安裝
- 主機：`usada-prod-01`
- 系統：Ubuntu 24.04
- 已安裝：
  - Nginx
  - PHP 8.3 FPM
  - MariaDB
  - Redis
  - Fail2ban
  - UFW

### 3. WordPress 資料庫已還原
- A2 舊站資料庫已匯出並匯入 Linode
- `home` / `siteurl` 已確認為：
  - `https://usadanews.com`
- 已驗證資料表可正常讀取
- `vtuber` 條目數量已可在新主機查詢

### 4. 網站檔案已完成主要搬移
- 主題、外掛、uploads 已完成主要同步
- 關鍵外掛已確認存在：
  - `wordpress-seo`
  - `wp-all-import`
  - `wpforms-lite`
  - `polylang`
  - `jetpack`
  - `w3-total-cache`
  - `vtuber-portal`
  - `wp-vtuber-cpts.php`

### 5. 新主機預覽驗證已通過
以下網址透過 `--resolve usadanews.com:443:172.105.219.46` 驗證通過：
- 首頁 `/`
- VTuber 列表 `/vtuber/`
- VTuber 單頁 `/vtuber/miyashiro-edamame/`
- 英語列表 `/en/vtuber/`
- 韓語單頁 `/ko/vtuber/kizuna-ai-5/`
- `wp-login.php`
- `wp-admin/`（會正確轉向登入頁）

### 6. 資產檢查
- CSS / JS / 常用圖片抽樣大多已正常回應 `200`
- 近期首頁破圖的關鍵圖片已補齊到新主機

## 目前仍屬「內容層」而非「主機搬移阻塞」的已知事項

### A. 多語 clean URL / canonical 問題仍未完全修完
範例：
- `https://usadanews.com/en/vtuber/irelia-graziella/`
  目前仍會 `301` 到中文條目

這是站內 Polylang / 自訂路由 / canonical 邏輯問題，不是 Linode 主機故障。
搬移後仍需要繼續修。

### B. 仍有少數圖片 URL 本身就是來源不存在
目前抽樣後剩餘的 404 主要分成兩類：
- 舊站本來就不存在的 favicon 檔案：
  - `wp-content/uploads/2023/04/cropped-256256_waifu2x_art_noise3_scale-32x32.webp`
  - `...192x192.webp`
  - `...180x180.webp`
- 頁面中直接引用 `hololist.net` 已失效的外部圖片

這些不是搬移造成的，是原始內容資料本身就有缺漏。

## 目前狀態判斷
- 新主機已可正常提供預覽站
- 前台與登入頁都已可正常回應
- 已到「只差 DNS / Nameserver 切換」的狀態

## 切換 DNS 前還可繼續做的事
- 再抽樣更多條目頁與圖片
- 修正多語 canonical / hreflang
- 補齊 favicon 與已失效外部圖片
- 上正式 SSL（若 DNS 已切到可控區）

## 當前真正缺少的唯一外部動作
你需要在網域註冊商 / DNS 控制端，將網域流量切到新架構。

若採 Cloudflare Nameserver 方案，下一步就是把網域 NS 改成：
- `leia.ns.cloudflare.com`
- `rory.ns.cloudflare.com`

## DNS 切換後我會做的事
1. 驗證正式流量是否進到 Linode
2. 補正式 SSL / 憑證
3. 再跑一次首頁、列表、條目、登入頁與 sitemap 驗證
4. 清理搬移暫存與舊站不再需要的殘留設定

