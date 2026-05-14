# Meta 官方投廣與廠商投廣技術交接文件

最後更新：2026-05-15  
適用 repo：`CarsonCCHsieh/ad-procurement-demo`

本文件供後續 RD 了解 demo 站最新功能，並將功能移植到 `JuksyHRAdmin/jusky-erp-ad`。`JuksyHRAdmin/juksysmallerp` 是正式站參考，除非另有授權，不要修改。

## 1. 功能總覽

| 模組 | 現況 |
| --- | --- |
| 廠商互動下單 | 支援一次性與平均排程。 |
| 供應商 | SMM Raja、Urpanel、JustAnotherPanel、HDZ。 |
| 追加投遞 | 每個品項可設定完成後自動追加指定供應商服務。平均排程時，每日批次完成後各自追加。 |
| 投放成效 | 同頁顯示廠商互動與 Meta 官方投廣成效。 |
| Meta 官方投廣 | 可建立 Campaign / Ad Set / Creative / Ad，預設 PAUSED。 |
| Meta 開始 / 暫停 | 後端會同時更新 Campaign、Ad Set、Ad。 |
| Meta 成效同步 | 支援 ad insights、Facebook post metrics、Instagram media metrics。 |
| 達標停投 | 目標數值達成後自動暫停整棵投放樹。 |
| Token 管理 | 支援共用 User Token 與 Ads / Facebook / Instagram 專用 token。 |

## 2. Meta 官方投廣流程

主要檔案：

- `src/pages/MetaAdsOrders.tsx`：投放流程 UI。
- `src/pages/AdPerformance.tsx`：成效報表、同步、開始、暫停。
- `src/components/MetaSettingsCard.tsx`：token、OAuth、帳號載入。
- `src/components/MetaStrategySettingsCard.tsx`：產業模板、受眾、A/B 門檻。
- `src/lib/metaPayload.ts`：payload builder。
- `src/lib/metaGoals.ts`：Meta Objective / Performance Goal 對應。
- `src/lib/metaOrderCapabilities.ts`：目標、轉換位置、KPI 顯示規則。
- `server/shared-api.js`：所有 Meta server-side API 與 Graph API 呼叫。

送出流程：

1. 使用者填寫投放目標。
2. 使用者貼上 post link 並驗證。
3. 套用產業模板並補充 TA。
4. 後端建立 Campaign / Ad Set / Creative / Ad。
5. 成功後寫入 `ad_demo_meta_orders_v1`。
6. 使用者到投放成效頁確認後按「開始投遞」。

## 3. Meta API / Function 對照

| 行為 | Frontend | Backend API | Backend function | Graph API |
| --- | --- | --- | --- | --- |
| 讀設定 | `MetaSettingsCard` | `GET /api/meta/settings` | `publicMetaSettings` | - |
| 存設定 | `MetaSettingsCard` | `POST /api/meta/settings` | `saveMetaSecretsPatch` / `readMetaSettings` | - |
| OAuth 開始 | `MetaSettingsCard` | `GET /api/meta/oauth/start` | OAuth helpers | Meta OAuth dialog |
| OAuth callback | Browser redirect | `GET /api/meta/oauth/callback` | `saveLongLivedMetaToken` | `/oauth/access_token` |
| 短效換長效 | `MetaSettingsCard` | `POST /api/meta/token/exchange-short-lived` | `exchangeShortLivedMetaToken` | `/oauth/access_token` |
| 載入帳號 | `MetaSettingsCard` | `GET /api/meta/accounts` | `listMetaSelectableAccounts` | `/me/adaccounts`, `/me/accounts`, business edges |
| 驗證貼文 | `MetaAdsOrders` | `POST /api/meta/resolve-post` | `resolveMetaPostSecure` | Page / IG media APIs |
| 補充 TA | `MetaAdsOrders` | `POST /api/meta/resolve-audience` | `resolveMetaAudienceInterestsForInput` | `/search?type=adinterest` |
| 建立投放 | `MetaAdsOrders` | `POST /api/meta/orders` | `createMetaOrderSecure` | Campaigns / Adsets / Adcreatives / Ads |
| 單筆同步 | `AdPerformance` | `POST /api/meta/orders/:id/sync` | `syncSharedMetaOrders` | Ad insights / post metrics |
| 全部同步 | `AdPerformance` | `POST /api/meta/sync-shared-orders` | `syncSharedMetaOrders` | Ad insights / post metrics |
| 開始投遞 | `AdPerformance` | `POST /api/meta/orders/:id/resume` | `updateMetaOrderDeliveryTreeSecure` | `/{campaign|adset|ad}` status ACTIVE |
| 暫停投遞 | `AdPerformance` | `POST /api/meta/orders/:id/pause` | `updateMetaOrderDeliveryTreeSecure` | `/{ad|adset|campaign}` status PAUSED |

完整 Meta 文件請看：`docs/META_ADS_TECHNICAL_GUIDE_ZH_TW.md`。

## 4. HDZ 供應商

HDZ 已接入 demo：

- Base URL：`https://www.hdsrdmp.com/api/v2`。
- API 格式：SMM panel 類型。
- 支援：
  - `action=services`：查詢服務。
  - `action=add`：新增訂單。
  - `action=status`：查詢訂單狀態。
  - `action=balance`：查詢餘額。

相關檔案：

- `src/config/appConfig.ts`：VendorKey / 預設供應商。
- `src/pages/Settings.tsx`：控制設定 UI。
- `server/shared-api.js`：後端代理與 status payload。
- `server/vendor-local.example.json`：本機 secrets 範例。

## 5. 追加投遞

用途：某個品項完成後，自動追加另一筆指定供應商服務，例如 Facebook 貼文讚完成後追加 150 個特定服務。

設定欄位：

- `enabled`：是否啟用。
- `vendor`：供應商。
- `serviceId`：追加服務 ID。
- `quantity`：追加數量。

主要 functions：

- `maybeHandleLineAppend(line, links)`：主批次完成後判斷是否要追加。
- `refreshAppendExecStatus(appendExec)`：同步追加訂單狀態。
- `isAppendCompleted(appendExec)`：判斷追加是否完成。

規則：

- 一次性下單：主批次完成後追加。
- 平均排程：每天批次完成後各自追加，不等最後一天。
- Partial / failed 不應視為完整完成，不能直接觸發正常追加。
- 成效頁應顯示追加狀態：待觸發、執行中、已完成、失敗。

## 6. 資料儲存

| 類型 | demo 位置 | 正式化建議 |
| --- | --- | --- |
| 供應商設定 | SQLite shared state `ad_demo_config_v1` | Supabase Storage 或 DB settings。 |
| 供應商 API Key | `data/vendor-local-secrets.json` | Supabase Secrets / server secret manager。 |
| 廠商訂單 | SQLite shared state `ad_demo_orders_v1` | `ad_procurement.orders` 或 JSON state。 |
| Meta 設定 | SQLite shared state `ad_demo_meta_settings_v2` | Server-only settings + public masked config。 |
| Meta token | `data/meta-local-secrets.json` | Supabase Secrets / server secret manager。 |
| Meta 訂單 | SQLite shared state `ad_demo_meta_orders_v1` | `ad_procurement.meta_orders` 或 JSON state。 |
| Meta 同步狀態 | `ad_demo_meta_sync_status_v1` | sync status table / settings。 |

## 7. 轉移到 jusky-erp-ad 注意事項

`jusky-erp-ad` 應保留 demo 的功能規格，但連線方式要改為正式架構：

1. 前端使用現有登入，不另做 demo login。
2. 前端不保存完整 token / API Key。
3. 供應商與 Meta 私密呼叫都走 Supabase Functions / Lovable server。
4. 設定與訂單要寫入 Supabase Storage 或 DB，不依賴瀏覽器 localStorage。
5. Meta OAuth、短效換長效、token status、assets loading 必須 server-side。
6. Meta 開始 / 暫停需同步 Campaign、Ad Set、Ad。
7. 達標停投應由排程 function 執行，避免只靠使用者開著頁面。
8. Rate limit / action block 必須 backoff，不可無限重試。

## 8. 必跑檢查

```bash
npm run check:encoding
npm run typecheck
npm run build
node --check server/shared-api.js
```

功能檢查：控制設定儲存、HDZ、追加投遞、Meta assets、貼文驗證、Meta 建立投放、三層開始 / 暫停、KPI 同步、達標停投。