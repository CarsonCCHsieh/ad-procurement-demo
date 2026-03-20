# USADA 搬移基準總覽（2026-03-20）

## 這份文件的用途
這是目前搬移前的總控文件，說明：
- 哪個 repo 是程式主基準
- 哪個目錄是部署快照
- 目前還缺哪些條件
- 哪些問題搬移前必須接受，哪些必須先解決

## Source of Truth

### 1. 程式主基準
- `C:\Users\User\hsieh\maintain\github_private_repo`

這裡是目前實際維護與正式站部署時最接近的來源，包含：
- WordPress runtime plugin / mu-plugin / templates
- 維護工具與 sitemap 工具
- 正式站近期修正

### 2. 搬移快照
- `C:\Users\User\hsieh\repos\ad-procurement-demo\usadanews-code-snapshot`

這裡的用途不是取代主基準，而是：
- 提供搬移時的可讀快照
- 集中保留部署需要的關鍵檔
- 避免主機切換時漏搬某些模板與腳本

## 目前已確認就緒
- Linode API 可用
- Cloudflare API 可用
- 既有站點可持續維護
- 最新主要程式已同步進 snapshot
- 搬移 runbook / checklist / readiness 文件已補齊

## 目前仍未完成

### A. 正式阻塞
1. `maintain/github_private_repo` 尚未 commit / push
2. `ad-procurement-demo` 尚未 commit / push
3. Linode OS 層登入方式缺失

### B. 非阻塞但重要
1. 多語 clean URL routing 尚未完全修正
2. canonical / html lang / hreflang 在部分語系單頁仍可能不正確
3. 仍有部分 Newsmatic 主題資產殘留依賴

## 搬移前最低標準
要達到「可正式搬移」至少必須滿足：
- GitHub 兩個 repo 皆 push 到 origin
- Linode 主機可登入
- snapshot 與主 repo 一致
- 現站健康檢查無致命錯誤

## 建議順序
1. 先完成 Git 提交與推送
2. 補 Linode 登入方式
3. 建新主機環境
4. 匯入站點
5. 驗證
6. 切流量
