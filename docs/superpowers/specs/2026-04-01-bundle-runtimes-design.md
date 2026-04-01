# 設計文件：將 Node.js 與 Python Runtime 打包進 App

## 背景

依據 [ADR-0001](../../adr/0001-bundle-runtimes.md)，將 Node.js 與 Python 執行環境打包進 dtd-desktop，讓使用者零設定即可執行 docx / pdf / pptx / xlsx 相關 skills。

## 範圍

- **目標平台**：Windows only
- **Runtime 版本**：Node.js 22 LTS portable (win-x64) + Python 3.13 embeddable (win-amd64)
- **預估體積增加**：~150-200MB

### 不在範圍內

- macOS / Linux 支援
- CLI 工具打包（LibreOffice、Poppler、qpdf、Tesseract）
- 擴充包下載機制
- 新增 Tauri command 或前端修改

## 目錄結構

Build 時產生，打包後位於 app resource 目錄：

```
src-tauri/resources/
  node/
    node.exe
    node_modules/
      docx/
      pptxgenjs/
      pdf-lib/
  python/
    python.exe
    python313.dll
    python313.zip              ← 標準函式庫
    Lib/
      site-packages/
        pypdf/
        pdfplumber/
        reportlab/
        openpyxl/
        pandas/
        markitdown/
        Pillow/
        pdf2image/
```

`src-tauri/resources/` 加入 `.gitignore`。

## Build 流程

新增 `scripts/setup-runtime.mjs`，由 npm script `setup-runtime` 執行，在 `tauri build` 前呼叫。

### 步驟

1. **下載 Node.js portable**
   - 來源：`https://nodejs.org/dist/v22.x.x/node-v22.x.x-win-x64.zip`
   - 解壓到 `src-tauri/resources/node/`

2. **下載 Python embeddable**
   - 來源：`https://www.python.org/ftp/python/3.13.x/python-3.13.x-embed-amd64.zip`
   - 解壓到 `src-tauri/resources/python/`

3. **啟用 Python pip**
   - 下載並執行 `get-pip.py`
   - 修改 `python313._pth` 取消註解 `import site`

4. **安裝 Python 套件**
   ```
   python.exe -m pip install --target=resources/python/Lib/site-packages \
     pypdf pdfplumber reportlab openpyxl pandas \
     "markitdown[pptx]" Pillow pdf2image
   ```

5. **安裝 Node.js 套件**
   ```
   npm install --prefix=resources/node docx pptxgenjs pdf-lib
   ```

### 冪等性

腳本檢查已存在的 runtime 版本，版本正確則跳過下載。版本號定義為腳本頂部常數。

## Tauri 設定

`tauri.conf.json` 新增：

```json
{
  "bundle": {
    "resources": {
      "resources/node": "resources/node",
      "resources/python": "resources/python"
    }
  }
}
```

## Rust 整合

### 新增 `src-tauri/src/runtime.rs`

| 函式 | 用途 |
|------|------|
| `resolve_runtime_path(app_handle, "node")` | 回傳 bundled `node.exe` 的 `PathBuf` |
| `resolve_runtime_path(app_handle, "python")` | 回傳 bundled `python.exe` 的 `PathBuf` |
| `build_runtime_env(app_handle)` | 回傳環境變數 `HashMap`：PATH prepend node/ + python/、NODE_PATH、PYTHONPATH |

### 修改 `execute_bash()`

在 `std::process::Command` spawn 前，呼叫 `build_runtime_env()` 注入環境變數，讓 `cmd /C` 執行的指令能直接使用 `node`、`python`。

改動量：約 5-10 行。

## 預裝套件清單

### Node.js (npm)

| 套件 | 用途 | skill |
|------|------|-------|
| `docx` | 建立 Word 文件 | docx |
| `pptxgenjs` | 建立 PowerPoint | pptx |
| `pdf-lib` | PDF 表單填寫 | pdf |

### Python (pip)

| 套件 | 用途 | skill |
|------|------|-------|
| `pypdf` | PDF 合併/分割/旋轉/加密 | pdf |
| `pdfplumber` | PDF 文字/表格擷取 | pdf |
| `reportlab` | 建立 PDF | pdf |
| `openpyxl` | Excel 讀寫 | xlsx, pdf |
| `pandas` | 資料分析 | xlsx, pdf |
| `markitdown[pptx]` | pptx 文字擷取 | pptx |
| `Pillow` | 圖片處理/縮圖 | pptx |
| `pdf2image` | PDF 轉圖片 | pdf, docx |

### 排除

- `pytesseract`：需要系統安裝 Tesseract OCR engine，歸類為未來擴充包

## CLI 工具處理

不做特殊處理。`execute_bash()` 執行 `soffice`、`pdftoppm` 等指令時，若系統未安裝，`cmd /C` 回傳的 stderr 錯誤訊息會原樣回傳給 LLM，由 LLM 自行告知使用者。

## 檔案異動清單

| 檔案 | 異動類型 | 說明 |
|------|----------|------|
| `scripts/setup-runtime.mjs` | 新增 | 下載、解壓、安裝套件 |
| `src-tauri/src/runtime.rs` | 新增 | 路徑解析、環境變數建構 |
| `src-tauri/tauri.conf.json` | 修改 | 加入 bundle.resources |
| `src-tauri/src/commands.rs` | 修改 | execute_bash() 注入環境變數 |
| `src-tauri/src/lib.rs` | 修改 | 註冊 runtime 模組 |
| `package.json` | 修改 | 加入 setup-runtime script |
| `.gitignore` | 修改 | 排除 src-tauri/resources/ |
