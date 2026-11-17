# CareersCloud LMS Daily Quiz Automation System

An automated end-to-end tool to parse daily Word documents (`.docx`), extract questions, options, answers, explanations, and table screenshots, and publish them directly to **Course 104** on the CareersCloud LMS admin panel.

---

## 🚀 Quick Start (1-Click Run for Employees)

1. **Place your daily `.docx` file** inside the `Quiz Document/` folder (or workspace root).
2. **Double-click `start.bat`**.
3. Your browser will automatically open to **http://localhost:3001**:
   - Click **"Parse Document"** to preview all parsed questions, answers, and explanations.
   - Click **"Start Automated Upload"** and watch the questions publish automatically in real time!

---

## 🛠 Features

- **Document Parser (`src/parser.js`):**
  - Extracts Quiz Title, Question body, Options (1 to 5), Correct Answer, and Explanation.
  - Automatically handles **Statement-based questions** (Statements A, B, C inside question body, and 1-5 as actual options).
  - Extracts Topics (`National Affairs`, `Banking & Finance`, etc.) and Difficulty levels (`Easy`, `Medium`).
- **Table-to-Image Engine (`src/tableRenderer.js`):**
  - When tables or DI sets are found in the Word document, it automatically renders them at **2x Retina resolution** into clean PNG images and attaches them to the question to prevent layout breakage.
- **Direct CKEditor 5 Injection (`src/uploader.js`):**
  - Directly sets HTML into CKEditor instances without slow typing or clipboard errors.
  - Automatically selects correct choice radio buttons, topic dropdowns, and difficulty levels.
- **Interactive Executive Dashboard (`public/`):**
  - Modern web interface with real-time SSE execution logs, progress bar, and visual question preview cards.
  - Supports both **Background (Headless)** and **Watch Live (Headful)** browser modes.

---

## ⚙️ Manual Commands (Terminal)

```bash
# Start the web dashboard:
npm start

# Parse docx via CLI:
npm run parse

# Re-login or update saved session:
npm run login
```
