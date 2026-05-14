# Meta 官方投廣技術指南

最後更新：2026-05-15  
適用 repo：`CarsonCCHsieh/ad-procurement-demo`

本文件整理目前 demo 站 Meta 官方投廣的前端流程、後端 API、Graph API 呼叫、資料儲存、同步排程、達標停投與未來轉移到 `JuksyHRAdmin/jusky-erp-ad` / 正式站時的注意事項。

## 1. 系統邊界

| 項目 | 現況 |
| --- | --- |
| 前端 | React + TypeScript + Vite，部署在 GitHub Pages。 |
| 後端 | 本機 Node API，入口 `server/shared-api.js`。 |
| DB | SQLite `data/shared-demo.sqlite`。 |
| Secrets | `data/meta-local-secrets.json`，不進 Git。 |
| 正式化方向 | `jusky-erp-ad` 應改用 Lovable server / Supabase Edge Functions / Supabase Storage 或 DB。 |
| 正式站參考 | `juksysmallerp` 只讀參考，不要直接修改。 |

## 2. 前端功能與檔案

### 2.1 Meta 官方投廣頁

檔案：`src/pages/MetaAdsOrders.tsx`  
路由：`#/meta-ads-orders`

目前為四步驟工作流：

1. 投放目標
   - 申請人、任務名稱、產業、投遞方式、Campaign Objective、Performance Goal、日預算、目標數值、起訖時間。
   - 任務名稱會帶入 Campaign / Ad Set / Ad 命名。
   - 投遞方式：`direct` 建立單一 ad set / ad；`optimized` 建立多組變體，後續以 proxy ROAS 判斷。
2. 貼文驗證
   - 使用者貼 Facebook / Instagram / Reels 單篇連結。
   - 前端呼叫 `POST /api/meta/resolve-post`。
   - 成功後取得 platform、post id、canonical id、permalink、發布時間、文案。
   - 未驗證成功不可進入下一步。
3. 受眾與版位
   - 套用產業模板。
   - 可用文字補充 TA 方向，後端用 Meta Targeting Search 搜尋可投遞 interest。
   - Facebook / Instagram 版位預設不勾選，由使用者確認。
4. 確認送出
   - 顯示摘要，不對一般使用者顯示 raw payload。
   - 呼叫 `POST /api/meta/orders`。
   - 建立成功後預設為 `PAUSED`，使用者需到投放成效頁確認後開始投遞。

### 2.2 投放成效頁

檔案：`src/pages/AdPerformance.tsx`  
路由：`#/ad-performance`

Meta 區塊功能：

- 顯示申請人、案件名、目標、預算、目前狀態、成立時間、目標進度、操作、備註。
- 操作包含同步、開始投遞、暫停。
- 開始 / 暫停不是只改 Ad，而是由後端同步更新 Campaign、Ad Set、Ad。
- 若成效達標，後端會自動暫停整棵投放樹並標示停投原因。

### 2.3 Meta 基本設定

檔案：`src/components/MetaSettingsCard.tsx`  
頁面：`#/settings`

功能：

- 設定 Meta App ID / App Secret / Redirect URI / Login Configuration ID。
- OAuth 登入取得長效 User Token。
- 短效 User Token 交換長效 token。
- 支援共用 User Token，也支援 Ads / Facebook / Instagram 專用 token 覆蓋。
- 載入可用廣告帳號、Facebook Page、Instagram 帳號。
- 驗證 token，但不回傳完整 token 到前端。

### 2.4 Meta 投放策略設定

檔案：`src/components/MetaStrategySettingsCard.tsx`  
設定來源：`src/config/metaPresetConfig.ts`

功能：管理預設廣告帳號、29 個產業模板、年齡、性別、地區、版位、interest 搜尋方向、儲備受眾、排除受眾、A/B 優化門檻。

## 3. 後端 API

所有 API 位於 `server/shared-api.js`。

| API | 方法 | 用途 | 回傳完整 token |
| --- | --- | --- | --- |
| `/api/meta/settings` | GET | 讀取公開 Meta 設定與遮罩 token 狀態 | 否 |
| `/api/meta/settings` | POST | 儲存 Meta App、token、帳號、Page、IG actor、模板設定 | 否 |
| `/api/meta/token/status` | GET | 用 `/debug_token` 檢查 token 狀態 | 否 |
| `/api/meta/oauth/start` | GET | 建立 Meta OAuth 授權 URL | 否 |
| `/api/meta/oauth/callback` | GET | OAuth callback，交換長效 token | 否 |
| `/api/meta/token/exchange-short-lived` | POST | 短效 User Token 交換長效 token | 否 |
| `/api/meta/disconnect` | POST | 清除所有 Meta token | 否 |
| `/api/meta/accounts` | GET | 載入 ad accounts / pages / IG accounts | 否 |
| `/api/meta/assets` | GET | `/api/meta/accounts` 相容別名 | 否 |
| `/api/meta/verify-token` | POST | 驗證 User / Ads / Facebook / Instagram token | 否 |
| `/api/meta/resolve-audience` | POST | 文字 TA 方向轉 Meta interest | 否 |
| `/api/meta/resolve-post` | POST / GET | 解析 Facebook / Instagram 貼文 | 否 |
| `/api/meta/post-metrics` | GET | 查詢貼文指標 | 否 |
| `/api/meta/orders` | GET | 讀取 Meta 投放案件 | 否 |
| `/api/meta/orders` | POST | 建立 Campaign / Ad Set / Creative / Ad | 否 |
| `/api/meta/orders/:id/sync` | POST | 同步單筆案件，實作上會跑一次 shared sync 並包含該案件 | 否 |
| `/api/meta/sync-shared-orders` | POST | 批次同步 Meta 案件 | 否 |
| `/api/meta/orders/:id/pause` | POST | 暫停 Campaign / Ad Set / Ad | 否 |
| `/api/meta/orders/:id/resume` | POST | 啟用 Campaign / Ad Set / Ad | 否 |

## 4. 後端核心 functions

| Function | 責任 |
| --- | --- |
| `loadMetaSecrets()` | 讀取 `data/meta-local-secrets.json`。 |
| `saveMetaSecretsPatch()` | 更新 secrets，避免覆蓋未修改欄位。 |
| `readMetaSettings()` | 讀取 `ad_demo_meta_settings_v2`。 |
| `publicMetaSettings()` | 產生前端可看的設定，遮罩 token。 |
| `getMetaToken()` | 依用途取得 token。 |
| `getMetaTokenCandidates()` | 依用途取得 token 候選順序，支援 User fallback。 |
| `saveLongLivedMetaToken()` | 儲存長效 token，可指定 user / ads / facebook / instagram。 |
| `verifyMetaToken()` | 驗證 token 是否可用。 |
| `listMetaSelectableAccounts()` | 列出可用廣告帳號、Page、IG 帳號。 |
| `resolveMetaPostSecure()` | 安全解析貼文 URL，不暴露 token。 |
| `fetchMetaPostMetricsSecure()` | 取得 Facebook / Instagram 貼文成效，含快取與 backoff。 |
| `resolveMetaAudienceInterestsForInput()` | 將文字 TA 方向轉為可投遞 interest。 |
| `createMetaOrderSecure()` | 建立 Meta 投放物件並寫入 shared state。 |
| `fetchMetaAdSnapshotSecure()` | 查詢 ad status 與 insights。 |
| `syncSharedMetaOrders()` | 批次同步、A/B 判斷、達標停投。 |
| `updateMetaDeliveryObjectSecure()` | 更新單一 Campaign / Ad Set / Ad 狀態。 |
| `collectMetaDeliveryObjectIds()` | 從 order / variants 收集 Campaign、Ad Set、Ad ID。 |
| `updateMetaOrderDeliveryTreeSecure()` | 依正確順序啟用或暫停 Campaign / Ad Set / Ad。 |

## 5. Meta Graph API 呼叫

### 5.1 建立投放

由 `createMetaOrderSecure()` 執行：

1. Campaign：`POST /act_{ad_account_id}/campaigns`
2. Ad Set：`POST /act_{ad_account_id}/adsets`
3. Creative：`POST /act_{ad_account_id}/adcreatives`
4. Ad：`POST /act_{ad_account_id}/ads`

建立時預設 `status=PAUSED`，避免測試誤投。

### 5.2 開始與暫停

由 `updateMetaOrderDeliveryTreeSecure()` 執行：

- 開始投遞：Campaign -> Ad Set -> Ad 全部改 `ACTIVE`。
- 暫停投遞：Ad -> Ad Set -> Campaign 全部改 `PAUSED`。

這是必要設計，因為只啟用 Ad 而 Campaign / Ad Set 仍關閉時，廣告不會實際投遞。

### 5.3 成效同步

- Ad status：`GET /{ad_id}?fields=id,name,status,effective_status,updated_time`
- Ad insights：`GET /{ad_id}/insights`
- Facebook post metrics：Page token + Page/Post insights 或 engagement fields。
- Instagram media metrics：IG media fields / insights。

### 5.4 貼文解析

解析順序包含：URL pattern、Facebook public metadata / HTML fallback、Page token 掃描 Page feed / posts、Instagram shortcode / media lookup。若 URL 本身無法直接取得 canonical id，系統會嘗試用 Page / IG token 找到可用 ID。

## 6. Meta API 重要限制與已處理事項

- 未使用 Campaign Budget 時，Campaign / Ad Set 需傳 `is_adset_budget_sharing_enabled=False`。
- Graph API form boolean 必須轉成 Meta 可接受格式：`True` / `False`。
- `instagram_actor_id` 不可放在 `promoted_object`，應放在 Creative 層。
- 台灣投放需帶 `regional_regulated_categories=[TAIWAN_UNIVERSAL]`。
- 台灣廣告主 / 出資者若 Meta 要求，需使用帳號預設或管理員設定。
- 遇到 action block 時寫入 `ad_demo_meta_submit_block_v1`，進入冷卻，不連續重送。
- 建立時可能成功建立 Campaign / Ad Set 但 Creative / Ad 失敗；後端會盡量清理已建立物件，仍需在 Ads Manager 檢查殘留。

## 7. KPI 與達標停投

同步時：

1. 依 Performance Goal 決定主要 metric。
2. 從 ad insights 與 post metrics 取得目前值。
3. 寫回 `ad_demo_meta_orders_v1`。
4. 若 `current >= targetValue`，呼叫 `updateMetaOrderDeliveryTreeSecure(..., 'PAUSED')`，狀態改為達標停投並寫入原因。

| 成效目標類型 | 主要追蹤 |
| --- | --- |
| 觸及 | reach |
| 曝光 | impressions |
| 點擊 / 流量 | clicks、link_clicks |
| 貼文互動 | likes、comments、shares、post_engagement |
| 影片觀看 | video views / ThruPlay / 3 秒觀看，依 Graph API 可用欄位回傳為準 |
| IG profile | profile visits，依 IG 權限與物件支援度為準 |

## 8. A/B testing 與 proxy ROAS

投遞模式為 AI 優化投遞時，系統會建立多組變體。每次同步會更新 spend 與目標成效。Proxy ROAS = 目標成效 / spend。達到最小花費與最小樣本後，低於勝出組一定比例的變體會被暫停。目前這是代理 ROAS；未串 Pixel / CAPI / 營收前，不等同真 ROAS。

## 9. Rate limit 與重試策略

- 同一 post / ad 的成效快取至少 5 分鐘。
- 每輪同步限制案件數與每筆間隔。
- 遇到 rate limit / request limit / temporary block 時進入 backoff。
- UI 顯示最近同步時間與簡化錯誤，不顯示 token、完整 stack 或過長 Graph error。
- 不做無限制重試，避免觸發 Meta 風控。

## 10. 資料儲存

| Key / 檔案 | 用途 |
| --- | --- |
| `ad_demo_meta_settings_v2` | Meta 設定、帳號、Page、IG actor、模板、優化門檻；不含完整 token。 |
| `ad_demo_meta_orders_v1` | Meta 案件、變體、Graph 建立結果、成效、停投狀態。 |
| `ad_demo_meta_sync_status_v1` | 最近同步時間、同步結果。 |
| `ad_demo_meta_submit_block_v1` | Meta action block 冷卻狀態。 |
| `ad_demo_meta_oauth_state_v1` | OAuth state 暫存。 |
| `data/meta-local-secrets.json` | Meta App Secret、User / Ads / Facebook / Instagram token、Page token cache。 |
| `server/meta-local.example.json` | secrets 範例，不含真實 token。 |

## 11. 轉移到 jusky-erp-ad / 正式站注意事項

| demo | 中繼 / 正式建議 |
| --- | --- |
| `server/shared-api.js` | Supabase Edge Functions 或 Lovable server。 |
| `data/meta-local-secrets.json` | Supabase Secrets / server secret manager。 |
| `state_entries` shared state | Supabase Storage JSON 或 `ad_procurement` schema tables。 |
| `/api/meta/*` | `meta-proxy`、`ad-procurement-sync` 或新增 `meta-order-proxy`。 |
| 本機 setInterval / 手動同步 | Supabase scheduled function / cron。 |

轉移原則：前端不可持有完整 Meta token；建立 Campaign / Ad Set / Creative / Ad 必須在 server-side function 執行；OAuth state 不建議放前端可讀 Storage；達標停投必須暫停 Campaign、Ad Set、Ad；若使用 Supabase table，建議保留 JSONB payload。

## 12. 回歸測試

```bash
npm run check:encoding
npm run typecheck
npm run build
node --check server/shared-api.js
```

功能測試：控制設定儲存、帳號載入、貼文驗證、建立 PAUSED 投放、成效頁看到新案件、開始投遞三層 ACTIVE、暫停三層 PAUSED、同步 KPI、達標自動停投、rate limit 不連續重試。

## 13. 禁止事項

- 不可把完整 token、App Secret、供應商 API Key 寫入 repo。
- 不可讓一般使用者看到 raw payload、Graph API stack trace 或完整錯誤 URL。
- 不可讓前端直接打 Meta Marketing API 建立或控制廣告。
- 不可在 rate limit / action block 時無限制重試。