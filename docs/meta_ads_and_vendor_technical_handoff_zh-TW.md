# Meta 官方投廣與廠商投廣技術交接文件

最後更新：2026-04-29
適用 repo：`CarsonCCHsieh/ad-procurement-demo`

本文件說明目前測試站的最新 Meta 官方投廣流程、前後端機制、資料儲存與同步機制，並補充 HDZ 供應商與廠商投廣「追加投遞」功能。

## 1. 系統邊界

- 前端：GitHub Pages 靜態站，React + TypeScript + Vite。
- 後端：本機 Node API，入口 `server/shared-api.js`。
- DB：SQLite，預設 `data/shared-demo.sqlite`。
- Secrets：只存在本機後端 `data/meta-local-secrets.json`、`data/vendor-local-secrets.json`，不可提交 Git。
- GitHub Pages 本身不保存 token，也不直接呼叫 Meta 或供應商私密 API。

## 2. Meta 官方投廣使用流程

路由：`#/meta-ads-orders`
主要檔案：`src/pages/MetaAdsOrders.tsx`

目前流程分 4 步：

1. 投放目標
   - 申請人、任務名稱、產業、投遞方式、Meta 官方 Campaign Objective、Performance Goal、日預算、達標停投數值、開始 / 結束時間。
   - 任務名稱會同步作為 campaign / ad set / ad 基礎名稱。
   - 投遞方式：
     - 直接投遞：建立單一 ad set / ad。
     - AI 優化投遞：建立 2 組變體，後續依 proxy ROAS 停用低效組。

2. 貼文驗證
   - 使用者貼 Facebook / Instagram / Reels 單篇連結。
   - 前端呼叫 `POST /api/meta/resolve-post`。
   - 成功後取得 post id、canonical id、permalink、貼文時間、文案（若 token 權限足夠）。
   - 未驗證成功不可進入後續送出。

3. 受眾與版位
   - 依產業模板帶入受眾搜尋方向。
   - 可用「補充 TA 方向」讓後端依文字搜尋 Meta interest。
   - 後端呼叫 Meta Targeting Search，成功結果會轉為 `interestObjects`。
   - Facebook / Instagram 版位預設不勾，使用者需自行選擇。

4. 確認送出
   - 顯示摘要，不顯示 raw payload。
   - 呼叫 `POST /api/meta/orders`。
   - 後端依序建立 Campaign、Ad Set、Creative、Ad，預設狀態皆為 `PAUSED`。

## 3. Meta 後端建立流程

主要檔案：`server/shared-api.js`
主要 function：`createMetaOrderSecure(input)`

送出流程：

1. 讀取設定與 secrets
   - `readMetaSettings()` 讀 shared state 的 `ad_demo_meta_settings_v2`。
   - `loadMetaSecrets()` 讀 `data/meta-local-secrets.json`。
   - Ads token 由 `getMetaToken(metaSecrets, "ads")` 取得；若沒有專用 Ads token，會 fallback 到 User token。

2. 驗證廣告帳號
   - 透過 `listAvailableAdAccounts(metaSecrets)` 確認 `adAccountId` 是目前 token 可操作的帳號。
   - 避免使用者誤填 Business Manager ID 或無權限 ad account。

3. 解析貼文與受眾
   - `resolveTrackingFromUrl()` / `resolveMetaPostSecure()` 處理貼文連結。
   - `resolveMetaAudienceInterestsForInput()` 搜尋 interest id。

4. 建立 Meta 物件
   - Campaign：`POST /act_{adAccountId}/campaigns`
   - Ad Set：`POST /act_{adAccountId}/adsets`
   - Creative：`POST /act_{adAccountId}/adcreatives`
   - Ad：`POST /act_{adAccountId}/ads`

5. 寫入本機 DB
   - 成功後寫入 shared state key：`ad_demo_meta_orders_v1`。
   - UI 的投放成效頁會從此 key 讀取。

## 4. Meta payload 注意事項

目前已處理過的 Meta API 限制：

- API v24 若未使用 Campaign Budget，建立 Campaign / Ad Set 時需指定：
  - `is_adset_budget_sharing_enabled: false`
- 表單送出 boolean 需轉為 Meta 可接受格式：
  - `true` → `True`
  - `false` → `False`
- `instagram_actor_id` 不可放在 `promoted_object`。
  - Instagram 身分應放在 Creative 的 `object_story_spec.instagram_actor_id` 或其他 creative 層級欄位。
- `promoted_object` 目前只放 Meta 允許的欄位，例如：
  - `page_id`
  - `pixel_id`
  - `custom_event_type`
  - `application_id`
  - `object_store_url`

## 5. Meta OAuth 與 token 機制

控制設定：`#/settings` → `Meta 基本設定`
主要檔案：

- `src/components/MetaSettingsCard.tsx`
- `src/config/metaConfig.ts`
- `server/shared-api.js`

支援方式：

1. OAuth 授權登入
   - `GET /api/meta/oauth/start`
   - `GET /api/meta/oauth/callback`
   - 使用 App ID / App Secret 取得長效 User Token。

2. 短效 User Token 交換
   - `POST /api/meta/token/exchange-short-lived`
   - 使用 Graph API Explorer 的短效 User Token 交換長效 token。

3. Token 狀態
   - `GET /api/meta/token/status`
   - 使用 `/debug_token` 驗證，不回傳完整 token。

4. 清除 token
   - `POST /api/meta/disconnect`
   - 清除 User / Ads / Facebook / Instagram token，但保留 App 設定。

5. 載入帳戶
   - `GET /api/meta/accounts`
   - 讀可用 ad accounts、Facebook pages、Instagram accounts。

Secrets 儲存位置：

- `data/meta-local-secrets.json`
- 範例：`server/meta-local.example.json`

前端只會收到：

- token 是否存在
- token 遮罩片段
- OAuth 狀態
- 到期時間
- scopes

前端不會收到完整 token。

## 6. Meta 成效更新與達標停投

投放成效頁：`#/ad-performance`
主要檔案：`src/pages/AdPerformance.tsx`

後端同步 function：`syncSharedMetaOrders()`

相關 API：

- `GET /api/meta/orders`
- `POST /api/meta/orders/:id/sync`
- `POST /api/meta/sync-running`
- `POST /api/meta/orders/:id/pause`
- `POST /api/meta/orders/:id/resume`

同步內容：

- Ad 狀態：`/{ad_id}`
- Ad insights：`/{ad_id}/insights`
- 貼文追蹤指標：Facebook post / Instagram media metrics
- 變體成效：spend、目前成效、proxy ROAS
- 達標停投：若 `targetValue` 已達成，後端呼叫 pause 並標記 `paused_by_target`

Rate limit 防護：

- 同一 post / ad 成效會快取。
- 每輪同步限制處理筆數：`META_SYNC_MAX_ROWS_PER_RUN`。
- 每筆同步間隔：`META_SYNC_ROW_GAP_MS`。
- 若遇到 rate limit / request limit，會 backoff，不連續重試。

Meta action block 防護：

- 若 Meta 回覆「你已暫時遭禁止執行這個動作」，後端會寫入：`ad_demo_meta_submit_block_v1`。
- 預設冷卻 30 分鐘：`META_ACTION_BLOCK_COOLDOWN_MS`。
- 冷卻期間後端不再送建立廣告請求，避免延長封鎖。

## 7. Meta 相關 shared state / DB keys

SQLite table：`state_entries`

| Key | 用途 | 寫入來源 | 讀取來源 |
| --- | --- | --- | --- |
| `ad_demo_meta_settings_v2` | Meta 設定、ad account、page、IG actor、優化門檻、產業模板 | Settings / server | MetaAdsOrders / server |
| `ad_demo_meta_orders_v1` | Meta 投放案件、變體、同步狀態、停投原因 | server | AdPerformance |
| `ad_demo_meta_sync_status_v1` | Meta 批次同步狀態 | server | AdPerformance |
| `ad_demo_meta_submit_block_v1` | Meta 建立廣告暫時封鎖冷卻狀態 | server | server |
| `ad_demo_meta_oauth_state_v1` | OAuth state 暫存 | server | server callback |

另外：

- `meta_tracking_cache` table 用於貼文連結解析快取。

## 8. 供應商 HDZ API

目前已加入第四個供應商：HDZ。

設定位置：

- `src/config/appConfig.ts`
- `src/pages/Settings.tsx`
- `server/shared-api.js`
- `server/vendor-local.example.json`

預設 base URL：

```text
https://www.hdsrdmp.com/api/v2
```

API 格式與 SMM panel 類型相同：

- 查詢服務：`POST action=services`
- 新增訂單：`POST action=add`
- 訂單狀態：`POST action=status`
- 查詢餘額：`POST action=balance`

後端處理：

- `DEFAULT_VENDOR_BASES.hdz`
- `isVendorKey()` 已包含 `hdz`
- `vendorApiStatusPayload()` 中 HDZ status 查詢使用 `order` 參數，與 SMM Raja 類型一致。

前端影響：

- 控制設定可設定 HDZ API Key。
- 可載入 HDZ services。
- 品項對應可選 HDZ 作為供應商。
- 廠商互動下單可依拆單策略將訂單送到 HDZ。

## 9. 廠商投廣追加投遞功能

控制設定位置：`#/settings` → `品項對應` → 每個品項的 `追加設定`

主要用途：

- 當某個品項完成後，固定追加一筆供應商訂單。
- 例如 Facebook 貼文讚完成後，自動追加 150 個特定供應商服務。

資料結構：

- 每個 placement 可設定：`appendOnComplete`
- 主要欄位：
  - `enabled`
  - `vendor`
  - `serviceId`
  - `quantity`

前端設定檔：

- `src/config/appConfig.ts`
- `src/pages/Settings.tsx`

下單時：

- `src/pages/AdOrders.tsx` 會把當下品項的 `appendOnComplete` 帶入 line。
- `POST /api/vendor/submit-order` 建立訂單時會保留此設定。

後端同步邏輯：`server/shared-api.js`

- `maybeHandleLineAppend(line, links)`
- `refreshAppendExecStatus(appendExec)`
- `isAppendCompleted(appendExec)`

觸發規則：

- 單次下單：主批次完成後觸發。
- 平均下單：最後一批完成後才觸發。
- 若主訂單 partial / failed，不視為正常完成，不應自動追加。
- 追加訂單會寫入 line 的 `appendExec`。

成效頁顯示：

- `src/pages/AdPerformance.tsx`
- 會顯示：
  - `追加：待觸發`
  - `追加：執行中`
  - `追加：已完成`
  - `追加失敗：...`

## 10. 主要檔案關係

| 功能 | 前端檔案 | 後端 / 資料檔 |
| --- | --- | --- |
| Meta 設定 | `src/components/MetaSettingsCard.tsx` | `server/shared-api.js`, `data/meta-local-secrets.json` |
| Meta 產業策略 | `src/components/MetaStrategySettingsCard.tsx`, `src/config/metaPresetConfig.ts` | `ad_demo_meta_settings_v2` |
| Meta 下單 | `src/pages/MetaAdsOrders.tsx` | `POST /api/meta/orders`, `createMetaOrderSecure()` |
| Meta 成效 | `src/pages/AdPerformance.tsx` | `syncSharedMetaOrders()` |
| 廠商下單 | `src/pages/AdOrders.tsx` | `POST /api/vendor/submit-order` |
| 廠商同步 | `src/pages/AdPerformance.tsx` | `POST /api/vendor/sync-shared-orders` |
| 追加投遞 | `src/pages/Settings.tsx`, `src/pages/AdPerformance.tsx` | `maybeHandleLineAppend()` |
| HDZ 供應商 | `src/config/appConfig.ts`, `src/pages/Settings.tsx` | `DEFAULT_VENDOR_BASES`, `vendor-local-secrets.json` |

## 11. 修改時的回歸測試清單

每次修改 Meta 或供應商流程後至少跑：

```bash
npm run check:encoding
npm run typecheck
npm run build
node --check server/shared-api.js
```

功能測試：

1. 本機 API 健康檢查：`GET /api/health`
2. 控制設定可儲存 Meta 設定，且不回傳完整 token。
3. `GET /api/meta/accounts` 可列出 ad account / page / IG account。
4. 貼文驗證成功後才能進下一步。
5. Meta 送出時 Campaign / Ad Set 都包含 `is_adset_budget_sharing_enabled=false`。
6. Meta 送出後預設狀態為 `PAUSED`。
7. 若 Meta action block，系統進入冷卻，不連續重送。
8. HDZ 可載入服務、查餘額、被品項對應選用。
9. 追加投遞只在主訂單完成後觸發，平均模式只在最後一批完成後觸發。
10. 投放成效頁能顯示廠商與 Meta 訂單狀態。

## 12. 禁止事項

- 不可把完整 Meta token、App Secret、供應商 API Key 寫入 repo。
- 不可讓前端直接呼叫 Meta Marketing API 建立廣告。
- 不可在 action block / rate limit 時無限制重試。
- 不可把 Graph API raw payload 顯示給一般使用者。
