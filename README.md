# ad-procurement-demo

內部廣告採購 Demo 專案。  
前台為 React + TypeScript 靜態頁面；實際下單、共享狀態與排程同步由本機 `shared-api` 提供。

## 系統架構

- 前台：`src/`（Vite + React + TypeScript）
- 本機 API：`server/shared-api.js`
- 共享資料庫：`data/shared-demo.sqlite`（SQLite）
- 供應商服務清單：`public/services/*.json`
- 部署：
  - GitHub Pages：只提供前台靜態頁面
  - 本機 `shared-api`：負責下單、狀態同步、多人共享資料

## 目前已支援功能

- 廠商互動下單（單次 / 平均拆批）
- Meta 官方投廣（建立、同步、暫停、重啟）
- 成效頁集中檢視
- 控制設定（品項、供應商、定價、最小單位、服務映射）
- 每小時自動同步進行中案件（頁面開啟期間）
- 追加設定：品項完成後固定追加一筆供應商訂單

## 追加設定（新品項功能）

控制設定 > 品項對應 > 各品項內「追加設定」：

- 狀態：啟用 / 停用
- 供應商：smmraja / urpanel / justanotherpanel
- serviceId：追加服務編號
- 追加數量：固定數量

觸發規則：

- 單次模式：該品項批次 `completed` 後觸發一次
- 平均模式：最後一批 `completed` 後觸發一次
- 追加送單只會觸發一次，不會重複送出

## 本機啟動

```bash
npm install
npm run check:encoding
npm run build
npm run shared-api
```

前台連線本機 API（建議）：

- 設定 `VITE_SHARED_API_BASE` 指向本機 API（或 Cloudflare Tunnel URL）
- 再啟動前台：`npm run dev`

## 編碼標準（統一方法）

本專案統一採用：

- UTF-8（無 BOM）
- LF 換行

落地規範：

- `.editorconfig`：`charset=utf-8`、`end_of_line=lf`
- `.gitattributes`：文字檔統一 LF
- `npm run check:encoding`：檢查
  - UTF-8 BOM
  - U+FFFD 破損字元
  - 可疑亂碼特徵
  - 可疑連續問號佔位字串

CI（GitHub Pages workflow）會在 build 前強制執行 `check:encoding`，避免亂碼再次進版。

## 重要安全原則

- API Key / Token 不可放在前端程式碼或 GitHub 版本庫
- 建議放在本機 `data/*.json`（不進版）或正式環境秘密管理系統
- Demo 帳密僅供展示，不具正式安全性

## 上正式主機前必做

- 將 `shared-api` 與 SQLite 移至正式主機（或改用正式 DB）
- 設定正式網域與 HTTPS
- 將本機 secrets 移到雲端 secret manager
- 依 `docs/` 檢查清單逐項驗證下單、同步、停投、成效欄位
