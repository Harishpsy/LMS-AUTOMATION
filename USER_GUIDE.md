# CareersCloud LMS Daily Quiz Automation — User Guide

A step-by-step operational guide for employees and administrators to parse daily quiz Word documents (`.docx`) and automatically publish questions, options, answers, and explanations to the CareersCloud LMS Admin Panel.

---

## 1. Quick Overview

The automation system eliminates manual copy-pasting by:
1. Extracting questions, options (A to E), correct answers, explanations, and tables from your `.docx` file.
2. Logging into the CareersCloud LMS Admin Panel.
3. Directly injecting data into the CKEditor and saving each question automatically.

```
[ Daily .docx Document ] 
          ↓
[ Start_Dashboard.bat ] 
          ↓
[ http://localhost:3000 ] 
          ↓
[ Parse & Preview Questions ] 
          ↓
[ Click 'Start Automated Upload' ] 
          ↓
[ Questions Published in Course 104 ]
```

---

## 2. Prerequisites & First-Time Setup

### Is Node.js Required on Other Systems?
**Yes.** If another team member runs `Start_Dashboard.bat` on their PC, their system requires:
1. **Node.js (LTS version)**: Download and install from [nodejs.org](https://nodejs.org/).
2. **Google Chrome** installed.
3. **One-time terminal setup** (in the project folder):
   ```bash
   npm install
   npx playwright install chromium
   ```

> **Tip (Zero Installation for Team Members):** 
> You can also run the dashboard on one main PC or server. Anyone on the same office Wi-Fi/LAN can open `http://<YOUR_IP>:3000` in their browser and use the full upload tool without installing Node.js at all!

---

## 3. Step-by-Step Instructions

### Step 1: Launch the Automation Dashboard

1. Navigate to the project root folder:
   `LMS ADMIN PANNEL QUIZ AUTOMATION`
2. Double-click the file named **`Start_Dashboard.bat`**.
3. A command prompt window will open and initialize the server.
4. Your default browser will automatically open to:
   **`http://localhost:3000`**

> **Note:** Keep the command prompt window open in the background while using the dashboard. You can close it once your upload tasks are complete.

---

### Step 2: Verify LMS Session & Credentials

At the top right corner of the dashboard:
1. Check the **Auth Status Badge**:
   - **Green ("Session Valid")**: You are already authenticated and ready to proceed.
   - **Yellow / Red**: You need to log in.
2. If you need to set or update your login details:
   - Click the **"LMS Credentials"** button.
   - Enter your LMS Admin Email/Username and Password.
   - Click **Save & Authenticate**.
3. If an existing session has timed out, click the **"Re-login"** icon button to refresh it.

---

### Step 3: Select Target Course & Quiz (Section 1)

1. **Course ID**: Default is **`104`** (General/Daily CA Course). Modify this if targeting a different course.
2. **Target Quiz in Course**:
   - **Option A (Default - Fastest)**: Keep **"⚡ Latest Created Quiz (Click First Eye Icon)"** selected. The tool will automatically open and edit the topmost/newest quiz in the course.
   - **Option B (Specific Quiz)**: Click **"Refresh"** to fetch available quizzes from the LMS, then pick the exact quiz from the dropdown list.
   - **Option C (Search / Direct ID)**: Type part of the quiz name (e.g. `DAILY CA QUIZ 28 OCT`) or enter the numerical Quiz ID directly into the search field.
3. **Start from Q#**:
   - Default is **`1`**.
   - If an earlier session was stopped or interrupted (e.g., at Question 15), enter **`16`** here to resume from Question 16 without duplicating earlier questions.

---

### Step 4: Provide and Parse the Word Document (Section 2)

Choose either of the two methods:

#### Method A: Workspace Folder
1. Copy or save your daily `.docx` file into the `Quiz Document/` folder inside the project.
2. Click the **"Workspace Folder"** tab on the dashboard.
3. Select your file from the **"Available Quiz Files"** dropdown.
4. Click **"Parse Document"**.

#### Method B: Direct Upload from Computer
1. Click the **"Upload from Computer"** tab.
2. Drag and drop your `.docx` file into the designated box, or click **"Browse File"** to select it from your computer.
3. Click **"Upload & Parse"**.

---

### Step 5: Review Question Preview

After parsing finishes:
1. Check the summary bar showing **Total Questions Detected** (e.g., 20 or 25 questions).
2. Scroll through the **Question Preview Cards**:
   - Verify the question body, statement formatting, and any rendered table images.
   - Verify the options (A, B, C, D, E).
   - Verify that the correct answer key and explanation text are accurate.
3. If any typo or formatting issue is spotted in the source document, update the `.docx` file and click **Parse** again.

---

### Step 6: Configure Execution & Start Upload (Section 3)

1. **Display Mode (Headful vs. Headless)**:
   - **Headful (Recommended)**: Keep the toggle ON. A visible Chrome browser will appear so you can observe the bot actively selecting options and entering text in real time.
   - **Headless**: Toggle OFF if you prefer the bot to run silently in the background without opening browser windows.
2. **Parallel Workers**:
   - **3 Workers (Recommended)**: Uploads 3 questions at a time in parallel for maximum speed and stability.
   - **1 Worker**: Sequential upload (one question after another), useful if you want to closely inspect each entry.
3. **Start Upload**:
   - Click the green **"🚀 Start Automated Upload"** button.

---

### Step 7: Monitor Progress & Completion

1. The real-time progress bar will advance as questions are uploaded.
2. Individual question cards will highlight in **green** upon successful submission.
3. The live terminal log at the bottom displays timestamped actions and status updates.
4. When finished, a confirmation notification will appear indicating that all questions have been published.
5. You can now verify the quiz directly in the CareersCloud LMS Admin Panel.

---

## 4. Key Rules for Preparing the Word Document (`.docx`)

To ensure 100% parsing accuracy:
- **Question Numbering**: Ensure questions begin with standard numbering (e.g., `Q1.`, `1.`, `Question 1:`).
- **Options**: Format options clearly as `(a)`, `(b)`, `(c)`, `(d)`, `(e)` or `A)`, `B)`, `C)`, `D)`, `E)`.
- **Answers**: Include the correct answer label clearly (e.g., `Answer: c`, `Ans: 3`, or `Correct Option: B`).
- **Explanation**: Prefix explanations with `Explanation:`, `Exp:`, or `Solution:`.
- **Tables**: Place tables directly under the respective question or passage; the system will automatically convert them into clear images.

---

## 5. Troubleshooting & Frequently Asked Questions

| Problem | Cause | Solution |
| :--- | :--- | :--- |
| **"Session Expired" / Login failed** | LMS session token expired or password changed | Click **"LMS Credentials"** at the top right, enter your updated credentials, and click **Save & Authenticate**. |
| **Document does not appear in dropdown** | File is saved in another folder or wrong extension | Ensure the file is saved as `.docx` (not `.doc` or `.pdf`) in the `Quiz Document/` folder, or use the **"Upload from Computer"** tab. |
| **Upload stopped mid-way due to internet drop** | Connection interrupted during question entry | Check the last saved question in LMS (e.g., Q10). Change **"Start from Q#"** to **`11`** and click **Start Automated Upload** to resume without duplicates. |
| **Port 3000 in use error** | Another instance of the server is running | Close any open Node.js command prompt windows, then re-open `Start_Dashboard.bat`. |

---

## 6. Support & Maintenance

- **Log files**: Session logs are displayed in the dashboard console and saved under the `screenshots/` directory for troubleshooting.
- **Session state**: Stored locally in `storageState.json` so you do not need to re-type credentials on every run.
