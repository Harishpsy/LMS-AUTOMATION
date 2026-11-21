/**
 * PDF & Quiz Document Generator Client Module
 * Provides controls for generating Daily & Monthly Quiz PDF & DOCX files in English & Hindi
 */

import { appendLog } from './logger.js';
import { showError } from './error.js';

let pdfGenState = {
  dailySources: [],
  monthlySources: [],
  quizDocSources: [],
  currentGenerated: [],
  generated: { daily: [], monthly: [], parsed: [] }
};

let getParsedDataFn = null;

export function setCurrentGenerated(files) {
  if (Array.isArray(files)) {
    pdfGenState.currentGenerated = files.filter(f => f && f.name && f.name.endsWith('.docx'));
    renderGeneratedFiles();
  }
}

let selectedUploadFile = null;
let selectedMonthlyUploadFiles = [];

export function initPdfGenerator(options = {}) {
  getParsedDataFn = options.getParsedData || null;

  const btnGenerateDaily = document.getElementById('btnGenerateDailyDoc');
  const btnGenerateMonthly = document.getElementById('btnGenerateMonthlyDoc');
  const btnRefreshPdfList = document.getElementById('btnRefreshPdfList');
  const btnExportParsedPdf = document.getElementById('btnExportParsedPdf');

  if (btnGenerateDaily) {
    btnGenerateDaily.addEventListener('click', () => onGenerateDaily());
  }

  const btnGenerateModern = document.getElementById('btnGenerateModernPdf');
  if (btnGenerateModern) {
    btnGenerateModern.addEventListener('click', () => onGenerateModernPdf());
  }

  if (btnGenerateMonthly) {
    btnGenerateMonthly.addEventListener('click', () => onGenerateMonthly());
  }

  if (btnRefreshPdfList) {
    btnRefreshPdfList.addEventListener('click', loadPdfGenFiles);
  }

  if (btnExportParsedPdf) {
    btnExportParsedPdf.addEventListener('click', onExportParsed);
  }

  // ── Source Tabs (Workspace Folder vs Upload from Computer) ──
  const tabGenFolder = document.getElementById('tabGenFolder');
  const tabGenUpload = document.getElementById('tabGenUpload');
  const panelGenFolder = document.getElementById('panelGenFolder');
  const panelGenUpload = document.getElementById('panelGenUpload');

  if (tabGenFolder && tabGenUpload) {
    tabGenFolder.addEventListener('click', () => {
      tabGenFolder.classList.add('active');
      tabGenUpload.classList.remove('active');
      panelGenFolder?.classList.remove('hidden');
      panelGenUpload?.classList.add('hidden');
    });

    tabGenUpload.addEventListener('click', () => {
      tabGenUpload.classList.add('active');
      tabGenFolder.classList.remove('active');
      panelGenUpload?.classList.remove('hidden');
      panelGenFolder?.classList.add('hidden');
    });
  }

  // ── Quick Upload in Workspace Tab ──
  const btnQuickUpload = document.getElementById('btnQuickUpload');
  const quickFileInput = document.getElementById('quickFileInput');
  if (btnQuickUpload && quickFileInput) {
    btnQuickUpload.addEventListener('click', () => quickFileInput.click());
    quickFileInput.addEventListener('change', async () => {
      const file = quickFileInput.files && quickFileInput.files[0];
      if (file) {
        btnQuickUpload.disabled = true;
        btnQuickUpload.innerText = '⏳ Uploading...';
        try {
          await uploadSourceFile(file, { autoSelect: true });
        } catch (err) {
          showError('Upload Failed', err.message);
        } finally {
          btnQuickUpload.disabled = false;
          btnQuickUpload.innerText = '📤 Upload .docx';
          quickFileInput.value = '';
        }
      }
    });
  }

  // ── Monthly Source Tabs (Workspace Files vs Upload Monthly .docx) ──
  const tabMonthlyFolder = document.getElementById('tabMonthlyFolder');
  const tabMonthlyUpload = document.getElementById('tabMonthlyUpload');
  const panelMonthlyFolder = document.getElementById('panelMonthlyFolder');
  const panelMonthlyUpload = document.getElementById('panelMonthlyUpload');

  if (tabMonthlyFolder && tabMonthlyUpload) {
    tabMonthlyFolder.addEventListener('click', () => {
      tabMonthlyFolder.classList.add('active');
      tabMonthlyUpload.classList.remove('active');
      panelMonthlyFolder?.classList.remove('hidden');
      panelMonthlyUpload?.classList.add('hidden');
    });

    tabMonthlyUpload.addEventListener('click', () => {
      tabMonthlyUpload.classList.add('active');
      tabMonthlyFolder.classList.remove('active');
      panelMonthlyUpload?.classList.remove('hidden');
      panelMonthlyFolder?.classList.add('hidden');
    });
  }

  // ── Quick Monthly Upload in Workspace Tab ──
  const btnQuickMonthlyUpload = document.getElementById('btnQuickMonthlyUpload');
  const quickMonthlyFileInput = document.getElementById('quickMonthlyFileInput');
  if (btnQuickMonthlyUpload && quickMonthlyFileInput) {
    btnQuickMonthlyUpload.addEventListener('click', () => quickMonthlyFileInput.click());
    quickMonthlyFileInput.addEventListener('change', async () => {
      const files = quickMonthlyFileInput.files;
      if (files && files.length > 0) {
        btnQuickMonthlyUpload.disabled = true;
        btnQuickMonthlyUpload.innerText = '⏳ Uploading...';
        try {
          await uploadMonthlyFiles(files, { autoSelect: true });
        } catch (err) {
          showError('Monthly Upload Failed', err.message);
        } finally {
          btnQuickMonthlyUpload.disabled = false;
          btnQuickMonthlyUpload.innerText = '📤 Upload Monthly .docx';
          quickMonthlyFileInput.value = '';
        }
      }
    });
  }

  // ── Monthly Drag & Drop / Browse Upload in Upload Tab ──
  function handleMonthlyFiles(files) {
    if (!files || files.length === 0) return;
    const docxList = Array.from(files).filter(f => f.name.endsWith('.docx'));
    if (docxList.length === 0) {
      alert('Please select valid .docx file(s).');
      return;
    }
    selectedMonthlyUploadFiles = docxList;
    const monthlyUploadedFileName = document.getElementById('monthlyUploadedFileName');
    const btnMonthlyUploadAndGenerate = document.getElementById('btnMonthlyUploadAndGenerate');
    if (monthlyUploadedFileName) {
      if (docxList.length === 1) {
        monthlyUploadedFileName.textContent = `📄 ${docxList[0].name} (${Math.round(docxList[0].size / 1024)} KB)`;
      } else {
        monthlyUploadedFileName.textContent = `📄 ${docxList.length} files selected: ${docxList.map(f => f.name).join(', ')}`;
      }
      monthlyUploadedFileName.classList.remove('hidden');
    }
    if (btnMonthlyUploadAndGenerate) {
      btnMonthlyUploadAndGenerate.disabled = false;
    }
    appendLog(`📁 ${docxList.length} Monthly source file(s) selected`, 'info');
  }

  const monthlyDropZone = document.getElementById('monthlyDropZone');
  const monthlyFileUploadInput = document.getElementById('monthlyFileUploadInput');
  const btnBrowseMonthlyFile = document.getElementById('btnBrowseMonthlyFile');
  const btnMonthlyUploadAndGenerate = document.getElementById('btnMonthlyUploadAndGenerate');

  if (btnBrowseMonthlyFile && monthlyFileUploadInput) {
    btnBrowseMonthlyFile.addEventListener('click', () => monthlyFileUploadInput.click());
    monthlyFileUploadInput.addEventListener('change', () => {
      handleMonthlyFiles(monthlyFileUploadInput.files);
    });
  }

  if (monthlyDropZone) {
    ['dragenter', 'dragover'].forEach(evt => {
      monthlyDropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        monthlyDropZone.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      monthlyDropZone.addEventListener(evt, () => monthlyDropZone.classList.remove('drag-over'));
    });
    monthlyDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      handleMonthlyFiles(e.dataTransfer.files);
    });
  }

  if (btnMonthlyUploadAndGenerate) {
    btnMonthlyUploadAndGenerate.addEventListener('click', async () => {
      if (!selectedMonthlyUploadFiles || selectedMonthlyUploadFiles.length === 0) return;
      btnMonthlyUploadAndGenerate.disabled = true;
      btnMonthlyUploadAndGenerate.innerText = '⏳ Uploading & Generating...';
      try {
        const monthUploadInput = document.getElementById('monthlyUploadLabelInput');
        const monthLabel = (monthUploadInput && monthUploadInput.value.trim()) || 'November 2026';
        const uploadResult = await uploadMonthlyFiles(selectedMonthlyUploadFiles, { autoSelect: true, monthLabel });
        // Switch back to folder tab
        tabMonthlyFolder?.click();
        const targetPath = (selectedMonthlyUploadFiles && selectedMonthlyUploadFiles.length > 1)
          ? (uploadResult?.folder || 'Uploaded Documents/Monthly')
          : (uploadResult?.path || 'Uploaded Documents/Monthly');
        await onGenerateMonthly(targetPath, monthLabel);
      } catch (err) {
        showError('Monthly Upload & Generate Failed', err.message);
      } finally {
        btnMonthlyUploadAndGenerate.disabled = false;
        btnMonthlyUploadAndGenerate.innerText = '📚 Upload & Generate Monthly Quiz (DOCX)';
      }
    });
  }

  // ── Drag & Drop / Browse Upload in Upload Tab ──
  const genDropZone = document.getElementById('genDropZone');
  const genFileUploadInput = document.getElementById('genFileUploadInput');
  const btnBrowseGenFile = document.getElementById('btnBrowseGenFile');
  const genUploadedFileName = document.getElementById('genUploadedFileName');
  const btnUploadAndGenerate = document.getElementById('btnUploadAndGenerate');

  function handleGenFile(file) {
    if (!file || !file.name.endsWith('.docx')) {
      alert('Please select a valid .docx file.');
      return;
    }
    selectedUploadFile = file;
    if (genUploadedFileName) {
      genUploadedFileName.textContent = `📄 ${file.name} (${Math.round(file.size / 1024)} KB)`;
      genUploadedFileName.classList.remove('hidden');
    }
    if (btnUploadAndGenerate) {
      btnUploadAndGenerate.disabled = false;
    }
    appendLog(`📁 Source file selected: "${file.name}"`, 'info');
  }

  if (btnBrowseGenFile && genFileUploadInput) {
    btnBrowseGenFile.addEventListener('click', () => genFileUploadInput.click());
    genFileUploadInput.addEventListener('change', () => {
      const file = genFileUploadInput.files && genFileUploadInput.files[0];
      if (file) handleGenFile(file);
    });
  }

  if (genDropZone) {
    ['dragenter', 'dragover'].forEach(evt => {
      genDropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        genDropZone.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      genDropZone.addEventListener(evt, () => genDropZone.classList.remove('drag-over'));
    });
    genDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleGenFile(file);
    });
  }

  if (btnUploadAndGenerate) {
    btnUploadAndGenerate.addEventListener('click', async () => {
      if (!selectedUploadFile) return;
      btnUploadAndGenerate.disabled = true;
      btnUploadAndGenerate.innerText = '⏳ Uploading & Generating...';
      try {
        const uploadResult = await uploadSourceFile(selectedUploadFile, { autoSelect: true });
        if (uploadResult && uploadResult.path) {
          // Switch back to folder view tab
          tabGenFolder?.click();
          await onGenerateDaily(uploadResult.path);
        }
      } catch (err) {
        showError('Upload & Generate Failed', err.message);
      } finally {
        btnUploadAndGenerate.disabled = false;
        btnUploadAndGenerate.innerText = '⚡ Upload & Generate Daily Quiz (DOCX)';
      }
    });
  }

  // Load initial list
  loadPdfGenFiles();
}

/**
 * Upload a source docx file to Uploaded Documents/Daily folder
 */
export async function uploadSourceFile(file, { autoSelect = true } = {}) {
  appendLog(`📤 Uploading source file "${file.name}" to Uploaded Documents/Daily folder...`, 'info');
  const formData = new FormData();
  formData.append('docxFile', file);

  const res = await fetch('/api/pdf-gen/upload?folder=daily', {
    method: 'POST',
    body: formData
  });

  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Failed to upload source file');

  appendLog(`✅ Uploaded "${result.name}" successfully to Uploaded Documents/Daily!`, 'success');
  await loadPdfGenFiles();

  if (autoSelect) {
    const select = document.getElementById('pdfSourceSelect');
    if (select) {
      select.value = result.path;
    }
  }

  return result;
}

/**
 * Upload source docx file(s) to Uploaded Documents/Monthly folder
 */
export async function uploadMonthlyFiles(files, { autoSelect = true, monthLabel = '' } = {}) {
  const fileArray = Array.isArray(files) ? files : Array.from(files || []);
  if (fileArray.length === 0) return null;

  const monthParam = monthLabel ? `&month=${encodeURIComponent(monthLabel)}` : '';
  appendLog(`📤 Uploading ${fileArray.length} file(s) to Uploaded Documents/Monthly${monthLabel ? ` (${monthLabel})` : ''}...`, 'info');
  const formData = new FormData();
  fileArray.forEach(f => formData.append('docxFiles', f));

  const res = await fetch(`/api/pdf-gen/upload?folder=monthly${monthParam}`, {
    method: 'POST',
    body: formData
  });

  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Failed to upload monthly file(s)');

  appendLog(`✅ Uploaded ${fileArray.length} file(s) successfully to ${result.folder || 'Monthly folder'}!`, 'success');
  await loadPdfGenFiles();

  if (autoSelect && (result.folder || result.path)) {
    const monthlySelect = document.getElementById('monthlySourceSelect');
    if (monthlySelect) {
      const matchVal = result.folder || result.path;
      if (Array.from(monthlySelect.options).some(o => o.value === matchVal)) {
        monthlySelect.value = matchVal;
      }
    }
  }

  return result;
}

/**
 * Fetch available source files and generated files from backend
 */
export async function loadPdfGenFiles() {
  try {
    const res = await fetch('/api/pdf-gen/files');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    pdfGenState = data;
    renderPdfSources();
    renderGeneratedFiles();
  } catch (err) {
    console.error('Failed to load pdf-gen files:', err);
  }
}

function renderPdfSources() {
  const select = document.getElementById('pdfSourceSelect');
  if (select) {
    select.innerHTML = '';

    const optGroupDaily = document.createElement('optgroup');
    optGroupDaily.label = '📁 Daily PDF Folder';
    (pdfGenState.dailySources || []).forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.path;
      opt.textContent = `Daily PDF / ${f.name}`;
      optGroupDaily.appendChild(opt);
    });
    select.appendChild(optGroupDaily);

    const optGroupQuiz = document.createElement('optgroup');
    optGroupQuiz.label = '📁 Quiz Document Folder';
    (pdfGenState.quizDocSources || []).forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.path;
      opt.textContent = `Quiz Document / ${f.name}`;
      optGroupQuiz.appendChild(opt);
    });
    select.appendChild(optGroupQuiz);
  }

  const monthlySelect = document.getElementById('monthlySourceSelect');
  if (monthlySelect) {
    const prevVal = monthlySelect.value;
    monthlySelect.innerHTML = '';

    const monthlyCount = (pdfGenState.monthlySources || []).length;
    const dailyCount = (pdfGenState.dailySources || []).length;

    // 1. Month-Specific Folder compilations (isolated by month, e.g. 2026-10, 2026-11)
    if (pdfGenState.monthlyGroups && pdfGenState.monthlyGroups.length > 0) {
      pdfGenState.monthlyGroups.forEach(g => {
        const optG = document.createElement('option');
        optG.value = g.path;
        const qCount = g.totalQuestions || (g.count * 30);
        optG.textContent = `📁 Consolidate ${g.label} (${g.count} files – ${qCount} Questions in Monthly/${g.folder})`;
        monthlySelect.appendChild(optG);
      });
    }

    const optMonthlyAll = document.createElement('option');
    optMonthlyAll.value = 'monthly-all';
    const monthlyQCount = pdfGenState.monthlyTotalQuestions || (monthlyCount * 30);
    optMonthlyAll.textContent = `📁 Consolidate all files in Uploaded Documents/Monthly (${monthlyCount} files – ${monthlyQCount} Total Questions)`;
    monthlySelect.appendChild(optMonthlyAll);

    const optDailyAll = document.createElement('option');
    optDailyAll.value = 'daily-all';
    optDailyAll.textContent = `📁 Consolidate all files in Daily Uploads (${dailyCount} files)`;
    monthlySelect.appendChild(optDailyAll);

    if (prevVal && Array.from(monthlySelect.options).some(o => o.value === prevVal)) {
      monthlySelect.value = prevVal;
    } else if (pdfGenState.monthlyGroups && pdfGenState.monthlyGroups.length > 0) {
      monthlySelect.value = pdfGenState.monthlyGroups[0].path;
    } else {
      monthlySelect.value = monthlyCount > 0 ? 'monthly-all' : 'daily-all';
    }
  }
}

function renderFileListSection(title, files, color, emptyMsg) {
  if (!files || files.length === 0) return '';
  let html = `<strong style="font-size:12px; color:${color}; text-transform:uppercase; letter-spacing:0.5px; margin-top:10px; display:block;">${title}:</strong>`;
  html += '<div style="display:flex; flex-direction:column; gap:6px; margin-top:4px;">';

  files.slice(0, 20).forEach(f => {
    const sizeKb = Math.round(f.size / 1024);
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-card-subtle); padding:8px 12px; border-radius:6px; border:1px solid var(--border-color);">
        <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
          <span style="font-size:16px;">📘</span>
          <span style="font-size:10px; font-weight:800; background:#dbeafe; color:#1e40af; padding:2px 6px; border-radius:4px;">DOCX</span>
          ${f.dateFolder ? `<span style="font-size:10px; font-weight:700; background:rgba(139,92,246,0.18); color:var(--accent-purple, #8b5cf6); border:1px solid rgba(139,92,246,0.3); padding:2px 6px; border-radius:4px; flex-shrink:0;">📁 ${escapeHtml(f.dateFolder)}</span>` : ''}
          <span style="font-size:13px; font-weight:600; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
          <span style="color:var(--text-muted); font-size:11px; flex-shrink:0;">(${sizeKb} KB)</span>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-shrink:0; margin-left:8px;">
          <a href="/api/pdf-gen/download?path=${encodeURIComponent(f.path)}" class="btn btn-secondary" style="padding:4px 10px; font-size:12px; display:inline-flex; align-items:center; gap:4px;" download title="Download Word DOCX file">
            ⬇️ Download
          </a>
          <a href="/api/pdf-gen/download-pdf?path=${encodeURIComponent(f.path)}" class="btn btn-primary" onclick="window.__onDownloadPdfClick && window.__onDownloadPdfClick(this)" style="padding:4px 10px; font-size:12px; display:inline-flex; align-items:center; gap:4px; background:linear-gradient(135deg, #dc2626, #b91c1c); border-color:#ef4444; color:#fff; font-weight:600;" download title="Download / Export as PDF">
            📕 Download PDF
          </a>
        </div>
      </div>
    `;
  });
  html += '</div>';
  return html;
}

window.__onDownloadPdfClick = function(btn) {
  const originalText = btn.innerHTML;
  btn.innerHTML = '⏳ Preparing PDF...';
  btn.style.pointerEvents = 'none';
  setTimeout(() => {
    btn.innerHTML = originalText;
    btn.style.pointerEvents = '';
  }, 4000);
};

function renderGeneratedFiles() {
  const listEl = document.getElementById('generatedFilesList');
  if (!listEl) return;

  const currentFiles = (pdfGenState.currentGenerated || []).filter(f => f && f.name && f.name.endsWith('.docx'));

  if (currentFiles.length === 0) {
    listEl.innerHTML = `
      <div style="color:var(--text-muted); font-size:13px; padding:16px; text-align:center; background:var(--bg-card-subtle); border-radius:8px; border:1px dashed var(--border-color);">
        ✨ No document generated yet in this session.<br>
        <span style="font-size:12px; color:var(--text-muted); margin-top:4px; display:inline-block;">Select a source file above and click <strong>Generate Daily Quiz (DOCX)</strong> or <strong>Generate Monthly</strong> to produce your document.</span>
      </div>
    `;
    return;
  }

  let html = '';
  html += `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
      <span style="font-size:12px; font-weight:700; color:#10b981; text-transform:uppercase; letter-spacing:0.5px; display:inline-flex; align-items:center; gap:6px;">
        ✨ Current Generated Document${currentFiles.length > 1 ? 's' : ''} (${currentFiles.length}):
      </span>
      <span style="font-size:11px; color:var(--text-muted);">Ready to download (.docx or native PDF)</span>
    </div>
  `;

  html += '<div style="display:flex; flex-direction:column; gap:8px;">';

  currentFiles.forEach(f => {
    const sizeKb = Math.round((f.size || 0) / 1024);
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-card-subtle); padding:10px 14px; border-radius:8px; border:1.5px solid rgba(16,185,129,0.5); box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
          <span style="font-size:20px;">📘</span>
          <span style="font-size:10px; font-weight:800; background:#dbeafe; color:#1e40af; padding:2px 6px; border-radius:4px;">DOCX</span>
          ${f.dateFolder ? `<span style="font-size:10px; font-weight:700; background:rgba(139,92,246,0.18); color:var(--accent-purple, #8b5cf6); border:1px solid rgba(139,92,246,0.3); padding:2px 6px; border-radius:4px; flex-shrink:0;">📁 ${escapeHtml(f.dateFolder)}</span>` : ''}
          <span style="font-size:13px; font-weight:600; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
          <span style="color:var(--text-muted); font-size:11px; flex-shrink:0;">(${sizeKb} KB)</span>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-shrink:0; margin-left:12px;">
          <a href="/api/pdf-gen/download?path=${encodeURIComponent(f.path)}" class="btn btn-secondary" style="padding:6px 12px; font-size:12px; font-weight:600; display:inline-flex; align-items:center; gap:6px;" download title="Download Word DOCX file">
            ⬇️ Download
          </a>
          <a href="/api/pdf-gen/download-pdf?path=${encodeURIComponent(f.path)}" class="btn btn-primary" onclick="window.__onDownloadPdfClick && window.__onDownloadPdfClick(this)" style="padding:6px 12px; font-size:12px; display:inline-flex; align-items:center; gap:6px; background:linear-gradient(135deg, #dc2626, #b91c1c); border-color:#ef4444; color:#fff; font-weight:600;" download title="Download / Export as PDF">
            📕 Download PDF
          </a>
        </div>
      </div>
    `;
  });
  html += '</div>';

  // Collapsed history accordion for older documents so they never clutter the screen
  const allPastFiles = [
    ...(pdfGenState.generated?.daily || []),
    ...(pdfGenState.generated?.monthly || []),
    ...(pdfGenState.generated?.parsed || [])
  ].filter(pf => !currentFiles.some(cf => cf.name === pf.name));

  if (allPastFiles.length > 0) {
    html += `
      <details style="margin-top:14px; padding-top:10px; border-top:1px dashed var(--border-color);">
        <summary style="font-size:12px; color:var(--text-muted); cursor:pointer; user-select:none; outline:none;">
          📁 View previous generated documents (${allPastFiles.length} archived files)
        </summary>
        <div style="margin-top:8px;">
          ${renderFileListSection('Archived Daily Documents', pdfGenState.generated?.daily?.filter(pf => !currentFiles.some(cf => cf.name === pf.name)), 'var(--accent-green)')}
          ${renderFileListSection('Archived Monthly Compilations', pdfGenState.generated?.monthly?.filter(pf => !currentFiles.some(cf => cf.name === pf.name)), 'var(--accent-purple)')}
          ${renderFileListSection('Archived Parsed Exports', pdfGenState.generated?.parsed?.filter(pf => !currentFiles.some(cf => cf.name === pf.name)), '#ef4444')}
        </div>
      </details>
    `;
  }

  listEl.innerHTML = html;
}

async function onGenerateDaily(customPath = null) {
  const select = document.getElementById('pdfSourceSelect');
  const filePath = (typeof customPath === 'string' && customPath) ? customPath : (select ? select.value : '');
  if (!filePath) {
    alert('Please select a source document first');
    return;
  }

  const btn = document.getElementById('btnGenerateDailyDoc');
  btn.disabled = true;
  btn.innerText = '⏳ Generating Daily Word DOCs...';

  const listEl = document.getElementById('generatedFilesList');
  if (listEl) {
    listEl.innerHTML = `
      <div style="background:rgba(37,99,235,0.08); border:1px solid rgba(37,99,235,0.25); border-radius:8px; padding:16px; text-align:center;">
        <span style="font-size:18px;">⏳</span>
        <div style="font-size:14px; font-weight:600; margin-top:6px; color:var(--accent-blue);">Generating Daily Quiz DOCX...</div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Your download links will appear here immediately once ready.</div>
      </div>
    `;
  }

  appendLog(`🚀 Requesting Daily Generation (DOCX) for: ${filePath}`, 'info');

  try {
    const res = await fetch('/api/pdf-gen/generate-daily', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Server error');
    appendLog('⏳ Daily generation running. Creating DOCX files...', 'info');
  } catch (err) {
    showError('Daily Generation Failed', err.message);
    appendLog(`❌ Error: ${err.message}`, 'error');
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.innerText = '⚡ Generate Daily Quiz (DOCX)';
      loadPdfGenFiles();
    }, 2500);
  }
}

async function onGenerateModernPdf() {
  const select = document.getElementById('pdfSourceSelect');
  const filePath = select ? select.value : '';
  if (!filePath) {
    alert('Please select a source document first');
    return;
  }

  const btn = document.getElementById('btnGenerateModernPdf');
  btn.disabled = true;
  btn.innerText = '⏳ Generating Modern PDF...';

  const listEl = document.getElementById('generatedFilesList');
  if (listEl) {
    listEl.innerHTML = `
      <div style="background:rgba(37,99,235,0.08); border:1px solid rgba(37,99,235,0.25); border-radius:8px; padding:16px; text-align:center;">
        <span style="font-size:18px;">⏳</span>
        <div style="font-size:14px; font-weight:600; margin-top:6px; color:var(--accent-blue);">Generating Modern Daily PDF...</div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">This takes around 20-40 seconds. The download link will appear here.</div>
      </div>
    `;
  }

  appendLog(`🚀 Requesting Modern PDF for: ${filePath}`, 'info');

  try {
    const res = await fetch('/api/pdf-gen/generate-daily-modern', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Server error');

    const href = `/api/pdf-gen/download?path=${encodeURIComponent(result.path)}`;
    if (listEl) {
      listEl.innerHTML = `
        <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:8px; padding:16px;">
          <div style="font-size:14px; font-weight:600; margin-bottom:8px;">✅ ${result.name}</div>
          <a class="btn btn-primary" href="${href}" download style="text-decoration:none; display:inline-block;">⬇ Download Modern PDF</a>
        </div>
      `;
    }
    appendLog(`🎉 Modern PDF ready: ${result.name}`, 'success');
  } catch (err) {
    showError('Modern PDF Failed', err.message);
    appendLog(`❌ Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = '✨ Generate Modern PDF';
  }
}

async function onGenerateMonthly(customTarget = null, customLabel = null) {
  const monthlySelect = document.getElementById('monthlySourceSelect');
  const targetVal = customTarget || (monthlySelect ? monthlySelect.value : 'monthly-all');

  const monthInput = document.getElementById('monthlyLabelInput');
  const monthLabel = customLabel || (monthInput && monthInput.value.trim()) || 'November 2026';

  const btn = document.getElementById('btnGenerateMonthlyDoc');
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ Compiling Monthly Topic-Wise DOCs...';
  }

  const listEl = document.getElementById('generatedFilesList');
  if (listEl) {
    listEl.innerHTML = `
      <div style="background:rgba(139,92,246,0.08); border:1px solid rgba(139,92,246,0.25); border-radius:8px; padding:16px; text-align:center;">
        <span style="font-size:18px;">⏳</span>
        <div style="font-size:14px; font-weight:600; margin-top:6px; color:var(--accent-purple);">Compiling Monthly Topic-Wise DOCX...</div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Your download links will appear here immediately once ready.</div>
      </div>
    `;
  }

  let reqBody = { monthLabel };
  if (targetVal === 'monthly-all') {
    reqBody.folderPath = 'monthly-all';
  } else if (targetVal === 'daily-all') {
    reqBody.folderPath = 'daily-all';
  } else {
    // Individual file or specific folder
    reqBody.filePath = targetVal;
  }

  appendLog(`🚀 Requesting Monthly Compilation for target: ${targetVal} (${monthLabel})`, 'info');

  try {
    const res = await fetch('/api/pdf-gen/generate-monthly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Server error');
    appendLog('⏳ Monthly compilation running. Creating topic-wise DOCX files...', 'info');
  } catch (err) {
    showError('Monthly Generation Failed', err.message);
    appendLog(`❌ Error: ${err.message}`, 'error');
  } finally {
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerText = '📚 Generate Monthly Topic-Wise (DOCX)';
      }
      loadPdfGenFiles();
    }, 3000);
  }
}

async function onExportParsed() {
  const parsedData = typeof getParsedDataFn === 'function' ? getParsedDataFn() : null;
  if (!parsedData || !parsedData.questions || parsedData.questions.length === 0) {
    showError('No Parsed Data', 'Please select and parse a document in Step 2 first.');
    return;
  }

  const btn = document.getElementById('btnExportParsedPdf');
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ Generating DOCX...';
  }

  const listEl = document.getElementById('generatedFilesList');
  if (listEl) {
    listEl.innerHTML = `
      <div style="background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:8px; padding:16px; text-align:center;">
        <span style="font-size:18px;">⏳</span>
        <div style="font-size:14px; font-weight:600; margin-top:6px; color:#ef4444;">Exporting Parsed Quiz to DOCX...</div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Your download links will appear here immediately once ready.</div>
      </div>
    `;
  }

  appendLog(`🚀 Generating DOCX for parsed document: "${parsedData.quizTitle || 'Quiz'}" (${parsedData.questions.length} questions)...`, 'info');

  try {
    const res = await fetch('/api/pdf-gen/generate-from-parsed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quizData: parsedData })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Server error');
    appendLog('⏳ Document creation in progress...', 'info');
  } catch (err) {
    showError('Export Failed', err.message);
    appendLog(`❌ Error: ${err.message}`, 'error');
  } finally {
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerText = '📄 Export to DOCX';
      }
      loadPdfGenFiles();
    }, 2000);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
