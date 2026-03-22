# 文字編碼標準（UTF-8）

本專案所有文字檔統一使用：

- `UTF-8`（無 BOM）
- `LF` 換行

## 為什麼

- 避免中文亂碼、問號佔位字串、替代字元（U+FFFD）等問題反覆出現
- 避免 Windows / macOS / Linux 換行差異造成無意義 diff

## 已實作的防呆

- `.editorconfig`
  - `charset = utf-8`
  - `end_of_line = lf`
- `.gitattributes`
  - `* text=auto eol=lf`
- `scripts/check_encoding.mjs`
  - 檢查 UTF-8 BOM
  - 檢查 U+FFFD
  - 檢查可疑亂碼特徵
  - 檢查可疑連續問號佔位字串
- GitHub Actions (`pages.yml`)
  - build 前必跑 `npm run check:encoding`

## 日常開發規範

1. 修改後先跑：
   - `npm run check:encoding`
2. 再跑：
   - `npm run build`
3. 通過後再 commit / push
