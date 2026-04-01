# 正式環境移轉與交接指南

本文件給接手 RD 進行正式上線與維運使用。

## 1. 現況摘要
- 前端可在 GitHub Pages 運行。
- 後端 shared-api 目前在本機/指定主機運行。
- 共享資料與排程依賴後端 + SQLite。
- 若只有前端、沒有後端，系統無法實際下單與同步。

## 2. 必要權限清單
- 目標 repo 讀寫權限
- 正式後端主機部署權限
- 正式資料庫建立/維護權限
- Secret manager（或環境變數）管理權限
- 供應商 API key 與 Meta token 配置權限

## 3. 必搬項目
- 後端：`server/shared-api.js`
- DB：`data/shared-demo.sqlite` 對應資料模型與資料
- 前端環境變數：`VITE_SHARED_API_BASE`
- secrets：Meta / vendor 全部移到後端安全儲存

## 4. 建議正式拓樸
- 前端：正式網域（例：`erp.juksy.com`）
- API：獨立 Node service（對外只開必要 API）
- DB：PostgreSQL（建議）或受控 SQLite
- 排程：
- 每分鐘：處理平均排程批次
- 每 5 分鐘：Meta 進度同步與目標停投判斷

## 5. 上線驗收（必跑）
1. `GET /api/health` 正常
2. 多裝置更新同一資料，revision 與同步結果正確
3. 廠商下單：
- 一次下單
- 平均排程（跨日）
- 同步進度與重試失敗批次
4. Meta 下單：
- 驗證貼文連結
- 建立投放
- 同步成效
- 目標達成自動停投
5. 權限：
- `order_user` 不可見 `settings`
- `order_user` 不可見 `meta-ads-orders`

## 6. 風險與對策
- 風險：token 過期導致同步中斷
- 對策：後端告警 + token 輪替 SOP
- 風險：第三方 API 回傳非 JSON
- 對策：後端統一錯誤正規化，前端顯示可操作訊息
- 風險：共享狀態競態覆蓋
- 對策：維持 revision 機制與批次寫入

## 7. 交接必附文件
- `docs/api_and_storage_map_zh.md`
- `docs/function_relationship_map_zh-TW.md`
- 本文件
- 不含明文 secrets 的環境設定清單
- 一份完整 UAT 驗收紀錄
