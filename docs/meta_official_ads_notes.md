# Meta 官方投放功能說明（第一版）

## 已實作頁面
- `#/meta-ads-orders`：建立 Meta 投放（UI + payload + 送出）
- `#/meta-ads-performance`：檢視送出結果與同步狀態
- `#/settings`：新增 Meta 設定區塊（模式、API 版本、帳號、Page/IG Actor、Token）

## 已支援的投放目標
- Facebook 貼文讚
- Facebook 互動
- Facebook 觸及
- Facebook 影片觀看
- Instagram 貼文擴散
- Instagram Reels 擴散
- Instagram 影片觀看
- Instagram 互動
- Instagram 帳號增粉（以個人檔案造訪為主要優化方向）

## 實作模式
- 模擬模式（`simulate`）：不打 Meta API，回傳模擬 id 與流程 log。
- 正式模式（`live`）：會依序呼叫：
  1. `POST /act_{ad_account_id}/campaigns`
  2. `POST /act_{ad_account_id}/adsets`
  3. `POST /act_{ad_account_id}/adcreatives`
  4. `POST /act_{ad_account_id}/ads`

## 第一版關鍵假設
- 目標映射採官方 SDK 可用 enum（objective / optimization_goal）做模板。
- 先支援「既有貼文」或「連結廣告」兩種創意來源。
- 受眾先以基本條件為主（國家、年齡、性別），進階 audience 先保留。

## 進入正式上線前，建議再補的需求
1. 每個目標對應的最終 KPI 定義（例如：互動要算留言+分享+按讚，或只算按讚）
2. 各目標的預設版位策略（Feed/Reels/Story/Explore）與是否允許手動覆蓋
3. 預算規則（最低日預算、幣別、是否允許 lifetime budget）
4. 內容素材規範（必填欄位、文案長度、圖片/影片規格、CTA 白名單）
5. 正式權限與金鑰策略（System User、長期 token、更新流程、權限最小化）
6. 成效同步頻率與欄位（impressions/reach/clicks/spend/results）
7. 失敗重試策略（API 失敗時是否自動重送、最多重試次數）
8. 審核/上線流程（送出前是否需主管核准）
