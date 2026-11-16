/**
 * File Manager Module
 * Handles file discovery, drag-and-drop local uploads, and .docx document parsing
 */

import { appendLog } from './logger.js';
import { showError, dismissGlobalError } from './error.js';
import { renderQuestionsPreview } from './preview.js';
import { loadMediaGallery } from './gallery.js';

const fileSelect = document.getElementById('fileSelect');
const btnParse = document.getElementById('btnParse');
const btnParseUpload = document.getElementById('btnParseUpload');
const dropZone = document.getElementById('dropZone');
const fileUploadInput = document.getElementById('fileUploadInput');
const uploadedFileName = document.getElementById('uploadedFileName');
const btnStartUpload = document.getElementById('btnStartUpload');

let uploadedFileBlob = null;

/**
 * Fetch and populate .docx files discovered in the workspace / Quiz Document folder
 */
export async function loadFiles() {
  if (!fileSelect) return;
  try {
    const res = await fetch('/api/files');
    const data = await res.json();
    if (!res.ok || data.error) {
      const errMsg = data.error || `HTTP ${res.status}: Failed to discover files`;
      showError('File Discovery Error', errMsg);
      return;
    }

    fileSelect.innerHTML = '';
    if (data.files && data.files.length > 0) {
      data.files.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f;
        fileSelect.appendChild(opt);
      });
      appendLog(`Found ${data.files.length} quiz file(s) in workspace.`, 'info');
    } else {
      fileSelect.innerHTML = '<option value="">No .docx files found in workspace</option>';
    }
  } catch (err) {
    appendLog(`Failed to fetch files: ${err.message}`, 'error');
  }
}

/**
 * Handle a local file selected by file input or drag-and-drop
 * @param {File} file
 */
export function handleFileSelected(file) {
  if (!file || !file.name.endsWith('.docx')) {
    alert('Please select a valid .docx file.');
    return;
  }
  uploadedFileBlob = file;
  if (uploadedFileName) {
    uploadedFileName.textContent = file.name;
    uploadedFileName.classList.remove('hidden');
  }
  if (btnParseUpload) {
    btnParseUpload.disabled = false;
  }
  appendLog(`File selected: "${file.name}" (${(file.size / 1024).toFixed(1)} KB)`, 'info');
}

/**
 * Initialize file manager handlers
 * @param {object} options
 * @param {function} options.onParsedSuccess - Callback called with parsed quiz data
 */
export function initFileManager({ onParsedSuccess } = {}) {
  // Drag and Drop
  if (dropZone) {
    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, () => dropZone.classList.remove('drag-over'));
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelected(file);
    });
  }

  // Local file input
  if (fileUploadInput) {
    fileUploadInput.addEventListener('change', () => {
      const file = fileUploadInput.files[0];
      if (file) handleFileSelected(file);
    });
  }

  // Parse Uploaded Local Document
  if (btnParseUpload) {
    btnParseUpload.addEventListener('click', async () => {
      if (!uploadedFileBlob) {
        showError('File Missing', 'Please select or drag & drop a .docx file first.');
        return;
      }

      dismissGlobalError();
      btnParseUpload.disabled = true;
      btnParseUpload.textContent = 'Uploading...';
      appendLog(`Uploading "${uploadedFileBlob.name}" to server...`, 'info');

      const formData = new FormData();
      formData.append('docxFile', uploadedFileBlob);

      try {
        const res = await fetch('/api/upload-docx', {
          method: 'POST',
          body: formData
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          const errMsg = data.error || `HTTP ${res.status}: Upload failed`;
          showError('Upload & Parse Failed', errMsg, `File: ${uploadedFileBlob.name}\nStatus: ${res.status}`);
          throw new Error(errMsg);
        }

        appendLog(`✅ Uploaded & parsed "${uploadedFileBlob.name}" — ${data.totalQuestions} questions found!`, 'success');

        renderQuestionsPreview(data.questions);
        loadMediaGallery();

        if (typeof onParsedSuccess === 'function') {
          onParsedSuccess(data);
        }
      } catch (err) {
        appendLog(`❌ Upload error: ${err.message}`, 'error');
      } finally {
        btnParseUpload.disabled = false;
        btnParseUpload.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> Upload & Parse`;
      }
    });
  }

  // Parse Selected Workspace Document
  if (btnParse) {
    btnParse.addEventListener('click', async () => {
      const selectedFile = fileSelect ? fileSelect.value : '';
      if (!selectedFile) {
        showError('Selection Missing', 'Please select a quiz file from the workspace dropdown to parse.');
        return;
      }

      dismissGlobalError();
      btnParse.disabled = true;
      btnParse.textContent = 'Parsing...';
      appendLog(`Parsing document: "${selectedFile}"...`, 'info');

      try {
        const res = await fetch('/api/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: selectedFile })
        });

        const data = await res.json();
        if (!res.ok || data.error) {
          const errMsg = data.error || `HTTP ${res.status}: Failed to parse document`;
          showError('Document Parsing Error', errMsg, `File: ${selectedFile}`);
          throw new Error(errMsg);
        }

        appendLog(`Successfully parsed ${data.totalQuestions} questions from document!`, 'success');

        renderQuestionsPreview(data.questions);
        loadMediaGallery();

        if (typeof onParsedSuccess === 'function') {
          onParsedSuccess(data);
        }
      } catch (err) {
        appendLog(`Error parsing: ${err.message}`, 'error');
      } finally {
        btnParse.disabled = false;
        btnParse.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> Parse Document`;
      }
    });
  }
}

