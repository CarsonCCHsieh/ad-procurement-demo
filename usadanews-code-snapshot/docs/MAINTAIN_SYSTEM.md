# USADA 維護系統說明（快照版）

最後更新：2026-03-20（Asia/Taipei）

## 文件用途
這份文件是遷移快照中的維護系統摘要，讓接手部署的人能快速理解：
- 例行維護做什麼
- 哪些程式是維護主體
- 哪些資料來源會被同步
- 搬移後哪些工作必須恢復

## 維護核心元件

### 1. `vt-maint-runner.php`
WordPress 維護主插件，負責：
- Google Sheet 同步
- HoloList / 其他來源同步
- 補圖
- 補 tag / taxonomy
- 多語同步
- 報告輸出

### 2. `wp-vtuber-cpts.php`
Portal 站點核心插件，負責：
- 自訂 post type / taxonomy
- template loader
- SEO helper
- canonical / hreflang 補強
- 搜尋 API 與部分前台邏輯

### 3. `vt-portal-redirects.php`
MU plugin，負責：
- 舊網址導向
- Portal 結構修補
- 歷史連結修復

### 4. Portal 模板
位於 `theme/` 目錄中的模板快照，包含：
- 首頁
- 列表頁
- 個人頁
- taxonomy 頁
- 索引頁

## 主要資料來源
- 台灣 VTuber Google Sheet 主表與分表
- HoloList（非台灣來源）
- 公開社群頁資料（YouTube / Twitch 等）
- 站內既有資料與 taxonomy

## 例行維護工作
一般例行會做：
1. 檢查來源健康
2. 同步資料來源
3. 補齊翻譯關聯
4. 補縮圖
5. 更新新聞聚合
6. 跑站內健康檢查

## 搬移後必須優先恢復的項目
1. 例行維護排程
2. sitemap 生成與更新
3. 報告輸出目錄
4. GSC / GA4 相關驗證
5. 補圖與多語同步流程

## 重要提醒
- 這份快照不包含 secrets / token / 密碼
- 憑證應由新主機環境變數或私密檔注入
- 若要看完整維運說明，應以主 repo 中的最新維護文件為準
