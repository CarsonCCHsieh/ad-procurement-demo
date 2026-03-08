# USADA News 遷移前精簡清理清單（保留 / 排除）

更新時間：2026-03-09（Asia/Taipei）

## 目標
- 只遷移網站可運作必需資料。
- 不把快取、暫存、歷史輸出、除錯檔案搬到新主機。
- 先降檔案數（inode）與垃圾檔比例，再做主機遷移。

## 本次清理策略

### 必留（重要不可移除）
- WordPress 核心：`wp-admin/`, `wp-includes/`, 根目錄核心 PHP
- 站點設定：`wp-config.php`（遷移時再改 DB/快取設定）
- 啟用中的主題：`wp-content/themes/<active-theme>/`
- 啟用中的外掛：`wp-content/plugins/`（只留實際使用）
- 媒體原圖：`wp-content/uploads/`（可排除大量衍生縮圖）
- 資料庫完整 dump（最高優先）

### 可優化（可清理/壓縮）
- `uploads` 的大量縮圖衍生檔（`-<寬>x<高>`）
- 過舊測試輸出 HTML / JSON / logs
- 非當前流程需要的中間檔

### 垃圾可移除（不搬移）
- 快取/升級暫存：
  - `wp-content/cache/**`
  - `wp-content/upgrade/**`
  - `wp-content/upgrade-temp-backup/**`
- 維運與除錯輸出：
  - `wp-content/uploads/vt-logs/**`
  - `wp-content/debug.log`
  - `error_log`
- 過時封存：`*.bak`, `*.old`, 不再使用的 `*.zip`

## 遷移排除規則（給 rsync/打包工具）

```txt
/wp-content/cache/**
/wp-content/upgrade/**
/wp-content/upgrade-temp-backup/**
/wp-content/uploads/vt-logs/**
/wp-content/uploads/wpallimport/**
/wp-content/uploads/vt-remaining.json
*.bak
*.old
*.zip
```

## 縮圖排除規則（選用）

```txt
*-*x*.jpg
*-*x*.jpeg
*-*x*.png
*-*x*.webp
```

## 執行順序（建議）
1. 先完整備份（檔案 + DB）
2. 套用排除規則做 dry-run
3. 清理 cache / logs / upgrade-temp-backup
4. 抽樣檢查前台圖片與文章是否正常
5. 再正式做遷移打包

## 2026-03-09 補充
- 今日例行維護已執行，站點健康掃描樣本 45，壞鏈接 0。
- 遷移前仍建議再做一次「縮圖衍生檔密度」抽樣，避免搬移無效 inode。
