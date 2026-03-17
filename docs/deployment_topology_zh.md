# 目前 Demo 與正式環境部署拓樸

## 文件目的

這份文件用來清楚區分：
- 目前 demo 版本實際怎麼運作
- 哪些部分是靜態頁面
- 哪些部分是本機後端
- 未來正式主機應如何替換

## 一、目前 Demo 拓樸

```text
使用者瀏覽器
  ├─ GitHub Pages 前端
  │    ├─ Login / Ad Orders / Meta / Performance / Settings
  │    └─ 呼叫 API
  │
  └─ 本機後端（Cloudflare tunnel / LAN）
       ├─ /api/health
       ├─ /api/state
       ├─ /api/state/batch
       ├─ /api/vendor/submit-order
       ├─ /api/vendor/sync-shared-orders
       ├─ /api/meta/post-metrics
       ├─ SQLite
       └─ 本機 secrets
```

### 目前實際分界

#### GitHub Pages 負責
- 顯示頁面
- 收集表單
- 顯示共享資料
- 觸發 API 呼叫

#### 本機後端負責
- 真正的共享資料保存
- 真正的供應商 API 代理
- 真正的 Meta 指標查詢
- 真正的資料同步
- 真正的 secrets 保存

## 二、目前 Demo 的限制

1. 本機後端不能停
2. tunnel 不能斷
3. SQLite 與 secrets 綁在單一電腦
4. 雖然可多人使用，但不是正式 HA 架構

## 三、建議的正式拓樸

### 最低可行正式版

```text
使用者瀏覽器
  └─ 正式前端站台
       └─ 正式後端 API
            ├─ shared state API
            ├─ vendor proxy
            ├─ meta proxy
            ├─ scheduler / sync
            └─ SQLite 或正式 DB
```

### 較合理的正式版

```text
使用者瀏覽器
  └─ 正式前端站台
       └─ 正式後端 API
            ├─ shared state API
            ├─ vendor proxy
            ├─ meta proxy
            ├─ job / scheduler
            ├─ secrets manager
            └─ PostgreSQL / MySQL
```

## 四、正式搬遷時的對應替換

| 目前 demo | 正式環境建議 |
| --- | --- |
| GitHub Pages | 正式前端主機或保留靜態 hosting |
| 本機 `server/shared-api.js` | 正式 Node.js API service |
| `data/shared-demo.sqlite` | 正式 DB 或正式 SQLite 儲存 |
| `data/*-local-secrets.json` | 環境變數 / Secrets Manager |
| Cloudflare quick tunnel | 正式網域與 TLS |

## 五、正式上線前必做

1. 將本機 API 全部搬到正式主機
2. 將 SQLite / state 搬到正式資料層
3. 將 vendor / Meta secrets 改成後端管理
4. 重新跑完整驗收流程
5. 確認前端不再依賴本機 tunnel

## 六、搭配閱讀

- `README.md`
- `docs/local_multiuser_demo_zh.md`
- `docs/production_handoff_zh.md`
- `docs/api_and_storage_map_zh.md`
