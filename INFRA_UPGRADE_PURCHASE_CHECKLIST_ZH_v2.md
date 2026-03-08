# USADA 基礎設施升級採購與開通清單（Linode + Cloudflare）v3

最後更新：2026-03-09（Asia/Taipei）

用途：
- 讓你一次完成「服務開通 + 權限準備」，我拿到必要資訊後可直接執行遷移與切換。
- 以「先可用、可回滾、可擴充」為原則，不要求你一次買齊所有進階服務。

---

## 0. 目前建議路線（先省成本、再升級）

- 目標：在接近目前 A2 年費（約 NT$4,500 / 年）前提下，先提升穩定性與擴充性。
- 建議起手：
  1. Linode Compute（Shared CPU，Nanode 1GB 或 2GB）
  2. Cloudflare Free（DNS + CDN + SSL）
  3. Linode Backups（建議開）
- 後續流量上升再加：Cloudflare APO 或 Cloudflare Pro、Linode 升級 2GB/4GB。

---

## 1. 你要先開通哪些服務

## 1.1 Linode（Akamai Cloud）

1. 註冊 / 登入 Linode：
   - https://cloud.linode.com/
2. 完成帳務（你已綁卡，可略）。
3. 建立一台 Compute Instance（先建，不急著切流量）：
   - Region：建議 `Tokyo`（對台灣通常延遲較佳）
   - Plan：`Shared CPU Nanode 1GB`（先省成本）或 `2GB`
   - Image：`Ubuntu 24.04 LTS`
   - Label：`usada-prod-01`
   - Root Password：先自行設定一組強密碼（之後可關閉密碼登入改 SSH）
4.（建議）開啟 Linode Backups：
   - Instance 詳細頁 -> `Backups` -> Enable

## 1.2 Cloudflare

1. 註冊 / 登入 Cloudflare：
   - https://dash.cloudflare.com/
2. 新增網域 `usadanews.com`：
   - 選擇 Free Plan（先夠用）
3. 匯入現有 DNS 記錄（Cloudflare 會自動掃描，仍需人工核對）。
4. 先不要立刻改 NS（Name Server），等我完成新站部署與驗證再切。

---

## 2. 推薦給我的授權方式（最適合）

結論：**都用 API Token（最小權限）**，不要給主帳密碼。

- Linode：Personal Access Token（PAT）
- Cloudflare：API Token（Zone scoped）

優點：
- 權限可控（只給必要範圍）
- 可設定到期時間
- 任務完成可隨時撤銷，不影響主帳號

---

## 3. Linode API Token 建立步驟（詳細）

官方參考：
- Get started（PAT 說明）：https://techdocs.akamai.com/linode-api/reference/get-started
- Manage personal access tokens：https://techdocs.akamai.com/cloud-computing/docs/manage-personal-access-tokens

步驟：
1. 登入 Linode Cloud Manager。
2. 右上角個人選單 -> `API Tokens`。
3. 點 `Create a Personal Access Token`。
4. 欄位建議：
   - Label：`usada-migration-2026Q1`
   - Expiry：先給 30 天（完成遷移可撤銷）
5. Access（權限）建議：
   - `Linodes` -> `Read/Write`
   - `Volumes` -> `Read/Write`
   - `Firewalls` -> `Read/Write`
   - `Images` -> `Read`
   - `Domains` -> `Read/Write`（若你要用 Linode DNS；若 DNS 全在 Cloudflare 可給 Read）
   - `Account` -> `Read`
   - 其他全部 `None`（除非後續任務需要）
6. 點 `Create Token`，立即複製保存（關閉後通常不再顯示完整 token）。

你要提供給我：
- Linode PAT（字串）
- Linode account email（僅辨識用，可不給密碼）
- 已建立的 Instance 名稱/ID（若你已建立）

---

## 4. Cloudflare API Token 建立步驟（詳細）

官方參考：
- Create token：https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- Token templates：https://developers.cloudflare.com/fundamentals/api/reference/template/
- Permissions：https://developers.cloudflare.com/fundamentals/api/reference/permissions/

步驟：
1. 登入 Cloudflare Dashboard。
2. 右上角頭像 -> `My Profile` -> `API Tokens`。
3. 點 `Create Token`。
4. 建議用 `Create Custom Token`（不要用 Global API Key）。
5. Token 內容建議：
   - Token name：`usada-dns-deploy-2026Q1`
   - Permissions：
     - `Zone` -> `Zone` -> `Read`
     - `Zone` -> `DNS` -> `Edit`
     - `Zone` -> `Cache Purge` -> `Purge`
     - `Zone` -> `Zone Settings` -> `Edit`
   - Zone Resources：
     - `Include` -> `Specific zone` -> `usadanews.com`
   - Client IP Address Filtering：可留空（若你 IP 固定可加白名單更安全）
   - TTL：建議 30 天（遷移完成可撤銷）
6. 建立後複製 Token。

你要提供給我：
- Cloudflare API Token（上述權限）
- Cloudflare Zone ID（`usadanews.com` 的 Zone ID）
- Cloudflare Account ID（可選，但建議給）

---

## 5. Name Server（NS）切換正確時機

重點：**先部署與驗證，再切 NS**。

正確順序：
1. Linode 新站部署完成（不影響現站）
2. Cloudflare DNS 記錄先建好
3. 用 hosts 或暫時子網域測試新站
4. 我確認：首頁、條目頁、搜尋、API、sitemap、SSL 都正常
5. 你到網域註冊商把 NS 改成 Cloudflare 指定的兩組 NS
6. 觀察 24~48 小時（含回滾預案）

---

## 6. 你回傳給我資料的格式（可直接複製填空）

請用下面格式回傳（不要貼在公開 Repo）：

```txt
[Linode]
PAT = <貼這裡>
Region = Tokyo
Instance = usada-prod-01（若已建立）

[Cloudflare]
API_TOKEN = <貼這裡>
ZONE_ID = <貼這裡>
ACCOUNT_ID = <貼這裡，可選>
ZONE_NAME = usadanews.com

[Current A2]
A2 cPanel URL = <你的 cPanel URL>
A2 account user = <帳號>
A2 backup location = <備份檔放哪>

[通知]
Alert email = <通知信箱>
```

---

## 7. 安全規範（務必）

- 不要把 Token 寫進 GitHub 版本庫（含 private repo）。
- Token 只透過私下訊息提供，且完成遷移後立即 rotate/revoke。
- 遷移完成後建議：
  - Linode PAT 撤銷或改成唯讀
  - Cloudflare Token 重新發一組短期維運 token

---

## 8. 完成上述後，我會立即做的事

1. 建立 Linode 主機安全基線（SSH、Firewall、Fail2ban、PHP-FPM/Nginx）
2. 還原 WP 與資料庫、修正 wp-config 與快取層
3. 佈署 Cloudflare DNS/SSL/Cache 規則
4. 驗證：站內功能、sitemap、canonical、404/5xx、效能基準
5. 無痛切換與回滾計畫

---

## 9. 官方連結總表

- Linode Cloud Manager：https://cloud.linode.com/
- Linode Pricing：https://www.linode.com/pricing/
- Linode PAT 管理：https://techdocs.akamai.com/cloud-computing/docs/manage-personal-access-tokens
- Linode API Get started：https://techdocs.akamai.com/linode-api/reference/get-started
- Cloudflare Dashboard：https://dash.cloudflare.com/
- Cloudflare Create API Token：https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- Cloudflare API token templates：https://developers.cloudflare.com/fundamentals/api/reference/template/
- Cloudflare DNS setup（改 NS）：https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/
