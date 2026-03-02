# 廣告採購 Demo（GitHub Pages）

這是一個獨立的 Demo 專案，用來展示「廣告下單 -> 確認送出」流程。

重點：
- 不依賴 Lovable
- 不依賴 Supabase
- 只提供前端 Demo 用的「假登入」（不具安全性）
- 適合給少數內部人員看流程與 UI

## 功能
- `#/login`：假登入
- `#/ad-orders`：原 SMM 下單表單（含欄位驗證） -> 確認送出頁
- `#/ad-performance`：原 SMM 成效頁
- `#/meta-ads-orders`：Meta 官方投放下單（Campaign/AdSet/Creative/Ad）
- `#/meta-ads-performance`：Meta 投放狀態同步與送出紀錄
- `#/settings`：系統設定（含 Meta API 設定、供應商設定、定價設定）

## Demo 帳密（可自行修改）
帳密設定在：
- `src/auth/demoAuth.ts`

提醒：這是純前端 Demo，帳密會被打包到 JS 裡，無法當作真正的安全機制。

## 本機開發
需要 Node.js 20+（建議 LTS）。

```bash
npm install
npm run doctor
npm run dev
```

若 PowerShell PATH 尚未刷新，可先重開終端機再執行。`doctor` 會檢查：
- Node / npm / npx 可用性
- `.git/index.lock` 是否存在
- `node_modules/.bin/vite` 是否可用

## 部署到 GitHub Pages
此專案內含 GitHub Actions workflow（`.github/workflows/pages.yml`）。

一般流程：
1. 推到 GitHub（main 分支）
2. 到 GitHub Repo Settings -> Pages，Source 選 GitHub Actions
3. 等 Actions 跑完後，就會有 Pages URL

## 定價
目前定價先用暫定版本，集中在：
- `src/lib/pricing.ts`

後續可替換成讀取 Google Sheet 或後端配置。
