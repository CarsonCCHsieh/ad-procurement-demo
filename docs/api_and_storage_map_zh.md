# API 與資料儲存對照

## 文件目的

這份文件列出目前專案中：

- 前端實際呼叫哪些 API
- 哪些 API 必須依賴後端，不是 GitHub Pages 靜態頁能單獨完成
- 目前共享資料、localStorage、本機 secrets 的分工
- 未來搬到正式主機時，哪些資料與行為需要一起搬移

## 一、前端主要路由

| 路由 | 用途 | 依賴後端 |
| --- | --- | --- |
| `#/login` | 登入 | 否，前端角色控制 |
| `#/ad-orders` | 廠商互動下單 | 是 |
| `#/meta-ads-orders` | Meta 官方投廣 | 是 |
| `#/ad-performance` | 投放成效 | 是 |
| `#/settings` | 控制設定 | 是 |

## 二、後端 API

| Endpoint | 方法 | 用途 | 正式環境是否必搬 |
| --- | --- | --- | --- |
| `/api/health` | `GET` | 健康檢查、revision 檢查 | 是 |
| `/api/state` | `GET` | 讀取共享 state | 是 |
| `/api/state/batch` | `POST` | 批次寫入共享 state | 是 |
| `/api/vendor/submit-order` | `POST` | 廠商互動下單送單 | 是 |
| `/api/vendor/sync-shared-orders` | `POST` | 同步共享中的供應商訂單狀態 | 是 |
| `/api/vendor/retry-batch` | `POST` | 重送失敗的供應商批次 | 是 |
| `/api/vendor/balance` | `GET` | 查詢目前實際生效的供應商帳戶餘額 | 是 |
| `/api/meta/post-metrics` | `GET` | 後端代理 Meta 貼文指標查詢 | 是 |

說明：

- GitHub Pages 只負責前端 bundle，不會提供上述 `/api/...`。
- 只搬前端、不搬後端時，頁面仍會打開，但共享資料、送單、同步、Meta 查詢都會失效。

## 三、共享資料 key

| Key | 內容 | 主要讀寫位置 | 正式環境建議 |
| --- | --- | --- | --- |
| `ad_demo_config_v1` | 品項、供應商、拆單設定 | 控制設定頁、後端 | 存正式 DB |
| `ad_demo_pricing_v1` | 前台定價與最小單位 | 控制設定頁 | 存正式 DB |
| `ad_demo_orders_v1` | 廠商互動訂單 | 下單頁、成效頁、後端 | 存正式 DB |
| `ad_demo_meta_orders_v1` | Meta 投廣案件 | Meta 頁、成效頁、後端 | 存正式 DB |
| `ad_demo_service_catalog_v1` | 供應商 services 清單 | 控制設定頁 | 存 DB 或後端快取 |
| `ad_demo_vendor_keys_v1` | 供應商 API key | 控制設定頁、後端 | 正式環境應移到後端 secrets |
| `ad_demo_meta_config_v1` | Meta 設定 | 控制設定頁、後端 | 正式環境應拆成 DB + secrets |
| `ad_demo_auth` | 前端登入狀態 | 前端 | 可改正式 auth / session |
| `ad_demo_shared_client_id` | shared sync client id | 前端 | 可保留前端快取用途 |

## 四、localStorage 用途

目前 localStorage 只應作為：

1. 前端快取
2. UI 狀態保存
3. shared sync 的本機緩衝

目前常見 key：

- `ad_demo_config_v1`
- `ad_demo_pricing_v1`
- `ad_demo_orders_v1`
- `ad_demo_meta_orders_v1`
- `ad_demo_service_catalog_v1`
- `ad_demo_auth`
- `ad_demo_shared_client_id`
- `sec:*` 收合狀態

正式環境建議：

- 不要把正式案件、設定、敏感資料的唯一真實來源放在 localStorage
- localStorage 最多保留登入快取、UI 偏好與少量前端暫存

## 五、本機 secrets 與優先順序

目前供應商 key 與 Meta token 不進 Git。

本機 secrets 檔案：

- `data/vendor-local-secrets.json`
- `data/meta-local-secrets.json`

目前供應商 key 來源優先順序：

1. `ad_demo_vendor_keys_v1` 共享設定
2. `data/vendor-local-secrets.json` 本機備援

這代表：

- 正常情況下，系統應優先使用控制設定中保存的共享 key
- 若共享 key 讀取失敗或不存在，後端會退回本機備援檔
- 正式環境應移除這種雙軌 fallback，改成單一後端 secrets 來源

## 六、不會進 Git 的資料

以下資料不應提交到 Git：

- `data/shared-demo.sqlite`
- `data/meta-local-secrets.json`
- `data/vendor-local-secrets.json`
- 真實 `.env`

未來搬到正式環境時，這些資料應搬到：

- 正式 DB
- 後端環境變數
- Secrets Manager
- 受控的正式設定機制

## 七、RD 搬遷時要確認的事

1. 所有 `/api/...` 是否都已部署到正式後端
2. 前端是否已改指向正式 API base
3. shared state 是否已搬到正式 DB
4. vendor / Meta secrets 是否已移出前端與本機檔案
5. `retry-batch`、`sync-shared-orders`、`vendor/balance` 是否都能正常工作
6. 上線驗收是否已依 `docs/production_handoff_zh.md` 完整跑過
