# USADA 搬移狀態摘要

最後更新：2026-03-20（Asia/Taipei）

## 結論
目前狀態：**可進入正式搬移前收斂階段，但尚未可直接切站。**

## 已完成
- Linode API / Cloudflare API 均可正常使用
- `usada-prod-01` 已建立並可從 API 讀取狀態
- `usadanews.com` Cloudflare Zone 已存在，Zone ID 已具備
- 現站 WordPress 維護流程可持續運作
- 站內主要程式快照已整理到 `usadanews-code-snapshot`
- 搬移採購清單與廣告規劃文件已建立

## 尚未完成
1. GitHub 尚未完全收斂成搬移基準
2. Linode 主機 OS 層登入方式尚未補齊
3. 多語 clean URL routing / canonical 還未完全修正
4. Cloudflare Zone 仍待實際接管 Nameserver

## 對搬移的影響
- 1、2 是正式搬移阻塞項
- 3 不阻止搬移，但若不先修，搬移後 SEO 驗證會持續有問題
- 4 是正式切流量前最後一步

## 下一步
1. 完成 GitHub 版本整理與推送
2. 補齊 Linode 登入方式
3. 在 Linode 佈署新站
4. 切換 Cloudflare / Nameserver
