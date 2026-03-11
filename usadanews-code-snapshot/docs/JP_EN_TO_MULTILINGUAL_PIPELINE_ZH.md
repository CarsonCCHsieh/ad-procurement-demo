# 日英優先到全語系內容管線（JP/EN-first Pipeline）

更新日期：2026-03-11  
適用範圍：USADA VTuber Portal 維運/擴充流程（maintain pipeline）

## 1. 目標
- 目前中文來源完整，但全球搜尋量最高的 VTuber 查詢主力在日語與英語。
- 新策略改為「日英先收斂」再「多語系擴散」：
  - `ja/en` 做為主資料層（高覆蓋、可持續）
  - `zh-TW` 維持台灣資料庫主權來源（Google Sheet）
  - `zh-CN/ko/es/hi` 以 `ja/en` + 結構化資料轉譯生成
- 降低內容重複、空白介紹、語系失配，避免薄內容影響 SEO。

## 2. 來源策略
來源清單：`ops/jpen_source_registry.json`  
健康檢查腳本：`ops/probe_jpen_sources.py`  
輸出報告：`reports/jpen_source_health_latest.json|md`

### 2.1 優先級原則
- Tier 1：高可信、可結構化、可自動化（官方/API/穩定 JSON）
- Tier 2：補充型來源（百科/社群整理）
- 健康狀態（HTTP 200）會直接影響當輪優先度。

### 2.2 區域衝突規則
- 台灣 VTuber 來源以你指定的 Google Sheet 為主。
- `hololist` / `vdb` 在碰到 `TW` 條目時不覆蓋主欄位（僅做補充或跳過）。

## 3. 日英到全語系流程

### Stage A：實體對齊（Entity Resolution）
- 以穩定鍵值去重與對齊：
  - `YouTube channel_id` > `Twitch login` > `X handle` > 名稱正規化
- 用 `Wikidata` 做跨語系 alias 映射，降低日英中文名稱不一致造成重複條目。

### Stage B：日英事實層聚合
- Discovery（人名/條目發現）：
  - hololist / vdb / 官方 roster
- Facts（欄位事實）：
  - 官方頁（組織、連結、狀態）
  - YouTube/Twitch API（頭像、粉絲、簡介）
  - Wikipedia/Wikidata/Fandom API（背景、關鍵事件、別名）

### Stage C：內容生成與去重
- 先寫 `ja/en` 的「完整介紹」草稿，再擴散到其他語系。
- 內容門檻（避免垃圾重複）：
  - 不可重複頁面既有欄位文案
  - 需有新資訊增量（事件、風格、特徵、歷程）
  - 無可靠來源時寧缺勿濫（保留空白，不硬生）

### Stage D：多語系擴散（Localization）
- `zh-CN/ko/es/hi` 預設以 `en` 為中繼，缺 EN 則轉 `ja`。
- 頁面元素一起翻譯（不只內文）：
  - 首頁 hero、搜尋提示、CTA、欄位標籤、卡片說明、meta 文案
- URL 與 SEO 一致：
  - `zh-TW` 無前綴
  - 其餘語系走 `/cn /ja /en /ko /es /hi`
  - canonical + hreflang 成對輸出

### Stage E：發布與稽核
- 每輪 maintain 產出來源健康報告。
- 若來源健康下降（例如 API 403/超時），自動降級 fallback，不中斷整輪任務。
- 將來源可用性與內容覆蓋率納入週報。

## 4. 已接入 maintain 的新動作
- `run_maint_cycle.py` 已新增 `probe_jpen_sources` 階段：
  - 讀取 `jpen_source_registry.json`
  - 探測來源健康
  - 輸出語系優先地圖（哪個語言先吃哪些來源）
- 控制旗標：
  - `VT_CYCLE_RUN_JPEN_SOURCE_PROBE=1|0`

## 5. 本次建議優先落地順序
1. 用來源健康報告確認「可長期」來源池（先穩定再擴張）。
2. 先把 `ja/en` 介紹密度拉高，再同步下放到 `cn/ko/es/hi`。
3. 嚴格套用「新資訊增量」門檻，避免完整介紹變成欄位重複。
4. 每週回看來源表，淘汰不穩來源，補進更穩替代來源。

## 6. 風險與處理
- 來源封鎖/反爬：改 API 或官方頁優先；必要時降頻與快取。
- 版權風險：不長段複製，僅摘要與結構化事實，附來源追溯欄位。
- 翻譯品質：先機器草稿，再以關鍵詞字典與人工校正高流量頁。
