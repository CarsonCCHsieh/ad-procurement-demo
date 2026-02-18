# 廣告採購 Demo（GitHub Pages）進度說明

更新日期：2026-02-18

## 目標與限制
- 目標：做一個可對少數人展示的「廣告採購下單」Demo，先把「填寫 -> 確認提交」流程做出來。
- 限制：
  - 不碰既有 `juksysmallerp`（Lovable / Supabase）任何程式與部署流程。
  - Demo 站採用 GitHub Pages，僅作展示用途。
  - Demo 登入為前端假登入（不具備真正的安全性），僅用來避免隨意進入頁面。
  - 廠商 API 即使可串，測試帳號無點數時可能無法成功呼叫；本階段不以 API 成功為完成標準。

## 專案位置
- 本機路徑：`repos/ad-procurement-demo`
- 技術：
  - Vite + React + TypeScript
  - React Router（`HashRouter`，方便 GitHub Pages 直接可用，不需要伺服器 rewrite）

## 已完成的頁面與路由
- `#/login`
  - Demo 用假登入。
  - 帳號密碼定義在：`src/auth/demoAuth.ts`
  - 登入狀態存於 `localStorage`（可被使用者清除或修改，屬正常預期）。

- `#/ad-orders`
  - 下單表單頁（本階段主完成目標）。
  - 流程：填寫（含欄位檢核） -> 確認送出（同頁切換） -> 已送出（暫存狀態顯示）
  - 重點行為：
    - 可新增多筆投放項目（平台/品項 + 目標數量）。
    - 目標數量欄位強制數字檢核（不合法不可進入確認頁）。
    - 連結欄位支援多筆（以換行分隔），並進行基本 URL 檢核。
    - 定價目前為硬編碼，集中在：`src/lib/pricing.ts`
    - 送出後目前不會真的打 API；但會把「拆單計畫」存到 `localStorage`，供成效頁顯示（便於先對齊拆單邏輯與欄位）。

- `#/ad-performance`
  - 成效頁（Demo 版本先顯示「已提交工單」與「拆單計畫」，正式版再接 API 回寫狀態與成效）。

- `#/settings`
  - 控制設定頁（本次新增重點）。
  - 用途：把「內部下單品項（fb_like/ig_like...）」對應到三家供應商各自的 `serviceId`，並設定拆單 `weight` 與 `maxPerOrder`。
  - 服務下拉選單：
    - 你可以把供應商 `action=services` 的 JSON 回應貼到此頁匯入，之後就能用「可搜尋挑選」方式選 service，而不是只看 serviceId 數字。
  - 注意：因為 Demo 是純前端靜態站，無法安全保存 API key，也容易遇到 CORS，所以此頁採用「匯入 services JSON」的方式；正式版建議由後端同步 services 清單並保管 key。

## GitHub Pages 部署方式（Actions）
本專案使用 GitHub Actions 自動建置並部署到 GitHub Pages：
- Workflow 檔：`.github/workflows/pages.yml`
- 觸發：
  - push 到 `main` 或 `master`
  - 或手動執行 `workflow_dispatch`
- 建置流程：
  - `npm install`
  - `npm run build` 產出 `dist/`
  - 上傳 artifact 並 deploy 到 Pages

Repo 設定必要步驟（在 GitHub 網站上做一次即可）：
1. 進入 Repo：Settings -> Pages
2. Source 選 `GitHub Actions`
3. 之後每次 push，Actions 跑完就會更新 Pages

## 注意事項（安全與可移植性）
- 這個 Demo 的登入是前端假登入：任何能看到原始碼的人都能找到帳密，僅適合內部展示。
- 真正串接廠商 API 時，不要把 API key 放在前端：應改由後端（或 serverless）代打 API，前端只打你自己的端點。
- 若未來要「無痛轉移到其他平台」：
  - 現在的 UI/表單/流程邏輯已經切成獨立專案，不依賴 Lovable/Supabase。
  - 將來只要把同一套前端改接新的後端與登入來源即可（路由與頁面可直接搬移）。

## 下一步建議（等你提供資料後）
- 你提供「Google Sheet 欄位最終版」與「廠商 API 文件（含測試 key）」後，我們再做：
  - 送出後呼叫後端端點（先 mock 回應也可）
  - 成效頁 UI 根據 API response schema 定稿
  - 最小可用的資料儲存（若要 SQLite，建議用一個輕量後端承載，GitHub Pages 本身無法跑 SQLite）
