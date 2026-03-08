# USADA 主機轉移前就緒檢查（2026-03-09）

## 結論
目前狀態：**可進入主機轉移準備階段**，僅剩 Linode/Cloudflare 遷移 Token 未就位；其餘本機維運憑證已可運作。

## 已完成（本次已處理）
1. GitHub 代碼同步確認
- 倉庫：`ad-procurement-demo`
- 分支：`master`
- 狀態：`master...origin/master`（乾淨，無未提交變更）

2. 今日例行優化已執行成功
- 維運循環：`run_maint_cycle.py`（server profile）
- 執行時間：約 12 分鐘
- 站點健康掃描：樣本 45，壞鏈接 0
- 詳細：`docs/USADA_DAILY_MAINT_2026-03-09.md`

3. 主站關鍵代碼快照已入版控
- 新增：`usadanews-code-snapshot/`
- 內容包含 plugin/theme/ops 關鍵檔案
- 已進行敏感資訊去除（無硬編碼 API key / app password）

## 尚未完成（轉移前必要）
1. 正式遷移授權資料尚未完整就位
- 需要：Linode PAT、Cloudflare API Token、Zone ID、A2 備份定位資訊
- 參考文件：`INFRA_UPGRADE_PURCHASE_CHECKLIST_ZH_v2.md`

2. 低 CTR 自動優化的 WP 應用層憑證未配置
- 影響：`enrich_low_ctr` 仍會跳過
- 需要：`VT_WP_USER`、`VT_WP_APP_PASS`

3. 自動偵測結果
- 已嘗試在本機專案與維運目錄自動檢索遷移所需 Token（Linode/Cloudflare）
- 結果：未找到可直接使用的 `LINODE_TOKEN`、`CF_API_TOKEN`、`CF_ZONE_ID`
- 已就緒項：FTP 與 GSC 服務帳戶已可正常執行

## 風險檢查結果
- 風險項：本機有大量歷史腳本不在 repo（已用 `usadanews-code-snapshot` 補齊核心代碼）
- Secret 掃描：快照內未檢出明文 Google API key / GitHub token / 常見密鑰格式
- 建議：在正式推到新倉庫前，再跑一次完整 secret scan（含 regex + entropy）

## 轉移前最小待辦（Blocking）
- [ ] 設定 Linode/Cloudflare 遷移 Token（`LINODE_TOKEN`, `CF_API_TOKEN`, `CF_ZONE_ID`）
- [ ] 產出最新 DB dump + uploads 清理後備份

完成以上兩點後，我可直接執行完整遷移流程。
