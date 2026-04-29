# ad-procurement-demo

內部廣告採購與 Meta 投放 Demo。前端部署於 GitHub Pages，本機 Node API 與 SQLite 作為暫時多人共用後端。正式化時，後端排程與資料儲存可轉移至 Supabase / Cloud Functions。

## 系統定位

- 前端：React + TypeScript + Vite。
- 後端：Node.js，主要入口 `server/shared-api.js`。
- 資料庫：SQLite，預設檔案 `data/shared-demo.sqlite`。
- 前台部署：GitHub Pages，只提供靜態頁面。
- API 連線：前端透過 `VITE_SHARED_API_BASE` 或內建 fallback 連到本機 / tunnel API。
- Secrets 原則：供應商、Meta、Fanpage、Instagram、Ads API Key 只放後端，不放前端、不進 Git。

## 主要功能

- 廠商互動下單：支援一次性下單與平均排程下單。
- 廠商服務設定：供應商 API Key、服務清單、品項對應、追加設定、最低下單單位與定價。
- 投放成效：整合廠商訂單與 Meta 投放案件，支援手動同步與排程同步。
- Meta 官方投廣：依 Meta 官方 Campaign Objective 與 Performance Goal 建立投放流程。
- Meta 成效追蹤：依貼文連結解析 Facebook / Instagram 貼文，追蹤目標 KPI。
- 達標停投：當追蹤指標達成目標值時，自動暫停投遞。
- AI 優化投遞：建立多組 ad set / ad 變體，依 proxy ROAS 暫停低效變體。

## Meta OAuth 長效 Token

控制設定頁的 `Meta 基本設定` 支援兩種方式取得長效 User Token：

1. OAuth 授權登入
   - 後端 API：`GET /api/meta/oauth/start`、`GET /api/meta/oauth/callback`。
   - 需要設定 `Meta App ID`、`Meta App Secret`、`OAuth 回呼網址`。
   - 若使用 Meta 新版 Login Configuration，可填 `Login Configuration ID`。
   - 回呼網址預設：`http://127.0.0.1:8787/api/meta/oauth/callback`，必須加入 Meta App 的 Valid OAuth Redirect URIs。

2. 短效 User Token 交換
   - 後端 API：`POST /api/meta/token/exchange-short-lived`。
   - 可貼上圖形 API 測試工具產生的短效 User Token，由後端使用 App Secret 交換長效 token。

其他相關 API：

- `GET /api/meta/token/status`：確認目前長效 token 狀態，不回傳完整 token。
- `POST /api/meta/disconnect`：清除 User / Ads / Facebook / Instagram token，但保留 App 設定。
- `GET /api/meta/assets`：載入可用 Meta 廣告帳號、Facebook 粉專與 Instagram 帳戶。

## 後端 API

主要 API 皆在 `server/shared-api.js`：

- `GET /api/meta/settings`：讀取 Meta 投放設定，不回傳完整 token。
- `POST /api/meta/settings`：儲存 Meta App、token、預設廣告帳號、Page、Instagram actor、產業模板與優化門檻。
- `POST /api/meta/verify-token`：驗證 Ads / Facebook / Instagram / User token。
- `POST /api/meta/resolve-post`：用 post link 解析 platform、post id、canonical id、貼文時間、文案、permalink。
- `GET /api/meta/orders`：讀取 Meta 投放案件。
- `POST /api/meta/orders`：建立 campaign / ad set / creative / ad，預設狀態為 `PAUSED`，成功後寫入 SQLite。
- `POST /api/meta/orders/:id/sync`：同步單筆案件成效。
- `POST /api/meta/sync-running`：批次同步執行中案件與 A/B 判斷。
- `POST /api/meta/orders/:id/pause`：暫停投放。
- `POST /api/meta/orders/:id/resume`：重新啟用投放。

## 資料儲存

- `data/shared-demo.sqlite`：主要共享資料庫。
- `data/meta-local-secrets.json`：本機後端 secrets，必須保持不進 Git。
- `ad_demo_meta_settings_v2`：Meta 管理設定，不含完整 token。
- `ad_demo_meta_orders_v1`：Meta 投放案件、變體、同步結果與停投狀態。
- `ad_demo_orders_v1`：廠商互動下單案件。
- `ad_demo_config_v1`：供應商、品項、拆單、追加設定。

## 設定範例

- `.env.shared.example`：本機 API 與 Meta OAuth 環境變數範例。
- `server/meta-local.example.json`：本機 secrets JSON 範例，請複製到 `data/meta-local-secrets.json` 後填入實際值。
- `docs/meta_ads_and_vendor_technical_handoff_zh-TW.md`：最新 Meta 官方投廣、HDZ 供應商、追加投遞、資料儲存與同步機制交接文件。

必要 Meta OAuth 環境變數：

```bash
META_GRAPH_VERSION=v20.0
META_APP_ID=
META_APP_SECRET=
META_LOGIN_CONFIG_ID=
META_REDIRECT_URI=http://127.0.0.1:8787/api/meta/oauth/callback
META_OAUTH_SUCCESS_REDIRECT=https://carsoncchsieh.github.io/ad-procurement-demo/#/settings?meta_oauth=connected
META_OAUTH_ERROR_REDIRECT=https://carsoncchsieh.github.io/ad-procurement-demo/#/settings?meta_oauth=error
```

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

若 GitHub Pages 要連到本機 API，需保持 shared-api 與 tunnel 連線中，並確認前端 API base URL 可連到 `http://127.0.0.1:8787` 或對外 tunnel。

## Rate Limit 防護

- 成效同步預設每 5 分鐘一輪。
- 每輪限制案件數與每筆間隔，可用環境變數或控制設定調整。
- 同一 post / ad 的成效會快取，避免短時間重複呼叫。
- 遇到 Meta rate limit 類錯誤時不連續重試，會保留錯誤狀態供 UI 顯示。

## 測試重點

- 無 API Key：設定頁可保存空狀態，貼文驗證與送出會提示需設定 API Key，不可空白頁。
- 有 API Key：Ads token 可列出 ad accounts；Facebook / Instagram token 可解析貼文並取得 ID、文案、時間。
- 建立投放：預設建立為 `PAUSED`，避免測試誤投。
- 同步與停投：同步 spend、reach、impressions、clicks、actions；達標後自動 pause。
- UI：桌機與手機版不跑版，一般使用者看不到 token、raw payload 或 stack trace。

## 安全原則

- 不把完整 API Key / token 寫入 repo、commit、前端程式碼或 localStorage。
- 前端只顯示 token 是否存在與遮罩片段。
- 所有需要權限的 Meta / 供應商呼叫都走後端代理。
- `data/`、`.runtime/`、SQLite 備份與 secrets 不可提交。
