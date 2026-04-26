# ad-procurement-demo

內部廣告下單與投放成效 Demo。此版本以 GitHub Pages 作為前端展示，本機 Node API 與 SQLite 作為暫時可多人共用的後端。未來正式化時，後端與排程可移轉至 Supabase Functions / Cloud Functions，資料表移轉至雲端資料庫。

## 系統定位

- 前端：React + TypeScript + Vite。
- 後端：Node.js，主要入口為 `server/shared-api.js`。
- 資料庫：SQLite，檔案為 `data/shared-demo.sqlite`。
- 前台部署：GitHub Pages，只提供靜態頁面。
- API 連線：前端透過 `VITE_SHARED_API_BASE` 或內建 fallback 連到本機 / tunnel API。
- 安全原則：供應商、Meta、Fanpage、Instagram、Ads API Key 只放後端，不放前端、不進 Git。

## 主要功能

- 廠商互動下單：支援一次性下單與平均排程下單。
- 廠商服務設定：供應商 API Key、服務清單、品項對應、追加設定、最低下單單位與定價。
- 投放成效：整合廠商訂單與 Meta 投廣案件，支援手動同步與排程同步。
- Meta 官方投廣：依 Meta 官方 Campaign Objective 與 Performance Goal 建立投放流程。
- Meta 成效追蹤：依貼文連結解析 Facebook / Instagram 貼文，後續可追蹤目標 KPI。
- 達標停投：當追蹤指標達成設定目標時，自動暫停投遞。
- 優化投遞法：建立多個 ad set / ad 變體，依 proxy ROAS 自動停用低效變體。

## Meta 官方投廣設計

`Meta 官方投廣` 不再使用廠商下單品項，而是使用 Meta 官方投放結構：

- Campaign Objective：品牌認知、流量、互動、潛在顧客、應用程式推廣、銷售業績。
- Performance Goal：依 Meta 官方文字整理，並依 objective 篩選可用 KPI。
- KPI tracking：依 goal 對應 reach、impressions、clicks、post engagement、video views、profile visits、leads、conversions、app events、calls 等欄位。
- 直投法：建立單一投放結構，只追蹤與達標停投。
- 優化投遞法：建立至少兩組變體，預設為「模板受眾」與「廣泛受眾」。同步時以 `目標成效 / spend` 作為 proxy ROAS，低於勝出組比例門檻的變體會自動暫停。

## 產業模板

目前內建 29 個產業模板：

運動、鞋類、服飾、美妝、精品、鐘錶飾品、影劇娛樂、餐廳、食品飲料、酒類、日用品、3C家電、交通運輸、遊戲類、APP、EC平台、包包配件、旅遊業、金融保險、零售通路、光學眼鏡、電信通訊、健康醫藥、政府政黨、文教、房地產、嬰幼兒、醫美、其他。

第一版模板採安全預設：台灣、18-49、手動版位、保守興趣群組。管理員可於 `控制設定` 調整模板、受眾、版位與優化門檻。

## 後端 API

主要 API 皆在 `server/shared-api.js`：

- `GET /api/meta/settings`：讀取 Meta 投放設定，不回傳完整 token。
- `POST /api/meta/settings`：儲存 Ads / Facebook / Instagram token、預設廣告帳號、Page、Instagram actor、產業模板與優化門檻。
- `POST /api/meta/verify-token`：驗證 Ads / Facebook / Instagram token。
- `POST /api/meta/resolve-post`：用 post link 解析 platform、post id、canonical id、貼文時間、文案、permalink。
- `GET /api/meta/orders`：讀取 Meta 投放案件。
- `POST /api/meta/orders`：建立 campaign / ad set / creative / ad，預設狀態為 `PAUSED`，成功後寫入 SQLite。
- `POST /api/meta/orders/:id/sync`：同步單筆案件成效。
- `POST /api/meta/sync-running`：批次同步執行中案件與 A/B 判斷。
- `POST /api/meta/orders/:id/pause`：暫停投放。
- `POST /api/meta/orders/:id/resume`：重新啟用投放。

## 資料儲存

- `data/shared-demo.sqlite`：主要共享資料庫。
- `data/meta-local-secrets.json`：可放本機後端 secrets，必須保持不進 Git。
- `ad_demo_meta_settings_v2`：Meta 管理設定，不回傳完整 token 到前端。
- `ad_demo_meta_orders_v1`：Meta 投放案件、變體、同步結果與停投狀態。
- `ad_demo_orders_v1`：廠商互動下單案件。
- `ad_demo_config_v1`：供應商、品項、拆單、追加設定。

## Rate Limit 防護

- 成效同步預設每 5 分鐘一輪。
- 每輪限制處理案件數與案件間隔，可由環境變數或控制設定調整。
- 同一 post / ad 的成效會快取，避免短時間重複呼叫。
- 遇到 Meta rate limit 類錯誤時不會無限重試，會保留錯誤狀態供 UI 顯示。

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

若 GitHub Pages 要連到本機 API，需保持 shared-api 與 tunnel 連線中，並確認前端設定的 API base URL 可連到 `http://127.0.0.1:8787` 對外 tunnel。

## 測試重點

- 無 API Key：設定頁可保存空狀態；貼文驗證與送出會提示需要設定 API Key，不可空白頁。
- 有 API Key：Ads token 可列出 ad accounts；Facebook / Instagram token 可解析貼文並取得 ID、文案、時間。
- 建立投放：預設建立 `PAUSED`，避免測試誤投。
- 同步與停投：同步 spend、reach、impressions、clicks、actions；達標後自動 pause；優化投遞法會停用低效變體。
- UI：桌機與手機版不可跑版，一般使用者不可看見 token、raw payload 或 stack trace。

## 文件索引

- `docs/api_and_storage_map_zh.md`：API 與資料儲存地圖。
- `docs/function_relationship_map_zh-TW.md`：Function 關係與修改影響。
- `docs/production_handoff_zh.md`：正式化移轉說明。
- `docs/encoding_standard_zh-TW.md`：編碼標準。
- `docs/deployment_topology_zh.md`：部署拓撲。
- `docs/status_zh-TW.md`：目前狀態紀錄。

## 安全原則

- 不把完整 API Key / token 寫入 repo、commit、前端程式碼或 localStorage。
- 前端只顯示 token 是否存在與遮罩後片段。
- 所有需要權限的 Meta / 供應商呼叫都走後端代理。
- `.runtime/`、secrets、SQLite 備份檔不可提交。
