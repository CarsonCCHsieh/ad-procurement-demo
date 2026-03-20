# USADA 模板依賴盤點（2026-03-20）

## 結論
目前 USADA 仍屬於「WordPress 客製化模板站」，不是已完全脫離模板的自建應用。

因此搬移時不能只搬資料庫與媒體檔，還必須完整帶走以下程式層：
- CPT / taxonomy / rewrite / SEO 輔助邏輯
- Portal 模板
- MU plugin redirect
- 前端 CSS / JS
- Polylang / Yoast 相關整合行為

## 仍依賴模板的部分

### 1. 單一 VTuber 頁
- 檔案：`single-vtuber.php`
- 依賴內容：
  - 條目資料渲染
  - tag / related items / full profile / FAQ 區塊
  - canonical / hreflang 補強
  - `html lang` 修補

### 2. VTuber 列表頁
- 檔案：`archive-vtuber.php`
- 依賴內容：
  - 排序顯示
  - tag 卡片樣式
  - breadcrumb / archive SEO links

### 3. 首頁 Portal Landing
- 檔案：`vt-portal-landing.php`
- 依賴內容：
  - 首頁 hero
  - 最新更新
  - 熱門搜尋 / 常用標籤
  - 語系熱門 VTuber
  - 搜尋框與 UI 結構

### 4. taxonomy 集合頁
- 檔案：
  - `taxonomy-agency.php`
  - `taxonomy-country.php`
  - `taxonomy-debut-year.php`
  - `taxonomy-franchise.php`
  - `taxonomy-life-status.php`
  - `taxonomy-platform.php`
  - `taxonomy-role-tag.php`
- 依賴內容：
  - 集合頁標題 / 導言 / canonical / hreflang
  - 條目卡片列表
  - 篩選與 SEO 集合頁承載

### 5. 索引頁
- 檔案：
  - `vt-agency-index.php`
  - `vt-country-index.php`
  - `vt-debut-year-index.php`
  - `vt-platform-index.php`
  - `vt-role-index.php`
  - `vt-contact.php`
- 依賴內容：
  - 各索引型 landing page
  - 站內導覽入口

## 仍依賴 WordPress / 外掛的部分

### 1. `wp-vtuber-cpts.php`
負責：
- `register_post_type`
- `register_taxonomy`
- template loader
- runtime i18n
- canonical / hreflang
- sitemap / robots / SEO helper
- redirect / legacy URL repair 的部分配合

### 2. `vt-maint-runner.php`
負責：
- 來源同步
- 補圖
- taxonomy / tag enrich
- 多語同步
- 報告輸出

### 3. `vt-portal-redirects.php`（MU plugin）
負責：
- 舊網址修補
- Portal URL redirect / canonicalize
- 不讓舊模板路徑持續暴露

### 4. Polylang
負責：
- 語系關聯
- 翻譯關係
- 語系頁面切換

### 5. Yoast SEO
負責：
- 一部分 canonical / meta / schema 輸出
- 與自訂 canonical / hreflang 共存

## 與舊主題 Newsmatic 的殘留依賴
目前仍可見以下殘留依賴：
- `newsmatic-*` CSS handles
- `newsmatic-navigation-js`
- `newsmatic-theme-js`
- 部分 body class / 容器樣式覆寫

這表示：
- 現在主視覺已大幅 portal 化
- 但還不是完全去主題依賴

## 搬移時最低必要帶走項目
1. `wp-content/plugins/wp-vtuber-cpts.php`
2. `wp-content/plugins/vt-maint-runner.php`
3. `wp-content/mu-plugins/vt-portal-redirects.php`
4. `wp-content/plugins/vtuber-portal/templates/*.php`
5. `wp-content/plugins/vtuber-portal/assets/vtuber-portal.css`
6. Polylang / Yoast 對應設定與資料表
7. 資料庫完整 dump
8. `uploads` 媒體檔

## 搬移後建議的下一步
搬移完成後，再逐步做：
1. 去除 Newsmatic 殘留資產依賴
2. 將 canonical / hreflang 從模板修補，提升到 request/router 層
3. 將前台渲染邏輯進一步模組化，為未來脫離 WordPress 做準備
