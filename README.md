# ad-procurement-demo

內部廣告採購與 Meta 官方投廣 Demo。前端部署在 GitHub Pages，本機 Node API 與 SQLite 作為暫時多人共用後端。正式化時，後端排程、Secrets 與資料儲存應轉移至 Supabase / Cloud Functions 或等價雲端後端。

## Repo 定位

- `CarsonCCHsieh/ad-procurement-demo`：目前功能最完整的測試站，作為功能來源與驗證環境。
- `JuksyHRAdmin/jusky-erp-ad`：中繼 repo，供同仁依正式站架構整合功能。
- `JuksyHRAdmin/juksysmallerp`：正式站 / 架構參考；除非明確授權，請勿修改。

## 技術架構

- 前端：React + TypeScript + Vite。
- 後端：Node.js，主要入口 `server/shared-api.js`。
- 資料庫：SQLite，預設檔案 `data/shared-demo.sqlite`。
- 前台部署：GitHub Pages，只提供靜態頁面。
- API 連線：前端透過 `VITE_SHARED_API_BASE` 或內建 fallback 連到本機 / tunnel API。
- Secrets：供應商、Meta、Fanpage、Instagram、Ads API Key 只放後端，不放前端、不提交 Git。

## 主要功能

- 廠商互動下單：支援一次性下單與平均排程下單。
- 廠商管理：供應商 API Key、服務清單、品項對應、追加投遞、最低下單單位與前台定價。
- HDZ 供應商：已支援 services / add / status / balance。
- 投放成效：整合廠商訂單與 Meta 投放案件，可手動同步與排程同步。
- Meta 官方投廣：依 Meta Campaign Objective 與 Performance Goal 建立 Campaign / Ad Set / Creative / Ad。
- Meta 成效追蹤：依貼文連結解析 Facebook / Instagram 貼文，追蹤目標 KPI。
- 達標停投：同步時若達到目標數值，後端會暫停 Campaign、Ad Set、Ad。
- AI 優化投遞：建立多組 ad set / ad 變體，依 proxy ROAS 暫停低效組。

## 重要文件

- `docs/META_ADS_TECHNICAL_GUIDE_ZH_TW.md`：Meta 官方投廣完整技術指南。
- `docs/meta_ads_and_vendor_technical_handoff_zh-TW.md`：Meta 與廠商投廣交接文件。
- `docs/function_relationship_map_zh-TW.md`：function 關係與修改影響矩陣。
- `docs/deployment_topology_zh.md`：部署拓撲。
- `docs/api_and_storage_map_zh.md`：API 與資料儲存對照。

## Meta 後端 API 摘要

主要 API 都在 `server/shared-api.js`：

- `GET /api/meta/settings`：讀取 Meta 投放設定，不回傳完整 token。
- `POST /api/meta/settings`：儲存 Meta App、token、預設廣告帳號、Page、Instagram actor、產業模板與優化門檻。
- `GET /api/meta/token/status`：確認長效 token 狀態，不回傳完整 token。
- `GET /api/meta/oauth/start`、`GET /api/meta/oauth/callback`：Meta OAuth 授權與長效 token 流程。
- `POST /api/meta/token/exchange-short-lived`：短效 User Token 交換長效 token。
- `POST /api/meta/disconnect`：清除 User / Ads / Facebook / Instagram token，保留 App 設定。
- `GET /api/meta/accounts` / `GET /api/meta/assets`：載入可用廣告帳號、Facebook Page、Instagram 帳號。
- `POST /api/meta/verify-token`：驗證 Ads / Facebook / Instagram / User token。
- `POST /api/meta/resolve-audience`：將文字 TA 方向轉為可投遞 interest。
- `POST /api/meta/resolve-post` / `GET /api/meta/resolve-post`：解析 post link。
- `GET /api/meta/post-metrics`：取得貼文成效。
- `GET /api/meta/orders`：讀取 Meta 投放案件。
- `POST /api/meta/orders`：建立 Campaign / Ad Set / Creative / Ad，預設 `PAUSED`。
- `POST /api/meta/orders/:id/sync`：同步單筆案件。
- `POST /api/meta/sync-shared-orders`：同步執行中或手動指定案件。
- `POST /api/meta/orders/:id/pause`：暫停 Campaign / Ad Set / Ad。
- `POST /api/meta/orders/:id/resume`：啟用 Campaign / Ad Set / Ad。

## Meta OAuth 長效 Token

控制設定頁的 `Meta 基本設定` 支援兩種方式取得長效 User Token：

1. OAuth 授權登入：
   - 後端 API：`GET /api/meta/oauth/start`、`GET /api/meta/oauth/callback`。
   - 需要設定 `Meta App ID`、`Meta App Secret`、`OAuth 回呼網址`。
   - 若使用 Meta 新版 Login Configuration，可填 `Login Configuration ID`。
2. 短效 User Token 交換：
   - 後端 API：`POST /api/meta/token/exchange-short-lived`。
   - 可貼上 Graph API Explorer 產生的短效 User Token，由後端使用 App Secret 交換長效 token。

Token 可分角色：

- 共用 User Token：同時供投廣、Facebook 貼文讀取、Instagram 貼文讀取使用。
- Ads Token：只用於建立與控制廣告。
- Facebook Token：只用於 Facebook Page / Post 指標。
- Instagram Token：只用於 Instagram media 指標。

前端只顯示 token 是否存在、遮罩片段與到期資訊，不回傳完整 token。

## 資料儲存

- `data/shared-demo.sqlite`：主要 shared state 與案件資料。
- `data/meta-local-secrets.json`：Meta App Secret、token、Page token 等本機後端 secrets，不可提交 Git。
- `data/vendor-local-secrets.json`：供應商 API Key，不可提交 Git。
- `ad_demo_meta_settings_v2`：Meta 管理設定，不含完整 token。
- `ad_demo_meta_orders_v1`：Meta 投放案件、變體、同步結果、停投狀態。
- `ad_demo_meta_sync_status_v1`：Meta 批次同步狀態。
- `ad_demo_meta_submit_block_v1`：Meta action block 冷卻狀態。
- `ad_demo_orders_v1`：廠商互動下單案件。
- `ad_demo_config_v1`：供應商、品項、拆單、追加投遞設定。

## 本機啟動

```bash
npm install
npm run check:encoding
npm run typecheck
npm run build
npm run shared-api
```

前端開發模式：

```bash
npm run dev
```

若 GitHub Pages 要連到本機 API，需保持 `shared-api` 與 tunnel 連線中，並確認前端 API base URL 可連到 `http://127.0.0.1:8787` 或對外 tunnel。

## 安全原則

- 不把完整 API Key / token 寫入 repo、commit、前端程式碼或 localStorage。
- 前端不直接呼叫 Meta Marketing API 建立廣告。
- Meta / 供應商私密 API 都必須經後端代理。
- `data/`、`.runtime/`、SQLite 備份與 secrets 不可提交。
- 遇到 rate limit 或 action block 時，不連續重試。