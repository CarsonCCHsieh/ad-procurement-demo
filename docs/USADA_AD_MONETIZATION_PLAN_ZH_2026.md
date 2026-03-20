# USADA 廣告版位與收益規劃報告（2026-03）

最後更新：2026-03-20  
狀態：規劃完成，**尚未部署到正式站**

---

## 1. 目標

這份文件的目的，是先替 `usadanews.com` 設計一套：

- 對桌面版、手機版都可用的廣告版位策略
- 以 **Google AdSense 先上線**、未來可升級到 **Google Ad Manager + Ad Exchange / MCM Partner** 的架構
- 優先追求：
  - 單一版位的高單價潛力
  - 不過度破壞使用者體驗
  - 不讓頁面速度與 SEO 明顯惡化

---

## 2. 結論先講

如果以你目前網站型態（VTuber 資料庫 / 條目頁 / 集合頁 / 手機流量重要）來看，**最值得先做的兩個高價值版位**是：

### 桌面版首選

- **桌面右側 Sticky Half Page**
- 建議主尺寸：
  - `300 x 600`
- 次要相容尺寸：
  - `300 x 250`
  - `160 x 600`

### 手機版首選

- **Mobile Vignette（頁面切換蓋版）**
- 搭配：
  - **Mobile Anchor（底部固定錨定廣告）**
- 若要保守起步，先上：
  - `Vignette + Anchor`
- 若只想先上「一個手機型態」，優先順序：
  1. `Vignette`
  2. `Anchor`

---

## 3. 為什麼是這兩個

## 3.1 桌面版：`300x600` Sticky 右欄

原因：

1. `300x600` 是典型高價值、高可視率展示尺寸之一，適合品牌展示與高 CPM 需求。
2. 如果放在 **個人條目頁 / 集合頁右欄**，能維持高 viewability，而不直接切斷主要內容閱讀。
3. 對 VTuber 條目頁來說，使用者通常會停留較久，右欄 sticky 廣告更容易獲得完整曝光。

適合頁型：

- 單一 VTuber 條目頁
- 組織 / 國家 / 平台集合頁
- 不建議優先放在首頁 hero 最上方，避免破壞品牌首屏

---

## 3.2 手機版：Vignette + Anchor

原因：

1. 手機流量通常佔比較高，且資料庫型網站會有較多「列表 -> 條目 -> 再回列表」的翻頁行為。
2. `Vignette` 屬於高可見度格式，通常比普通 in-content banner 更有機會拉高單次展示價值。
3. `Anchor` 佔用少量畫面、展示穩定，作為手機基礎收益來源很有效。
4. 這兩種都屬於 Google Auto ads 可原生支援的 overlay 格式，實作與 A/B 測試成本最低。

適合頁型：

- 條目頁
- 列表頁
- 搜尋結果頁

注意：

- `Vignette` 不應調得太激進，避免跳出率上升
- 先用 Google Auto ads 的實驗機制驗證，再決定頻率

---

## 4. 不建議一開始就做的版位

以下版位不是不能做，而是**不建議在第一階段就上**：

### 4.1 首頁頂部大橫幅 `970x250`

缺點：

- 會直接吃掉品牌首屏
- 影響首頁視覺質感
- 對目前 USADA 的品牌建立不利

可作為第二階段：

- 首頁 hero 下方、統計區塊與搜尋區之間

### 4.2 太多內文穿插小 banner

缺點：

- 破壞資料庫頁面的整潔
- 會讓條目頁看起來像內容農場
- 若廣告密度太高，可能拖慢 LCP 與體感速度

### 4.3 先上 AdX 專案

目前月流量若只有約 `10,000`，更務實的路線是：

1. 先上 **AdSense**
2. 穩定測數據
3. 等流量 / 頁量 / 內容成熟後，再評估：
   - Google Ad Manager
   - MCM Partner
   - Ad Exchange demand

---

## 5. 建議的版位設計

## 5.1 第一階段：最小可行版本（建議）

### 桌面版

**版位 D1：條目頁 / 列表頁右欄 Sticky**

- 主要尺寸：`300x600`
- 備援尺寸：`300x250`
- 位置：
  - 單一 VTuber 頁右側資訊欄下方或新聞區塊上方
  - 列表頁右側資訊欄（若版面保留右欄）
- 放送方式：
  - Manual ad slot 或 Auto ads side rail

### 手機版

**版位 M1：Vignette**

- 類型：Auto ads overlay
- 觸發情境：
  - 使用者從列表點入條目
  - 條目之間切換
  - 返回列表

**版位 M2：Bottom Anchor**

- 類型：Auto ads overlay
- 尺寸由 Google 自適應
- 適合長時間閱讀與滑動頁面

---

## 5.2 第二階段：優化版本

### 桌面補充版位

**版位 D2：首頁 / 集合頁中段 Billboard**

- 尺寸建議：
  - `970x250`
  - 備援 `970x90` / `728x90`
- 位置：
  - 首頁 hero 區下方
  - 集合頁標題區與卡片列表之間

### 手機補充版位

**版位 M3：內容中 Large Mobile Banner**

- 尺寸建議：
  - `320x100`
  - 備援 `320x50`
- 位置：
  - 條目頁第一段完整介紹後
  - FAQ 前

---

## 6. 實作建議：AdSense 先上，AdX 後上

## 6.1 第一階段：AdSense

最適合目前狀態的做法：

1. 全站插入一份 AdSense code
2. 開啟 Auto ads
3. 先啟用：
   - Anchor ads
   - Vignette ads
   - Side rail ads（桌面）
4. 手動補 1 個高價值桌面 slot（`300x600`）
5. 觀察 2~4 週再決定是否增加中段版位

這樣的好處：

- 導入速度最快
- 不需要先重構版位管理系統
- 對現有 WordPress 與未來自建站都容易搬移

## 6.2 第二階段：Ad Manager / AdX

如果之後流量與內容量提升，可以升級成：

- Google Ad Manager（GAM）當作廣告版位管理層
- 透過 MCM partner 或合規渠道接 Ad Exchange demand

但以目前月流量 `10k` 左右來看，**不建議一開始就主打 AdX**，因為：

- 整體操作成本較高
- 需求競價優勢不一定能立即吃到
- 先把 AdSense 版位、頁面速度、viewability 做好，通常 ROI 更高

---

## 7. 預估收益模型（以月流量 10,000 計）

## 7.1 試算前提

因為你說的是「每月一萬流量」，這裡先用 **10,000 sessions / 月** 估算。

我用三種頁面深度假設：

- 保守：`1.5` pages / session
- 中位：`1.8` pages / session
- 樂觀：`2.2` pages / session

對應月 pageviews：

- 保守：`15,000 PV`
- 中位：`18,000 PV`
- 樂觀：`22,000 PV`

---

## 7.2 收益估算方式

公式：

`月收益 = Pageviews × Page RPM / 1000`

---

## 7.3 建議採用的 RPM 區間

### 情境 A：AdSense 基礎起步

- Page RPM 假設：`US$1.5 ~ US$4`

### 情境 B：AdSense 優化完成（Anchor + Vignette + Desktop 300x600）

- Page RPM 假設：`US$3 ~ US$7`

### 情境 C：後續升級到較成熟 programmatic / AdX partner

- Page RPM 假設：`US$5 ~ US$10`

> 這不是保證值，而是根據目前娛樂 / 遊戲 / VTuber 類內容站常見低個位數到中個位數 Page RPM 區間，加上 Google 官方 Auto ads uplift 案例做出的保守～中位試算。  
> 若流量主要來自日本 / 美國 / 台灣高價值受眾，實際值可能偏高；若以低價區流量為主，則可能偏低。

---

## 7.4 以 10,000 sessions / 月試算

### A. AdSense 基礎起步

| 月 PV | RPM | 月收益（USD） | 月收益（TWD, 1:32） |
|---|---:|---:|---:|
| 15,000 | 1.5 | 22.5 | 約 720 |
| 18,000 | 2.5 | 45 | 約 1,440 |
| 22,000 | 4 | 88 | 約 2,816 |

### B. AdSense 優化完成

| 月 PV | RPM | 月收益（USD） | 月收益（TWD, 1:32） |
|---|---:|---:|---:|
| 15,000 | 3 | 45 | 約 1,440 |
| 18,000 | 5 | 90 | 約 2,880 |
| 22,000 | 7 | 154 | 約 4,928 |

### C. 升級到較成熟 programmatic / AdX partner

| 月 PV | RPM | 月收益（USD） | 月收益（TWD, 1:32） |
|---|---:|---:|---:|
| 15,000 | 5 | 75 | 約 2,400 |
| 18,000 | 7 | 126 | 約 4,032 |
| 22,000 | 10 | 220 | 約 7,040 |

---

## 7.5 我對 USADA 目前最實際的判斷

若你現在就上廣告，且不做太激進版位，**比較合理的初期期待值**是：

- 約 `US$40 ~ US$100 / 月`
- 約 `NT$1,300 ~ NT$3,200 / 月`

如果條件同時成立：

- 手機流量穩定
- 來自日本 / 台灣 / 美國受眾比例增加
- 單頁停留時間穩定
- 條目頁內容更完整
- 首屏速度改善

則有機會往：

- `US$100 ~ US$180 / 月`
- 約 `NT$3,200 ~ NT$5,800 / 月`

靠近。

---

## 8. 如何實現（不先上正式站的版本）

## 8.1 目前應做的不是直接上線，而是先準備版位架構

建議流程：

1. 在程式端預留 slot 容器，但先不輸出廣告 script
2. 定義桌面 / 手機版位命名
3. 定義哪些頁型可顯示、哪些頁型先排除
4. 準備將來的 A/B 測試開關

---

## 8.2 建議的 slot 命名

### 桌面

- `usada_desktop_sidebar_halfpage`
- `usada_desktop_home_billboard`

### 手機

- `usada_mobile_anchor_auto`
- `usada_mobile_vignette_auto`
- `usada_mobile_incontent_largebanner`

---

## 8.3 建議先開廣告的頁型

優先：

- 單一 VTuber 頁
- VTuber 列表頁
- 組織 / 國家 / 平台集合頁

先不要：

- 後台頁
- 低內容量頁
- 空集合頁
- 轉址頁
- 搜尋功能不成熟的測試頁

---

## 8.4 技術與 UX 限制

正式上線時要遵守：

1. 不要讓廣告導致 CLS 明顯升高
2. 不要在首屏同時塞多個高干擾廣告
3. 圖像、卡片、搜尋框不能被廣告擠壓變形
4. 手機頁第一屏先保留給品牌與主要內容
5. 若條目頁內容很短，不要強行插中段廣告

---

## 9. 建議的正式上線順序

### Phase 1

- 只上：
  - `Desktop 300x600 sticky`
  - `Mobile vignette`
  - `Mobile anchor`

### Phase 2

- 視數據加：
  - `Homepage / archive 970x250`
  - `Mobile 320x100 in-content`

### Phase 3

- 若流量、頁量、速度都穩定，再評估：
  - GAM
  - MCM
  - AdX
  - Header bidding / 更進階收益優化

---

## 10. 追蹤與評估指標

正式上線後建議每週看：

- Page RPM
- Viewability
- CTR
- 手機 / 桌機分別收益
- 單頁停留時間變化
- 跳出率
- LCP / INP / CLS 變化
- 是否影響搜尋流量

若發現：

- 收益提升很少
- 但 LCP / 跳出率惡化很多

就代表版位過重，需要回調。

---

## 11. 我建議的最終方案

如果只選 **一個桌面位置 + 一個手機位置**：

### 桌面

- **右欄 sticky `300x600`**

### 手機

- **Vignette**

如果你接受手機再多一個低風險版位：

- 再加 **Bottom Anchor**

這會是目前在：

- 收益
- 實作難度
- 對版面破壞程度
- 與 Google 官方支援相容性

之間，最平衡的組合。

---

## 12. 我後續可直接做的事（但本次先不部署）

下一步如果你要我進入實作，我會做：

1. 在現有版型中預留廣告容器
2. 桌機 / 手機條件式輸出版位
3. 加入 feature flag，不啟用時不輸出廣告 script
4. 撰寫 AdSense 接入說明
5. 上線前做一輪 Core Web Vitals 風險檢查

---

## 13. 主要參考來源

### Google 官方

- AdSense Auto ads settings  
  https://support.google.com/adsense/answer/9305577?hl=en

- About side rail ads  
  https://support.google.com/adsense/answer/16531757

- About vignette ads  
  https://support.google.com/adsense/answer/16531962

- Vignettes frequency controls  
  https://support.google.com/adsense/answer/13992041

- About Multiplex Auto ads  
  https://support.google.com/adsense/answer/16532969

- Modify anchor ads code  
  https://support.google.com/adsense/answer/7478225?hl=en

- Google Ads uploaded display sizes  
  https://support.google.com/google-ads/answer/1722096?hl=en

### 業界參考（收益區間用）

- Ezoic case study：AdSense Page RPM 由 `5.81` 提升到 `19.6`  
  https://www.ezoic.com/case-studies/adsense-to-premium-demand-case-study

- 2026 entertainment niche RPM public benchmark（僅作輔助參考，不視為保證）  
  https://adstimate.com/blog/niche/entertainment-adsense-rpm.html

- 2025 publisher RPM discussion / public range reference（僅作輔助參考）  
  https://www.techconda.com/2026/02/adsense-page-rpm-range-2025.html

---

## 14. 備註

本報告是「廣告產品規劃與收益估算」，不是保證收益。

真正影響廣告收入最大的因素，仍然是：

- 流量來源國家
- 頁面停留時間
- viewability
- 內容完整度
- 品牌安全與政策合規
- 頁面速度

所以廣告設計應與：

- 內容補強
- SEO
- 頁面速度優化

一起推進，效果才會最大。
