# USADA 主機轉移前就緒檢查（2026-03-20）

## 目標
確認目前程式碼、文件、快照、權限與站點狀態，是否已達到「可作為正式搬移基準」。

## 目前判定
狀態：**已達成 GitHub 搬移基準，但尚未具備正式部署條件。**

## 已就緒
1. API / 平台權限
- Linode PAT 可用
- Cloudflare Token 可用
- Cloudflare Zone ID 已取得
- 既有站點 FTP / WP 維護權限可用

2. 站點運行狀態
- `health_scan_latest.json` 顯示抽樣 URL 無壞鏈
- `google_sitemap_refresh_report.json` 顯示 sitemap index 可讀、site audit `pass=27 fail=0`
- 例行維護流程可成功執行

3. 程式碼與快照
- 主要 WordPress runtime 檔案已同步到：
  - `usadanews-code-snapshot/plugin`
  - `usadanews-code-snapshot/theme`
  - `usadanews-code-snapshot/mu-plugins`
  - `usadanews-code-snapshot/ops`
4. GitHub 版本已收斂
- `maintain/github_private_repo` 已提交並推送
- `ad-procurement-demo` 已提交並推送

## 尚未完全就緒
1. Linode OS 登入方式缺失
- 尚未提供 root password / SSH key / 重建授權

2. 多語路由問題未收斂
- 某些 `/en|ja|ko/...` clean path 仍由中文主 post 渲染
- 造成 canonical / `html lang` / GSC duplicate 問題

## 建議的收斂順序
1. 補齊 Linode OS 層登入
2. 修正多語 clean URL routing
3. 重新做一次搬移前健康檢查

## 搬移阻塞項（Blocking）
- [x] 兩個 repo 皆 push 到 GitHub
- [ ] Linode 主機 OS 層登入方式

## 非阻塞但應盡快處理
- [ ] 多語 canonical / routing
- [ ] 重新提交 sitemap 與切站後 GSC 驗證
