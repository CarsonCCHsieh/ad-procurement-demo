# 正式主機搬遷與驗收說明

## 文件目的

這份文件是給未來接手部署與維運的 RD 人員使用。

目標：
- 讓 RD 能快速理解本 repo 的前端 / 後端分界
- 知道哪些功能目前依賴本機端
- 知道搬遷到正式主機或正式 DB 時要搬哪些部分
- 有一份可以照著跑的上線驗收清單

## 一、目前系統拆分

### A. 靜態前端
位置：`src/`
部署：GitHub Pages

負責：
- 頁面 UI
- 使用者輸入
- 案件列表與成效展示
- 控制設定畫面
- 呼叫共享後端 API

不能單獨完成的事：
- 保存多人共用資料
- 供應商送單
- Meta 指標查詢
- 訂單狀態同步

### B. 後端服務
位置：`server/shared-api.js`

負責：
- 共享 state API
- SQLite 持久化
- 供應商 API 代理
- Meta post metrics 代理
- 本機 secrets 讀取
- 本機模式下提供 build 後的前端靜態檔

### C. 資料層
目前資料來源：
- SQLite：`data/shared-demo.sqlite`
- 前端 localStorage：作為本地快取與同步載體

正式環境建議：
- 可先維持 SQLite
- 或改成正式 DB，例如 PostgreSQL / MySQL

### D. Secrets
目前本機 secrets：
- `data/meta-local-secrets.json`
- `data/vendor-local-secrets.json`

正式環境應改成：
- 雲主機環境變數
- secrets manager
- 或受控的正式設定檔，不可放在前端

## 二、目前哪些功能必須跟後端一起搬

以下功能若不上正式後端，前端無法單獨成立：

1. 多使用者共享案件與設定
2. 廠商互動下單 API 呼叫
3. 廠商訂單狀態同步
4. Meta post metrics 查詢
5. 控制設定跨裝置同步
6. 訂單 revision / polling 機制

## 三、正式搬遷時最少要搬的內容

### 必搬
- `server/shared-api.js`
- `data/` 對應的正式 DB 機制
- secrets 管理方式
- `.env.shared.example` 中對應的正式環境設定

### 可保留原樣
- React / TypeScript / Vite 前端
- GitHub Pages 改成任意靜態站 hosting 或正式 web host

### 建議重構但不是立刻必要
- SQLite 換正式 DB
- quick tunnel 換正式 domain + TLS
- 本機 JSON secrets 改 secrets manager
- 排程任務與同步機制獨立成 worker / cron

## 四、建議的正式部署結構

### 最低可行方案
- 前端：任一靜態 hosting
- 後端：Node.js server
- DB：SQLite
- secrets：主機環境變數或受控檔案

### 較合理的正式方案
- 前端：正式 web host
- 後端：Node.js API service
- DB：PostgreSQL / MySQL
- secrets：Secrets Manager / 環境變數
- background job：cron / worker

## 五、上線後驗收清單

### 1. 基礎連線
- 前端網站可正常開啟
- 後端 `/api/health` 正常
- 前端能成功呼叫 `/api/state`
- 共享資料 revision 會變化

### 2. 權限與登入
- 管理員可登入
- 下單使用者可登入
- 下單使用者看不到 `控制設定`
- 下單使用者看不到 `Meta官方投廣`

### 3. 控制設定
- 停用品項後，下單頁不再顯示該品項
- 新增品項後，下單頁可看到新項目
- 刪除品項後，下單頁不再顯示且設定已移除
- 載入服務清單後，Service Picker 可選到服務
- Meta 設定可儲存並重新載入

### 4. 廠商互動下單
- 可建立新訂單
- 新訂單會寫入共享後端 / 正式 DB
- 供應商 API 回傳失敗時，前台能顯示可理解訊息
- 成效頁能看到新訂單

### 5. 投放成效
- 可看到共享訂單
- 可按同步進行中案件
- 狀態同步後資料有更新
- 已完成案件顯示正確狀態

### 6. Meta 功能
- Meta 頁可載入
- Meta 設定可保存
- 貼文 metrics API 可從後端查到數據
- 若有自動停投機制，需驗證達標後可停投

## 六、目前已知架構限制

1. demo 版本仍依賴單一共享後端
2. 若後端停機，GitHub Pages 前端仍會開啟，但資料功能會失效
3. 目前部分同步仍採 polling，不是完整事件驅動
4. 目前 vendor 與 Meta secrets 仍偏向 demo 階段做法，正式環境應獨立管理

## 七、RD 接手時建議先做的事

1. 先把後端從本機搬到正式主機
2. 把 `data/shared-demo.sqlite` 換成正式 DB 或正式保存方式
3. 把本機 secrets 改成正式 secrets 管理
4. 用本文件的驗收清單跑完整回歸測試
5. 確認 GitHub Pages 或新前端 host 指向正式後端 API

## 八、參考檔案

- `README.md`
- `docs/status_zh-TW.md`
- `docs/local_multiuser_demo_zh.md`
- `docs/api_and_storage_map_zh.md`
- `docs/deployment_topology_zh.md`
- `server/shared-api.js`
- `.env.shared.example`
- `server/meta-local.example.json`
- `server/vendor-local.example.json`
