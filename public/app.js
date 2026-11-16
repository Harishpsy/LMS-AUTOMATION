/**
 * Main Application Entry Point
 * Orchestrates modular architecture: theme, auth, course/quizzes, files, preview, uploader, and gallery
 */

import { initTheme } from './modules/theme.js';
import './modules/uiTabs.js';
import { initAuth, checkAuthStatus } from './modules/auth.js';
import { initCourseQuiz, fetchCourseQuizzes } from './modules/courseQuiz.js';
import { initFileManager, loadFiles } from './modules/fileManager.js';
import { initUploader } from './modules/uploader.js';
import { initGallery } from './modules/gallery.js';
import { appendLog } from './modules/logger.js';
import { initPdfGenerator } from './modules/pdfGenUI.js';

// Application State
let currentParsedData = null;

/**
 * Initialize all dashboard modules and load initial data
 */
function initApp() {
  // 1. Initialize UI Controls & Theme
  initTheme();
  initGallery();
  initPdfGenerator({
    getParsedData: () => currentParsedData
  });

  // 2. Initialize LMS Authentication & Session Watcher
  initAuth();

  // 3. Initialize Course & Quiz Selection
  initCourseQuiz();

  // 4. Initialize File Manager & Drag-and-Drop Parser
  initFileManager({
    onParsedSuccess: (data) => {
      currentParsedData = data;
    }
  });

  // 5. Initialize Automated Uploader
  initUploader({
    getParsedData: () => currentParsedData
  });

  // 6. Fetch Initial Server Data
  loadFiles();
  checkAuthStatus();
  fetchCourseQuizzes();

  appendLog('🚀 Dashboard initialized & ready.', 'info');
}

// Start application
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
