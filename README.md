# Ad Procurement Demo

本專案是 JUKSY 內部廣告採購流程的 demo / staging 版本，目的是先驗證下列流程：

1. 內部人員登入後提交「廠商互動下單」或「Meta 官方投廣」
2. 系統保存案件、同步多使用者畫面
3. 管理員在控制設定中管理品項、定價、供應商與 Meta 設定
4. 使用者在投放成效頁查看案件進度

目前此 repo 同時包含：
- 靜態前端：部署於 GitHub Pages
- Node.js 本機後端：目前跑在本機，用來提供共享資料 API、SQLite、供應商 API 代理、Meta 查詢代理

這點非常重要：
目前 GitHub Pages 只負責前端 UI。真正讓系統可「多人共用」、「可送單」、「可同步狀態」、「可查 Meta 數據」的是後端服務，不是純靜態頁面。

## 目前架構

### 1. 靜態前端
位置：`src/`

技術：
- React
- TypeScript
- Vite
- React Router

目前主要頁面：
- `#/login`：登入
- `#/ad-orders`：廠商互動下單
- `#/meta-ads-orders`：Meta 官方投廣
- `#/ad-performance`：投放成效
- `#/settings`：控制設定

部署位置：
- GitHub Pages

前端職責：
- 顯示 UI
- 收集使用者輸入
- 呼叫共享後端 API
- 顯示共享後端回傳的案件、進度、設定與 Meta 數據

### 2. 共享後端 / 本機 API
位置：`server/shared-api.js`

技術：
- Node.js 原生 HTTP server
- SQLite（`data/shared-demo.sqlite`）

目前後端負責：
- 提供共享 state API
- 保存多人共用資料
- 代理供應商送單與狀態同步
- 代理 Meta post metrics 查詢
- 保存 / 讀取本機 secrets
- 本機模式下同時提供已 build 的前端靜態檔

### 3. 本機資料與 secrets
不會提交到 Git：
- `data/shared-demo.sqlite`
- `data/meta-local-secrets.json`
- `data/vendor-local-secrets.json`
- 各種 `.env.local` / 真實 `.env`

Git 內只保留範本：
- `.env.shared.example`
- `server/meta-local.example.json`
- `server/vendor-local.example.json`

## 目前哪些功能依賴本機後端

下列功能不是 GitHub Pages 單獨能完成的，未來搬到正式主機時必須一起搬：

- 多人共享案件資料
- 控制設定跨裝置同步
- 廠商下單 API 呼叫
- 廠商訂單狀態同步
- Meta post metrics 查詢
- 自動同步 / 共用 revision 機制
- SQLite state storage

如果只有前端搬到正式主機，但後端不搬，以下功能會失效：
- 新訂單共享
- 成效同步
- 供應商送單
- Meta 指標讀取
- 多人同時看到同一份資料

## 快速啟動

### 本機前端開發
```bash
npm install
npm run dev
```

### 本機完整 demo
```bash
npm install
npm run local-demo
```

`npm run local-demo` 會：
1. build 前端
2. 啟動 `server/shared-api.js`
3. 用同一個 Node server 提供：
   - 前端靜態頁
   - 共享 API
   - SQLite

## 環境變數
範本：`.env.shared.example`

目前使用到的主要變數：
- `VITE_SHARED_API_BASE`
- `SHARED_API_PORT`
- `SHARED_API_DB`

注意：
- 不要把真實 `.env` 推上 Git
- 不要把真實 API key / token / 本機 secrets 推上 Git

## 驗證指令

```bash
npm run build
npm run doctor
```

## 目前正式頁與本機的分界

### GitHub Pages 上的內容
- 前端 bundle
- 頁面 UI
- 使用者操作流程

### 本機後端上的內容
- `/api/state`
- `/api/vendor/submit-order`
- `/api/vendor/sync-shared-orders`
- `/api/meta/post-metrics`
- SQLite state
- 本機 secrets

## RD 搬遷時必讀

正式主機搬遷請先看：
- `docs/production_handoff_zh.md`
- `docs/local_multiuser_demo_zh.md`
- `docs/api_and_storage_map_zh.md`
- `docs/deployment_topology_zh.md`
- `docs/status_zh-TW.md`

上述文件已把：
- 目前靜態頁與本機功能的界線
- 正式主機要搬什麼
- 上線後如何驗收
寫清楚。

## 文件索引

- `README.md`
  - 專案入口與架構摘要
- `docs/status_zh-TW.md`
  - 目前專案狀態總覽
- `docs/local_multiuser_demo_zh.md`
  - 本機多人 demo 的啟動與限制
- `docs/production_handoff_zh.md`
  - 正式主機搬遷與驗收清單
- `docs/api_and_storage_map_zh.md`
  - API、shared state 與 localStorage 對照
- `docs/deployment_topology_zh.md`
  - 目前 demo 與正式環境的部署拓樸
