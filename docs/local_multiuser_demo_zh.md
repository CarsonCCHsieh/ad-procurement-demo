# 本機多人 Demo 操作方式

## 用途

這份文件是給目前 demo 階段使用。

目標：
- 在你自己的電腦上同時提供前端與共享後端
- 讓 3 人以上可在同一時間看到相同的案件、設定與成效畫面

## 啟動方式

在專案根目錄執行：

```powershell
npm run local-demo
```

此指令會：
1. build 前端
2. 啟動 `server/shared-api.js`
3. 由同一個 Node server 提供：
   - 前端網站
   - 共享資料 API
   - SQLite

## 同事如何連線

啟動後，終端機會顯示：
- 本機網址
- LAN URL

同事只要與你在同一個網路，可直接開 `LAN URL`，例如：

```text
http://192.168.1.23:8787
```

## 目前多人共享的內容

目前共享後端會同步：
- 廠商互動下單資料
- Meta 官方投廣資料
- 投放成效頁資料
- 控制設定
- 定價設定
- 服務清單
- Meta 設定

## 本機模式限制

1. 你的電腦不能關機
2. `npm run local-demo` 不能中斷
3. Windows 防火牆需要允許 `8787`
4. 若要從 GitHub Pages 打回你的本機，還需要維持外部 tunnel 存活

## secrets 管理

不應提交到 Git 的內容：
- 真實 API key
- 真實 Meta token
- 真實帳密
- `data/` 下的 SQLite 與 secrets 檔

repo 內只保留範本：
- `.env.shared.example`
- `server/meta-local.example.json`
- `server/vendor-local.example.json`

## 這份文件和正式環境的差異

本機 demo 的用途是快速驗證流程。

未來搬到正式主機時，應將下列內容移到正式環境：
- `server/shared-api.js`
- SQLite 或正式 DB
- 本機 secrets 機制
- 外部 API 代理
- 定時同步與共享資料機制

正式搬遷與驗收請看：
- `docs/production_handoff_zh.md`
- `docs/api_and_storage_map_zh.md`
- `docs/deployment_topology_zh.md`
