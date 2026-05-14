# Function 關係圖與修改影響矩陣

本文件用來協助後續維護者判斷「修改某個 function 會影響哪些功能」。

## 1. 分層結構

| 層級 | 主要檔案 | 責任 |
| --- | --- | --- |
| 頁面層 | `src/pages/*.tsx` | UI、表單驗證、流程控制。 |
| 前端領域層 | `src/lib/*.ts`、`src/config/*.ts` | 規則、payload、資料存取、同步封裝。 |
| 後端 API 層 | `server/shared-api.js` | DB 存取、排程、供應商 / Meta 代理。 |
| 外部服務層 | Vendor API、Meta Graph API | 實際下單、建立投放、查詢成效。 |

## 2. 廠商互動下單流程

1. `src/pages/AdOrders.tsx`：建立訂單、欄位驗證。
2. `src/lib/orderSchedule.ts`：`buildInstantBatches`、`buildAverageBatches`。
3. `POST /api/vendor/submit-order`。
4. `server/shared-api.js`：`submitBatch`、`submitVendorSplit`、`buildLineFromBatches`。
5. 寫入 `ad_demo_orders_v1`。
6. `src/pages/AdPerformance.tsx` 顯示進度。

## 3. 廠商進度同步與追加投遞

1. `AdPerformance.tsx` 觸發同步。
2. `POST /api/vendor/sync-shared-orders`。
3. `server/shared-api.js`：`syncSharedOrders`、`maybeHandleLineAppend`、`refreshAppendExecStatus`、`isAppendCompleted`。
4. 更新 `ad_demo_orders_v1`。

修改影響：

- 改 `buildAverageBatches` 會影響平均排程日期、每天數量、每天追加觸發。
- 改 `maybeHandleLineAppend` 會影響追加投遞是否重複觸發或漏觸發。
- 改 vendor status mapping 會影響 Completed / Partial / Failed 判定。

## 4. Meta 官方投廣下單

1. `src/pages/MetaAdsOrders.tsx`：四步驟 UI。
2. `POST /api/meta/resolve-post`：貼文驗證。
3. `POST /api/meta/resolve-audience`：TA 文字補充。
4. `POST /api/meta/orders`。
5. `server/shared-api.js`：`createMetaOrderSecure`、`resolveMetaAudienceInterestsForInput`、`resolveMetaPostSecure`。
6. 寫入 `ad_demo_meta_orders_v1`。

修改影響：

- 改 `src/lib/metaGoals.ts` 會影響 Objective / Performance Goal 可選項與 KPI 對應。
- 改 `src/lib/metaPayload.ts` 或後端 payload 組裝會影響 Meta API 是否能建立成功。
- 改 `resolveMetaPostSecure` 會影響 Facebook / Instagram 貼文驗證與後續成效追蹤。

## 5. Meta 成效同步、開始、暫停、達標停投

1. `AdPerformance.tsx`：使用者操作同步 / 開始 / 暫停。
2. 後端 API：`POST /api/meta/orders/:id/sync`、`POST /api/meta/sync-shared-orders`、`POST /api/meta/orders/:id/resume`、`POST /api/meta/orders/:id/pause`。
3. `server/shared-api.js`：`syncSharedMetaOrders`、`fetchMetaAdSnapshotSecure`、`fetchMetaPostMetricsSecure`、`updateMetaOrderDeliveryTreeSecure`。
4. 更新 `ad_demo_meta_orders_v1` 與 `ad_demo_meta_sync_status_v1`。

重要：開始投遞必須讓 Campaign、Ad Set、Ad 都變 ACTIVE；暫停與達標停投必須讓三者都變 PAUSED。

## 6. Meta Token 與帳號管理

1. `src/components/MetaSettingsCard.tsx`：設定 UI。
2. `GET /api/meta/oauth/start` / `GET /api/meta/oauth/callback`：OAuth。
3. `POST /api/meta/token/exchange-short-lived`：短效換長效。
4. `GET /api/meta/accounts`：載入可用 assets。
5. `server/shared-api.js`：`getMetaToken`、`getMetaTokenCandidates`、`saveLongLivedMetaToken`、`listMetaSelectableAccounts`。

修改影響：

- 改 token precedence 會影響投放建立與貼文成效讀取使用哪一把 token。
- 改帳號載入邏輯會影響管理員能否選到正確 Page / IG / Ad Account。

## 7. 高風險修改清單

| 想修改的功能 | 必須一起檢查 |
| --- | --- |
| Meta payload | `createMetaOrderSecure`、Meta API v24 限制、台灣管制欄位、Creative 層欄位。 |
| Meta 開始 / 暫停 | Campaign / Ad Set / Ad 三層 status 是否一致。 |
| Meta KPI | `metaGoals.ts`、`buildMetaPerformance`、`buildMetaTargetProgress`。 |
| 貼文解析 | Facebook pfbid、Page scoped ID、Instagram shortcode、Page token fallback。 |
| 平均排程 | 日期拆分、到期送單、每日追加投遞。 |
| 供應商 status | Completed / Partial / Insufficient balance / Failed 對 UI 與追加投遞的影響。 |
| shared state | `readSharedJson`、`writeSharedJson`、revision、多人同步。 |

## 8. 回歸檢查

```bash
npm run check:encoding
npm run typecheck
npm run build
node --check server/shared-api.js
```

功能面至少檢查：廠商一次性下單、廠商平均排程、追加投遞、HDZ、Meta token、貼文驗證、Meta 建立投放、Meta 開始 / 暫停三層狀態、Meta 成效同步與達標停投。