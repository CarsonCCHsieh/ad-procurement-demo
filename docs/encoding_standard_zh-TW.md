# 文字編碼與換行標準

## 標準
- 全專案統一：`UTF-8`（無 BOM）
- 換行統一：`LF`

## 目的
- 避免中文亂碼與雙重轉碼
- 避免 Windows/macOS/Linux 換行差異造成無意義 diff

## 已落地機制
- `.editorconfig`：`charset=utf-8`、`end_of_line=lf`
- `.gitattributes`：文字檔統一 LF
- `scripts/check_encoding.mjs`：檢查 BOM、U+FFFD、可疑亂碼特徵
- CI（GitHub Pages workflow）：build 前先跑 `npm run check:encoding`

## 日常流程（必做）
1. `npm run check:encoding`
2. `npm run build`
3. 通過後再 commit / push

## 若再次出現亂碼，排查順序
1. 確認編輯器儲存格式是 UTF-8
2. 確認終端或工具未做 Big5 / ANSI 轉碼
3. 針對異常檔案做最小修復，重新跑 `check:encoding`
