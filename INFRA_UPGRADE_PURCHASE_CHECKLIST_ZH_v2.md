# USADA 基礎設施升級採購與開通清單（Linode + Cloudflare）v3

最後更新：2026-03-20（Asia/Taipei）

用途：
- 讓你一次完成「服務開通 + 權限準備」，我拿到必要資訊後可直接執行遷移與切換。
- 以「先可用、可回滾、可擴充」為原則，不要求你一次買齊所有進階服務。

---

## A. 目前實際狀態總覽（2026-03-20）

### A.1 已確認具備

- Linode API 可正常使用
  - Instance：`usada-prod-01`
  - Instance ID：`93660067`
  - 狀態：`running`
  - Region：`ap-northeast`（Tokyo）
  - Plan：`g6-nanode-1`
  - IPv4：`172.105.219.46`
- Cloudflare API 可正常使用
  - Zone：`usadanews.com`
  - Zone ID：已具備
  - Cloudflare 指定 Nameserver：
    - `leia.ns.cloudflare.com`
    - `rory.ns.cloudflare.com`
- 既有站點可透過既有 FTP / WordPress 維護流程持續操作
- GitHub remote 已存在
  - 維護主 repo：`git@github.com:CarsonCCHsieh/usada-vtuber-maintain-private.git`
  - 本地工作 repo：`git@github.com:CarsonCCHsieh/ad-procurement-demo.git`

### A.2 目前尚未完成，不能直接視為「已完全可搬移」

1. **GitHub 仍不是最新完整狀態**
   - 維護主 repo 目前仍有未提交變更：
     - `wp-content/plugins/wp-vtuber-cpts.php`
     - `wp-content/mu-plugins/vt-portal-redirects.php`
     - `wp-content/plugins/vtuber-portal/assets/vtuber-portal.css`
     - 多個 `vtuber-portal/templates/*.php`
     - 多個 `tools/*.py`
     - 新檔：`wp-content/plugins/vtuber-portal/templates/vt-role-index.php`
   - `ad-procurement-demo` 內的 `usadanews-code-snapshot` 也仍有未提交變更
   - 結論：**目前版本尚未完整推到 GitHub，搬移前應先整理、提交、推送**

2. **Cloudflare Zone 狀態仍為 `pending`**
   - 代表網域 `usadanews.com` 的 Nameserver 目前尚未切到 Cloudflare
   - 在此之前，我可以先完成 Linode 端部署與驗證
   - 但最終正式切流量，仍需要把網域註冊商上的 NS 改到 Cloudflare

3. **Linode 主機 OS 層登入方式仍是實際阻塞點**
   - 目前 API 能看到主機存在、運行中
   - 但若要正式部署 Nginx / PHP / MariaDB / SSL / 還原站點，我還需要至少一種 OS 層登入方式：
     - root password，或
     - 已允許的 SSH key，或
     - 允許我重建這台機器並注入新的 SSH key / cloud-init

4. **Linode Backups 尚未啟用**
   - 目前狀態：`enabled=false`
   - 不是立即阻塞，但正式搬移前建議先打開

### A.3 以目前狀況來看，真正還缺的資訊 / 權限

以下是我判定的「最小必要剩餘項目」：

1. **Linode 主機登入方式**
   - 三選一即可：
     - `root password`
     - 我可登入的 SSH private key 對應授權
     - 明確允許我重建 `usada-prod-01`，用我自己的 SSH public key 重新建置

2. **最終切換 Nameserver 的操作位置**
   - 你現在已取回 domain DNS 修改控制權，接下來只需要在真正切站當下，能改到：
     - `leia.ns.cloudflare.com`
     - `rory.ns.cloudflare.com`
   - 若你已可操作註冊商後台，則此項視為已具備，只待實際切換

除此之外，**Linode PAT、Cloudflare token、Cloudflare zone、既有站點存取權限都已足夠先展開部署準備**。

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

結論：**優先用 API Token（最小權限）**，必要時可暫用 Global API Key。

- Linode：Personal Access Token（PAT）
- Cloudflare：API Token（Zone scoped，優先）或 Global API Key（備援）

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

## 4. Cloudflare API Token 建立步驟（詳細，優先）

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

備援（若 API Token 權限反覆異常）：
- `CF_AUTH_EMAIL`（Cloudflare 登入信箱）
- `CF_GLOBAL_API_KEY`（Global API Key）
- preflight 已支援 Global API Key 模式，不需額外改腳本

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

## 6. 自動帶入清單（已完成 / 待自動偵測）

以下欄位我已直接帶入，不需要你再手填：

```txt
[Detected]
ZONE_NAME = usadanews.com
USADA_FTP_HOST = usadanews.com
USADA_FTP_USER = developer_ssh@usadanews.com
USADA_FTP_ROOT = /public_html
GSC_SITE_URL = sc-domain:usadanews.com
GSC_SERVICE_ACCOUNT_JSON = C:\Users\User\Downloads\usadanews-6f9cb560be7e.json
```

以下欄位屬於第三方平台一次性授權（不會儲存在本機可讀位置），無法由我直接從系統自動取回：

```txt
[Linode]
LINODE_TOKEN = <一次性 PAT>

[Cloudflare]
CF_API_TOKEN = <一次性 API Token>
CF_ZONE_ID = <Zone ID>
```

我會持續使用 preflight 自動檢查是否已就位，一旦偵測到就直接啟動遷移流程，不再額外中斷詢問。

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
