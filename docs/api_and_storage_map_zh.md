# API 與資料儲存對照

## 文件目的

這份文件列出目前系統中：
- 前端會呼叫哪些 API
- 每個 API 屬於靜態前端還是後端能力
- 目前使用哪些 shared state key / localStorage key
- 未來搬到正式主機時，哪些項目必須一起遷移

## 一、前端路由

| 路由 | 用途 | 備註 |
| --- | --- | --- |
| `#/login` | 登入 | 純前端頁面 |
| `#/ad-orders` | 廠商互動下單 | 送出依賴後端 API |
| `#/meta-ads-orders` | Meta 官方投廣 | 成效查詢依賴後端 API |
| `#/ad-performance` | 投放成效 | 依賴共享資料與同步 API |
| `#/settings` | 控制設定 | 依賴共享資料與供應商 / Meta 管理 API |

## 二、後端 API

| Endpoint | 方法 | 用途 | 必須搬到正式主機 |
| --- | --- | --- | --- |
| `/api/health` | `GET` | 健康檢查 | 是 |
| `/api/state` | `GET` | 讀取共享 state | 是 |
| `/api/state/batch` | `POST` | 批次寫入共享 state | 是 |
| `/api/vendor/submit-order` | `POST` | 廠商互動下單送單代理 | 是 |
| `/api/vendor/sync-shared-orders` | `POST` | 同步共享中的供應商訂單狀態 | 是 |
| `/api/meta/post-metrics` | `GET` | 由後端代理查詢 Meta 貼文數據 | 是 |

說明：
- 以上 API 都不是 GitHub Pages 本身能提供的功能。
- 如果只搬前端，不搬這些 API，系統只能顯示畫面，無法共用資料與查詢進度。

## 三、Shared State Key 對照

目前共享與本地快取主要使用以下 key：

| Key | 用途 | 主要寫入端 | 正式環境處理建議 |
| --- | --- | --- | --- |
| `ad_demo_config_v1` | 品項、供應商、路由設定 | 控制設定頁 / 後端同步 | 存正式 DB |
| `ad_demo_pricing_v1` | 定價與最小單位 | 控制設定頁 | 存正式 DB |
| `ad_demo_orders_v1` | 廠商互動下單資料 | 下單頁 / 後端 | 存正式 DB |
| `ad_demo_meta_orders_v1` | Meta 官方投廣資料 | Meta 頁 / 後端 | 存正式 DB |
| `ad_demo_service_catalog_v1` | 供應商服務清單快取 | 控制設定頁 | 存 DB 或後端快取 |
| `ad_demo_vendor_keys_v1` | 供應商 API key | 控制設定頁 | 正式環境應改後端 secrets，不應留前端 |
| `ad_demo_meta_config_v1` | Meta 設定 | 控制設定頁 | 正式環境應改後端 secrets + DB |
| `ad_demo_auth` | 前端登入狀態 | 前端 | 可改正式 auth / session |
| `ad_demo_shared_client_id` | shared sync client id | 前端 | 可保留前端快取用途 |

## 四、目前 localStorage 用途

目前前端 localStorage 承擔兩種角色：

### 1. 本地快取
- `ad_demo_config_v1`
- `ad_demo_pricing_v1`
- `ad_demo_orders_v1`
- `ad_demo_meta_orders_v1`
- `ad_demo_service_catalog_v1`

### 2. 暫時性前端狀態
- `ad_demo_auth`
- `ad_demo_shared_client_id`
- 收合卡片狀態（例如 `sec:*`）

正式環境建議：
- localStorage 只保留登入狀態快取、UI 偏好與少量暫存。
- 訂單、設定、敏感資料不要依賴 localStorage 作為主要真實資料來源。

## 五、不在 Git 的資料

以下資料目前不應提交到 Git：
- `data/shared-demo.sqlite`
- `data/meta-local-secrets.json`
- `data/vendor-local-secrets.json`
- 真實 `.env`

這些內容未來正式搬遷時應改到：
- 正式 DB
- 主機環境變數
- Secrets Manager
- 受控的後端設定檔

## 六、RD 搬遷檢查點

1. 所有 `/api/...` endpoint 是否已部署到正式主機
2. shared state 是否已改接正式 DB
3. 前端是否指向正式 API base
4. secrets 是否已從前端 / 本機檔案移到後端管理
5. 驗收時是否已逐項驗證 `docs/production_handoff_zh.md` 清單
