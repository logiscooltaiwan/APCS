# AP CS 模擬考系統：完整匯出

匯出時間：2026-10-15（台北時間）
線上版本：https://claude.ai/artifact/75nZfNVnquny4US6aEF7BL

## 檔案內容

| 路徑 | 說明 |
| --- | --- |
| `app/exam.html` | 系統原始碼，和線上發佈的檔案完全相同（HTML + CSS + JavaScript，單一檔案） |
| `app/index.html` | 同一份原始碼，外面包好完整的 HTML 文件結構，可以直接用瀏覽器開啟看程式碼與畫面 |
| `data/questions.json` | 完整題庫（CSA 選擇 15、CSA 問答 4、CSP 選擇 20），含 `id` |
| `data/questions-CSA.json`、`data/questions-CSP.json` | 依科目拆開的題庫，可直接貼進後台「題庫 → 匯入 / 匯出 JSON」 |
| `data/config.json` | 考試時間設定（分鐘） |
| `data/students.json`、`data/students.csv` | 考生名單（密碼只有雜湊值，沒有明碼） |
| `data/results.json` | 所有考試紀錄的完整資料（作答內容、評分、評語） |
| `data/results.csv` | 成績總表，可用 Excel 開啟（UTF-8 BOM） |

## 執行環境

這個系統是在 Claude 裡執行的網頁，以下三項功能由 Claude 平台提供：

- `db`：資料庫，存放題庫、考生、成績、設定
- `user`：判斷目前使用者是不是頁面的編輯者（決定能不能進後台）
- `sample`：用 AI 依評分標準批改問答題

在 Claude 以外直接開啟 `index.html`，畫面會顯示「無法連線」，因為少了資料庫。要部署到自己的伺服器，需要把程式中的 `claude.use('db')` 換成其他資料庫（例如 Firebase Firestore，API 寫法很接近），並把 `sample.json(...)` 換成呼叫 Claude API 的後端端點。

## 資料結構

**questions/{id}**
- 共同欄位：`exam`（CSA / CSP）、`section`（mcq / frq）、`order`、`topic`（CSA：U1–U4；CSP：BI1–BI5）、`stem`、`code`
- 選擇題：`choices`（陣列）、`answer`（"B" 或複選 ["B","C"]）、`multi`、`choiceMono`、`explanation`
- 問答題：`title`、`parts`：[{`label`, `points`, `prompt`, `rubric`}]

**students/{id}**：`name`、`pw`（SHA-256 of `apmock|姓名|密碼`）、`cls`、`exams`

**results/{id}**：`studentId`、`studentName`、`exam`、`status`（mcq / frq / grading / pending / done）、各階段時間戳、`qids`（開考當下的題目順序）、`mcqAnswers`、`marked`、`frqAnswers`、`frqGrades`、`summary`（答對數、各單元統計、綜合分、AP 估分）

**config/exams**：`{CSA:{mcqMin, frqMin}, CSP:{mcqMin}}`

## 評分規則

- CSA 綜合分 = 選擇題答對率 × 55% + 問答題得分率 × 45%
- CSP 綜合分 = 選擇題答對率（正式考試另有 30% Create 實作任務）
- AP 估分門檻：CSA 70 / 57 / 44 / 33%；CSP 75 / 62 / 47 / 35%（對應 5 / 4 / 3 / 2 分，為近似值）

## 還原或搬移資料

- 題庫：在後台「題庫 → 匯入 / 匯出 JSON」貼上 `questions-CSA.json` 或 `questions-CSP.json` 的內容。有相同 `id` 的題目會被覆蓋。
- 考生、成績、設定：交給 Claude 寫回資料庫（後台沒有這幾項的匯入功能）。

## 在本機（非 Claude 環境）執行

`server/` 是一個小型 Node.js（Express）後端，直接把 `data/*.json` 當作資料庫讀寫，取代原本只能在 Claude 平台才有的 `claude.use('db'/'user'/'sample')`。前端多了 `app/local.html`（`app/index.html` 的副本，載入了 `app/localdb-shim.js`），把同一套 Firestore 風格的呼叫方式（`collection().onSnapshot()`、`doc().update()` 等）轉成打這個後端的 REST API，所以 `app/exam.html`／`app/index.html` 本身完全沒有被改動，仍可照原樣部署回 Claude。

```bash
cd server
npm install
npm start
```

開啟 http://localhost:4173 即可使用。資料就是 `data/` 資料夾裡的那幾個 JSON 檔，重開伺服器或重開機都還在；題庫、考生、成績都是直接讀寫這些檔案（有自動的原子寫入，不會因為中途斷電而壞檔）。

- **考官後台**：登入頁右上角按「考官登入」，預設管理密碼是 `teacher123`（可用環境變數 `ADMIN_PASSWORD` 覆蓋，例如 `ADMIN_PASSWORD=mypass npm start`）。登入後畫面上會多出「考官後台」按鈕，功能與線上版完全一樣：新增/刪除考生、重設密碼、題庫新增/編輯/刪除/JSON 匯入匯出、考試時間設定、成績列表與手動批改問答題。
- **AI 自動批改問答題**：預設關閉（會直接用「考官後台」手動評分，和原本「無法使用 AI」時一樣）。若要開啟，設定環境變數 `ANTHROPIC_API_KEY`（需要一個 Anthropic API key），可選 `ANTHROPIC_MODEL`（預設 `claude-haiku-5-5`）：
  ```bash
  ANTHROPIC_API_KEY=sk-ant-... npm start
  ```
- **換連接埠**：設定環境變數 `PORT`，例如 `PORT=8080 npm start`。
- 這套本機後端的權限管控很單薄（密碼比對、簡單的 session cookie），和原本「練習用系統」的安全等級一致，請勿用於正式評量或對外公開的伺服器。
