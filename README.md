# ad-procurement-demo

內部廣告下單與投放成效系統（Demo / 可運行版）。

## 專案定位
- 前端：React + TypeScript（Vite）
- 後端：Node.js（`server/shared-api.js`）
- 資料庫：SQLite（`data/shared-demo.sqlite`）
- 部署：
- GitHub Pages：只提供前端靜態頁面
- 本機/雲端 Node：提供 API、排程、狀態同步與第三方 API 代理

## 主要功能
- 廠商互動下單（一次下單 / 平均排程）
- 廠商進度同步與失敗批次重送
- Meta 官方投廣下單（建立、同步、暫停、重啟）
- 投放成效統一頁（廠商 + Meta）
- 控制設定（品項、供應商映射、定價、最小單位、追加設定、Meta 策略）
- 多人共享狀態同步（shared state）

## 本機啟動
```bash
npm install
npm run check:encoding
npm run build
npm run shared-api
```

前端開發模式（可選）：
```bash
npm run dev
```

若 API 不是同源，請設定 `VITE_SHARED_API_BASE` 指向 shared-api URL。

## 文件索引
- 架構與 API/資料儲存：`docs/api_and_storage_map_zh.md`
- Function 關係與修改影響：`docs/function_relationship_map_zh-TW.md`
- 正式環境移轉與驗收：`docs/production_handoff_zh.md`
- 編碼標準：`docs/encoding_standard_zh-TW.md`
- 部署拓樸：`docs/deployment_topology_zh.md`
- 狀態紀錄：`docs/status_zh-TW.md`

## 安全原則
- API key / token 不可放在前端程式碼或 Git 版本庫。
- secrets 只可放在後端環境變數或不入版控檔案。
- GitHub Pages 不提供後端能力；`/api/*` 必須由 shared-api（或正式雲端後端）提供。

## 本次收斂重點
- 將 Meta 投放能力判斷邏輯集中到 `src/lib/metaOrderCapabilities.ts`，降低頁面邏輯耦合。
- 補齊「function 關聯與影響矩陣」文件，降低後續改動的連鎖風險。
