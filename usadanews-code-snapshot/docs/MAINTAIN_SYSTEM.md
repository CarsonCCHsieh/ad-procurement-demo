# USADA VTuber 維護系統說明（Maintain System）

最後更新：2026-02-21（UTC+8）

本文件是 GitHub 私有專案的主說明文件，用於描述 USADA（usadanews.com）目前的「VTuber Portal」資料庫站點架構、維護流程（maintain pipeline）、SEO 策略、資料來源、稽核與部署方式。

重點原則：
- 不要把任何密碼、金鑰、API secret 寫進 repo；一律改用環境變數或外部私密檔。
- 台灣 VTuber 以你提供的 Google Sheet 為主；Hololist 來源不得覆蓋台灣條目。
- 多語系採「路徑前綴」：預設語言（繁中）不加前綴，其餘語言使用 `/cn /en /ko /es /hi`。

---

## 1. 目標（Goals）
- 穩定維運：可以長期自動同步、分批更新、可稽核、有報表、可回溯。
- SEO 友好：canonical/hreflang/robots、避免薄頁與重複索引、可持續擴充集合頁（taxonomy pages）、可更新 sitemap。
- 體驗一致：首頁、列表頁、分類頁、個人頁使用一致的 Portal 版型與 UI 元件；避免連回舊主題頁面。
- 資料完整：盡可能補齊大頭貼、社群連結、追蹤數、簡介；缺圖條目納入補齊流程或列清單處理。

---

## 2. 核心元件（Key Components）

### 2.1 `vt-maint-runner.php`（WordPress Plugin）
用途：維護/同步主流程（資料同步、補圖、去重、語系補齊、分類補齊、報表輸出）。

主要能力（概念層級）：
- **資料同步（Sheet Sync）**
  - 以 Google Sheets 作為台灣 VTuber 主資料源，分批掃描同步，避免一次載入造成 500 / memory exhausted。
  - 先用 Values API（輕量），必要時對「特定社群欄位」再用 Grid API 取得 rich-text hyperlink（因為 Values API 會遺失內嵌連結）。
- **補齊大頭貼（Avatar/Thumb Fill）**
  - 依優先順序嘗試取得頭像（YouTube / Twitch 等），寫入 WP featured image 或對應的圖片欄位。
  - 補齊過程會回寫 stable keys（例如 YouTube channel id、Twitch login、Twitter handle）以利去重與排序。
- **社群簡介補齊（Social Bio Enrich）**
  - 會從社群來源擷取可用簡介：YouTube API `snippet.description`、Twitch API `users.description`、社群頁 `og:description / twitter:description / meta description`。
  - 僅在 `vt_summary` 為空或品質過低時自動寫入，避免覆蓋人工編輯摘要。
  - 會同步記錄 `vt_summary_source` 與 `vt_summary_refreshed_utc` 供後續稽核。
- **社群數據（Followers/Metrics）**
  - 以可用 API 更新 Twitch followers（以及其他可取得的平台欄位）。
  - 追蹤數欄位用於排序、列表展示與集合頁排名。
- **分類/標籤（Taxonomy Enrich）**
  - 依資料來源補齊 `country`、`debut-year` 等集合頁，建立 SEO 友善的分類入口。
- **多語系骨架頁（Polylang Ensure Translations）**
  - 確保 Portal 主要頁面（首頁/索引頁）在 `cn/ja/en/ko/es/hi` 有對應的頁面存在，並走相同 IA（資訊架構）。
  - VTuber 個人頁的多語版本可先用英文骨架建立（後續再逐步翻譯），避免語系頁面點進去又回到中文列表。
- **去重（Dedupe）**
  - 依 stable keys（YouTube/Twitch/Twitter）及名稱規則合併重複條目，避免搜尋下拉出現多筆同人結果。
  - 合併會盡量保留內容較完整、圖片較好的那筆，並搬移缺少的欄位。
- **稽核（Audit）**
  - 定期跑站內稽核：檢查舊連結、缺圖比例、SEO head tag 是否符合規則、語系頁是否存在、集合頁是否可用等。
- **報表/紀錄**
  - 所有關鍵動作寫入 `wp-content/uploads/vt-logs/`（JSON + log），方便查問題與回溯。

### 2.2 `vt-maint.php`（維護端點 / 工具頁）
用途：提供「受保護」的 maintenance endpoint，用來手動觸發/查看維護動作、查看報表、解鎖卡住的 lock。

安全性：
- 端點必須是 key / Basic Auth 保護。
- 端點應加 `noindex`，避免被 Google 索引。

### 2.3 `wp-vtuber-cpts.php`（WordPress Plugin）
用途：Portal 前台功能支援（語言下拉、搜尋 API、排序、SEO head helpers、部分 UI shortcode 等）。

重點功能：
- Portal SEO helper functions：
  - `vtportal_render_polylang_seo_links_for_post($post_id)`：單頁 canonical/hreflang
  - `vtportal_render_polylang_seo_links_for_archive()`：列表/歸檔 canonical/hreflang
  - `vtportal_render_polylang_seo_links_for_term($term)`：taxonomy canonical/hreflang
- `?sort=...` 變體 SEO：
  - 排序頁對 SEO 來說是薄頁/重複內容：統一標記 `noindex,follow`
  - 如果 Yoast SEO 存在，會用 `wpseo_robots` filter 設置，避免同頁出現矛盾 robots。
- 搜尋 API（用於首頁搜尋下拉）：
  - REST endpoint 回傳 VTuber 條目清單，並用 stable keys 去重，避免同人多筆結果。
  - 會對 YouTube / Twitch / X 連結做 best-effort 正規化（canonicalize）以降低不同格式造成的重複。
- 多語 SEO 與 UI 翻譯修正（2026-02-21 新增）：
  - Landing 頁在 Yoast 啟用時，額外覆寫 `title / meta description / og / twitter / schema`，避免語系首頁仍顯示中文標題與描述。
  - 前台執行期翻譯 map（runtime i18n）優先於舊映射，修正 JA/EN/KO/ES/HI 首頁與內頁常見中文殘留。
  - 新增 taxonomy term 名稱執行期翻譯（`get_term` / `get_terms` filter）：
    - 將如 `個人勢 / 活動中 / 休止中 / 畢業` 等高頻詞，依語系轉為 `Indie / Active / Hiatus / Graduated...`。
  - 新增 excerpt 片段關鍵詞本地化（`get_the_excerpt` filter）：
    - 不做機器全文翻譯，但會把摘要中的高頻詞彙做語系替換，降低多語頁面混入中文詞的體感。

### 2.4 `vtuber-portal`（Portal 版型與樣式）
用途：Portal 的 templates 與 CSS（首頁/列表/分類/個人頁/索引頁）。

核心模板（位於 plugin templates）：
- `vt-portal-landing.php`：首頁
- `archive-vtuber.php`：VTuber 列表頁
- `single-vtuber.php`：VTuber 個人頁
- `taxonomy-*.php`：各分類/標籤集合頁
- `vt-*-index.php`：索引頁（例如平台索引、組織索引、國家索引、出道年索引）

### 2.5 `wp-content/mu-plugins/vt-portal-redirects.php`（MU Plugin）
用途：站內「強制導向」與「舊頁面收斂」。

主要做的事：
- 301 舊主題/舊分類/舊語系前綴 URL 到目前 Portal IA（減少 Google 索引舊頁面）。
- 語系前綴 canonicalize（例如 `/zh-cn/` -> `/cn/`，`/zh-tw/` -> 預設語言無前綴）。
- allowlist Portal 重要頁面模板，避免把翻譯後的 Portal 功能頁也導走。
- `sitemap*.xml` 不在此 MU redirect 層改寫，避免 Search Console 把 sitemap 判成重複 canonical。

### 2.6 `wp-content/mu-plugins/vt-ga4.php`（MU Plugin）
用途：注入 GA4 script（全站），避免主題切換後追蹤碼遺失。

---

## 3. 多語系 URL 政策（Polylang + Directory Prefix）
預設語言：繁體中文（台灣）不加前綴。

範例：
- 繁中（預設）：`https://usadanews.com/vtuber/<slug>/`
- 简中：`https://usadanews.com/cn/vtuber/<slug>/`
- 日本語：`https://usadanews.com/ja/vtuber/<slug>/`
- English：`https://usadanews.com/en/vtuber/<slug>/`
- 한국어：`https://usadanews.com/ko/vtuber/<slug>/`
- Español：`https://usadanews.com/es/vtuber/<slug>/`
- हिन्दी：`https://usadanews.com/hi/vtuber/<slug>/`

語言切換器：
- Portal templates 會用 Polylang 內建 switcher，但會「過濾」只顯示 SEO 目標語言：
  - `zh`（預設）、`cn`、`en`、`ko`、`es`、`hi`

注意：
- 多語 SEO 的核心是「每種語言真的有不同語言內容」。目前允許先建立骨架（英文內容直接套用到其他語言版本），但這不是最終 SEO 最佳狀態；後續要逐步翻譯與在地化關鍵字。

---

## 4. SEO Head Tags（Canonical / Hreflang / Robots / Heading / Alt）

### 4.1 Canonical 與 Hreflang
Portal 相關頁面由 `wp-vtuber-cpts.php` 的 helper 統一輸出：
- 單頁：`vtportal_render_polylang_seo_links_for_post($post_id)`
- 列表頁：`vtportal_render_polylang_seo_links_for_archive()`
- taxonomy：`vtportal_render_polylang_seo_links_for_term($term)`

與 Yoast SEO 共存規則：
- 若 Yoast 存在（`WPSEO_VERSION`），Portal templates **不重複輸出 canonical**（避免重複/衝突）。
- 若 Yoast 存在，`hreflang` 採「情境化策略」：
  - `vtuber` 單頁：預設保留手動 hreflang（補足某些自訂模板下 Yoast 未輸出的情況）。
  - 首頁/列表/taxonomy：預設不額外輸出手動 hreflang（避免 `<head>` duplicate alternate）。
- 可用 filter `vtportal_force_manual_hreflang_with_yoast` 依 context 覆寫（`page/archive/term/vtuber-single`）。

### 4.2 `?sort=` 排序頁（避免薄頁/重複索引）
排序頁對使用者體驗有用，但對 SEO 是重複內容，策略為：
- `?sort=...`：`noindex,follow`
- 若 Yoast 存在：使用 `wpseo_robots` filter 設置，避免同頁出現兩個矛盾 robots meta。

### 4.3 Heading（H1/H2）
原則：
- 每頁只應有一個清楚的 `<h1>`（頁面主題：列表標題/條目名稱/分類名稱）。
- 內容區塊使用 `<h2>` 作為主要段落標題（例如：Twitch簡介、常見問答、完整介紹、相關條目等）。

### 4.4 圖片 alt（可讀性 + SEO）
原則：
- VTuber 卡片縮圖與個人頁主圖：`alt` 使用「顯示名」或「條目名稱」。
- 其他 CPT：`alt` 使用文章標題。
- 不顯示縮圖的搜尋下拉（若禁用縮圖）則不需要做 alt。

---

## 5. 分類/標籤策略（Taxonomy Strategy）

目標：用 taxonomy 形成「SEO 友善集合頁」與「站內導覽入口」，同時避免錯誤分類。

### 5.1 `agency`（組織/公司/事務所）
- 只用於真實組織（hololive、NIJISANJI 等）。
- 不要把 `個人勢 / Indie` 當作 agency（個人勢應該是 role/tag）。
- 維護流程會主動清理歷史資料：若發現 agency slug 為 `indie` 或 `indie-zh/cn/en/...` 這類變體，會移除 agency 指派，改用 `role-tag=個人勢`。

### 5.2 `role-tag`（內容/屬性標籤）
- 用於特徵或類型（例如：個人勢、歌回、ASMR、雜談、遊戲等）。
- `活動中/休止中/已畢業/封存` 這類「狀態」不要放在 role-tag，應該只存在於 `life-status`（避免同時顯示/同時被分類為多種狀態）。
- 可逐步擴充為 SEO 集合頁（「ASMR VTuber」「歌回 VTuber」等）。

### 5.3 `country`（國家/地區）
- 用於國家/地區集合頁。
- 台灣 VTuber 由 Google Sheet 映射到 TW；Hololist 來源不得覆蓋 TW。

### 5.4 `debut-year`（出道年）
- 依 `vt_debut_date` 或原始欄位解析出道年，產生集合頁（例如 2021 出道 VTuber）。

### 5.5 `platform`（主要平台）
- 例如 YouTube / Twitch 等，可作為集合頁入口與 filter。

### 5.6 `life-status`（生命週期狀態）
- 例如：活動中 / 休止中 / 已畢業 等。
- 站內統計卡片可點擊導到對應集合頁（作為導覽入口）。
- 注意：Polylang 可能會為 taxonomy term 產生語系後綴 slug（例如 `hiatus-zh`、`hiatus-en`）。`maintain` 會以 `vt_lifecycle_status`（canonical base：`active/hiatus/graduated/reincarnated`）為準，並在寫入/顯示時自動將 `*-xx` 正規化，避免同一條目同時被視為多種狀態。
- 另外：若來源欄位/簡介中出現「停止活動 / 停止更新 / 休止 / 畢業 / 引退」等高訊號文字，maintain 會保守推斷狀態並修正 life-status（以避免「簡介寫停止活動但外面顯示活動中」）。所有這類推斷修正都會寫入 `wp-content/uploads/vt-logs/status-conflicts-last.json` 方便抽查。

---

## 6. 前台功能（Frontend Features）

### 6.1 首頁（Portal Landing）
- 主導覽（首頁、列表、索引頁等）
- 語言下拉（Polylang）
- 搜尋框（支援下拉建議）
- 最近更新清單（依更新時間排序，需顯示「依更新時間排序（最新優先）」等文字）
- 常用標籤（tag cloud / 常用分類入口）
- 提交建議表單（Suggestion Intake）

### 6.2 VTuber 列表（Archive）
- 支援排序：
  - 依更新時間
  - 依 YouTube 訂閱數（用 LEFT JOIN 避免沒有訂閱數的條目消失）
- 每頁顯示數量可調整（需平衡速度與可讀性）

### 6.3 VTuber 個人頁（Single）
- RWD：PC 兩欄（左：人物資料；右：新聞/快速摘要/導覽），Mobile 直排。
- 社群連結與 followers：顯示為可點擊區塊（顯示平台 + 數字），避免重複兩個 YouTube 區塊。
- 相關條目：同組織、同分類等快速導覽。

### 6.4 建議提交（Suggestion Intake -> Admin）
- 前台表單會寫入 CPT `vt-suggestion`（non-public），狀態 `pending`。
- 後台可在 Dashboard 看到 `VT Suggestions` 進行審核。
- 防濫用：
  - nonce
  - IP rate limit（best-effort）

---

## 7. 資料來源（Data Sources）

### 7.1 台灣 VTuber（Primary Source）
Google Sheet（同一份試算表多個分頁 gid）：
- 主資料（含轉生勢）：`gid=1575066064`
- 主 Twitch：`gid=1406516665`
- 特殊唱見影片勢：`gid=318638248`
- 準備中：`gid=1961441865`
- 無介紹配信非正式出道：`gid=1561118585`
- 暫停異動不定期：`gid=60192887`
- 失蹤畢業封存區：`gid=470068163`

重要：Google Sheets 內有些欄位（尤其 YouTube）是「顯示文字 + 內嵌超連結」。
- Values API 取不到 URL metadata。
- 維護流程會對核心社群欄位做 Grid API 的窄範圍讀取，把 hyperlink 抽出來再映射回條目欄位。
- 若 Google Sheets API key 過期或未啟用，維護流程會自動切換到 `export csv + gid` 後備同步，避免整體同步中斷。

### 7.2 Hololist（Non-TW only）
- 來源：`https://hololist.net/category/`
- 政策：
  - 不用 Hololist 更新台灣（TW）。
  - 若條目 `vt_data_origin=tw_sheet`，Hololist 不覆寫。
- 抓取策略：
  - 有速率限制（jitter delay）
  - 尊重 `robots.txt`（抓不到 robots 就跳過，避免風險）
  - 只補空欄位：YouTube/Twitch/Twitter 等，避免覆蓋既有更準確資料。

---

## 8. Cron 排程（Server-side Jobs）
（以實際 plugin 註冊為準）
- `vt_maint_fillthumbs_event`：每 10 分鐘（補齊大頭貼/回寫 stable keys）
- `vt_maint_enrich_terms_event`：每 10 分鐘（補齊 taxonomy）
- `vt_maint_assign_default_lang_event`：每 2 分鐘（確保預設語言/頁面狀態正確）
- `vt_maint_sync_sheet_event`：每 10 分鐘（分批同步 Google Sheet）
- `vt_maint_ensure_translations_event`：每 10 分鐘（分批補齊 VTuber 多語骨架頁）
- `vt_maint_ensure_page_translations_event`：每 10 分鐘（確保 Portal 主要頁面多語版本存在）
- `vt_maint_sync_hololist_event`：每日（非台灣來源同步）
- `vt_maint_dedupe_event`：每日（去重合併）

---

## 9. Sitemap 與 Google 收錄（Discovery）

### 9.1 Sitemap 現況
本站採「靜態 sitemap（存放在網站根目錄）」而非 WP core 動態 sitemap。

對外：
- `https://usadanews.com/robots.txt` 內包含：
  - `Sitemap: https://usadanews.com/sitemap_index.xml`

### 9.2 靜態 sitemap 產生與上傳（本機）
- 產生：
  - `python maintain/generate_static_sitemaps.py --base https://usadanews.com --out-dir .`
  - 會寫出：`sitemap_index.xml`、`sitemap.xml`、`vtuber-sitemap*.xml`、以及各 taxonomy sitemap（platform/agency/role-tag/life-status/country/debut-year/franchise）。
- 上傳：
  - `python maintain/upload_static_sitemaps.py --in-dir .`
  - 需要環境變數：
    - `USADA_FTP_USER`
    - `USADA_FTP_PASS`
    - （可選）`USADA_FTP_HOST`、`USADA_FTP_ROOT`

注意：
- Google 舊的 sitemap ping endpoint 已不可靠（可能 404），以 Search Console 提交為準。
- 若 GSC 仍留有舊提交（如 `post-sitemap.xml`/`page-sitemap.xml`），應在 GSC 端移除舊項目，只保留 `sitemap_index.xml`。
- 另有本機檢查器：
  - `python maintain/google_sitemap_refresh.py`
  - 會寫：`reports/google_sitemap_refresh_report.json`

---

## 10. vt-maint.php 常用動作（Actions）
常見動作（以實際部署版本為準）：
- `status`
- `site_audit`
- `polylang_setup`
- `polylang_lang_counts_raw`
- `assign_default_lang` / `assign_default_lang_raw`
- `ensure_translations` / `ensure_translations_raw`
- `ensure_page_translations` / `ensure_page_translations_raw`
- `sync_sheet` / `sync_sheet_force`
- `dedupe` / `dedupe_raw`
- `metrics_diagnose` / `metrics_diagnose_raw`
- `sync_hololist` / `sync_hololist_raw`
- `sync_translation_meta`（同步翻譯頁的 vt_* meta 與 taxonomy，避免各語系狀態/追蹤數飄移）
  - 可選參數：`id=<vtuber_post_id>`（只同步單一條目，方便針對性修正）
- `enrich_social_bio` / `enrich_social_bio_raw`（從社群頁/API 補齊個人摘要）
  - 可選參數：`batch=<int>`、`force=1`
- `unlock&name=...`（解鎖卡住的流程）

Hololist 批次：
- `batch=1..160`（小批次利於測試；cron 可跑更大批次或多次）

### 10.1 本機一鍵維護（推薦）
若需要用「本機一鍵」把整站維護流程跑一輪（並留下完整 log），使用：
- `python run_maint_cycle.py`

特性：
- 會依序觸發 `vt-maint.php` 的維護動作（polylang/terms/avatar/翻譯/去重/sitemap 等），並把結果寫入 `reports/maint_cycle_*.log`。
- **包含 `status_fix` 收斂步驟**：在 `cleanup_terms` 後，會反覆執行 `status_fix` 直到 `updated=0`（避免出現「簡介寫停止活動但外面顯示活動中」的誤導狀態）。
- **防卡住機制（2026-02-21）**：
  - `run_maint_cycle.py` 對外部子程序全面加入 timeout（GSC 匯出/上傳、sitemap 生成/上傳、HTTP health scan）。
  - 腳本會即時輸出進度時間戳（`[HH:MM:SS] ...`），避免「長時間無輸出」誤判卡死。
  - 若子程序超時，log 會明確寫入 `TIMEOUT ... after Ns`，方便追查瓶頸。

---

## 11. Logs / Reports（稽核與回溯）
目錄：`wp-content/uploads/vt-logs/`

常見檔案：
- `maint-runner.log`
- `hololist-sync-last.json`
- `dedupe-last.json`
- `translations-ensure-last.json`
- `page-translations-ensure-last.json`
- `lang-assign-last.json`
- `polylang-setup.json`
- `site-audit.json`
- `source-health-last.json`

---

## 12. 部署（Deployment / Upload）
本機透過 FTP 上傳（避免在 repo 放任何伺服器密碼）。

常用上傳腳本：
- `upload_portal_hotfix.py`
  - 上傳：`wp-vtuber-cpts.php`、MU plugins（redirects/GA4）
- `upload_vtuber_portal_assets.py`
  - 上傳：Portal templates + CSS

環境變數（僅本機/CI 設定，不入 repo）：
- `USADA_FTP_USER`
- `USADA_FTP_PASS`
- （可選）`USADA_FTP_HOST`、`USADA_FTP_ROOT`

---

## 13. GitHub 私有專案注意事項（Security）
必做：
- `.gitignore` 必須排除：
  - `*_secret*`、`client_secret*.json`、`account_profiles.json`、任何 API keys/Token、任何下載的私密檔
  - 本機 log、暫存、輸出報表（除非你刻意想追蹤的非敏感報表）
- 對 repo 做 secret scan（避免誤把 key commit 進去）。
- 所有 key 改用環境變數/私密檔注入（例如 `apply_secrets.py`）。

建議做法（實務）：
- 不要直接把整個工作區推到 GitHub。請改用 `python maintain/build_private_repo.py` 產生「已去敏」快照到 `maintain/github_private_repo/`，再推到 GitHub 私有 repo。
- 產生後先跑一次：`python maintain/repo_secret_scan.py maintain/github_private_repo`，確認快照內沒有敏感字串再 push。

---

## 14. 已知限制與後續方向（Roadmap）
- 多語 SEO 最終一定要做「真翻譯」與「不同語言關鍵字策略」；目前骨架頁只是先把路徑/結構/互鏈（hreflang）與收錄面建起來。
- 缺圖問題若仍存在：
  - 需要擴充更多可取得頭像的來源（例如官方網站、其他平台）或建立「人工補圖清單」工作流。
- 新聞聚合需要更穩定的更新機制（來源清單、頻率、快取、去重、引用格式）。

## 2026-02-27 維運更新（新增）
- `news_refresh` 改為小批次（`batch=6`）循環，降低超時與卡住風險。
- 新增 `cleanup_hololist_noise` 動作：
  - 會清除誤匯入的 HoloList 非人物頁（例如 `.../event` / `.../events`）。
  - `vt_maint_hololist_reserved_paths()` 已加入 `event/events`。
- 新增動態 VTuber Sitemap：
  - `vtuber-sitemap-index.php`（動態索引）
  - `vtuber-sitemap-dynamic.php?part=N`（動態分頁）
  - `sitemap_index.xml` 目前改引用動態 VTuber sitemap，避免磁碟配額不足導致靜態 sitemap 上傳失敗。
- avatar 補圖結果：`avatar_diagnose_raw sample=3000` 的 `no_thumbnail` 已降為 `0`。
- 2026-02-28 新增 `fix_tiny_thumb_fallback(_raw)`：當本地特色圖過小（tiny/small）且有有效外部頭像來源時，會自動移除小圖並切換到外部來源，避免品質卡死。
- 2026-02-28 新增 `cleanup_no_avatar_no_social(_raw)`：清理「無頭像 + 無社群 + 幾乎無摘要」的低品質條目。
- 補圖策略更新：對最後無頭像條目加入 `ui-avatars` 安全回退，確保 `no_thumbnail` 歸零。


## 2026-02-28 ????????
- ?? `fill_metrics` / `fill_metrics_raw`??????? `vt_youtube_subs`?`vt_twitch_followers`????? `fillthumbs` ???
- `vt_maint_fetch_twitch_meta()` ???? `GET /helix/channels/followers?broadcaster_id=...` ?? `total`???????? 0 ????
- `run_maint_cycle.py` ?? `fill_metrics_raw` ?????? no-op/locked ??????
- `unlock` allowlist ?? `fill_metrics`?????? `vt_maint_fill_metrics_lock`?
- `http_health_scan.py` ?? `--max-seconds`??????????? cycle?

---

## 2026-03-06 更新（多語內容補齊）

本次新增 maintain 任務：`sync_translation_content`（`sync_translation_content_raw`）。

- 目的：
  - 針對 Polylang 已建立的各語系 VTuber 翻譯頁，自動補齊 `post_content`（完整介紹）與 `post_excerpt`（摘要）。
  - 避免翻譯頁只複製原文，造成多語頁面內容不足。
- 策略（混合）：
  - 若來源本身為英文資料（如 HoloList），優先直接使用/轉換英文內容。
  - 其餘內容用快速機器翻譯補齊（Google translate endpoint，含快取）。
- 觸發點：
  - `vt-maint.php?action=sync_translation_content_raw&batch=25&min_len=160`
  - 已加入 `run_maint_cycle.py` 例行流程（在 `ensure_translations_raw` 之後執行）。
  - 已加入 WP cron 事件：`vt_maint_sync_translation_content_event`（每 6 小時）。
- 報表：
  - `/wp-content/uploads/vt-logs/translation-content-last.json`
