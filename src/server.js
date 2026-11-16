const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { chromium } = require('playwright');
const { parseQuizDocx } = require('./parser');
const { uploadQuizQuestions } = require('./uploader');
const { ensureAuthenticatedSession, ensureValidSession, getSessionInfo, loginWithCredentials, clearSavedSession } = require('./auth');
const { generateDailyQuiz, generateFromParsedQuiz } = require('./dailyPdfGenerator');
const { generateMonthlyQuiz } = require('./monthlyPdfGenerator');
const { generateModernDailyPdf } = require('./modernPdfGenerator');
const { listSourceFiles, listGeneratedFiles, OUTPUT_DIR } = require('./quizParser');
const { convertDocxToPdf } = require('./docxToPdf');

// ─── CONFIGURATION & INITIALIZATION ──────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, '..');
const STORAGE_PATH = path.join(ROOT_DIR, 'storageState.json');

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(ROOT_DIR, 'public')));

// ─── MULTER UPLOAD CONFIGURATION ─────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folderName = path.join('Uploaded Documents', 'Quiz');
    if (req.query.folder === 'monthly') {
      const monthSub = req.query.month ? getMonthFolder(req.query.month) : '';
      folderName = monthSub
        ? path.join('Uploaded Documents', 'Monthly', monthSub)
        : path.join('Uploaded Documents', 'Monthly');
    } else if (req.query.folder === 'daily') {
      folderName = path.join('Uploaded Documents', 'Daily');
    }
    const dir = path.join(ROOT_DIR, folderName);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Keep original file name, overwrite if re-uploaded
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const isDocx = file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                   file.originalname.endsWith('.docx');
    if (isDocx) {
      cb(null, true);
    } else {
      cb(new Error('Only .docx files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
});

// ─── SSE (SERVER-SENT EVENTS) REAL-TIME STREAMING ────────────────────────────
let activeSseClients = [];

/**
 * Broadcast an event payload to all connected SSE clients
 * @param {object} data
 */
function broadcastEvent(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  activeSseClients.forEach(client => {
    try {
      client.write(payload);
    } catch (e) {
      // Client disconnected
    }
  });
}

// SSE stream endpoint for real-time progress updates
app.get('/api/upload-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  activeSseClients.push(res);
  req.on('close', () => {
    activeSseClients = activeSseClients.filter(c => c !== res);
  });
});

// ─── ASSET ROUTES (TABLE SCREENSHOTS & EXTRACTED IMAGES) ─────────────────────

/**
 * GET /api/assets
 * Returns all extracted tables and images as data URIs for dashboard gallery preview
 */
app.get('/api/assets', (req, res) => {
  try {
    const searchDirs = [
      path.join(ROOT_DIR, 'Quiz Document', 'extracted_assets'),
      path.join(ROOT_DIR, 'extracted_assets')
    ];

    const result = { tables: [], images: [] };

    for (const assetsDir of searchDirs) {
      const tablesDir = path.join(assetsDir, 'tables');
      const imagesDir = path.join(assetsDir, 'images');

      if (fs.existsSync(tablesDir)) {
        const tableFiles = fs.readdirSync(tablesDir).filter(f => /\.(png|jpg|jpeg)$/i.test(f)).sort();
        for (const f of tableFiles) {
          const filePath = path.join(tablesDir, f);
          const b64 = fs.readFileSync(filePath).toString('base64');
          const ext = path.extname(f).slice(1).toLowerCase();
          result.tables.push({
            name: f,
            src: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b64}`
          });
        }
      }

      if (fs.existsSync(imagesDir)) {
        const imgFiles = fs.readdirSync(imagesDir).filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f)).sort();
        for (const f of imgFiles) {
          const filePath = path.join(imagesDir, f);
          const b64 = fs.readFileSync(filePath).toString('base64');
          const ext = path.extname(f).slice(1).toLowerCase();
          result.images.push({
            name: f,
            src: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b64}`
          });
        }
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/view-asset
 * Serves an individual asset file by relative or absolute path for previewing in the dashboard cards
 */
app.get('/api/view-asset', (req, res) => {
  try {
    const rawPath = req.query.path;
    if (!rawPath) return res.status(400).send('Path is required');

    const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.join(ROOT_DIR, rawPath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).send('Asset not found');
    }

    res.sendFile(resolvedPath);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ─── FILE DISCOVERY & LMS DATA ───────────────────────────────────────────────

/**
 * GET /api/files
 * Lists available .docx files in Quiz Document/ folder and workspace root
 */
app.get('/api/files', (req, res) => {
  try {
    const quizDocDir = path.join(ROOT_DIR, 'Quiz Document');
    const files = [];

    if (fs.existsSync(quizDocDir)) {
      const items = fs.readdirSync(quizDocDir).filter(f => f.endsWith('.docx'));
      items.forEach(f => files.push(`Quiz Document/${f}`));
    }

    const rootItems = fs.readdirSync(ROOT_DIR).filter(f => f.endsWith('.docx'));
    rootItems.forEach(f => files.push(f));

    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AUTHENTICATION & SESSION MANAGEMENT ─────────────────────────────────────

/**
 * GET /api/auth-status
 * Returns current session validity and token expiration details
 */
app.get('/api/auth-config', (req, res) => {
  try {
    res.json({
      hasCredentials: !!(process.env.LMS_EMAIL && process.env.LMS_PASSWORD),
      email: process.env.LMS_EMAIL || ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth-status', (req, res) => {
  try {
    const info = getSessionInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/login
 * Re-authenticates with .env credentials and refreshes storageState.json
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, saveToEnv } = req.body || {};
    const info = await loginWithCredentials({
      email,
      password,
      saveToEnv: saveToEnv !== false,
      headless: true,
      onLog: console.log
    });
    res.json({ success: true, info });
  } catch (err) {
    console.error('Manual login trigger failed:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/auth/logout
 * Clears saved session file
 */
app.post('/api/auth/logout', (req, res) => {
  try {
    clearSavedSession();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/quizzes
 * Fetches published quizzes for a selected course from the LMS
 */
app.get('/api/quizzes', async (req, res) => {
  const courseId = req.query.courseId || '104';
  let browser;

  try {
    // Proactively verify and renew expired token before opening page
    await ensureValidSession(console.log);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: STORAGE_PATH });
    const page = await context.newPage();

    await page.goto(`https://lms.careerscloud.in/courses/view/${courseId}`, { waitUntil: 'networkidle', timeout: 30000 });

    const reLogged = await ensureAuthenticatedSession(page, context);
    if (reLogged) {
      await page.goto(`https://lms.careerscloud.in/courses/view/${courseId}`, { waitUntil: 'networkidle', timeout: 30000 });
    }

    const tab = page.locator('.ui.tabular.menu a.item', { hasText: 'Quizzes' }).first();
    await tab.waitFor({ state: 'visible', timeout: 30000 });
    await tab.click();
    await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});

    const rawQuizzes = await page.$$eval('table tbody tr', rows => rows.map(r => {
      const titleEl = r.querySelector('strong, b, .title') || r.querySelector('td:nth-child(2)');
      const viewLink = r.querySelector('a.view');
      const statusEl = r.querySelector('.grid-status-chip, .activatebbt');
      const text = titleEl ? titleEl.innerText : '';
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      return {
        title: lines[0] || 'Untitled Quiz',
        quizId: viewLink && viewLink.href ? viewLink.href.split('/').pop() : null,
        status: statusEl ? statusEl.innerText.trim() : ''
      };
    }));

    const quizzes = rawQuizzes.filter(q => q.quizId);
    await browser.close();

    res.json({ courseId, quizzes });
  } catch (err) {
    console.error('Error fetching course quizzes:', err.message);
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    // Return graceful fallback rather than crash
    res.json({ courseId, quizzes: [], error: err.message });
  }
});

// ─── PARSING & UPLOAD ROUTES ─────────────────────────────────────────────────

/**
 * POST /api/parse
 * Parses an existing .docx file from the workspace
 */
app.post('/api/parse', async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename is required' });

    const fullPath = path.join(ROOT_DIR, filename);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File does not exist' });

    const parsedData = await parseQuizDocx(fullPath);
    res.json(parsedData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/upload-docx
 * Accepts a newly uploaded .docx file and immediately parses it
 */
app.post('/api/upload-docx', (req, res) => {
  upload.single('docxFile')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file received' });
    }

    try {
      const savedPath = req.file.path;
      const parsedData = await parseQuizDocx(savedPath);
      res.json({
        ...parsedData,
        uploadedFile: path.relative(ROOT_DIR, savedPath).replace(/\\/g, '/')
      });
    } catch (parseErr) {
      res.status(500).json({ error: parseErr.message });
    }
  });
});

/**
 * POST /api/upload
 * Starts automated question upload to the LMS portal with real-time SSE progress events
 */
app.post('/api/upload', async (req, res) => {
  try {
    const { quizData, courseId, targetQuiz, startFromQ, headless, workers, parallelWorkers } = req.body;
    if (!quizData || !quizData.questions || quizData.questions.length === 0) {
      return res.status(400).json({ error: 'Valid quiz data is required' });
    }

    res.json({ started: true });

    uploadQuizQuestions(quizData, {
      courseId: courseId || '104',
      targetQuiz: targetQuiz || 'latest',
      startFromQ: startFromQ || 1,
      headless: headless !== undefined ? headless : false,
      workers: parseInt(workers || parallelWorkers, 10) || 1
    }, (event) => {
      broadcastEvent(event);
    }).catch(err => {
      broadcastEvent({ type: 'error', message: err.message });
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── QUIZ DOCX / PDF GENERATION ROUTES ──────────────────────────────────────

// Track the most recent generation run
let latestGeneratedRun = {
  mode: null,
  timestamp: null,
  files: []
};

function getGeneratedFileMeta(fp) {
  const stat = fs.existsSync(fp) ? fs.statSync(fp) : { size: 0, mtimeMs: Date.now() };
  const pdfFp = fp.replace(/\.docx$/i, '.pdf');
  const hasPdf = fs.existsSync(pdfFp) && fs.statSync(pdfFp).size > 0;
  const parentName = path.basename(path.dirname(fp));
  const isDateFolder = /^\d{4}/.test(parentName);
  return {
    name: path.basename(fp),
    dateFolder: isDateFolder ? parentName : '',
    displayName: isDateFolder ? `${parentName} / ${path.basename(fp)}` : path.basename(fp),
    path: fp,
    ext: 'docx',
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    hasPdf,
    pdfPath: hasPdf ? pdfFp : null,
    pdfSize: hasPdf && fs.existsSync(pdfFp) ? fs.statSync(pdfFp).size : null
  };
}

function getCurrentGeneratedFiles() {
  if (latestGeneratedRun && latestGeneratedRun.files && latestGeneratedRun.files.length > 0) {
    return latestGeneratedRun.files
      .filter(f => f && f.path && f.path.endsWith('.docx') && fs.existsSync(f.path))
      .map(f => getGeneratedFileMeta(f.path));
  }

  // Fallback on startup: get the most recent batch of generated files
  const dirs = [
    path.join(OUTPUT_DIR, 'Daily'),
    path.join(OUTPUT_DIR, 'Monthly'),
    path.join(OUTPUT_DIR, 'Parsed')
  ];
  const allFiles = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isFile() && ent.name.endsWith('.docx') && !ent.name.startsWith('~$')) {
        allFiles.push(getGeneratedFileMeta(path.join(dir, ent.name)));
      } else if (ent.isDirectory()) {
        const subFiles = fs.readdirSync(path.join(dir, ent.name)).filter(f => f.endsWith('.docx') && !f.startsWith('~$'));
        for (const sf of subFiles) {
          allFiles.push(getGeneratedFileMeta(path.join(dir, ent.name, sf)));
        }
      }
    }
  }

  if (allFiles.length === 0) return [];

  allFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newestTime = allFiles[0].mtimeMs;
  return allFiles.filter(f => Math.abs(newestTime - f.mtimeMs) < 60000);
}

/**
 * POST /api/pdf-gen/upload
 * Accepts uploaded .docx source file(s), saves to 'Daily PDF', 'Monthly PDF', or 'Quiz Document',
 * and returns the saved file info so it can be selected immediately.
 */
app.post('/api/pdf-gen/upload', (req, res) => {
  upload.any()(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    const files = req.files || (req.file ? [req.file] : []);
    if (files.length === 0) {
      return res.status(400).json({ error: 'No file received' });
    }

    let subfolder = 'Quiz';
    if (req.query.folder === 'monthly') {
      const monthSub = req.query.month ? getMonthFolder(req.query.month) : '';
      subfolder = monthSub ? path.join('Monthly', monthSub) : 'Monthly';
    } else if (req.query.folder === 'daily') {
      subfolder = 'Daily';
    }

    const folderRelative = path.join('Uploaded Documents', subfolder).replace(/\\/g, '/');

    const uploaded = files.map(f => {
      broadcastEvent({
        type: 'pdf-gen-log',
        message: `📥 Source file uploaded to ${folderRelative}: ${f.originalname} (${Math.round(f.size / 1024)} KB)`
      });
      return {
        name: f.originalname,
        path: f.path,
        size: f.size
      };
    });

    res.json({
      success: true,
      files: uploaded,
      name: uploaded[0].name,
      path: uploaded[0].path,
      folder: folderRelative
    });
  });
});

function monthLabelFromFolder(folderName) {
  const m = String(folderName).match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthIdx = parseInt(m[2], 10) - 1;
    if (names[monthIdx]) return `${names[monthIdx]} ${m[1]}`;
  }
  return folderName;
}

/**
 * GET /api/pdf-gen/files
 * Lists available source documents in Uploaded Documents/, Daily PDF, Monthly PDF, & Quiz Document, plus already generated files
 */
app.get('/api/pdf-gen/files', (req, res) => {
  try {
    const uploadedDailyDir = path.join(ROOT_DIR, 'Uploaded Documents', 'Daily');
    const legacyDailyDir = path.join(ROOT_DIR, 'Daily PDF');

    const uploadedMonthlyDir = path.join(ROOT_DIR, 'Uploaded Documents', 'Monthly');
    const legacyMonthlyDir = path.join(ROOT_DIR, 'Monthly PDF');
    const legacyMonthlySampleDir = path.join(ROOT_DIR, 'Monthly PDF Sample');

    const uploadedQuizDir = path.join(ROOT_DIR, 'Uploaded Documents', 'Quiz');
    const legacyQuizDocDir = path.join(ROOT_DIR, 'Quiz Document');

    // Discover month subfolders in Uploaded Documents/Monthly (e.g. 2026-10, 2026-11)
    const monthlyGroups = [];
    const uploadedMonthlySubFiles = [];
    if (fs.existsSync(uploadedMonthlyDir)) {
      const entries = fs.readdirSync(uploadedMonthlyDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          const subDir = path.join(uploadedMonthlyDir, ent.name);
          const subFiles = listSourceFiles(subDir);
          if (subFiles.length > 0) {
            monthlyGroups.push({
              folder: ent.name,
              label: monthLabelFromFolder(ent.name),
              path: subDir,
              count: subFiles.length
            });
            uploadedMonthlySubFiles.push(...subFiles);
          }
        }
      }
    }

    // Filter out template files so source selector only displays actual test quizzes
    const isDailyTemplate = (name) => /Affairscloud|Current Affairs Q&A PDF/i.test(name);
    const isMonthlyTemplate = (name) => /Monthly Topic Wise Quiz - October 2026/i.test(name);

    const dailySources = [
      ...listSourceFiles(uploadedDailyDir),
      ...listSourceFiles(legacyDailyDir).filter(f => !isDailyTemplate(f.name))
    ];
    const monthlySources = [
      ...uploadedMonthlySubFiles,
      ...listSourceFiles(uploadedMonthlyDir),
      ...listSourceFiles(legacyMonthlyDir).filter(f => !isMonthlyTemplate(f.name)),
      ...listSourceFiles(legacyMonthlySampleDir).filter(f => !isMonthlyTemplate(f.name))
    ];
    const quizDocSources = [
      ...listSourceFiles(uploadedQuizDir),
      ...listSourceFiles(legacyQuizDocDir)
    ];
    const generated = listGeneratedFiles();
    const currentGenerated = getCurrentGeneratedFiles();

    res.json({
      dailySources,
      monthlySources,
      monthlyGroups,
      quizDocSources,
      currentGenerated,
      mode: latestGeneratedRun.mode || null,
      generated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pdf-gen/generate-daily
 * Generates Daily Quiz DOCX (English and Hindi separately) from a selected source file
 */
app.post('/api/pdf-gen/generate-daily', async (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'filePath is required' });

    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Source file not found' });
    }

    res.json({ started: true });

    broadcastEvent({ type: 'pdf-gen-log', message: `🚀 Starting Daily Doc Generation for: ${path.basename(resolvedPath)}` });

    generateDailyQuiz(resolvedPath, (event) => {
      broadcastEvent({ type: 'pdf-gen-log', ...event });
    }).then((generatedFiles) => {
      const docxFiles = generatedFiles.filter(f => typeof f === 'string' && f.endsWith('.docx'));
      const filesMeta = docxFiles.map(f => getGeneratedFileMeta(f));
      latestGeneratedRun = {
        mode: 'daily',
        timestamp: Date.now(),
        files: filesMeta
      };
      broadcastEvent({
        type: 'pdf-gen-complete',
        mode: 'daily',
        files: filesMeta
      });
    }).catch(err => {
      broadcastEvent({ type: 'pdf-gen-error', message: err.message });
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pdf-gen/generate-daily-modern
 * Generates the redesigned (Modern) Daily Q&A PDF straight from the selected source .docx.
 * Responds when the PDF is ready: { name, path, size }. Download via /api/pdf-gen/download?path=...
 */
app.post('/api/pdf-gen/generate-daily-modern', async (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'filePath is required' });

    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Source file not found' });
    }

    broadcastEvent({ type: 'pdf-gen-log', message: `🚀 Starting Modern Daily PDF for: ${path.basename(resolvedPath)}` });
    try {
      delete require.cache[require.resolve('./modernPdfGenerator')];
      delete require.cache[require.resolve('./modernPdfPaginate')];
    } catch {}
    const { generateModernDailyPdf } = require('./modernPdfGenerator');
    const pdfPath = await generateModernDailyPdf(resolvedPath, (event) => {
      broadcastEvent({ type: 'pdf-gen-log', ...event });
    });
    const stat = fs.statSync(pdfPath);
    const docxPath = pdfPath.replace(/\.pdf$/i, '.docx');
    if (fs.existsSync(docxPath)) {
      const fileMeta = getGeneratedFileMeta(docxPath);
      latestGeneratedRun = {
        mode: 'daily',
        timestamp: Date.now(),
        files: [fileMeta]
      };
      broadcastEvent({
        type: 'pdf-gen-complete',
        mode: 'daily',
        files: [fileMeta]
      });
    }
    res.json({ name: path.basename(pdfPath), path: pdfPath, size: stat.size });
  } catch (err) {
    console.error('Error in /api/pdf-gen/generate-daily-modern:', err);
    broadcastEvent({ type: 'pdf-gen-error', message: err.message });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pdf-gen/generate-monthly
 * Generates Monthly Topic-Wise DOCX (English and Hindi) from all files in a folder
 */
app.post('/api/pdf-gen/generate-monthly', async (req, res) => {
  try {
    const { folderPath, monthLabel, filePath } = req.body;
    const label = monthLabel || 'November 2026';
    let target = null;
    if (filePath) {
      target = path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
    } else if (folderPath && folderPath !== 'monthly-all' && folderPath !== 'daily-all') {
      target = path.isAbsolute(folderPath) ? folderPath : path.join(ROOT_DIR, folderPath);
    } else if (folderPath === 'daily-all') {
      const upDaily = path.join(ROOT_DIR, 'Uploaded Documents', 'Daily');
      const hasUpDaily = fs.existsSync(upDaily) && fs.readdirSync(upDaily).some(f => f.endsWith('.docx') && !f.startsWith('~$'));
      target = hasUpDaily ? upDaily : path.join(ROOT_DIR, 'Daily PDF');
    } else {
      // Default / monthly-all: prioritize month-specific subfolder (e.g. 2026-10, 2026-11)
      const monthSub = getMonthFolder(label);
      const monthSubDir = path.join(ROOT_DIR, 'Uploaded Documents', 'Monthly', monthSub);
      if (fs.existsSync(monthSubDir) && fs.readdirSync(monthSubDir).some(f => f.endsWith('.docx') && !f.startsWith('~$'))) {
        target = monthSubDir;
      } else {
        const upMonthly = path.join(ROOT_DIR, 'Uploaded Documents', 'Monthly');
        const hasUpMonthly = fs.existsSync(upMonthly) && fs.readdirSync(upMonthly).some(f => f.endsWith('.docx') && !f.startsWith('~$'));
        if (hasUpMonthly) {
          target = upMonthly;
        } else {
          const monthlyDir = path.join(ROOT_DIR, 'Monthly PDF');
          const hasMonthly = fs.existsSync(monthlyDir) && fs.readdirSync(monthlyDir).some(f => f.endsWith('.docx') && !f.startsWith('~$'));
          target = hasMonthly ? monthlyDir : path.join(ROOT_DIR, 'Daily PDF');
        }
      }
    }

    if (!fs.existsSync(target)) {
      return res.status(404).json({ error: 'Target path not found: ' + target });
    }

    res.json({ started: true });

    broadcastEvent({ type: 'pdf-gen-log', message: `🚀 Starting Monthly Topic-Wise Generation for: ${label}` });

    generateMonthlyQuiz(target, label, (event) => {
      broadcastEvent({ type: 'pdf-gen-log', ...event });
    }).then((generatedFiles) => {
      const docxFiles = generatedFiles.filter(f => typeof f === 'string' && f.endsWith('.docx'));
      const filesMeta = docxFiles.map(f => getGeneratedFileMeta(f));
      latestGeneratedRun = {
        mode: 'monthly',
        timestamp: Date.now(),
        files: filesMeta
      };
      broadcastEvent({
        type: 'pdf-gen-complete',
        mode: 'monthly',
        files: filesMeta
      });
    }).catch(err => {
      broadcastEvent({ type: 'pdf-gen-error', message: err.message });
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pdf-gen/generate-from-parsed
 * Generates PDF and DOCX directly from the currently parsed quiz questions in UI
 */
app.post('/api/pdf-gen/generate-from-parsed', async (req, res) => {
  try {
    const { quizData } = req.body;
    if (!quizData || !quizData.questions || quizData.questions.length === 0) {
      return res.status(400).json({ error: 'Valid parsed quiz data is required' });
    }

    res.json({ started: true });

    broadcastEvent({ type: 'pdf-gen-log', message: `🚀 Generating PDF & DOCX for parsed quiz (${quizData.questions.length} questions)...` });

    generateFromParsedQuiz(quizData, (event) => {
      broadcastEvent({ type: 'pdf-gen-log', ...event });
    }).then((generatedFiles) => {
      const docxFiles = generatedFiles.filter(f => typeof f === 'string' && f.endsWith('.docx'));
      const filesMeta = docxFiles.map(f => getGeneratedFileMeta(f));
      latestGeneratedRun = {
        mode: 'parsed',
        timestamp: Date.now(),
        files: filesMeta
      };
      broadcastEvent({
        type: 'pdf-gen-complete',
        mode: 'parsed',
        files: filesMeta
      });
    }).catch(err => {
      broadcastEvent({ type: 'pdf-gen-error', message: err.message });
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/pdf-gen/download
 * Download a generated docx file
 */
app.get('/api/pdf-gen/download', (req, res) => {
  try {
    const rawPath = req.query.path;
    if (!rawPath) return res.status(400).send('Path is required');

    const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.join(ROOT_DIR, rawPath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).send('File not found');
    }

    res.download(resolvedPath);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/**
 * GET /api/pdf-gen/download-pdf
 * Download or convert on-the-fly and download the PDF version of a docx file
 */
app.get('/api/pdf-gen/download-pdf', async (req, res) => {
  try {
    const rawPath = req.query.path;
    if (!rawPath) return res.status(400).send('Path is required');

    const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.join(ROOT_DIR, rawPath);
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).send('Source file not found');
    }

    let pdfPath;
    if (resolvedPath.endsWith('.pdf')) {
      pdfPath = resolvedPath;
    } else {
      pdfPath = resolvedPath.replace(/\.docx$/i, '.pdf');
    }

    // If PDF already exists, is newer than the source DOCX, and has content, stream directly
    if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 0) {
      const docxMtime = fs.existsSync(resolvedPath) ? fs.statSync(resolvedPath).mtimeMs : 0;
      const pdfMtime = fs.statSync(pdfPath).mtimeMs;
      if (pdfMtime >= docxMtime) {
        return res.download(pdfPath);
      }
    }

    // Otherwise convert on-demand using Word COM engine
    broadcastEvent({ type: 'pdf-gen-log', message: `⏳ Converting ${path.basename(resolvedPath)} to PDF...` });
    const convertedPath = await convertDocxToPdf(resolvedPath, pdfPath);
    broadcastEvent({ type: 'pdf-gen-log', message: `✅ PDF Ready: ${path.basename(convertedPath)}` });

    res.download(convertedPath);
  } catch (err) {
    console.error('Error in /api/pdf-gen/download-pdf:', err);
    res.status(500).send(`PDF conversion failed: ${err.message}`);
  }
});

// ─── START SERVER ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 LMS Quiz Automation Dashboard is running at http://localhost:${PORT}`);
});

