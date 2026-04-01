# Function 關係圖與修改影響矩陣

本文件的目標是讓後續修改者快速判斷「改一個 function 會影響哪些功能」。

## 1. 分層結構
| 層級 | 主要檔案 | 責任 |
| --- | --- | --- |
| 頁面層 | `src/pages/*.tsx` | UI、表單驗證、觸發流程 |
| 前端領域層 | `src/lib/*.ts`、`src/config/*.ts` | 規則、payload、資料存取、同步 |
| 後端 API 層 | `server/shared-api.js` | DB 存取、排程、供應商/Meta 代理 |
| 外部服務層 | Vendor API、Meta Graph API | 實際下單與成效來源 |

## 2. 主要功能流程（Function 鏈）

### 2.1 廠商互動下單
1. `src/pages/AdOrders.tsx`
2. `validateDraft`
3. `src/lib/orderSchedule.ts`
- `buildInstantBatches`
- `buildAverageBatches`
4. `POST /api/vendor/submit-order`
5. `server/shared-api.js`
- `submitBatch`
- `submitVendorSplit`
- `buildLineFromBatches`
6. 寫入 `ad_demo_orders_v1`
7. `src/pages/AdPerformance.tsx` 顯示進度

### 2.2 廠商進度同步
1. `AdPerformance.tsx` 觸發同步
2. `POST /api/vendor/sync-shared-orders`
3. `server/shared-api.js`：
- `syncSharedOrders`
- `maybeHandleLineAppend`
4. 更新 `ad_demo_orders_v1`

### 2.3 Meta 官方投廣下單
1. `src/pages/MetaAdsOrders.tsx`
2. `validate` + `resolveMetaPostReference`
3. `src/lib/metaPayload.ts`：`buildMetaPayloads`
4. `src/lib/metaGraphApi.ts`：`submitMetaOrderToGraph`
5. 更新 `ad_demo_meta_orders_v1`
6. `AdPerformance.tsx` 顯示 Meta 進度

### 2.4 Meta 成效同步與停投
1. `AdPerformance.tsx` 觸發
2. `POST /api/meta/sync-shared-orders`
3. `server/shared-api.js`：
- `syncSharedMetaOrders`
- `buildMetaPerformance`
- `updateMetaAdDeliverySecure`（停投/啟用）
4. 更新：
- `ad_demo_meta_orders_v1`
- `ad_demo_meta_sync_status_v1`

### 2.5 多人共享同步
1. `src/lib/sharedSync.ts`
- `queueSharedWrite`
- `postBatch`
- `pullSharedState`
2. `POST /api/state/batch` / `GET /api/state`
3. `state_meta.revision` 更新與比對

## 3. 高影響函式清單
| 檔案 | 函式 | 影響範圍 |
| --- | --- | --- |
| `src/lib/metaOrderCapabilities.ts` | `getConversionLocationOptions`、`needsPixelSetup`、`needsAppSetup` | Meta 表單顯示與驗證規則 |
| `src/lib/metaPayload.ts` | `buildMetaPayloads` | Graph API 送單格式 |
| `src/lib/orderSchedule.ts` | `buildAverageBatches` | 平均排程拆批 |
| `src/lib/split.ts` | `planSplit` | 廠商拆單比例與數量 |
| `src/lib/sharedSync.ts` | `pullSharedState`、`postBatch` | 多人資料一致性 |
| `server/shared-api.js` | `submitBatch`、`syncSharedOrders`、`syncSharedMetaOrders` | 真實送單與同步核心 |
| `server/shared-api.js` | `resolveTrackingFromUrl`、`resolveMetaPostSecure` | 貼文連結解析與追蹤 |

## 4. 修改影響矩陣
| 想修改的功能 | 必須一併檢查 |
| --- | --- |
| 下單欄位新增/刪除 | `AdOrders.tsx`、`validateDraft`、`/api/vendor/submit-order`、`ad_demo_orders_v1` 結構 |
| 平均排程規則 | `orderSchedule.ts`、背景排程、成效頁顯示 |
| 拆單策略 | `split.ts`、`submitBatch`、重試批次邏輯、成本顯示 |
| Meta KPI/轉換位置規則 | `metaOrderCapabilities.ts`、`MetaAdsOrders.tsx`、`metaPayload.ts` |
| Meta payload 欄位 | `metaPayload.ts`、`submitMetaOrderToGraph`、`syncSharedMetaOrders` |
| 多人同步異常 | `sharedSync.ts`、`/api/state`、`state_meta.revision` |
| 成效欄位調整 | `AdPerformance.tsx`、`buildMetaPerformance`、`metaGraphApi.ts` |

## 5. 安全邊界（不可破壞）
- token/key 不可回傳到前端可見資料。
- 前端不可直接呼叫供應商或 Meta 私密 API。
- 任何寫入 shared state 的流程都要維持 revision 更新。

## 6. 建議回歸測試順序
1. `npm run check:encoding`
2. `npm run build`
3. 廠商下單（一次 + 平均）
4. 廠商同步、失敗重試、追加設定
5. Meta 下單（驗證貼文、送單、同步）
6. 多裝置同時開頁面檢查資料一致性
