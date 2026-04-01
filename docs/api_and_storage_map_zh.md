# API 與資料儲存對照

## 1. 前端路由與後端依賴
| 路由 | 功能 | 是否依賴後端 |
| --- | --- | --- |
| `#/login` | Demo 登入 | 否（localStorage） |
| `#/ad-orders` | 廠商互動下單 | 是 |
| `#/ad-performance` | 投放成效彙總 | 是 |
| `#/meta-ads-orders` | Meta 官方投廣（管理員） | 是 |
| `#/settings` | 控制設定（管理員） | 是 |

## 2. 後端 API（`server/shared-api.js`）
| Method | Path | 用途 | 主要呼叫端 |
| --- | --- | --- | --- |
| `GET` | `/api/health` | 健康檢查、revision | sharedSync |
| `GET` | `/api/state` | 讀取 shared state | sharedSync |
| `POST` | `/api/state/batch` | 批次寫入 shared state | sharedSync |
| `POST` | `/api/vendor/submit-order` | 建立廠商訂單（含拆單） | AdOrders |
| `POST` | `/api/vendor/sync-shared-orders` | 同步廠商進度 | AdPerformance |
| `POST` | `/api/vendor/retry-batch` | 重送失敗批次 | AdPerformance |
| `GET` | `/api/vendor/balance` | 查供應商餘額 | Settings |
| `GET` | `/api/meta/resolve-post` | 驗證/解析貼文來源 | MetaAdsOrders |
| `GET` | `/api/meta/post-metrics` | 取得貼文成效指標 | AdPerformance、metaGraphApi |
| `POST` | `/api/meta/sync-shared-orders` | 同步 Meta 投放進度 | AdPerformance |

## 3. Shared State key 對照
| Key | 內容 | 寫入來源 | 讀取來源 |
| --- | --- | --- | --- |
| `ad_demo_config_v1` | 品項、供應商映射與拆單設定 | Settings | 全站 |
| `ad_demo_pricing_v1` | 前台定價與最小單位 | Settings | AdOrders |
| `ad_demo_orders_v1` | 廠商互動訂單資料 | AdOrders/後端同步 | AdPerformance |
| `ad_demo_meta_orders_v1` | Meta 投放訂單資料 | MetaAdsOrders/後端同步 | AdPerformance |
| `ad_demo_meta_sync_status_v1` | Meta 同步狀態 | 後端 | AdPerformance |
| `ad_demo_service_catalog_v1` | 供應商 services 清單 | Settings | Settings、AdOrders |
| `ad_demo_vendor_keys_v1` | 供應商 key 設定 | Settings | 後端 |
| `ad_demo_meta_config_v1` | Meta 帳號/token 設定 | Settings | MetaAdsOrders、後端 |
| `ad_demo_meta_preset_config_v1` | 產業模板與受眾設定 | Settings | MetaAdsOrders |
| `ad_demo_auth` | 前端登入狀態 | AuthContext | 全站 |
| `ad_demo_shared_client_id` | shared sync client id | sharedSync | sharedSync |

## 4. DB 與 secrets 邊界
- DB：`data/shared-demo.sqlite`
- 主要資料表：
- `state_entries`（各 key/value）
- `state_meta`（revision）
- `meta_tracking_cache`（貼文追蹤解析快取）
- 本機 secrets（不入版控）：
- `data/meta-local-secrets.json`
- `data/vendor-local-secrets.json`

## 5. 重點限制
- GitHub Pages 僅能提供前端靜態檔，不提供安全後端能力。
- 第三方 API（供應商、Meta）必須透過後端代理，不可由前端直接呼叫私密 key/token。
