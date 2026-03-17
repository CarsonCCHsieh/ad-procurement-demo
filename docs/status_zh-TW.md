# 專案現況總覽

更新日期：2026-03-18

## 這份文件的用途

這份文件提供目前 `ad-procurement-demo` 的最新狀態摘要，讓 RD、維運或交接人員可以快速確認：
- 現在有哪些功能已可使用
- 哪些功能依賴本機或後端服務
- 目前已知限制是什麼
- 應以哪些文件作為正式搬遷與驗收依據

如果要做正式主機搬遷，請以以下文件為主：
- `README.md`
- `docs/production_handoff_zh.md`
- `docs/api_and_storage_map_zh.md`
- `docs/deployment_topology_zh.md`

## 目前可用功能

### 前台
- 登入
- 廠商互動下單
- Meta 官方投廣表單
- 投放成效查看
- 依角色顯示可用入口

### 管理端
- 控制設定
- 品項新增 / 停用 / 刪除
- 定價與最小單位設定
- 供應商 API Key 與服務清單管理
- Meta 設定
- 備份匯出 / 匯入

### 共享與同步
- 多人共用案件資料
- 控制設定跨裝置同步
- 廠商訂單狀態同步
- Meta 貼文指標查詢

## 目前架構現況

### 靜態頁面
- 前端以 `React + TypeScript + Vite` 開發
- 可部署於 GitHub Pages 或任何靜態主機
- 僅負責 UI、使用者輸入與 API 呼叫

### 後端服務
- `server/shared-api.js`
- 負責共享 state、SQLite、供應商 API 代理、Meta 查詢代理
- 目前 demo 階段可跑在本機

### 資料儲存
- 後端主要共享資料：`SQLite`
- 前端輔助快取：`localStorage`
- 真實 secrets 不進 Git

## 已知限制

1. 若後端服務停止，前端頁面仍可開啟，但共享資料、送單與同步功能會失效。
2. 目前 demo 版仍採 polling，同步不是事件驅動。
3. 供應商送單與 Meta 功能是否成功，仍受外部 API 權限、餘額與 serviceId 正確性影響。
4. 正式上線前，應將本機 secrets 與 SQLite 遷移到正式主機與正式 secrets 管理方式。

## 驗收建議

正式驗收請依 `docs/production_handoff_zh.md` 的清單逐項執行。

如需檢查 API 與資料儲存點對照，請看：
- `docs/api_and_storage_map_zh.md`

如需確認目前 demo 架構與正式架構差異，請看：
- `docs/deployment_topology_zh.md`
