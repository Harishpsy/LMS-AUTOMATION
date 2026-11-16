/**
 * Media Gallery & Lightbox Module
 * Displays extracted tables and charts gallery with full-size interactive lightbox
 */

let mediaGalleryOpen = true;

/**
 * Toggle the media gallery accordion open / closed
 */
export function toggleMediaGallery() {
  mediaGalleryOpen = !mediaGalleryOpen;
  const body = document.getElementById('mediaGalleryBody');
  const chevron = document.getElementById('mediaChevron');
  if (body) {
    body.style.display = mediaGalleryOpen ? '' : 'none';
  }
  if (chevron) {
    chevron.style.transform = mediaGalleryOpen ? 'rotate(0deg)' : 'rotate(-90deg)';
  }
}

/**
 * Fetch and populate extracted table screenshots and charts
 */
export async function loadMediaGallery() {
  try {
    const res = await fetch('/api/assets');
    if (!res.ok) return;
    const data = await res.json();

    const section = document.getElementById('mediaGallerySection');
    const tablesGallery = document.getElementById('tablesGallery');
    const imagesGallery = document.getElementById('imagesGallery');
    const tableGrid = document.getElementById('tableThumbsGrid');
    const imageGrid = document.getElementById('imageThumbsGrid');
    const emptyState = document.getElementById('mediaEmptyState');
    const countBadge = document.getElementById('mediaCountBadge');
    const tableCountPill = document.getElementById('tableCountPill');
    const imageCountPill = document.getElementById('imageCountPill');

    const totalItems = (data.tables ? data.tables.length : 0) + (data.images ? data.images.length : 0);
    if (countBadge) {
      countBadge.textContent = `${totalItems} Item${totalItems !== 1 ? 's' : ''}`;
    }

    if (totalItems === 0) {
      if (emptyState) emptyState.classList.remove('hidden');
      if (tablesGallery) tablesGallery.classList.add('hidden');
      if (imagesGallery) imagesGallery.classList.add('hidden');
      if (section) section.classList.add('hidden');
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');
    if (section) section.classList.remove('hidden');

    // Render table screenshots
    if (data.tables && data.tables.length > 0) {
      if (tablesGallery) tablesGallery.classList.remove('hidden');
      if (tableCountPill) tableCountPill.textContent = data.tables.length;
      if (tableGrid) {
        tableGrid.innerHTML = '';
        data.tables.forEach(item => {
          tableGrid.appendChild(createThumb(item.src, item.name));
        });
      }
    } else if (tablesGallery) {
      tablesGallery.classList.add('hidden');
    }

    // Render embedded images
    if (data.images && data.images.length > 0) {
      if (imagesGallery) imagesGallery.classList.remove('hidden');
      if (imageCountPill) imageCountPill.textContent = data.images.length;
      if (imageGrid) {
        imageGrid.innerHTML = '';
        data.images.forEach(item => {
          imageGrid.appendChild(createThumb(item.src, item.name));
        });
      }
    } else if (imagesGallery) {
      imagesGallery.classList.add('hidden');
    }

  } catch (err) {
    console.warn('Could not load media gallery:', err.message);
  }
}

function createThumb(src, label) {
  const wrapper = document.createElement('div');
  wrapper.className = 'media-thumb';
  wrapper.title = `Click to enlarge: ${label}`;
  wrapper.onclick = () => openLightbox(src, label);

  const img = document.createElement('img');
  img.src = src;
  img.alt = label;
  img.loading = 'lazy';

  const lbl = document.createElement('div');
  lbl.className = 'media-thumb-label';
  lbl.textContent = label;

  wrapper.appendChild(img);
  wrapper.appendChild(lbl);
  return wrapper;
}

/**
 * Open full-size image in modal lightbox
 * @param {string} src
 * @param {string} label
 */
export function openLightbox(src, label) {
  const lb = document.getElementById('mediaLightbox');
  const lbImg = document.getElementById('mediaLightboxImg');
  const lbLabel = document.getElementById('mediaLightboxLabel');
  if (lbImg) lbImg.src = src;
  if (lbLabel) lbLabel.textContent = label;
  if (lb) lb.classList.add('open');
}

/**
 * Close the full-size image lightbox
 */
export function closeLightbox() {
  const lb = document.getElementById('mediaLightbox');
  if (lb) lb.classList.remove('open');
  const lbImg = document.getElementById('mediaLightboxImg');
  if (lbImg) lbImg.src = '';
}

/**
 * Initialize Lightbox escape key listeners
 */
export function initGallery() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLightbox();
    }
  });
}

// Expose on window for inline HTML onclick handlers
window.toggleMediaGallery = toggleMediaGallery;
window.closeLightbox = closeLightbox;
window.openLightbox = openLightbox;

