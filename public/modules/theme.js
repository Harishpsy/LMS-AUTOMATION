/**
 * Theme Module
 * Manages Dark / Light mode switching and localStorage persistence
 */

const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIconSun = document.getElementById('themeIconSun');
const themeIconMoon = document.getElementById('themeIconMoon');
const themeToggleLabel = document.getElementById('themeToggleLabel');

/**
 * Apply theme to document root and update UI icons
 * @param {'dark'|'light'} theme
 */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('lms_theme', theme);

  if (theme === 'light') {
    if (themeIconSun) themeIconSun.classList.remove('hidden');
    if (themeIconMoon) themeIconMoon.classList.add('hidden');
    if (themeToggleLabel) themeToggleLabel.textContent = 'Dark Mode';
  } else {
    if (themeIconSun) themeIconSun.classList.add('hidden');
    if (themeIconMoon) themeIconMoon.classList.remove('hidden');
    if (themeToggleLabel) themeToggleLabel.textContent = 'Light Mode';
  }
}

/**
 * Initialize theme from localStorage or default to dark
 */
export function initTheme() {
  const savedTheme = localStorage.getItem('lms_theme') || 'dark';
  applyTheme(savedTheme);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      applyTheme(newTheme);
    });
  }
}

