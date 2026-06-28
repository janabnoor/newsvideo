/**
 * app.js
 * Main orchestrator: boots the PDF, builds the book DOM, wires
 * navigation (arrows, keyboard, touch), zoom, sound, fullscreen,
 * and the auto-hiding control rail. Decides single-page (mobile)
 * vs dual-page spread (desktop) layout responsively.
 */

import { loadPdf, getPageDimensions } from './pdf-renderer.js';
import { ensurePageRendered, getActiveWindow, unloadPage } from './lazy-loader.js';
import { animateFlip, setDragProgress, resolveDragFlip, instantSetAngle } from './flip-engine.js';
import { attachGestures } from './touch-controls.js';
import { initSoundEngine, unlockAudio, playPageTurn, toggleMuted } from './sound-engine.js';
import { onZoomChange, getZoom, zoomIn, zoomOut, toggleDoubleTapZoom, setRawZoom, snapToNearestLevel } from './zoom-controls.js';
import { attachHotspotsForPage, stopVideoOnPage } from './video-hotspot.js';

// ---- DOM refs ----
const loader = document.getElementById('loader');
const loaderBar = document.getElementById('loaderBar');
const bookWrapper = document.getElementById('bookWrapper');
const bookEl = document.getElementById('book');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const controlRail = document.getElementById('controlRail');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomLabel = document.getElementById('zoomLabel');
const soundBtn = document.getElementById('soundBtn');
const soundIconOn = document.getElementById('soundIconOn');
const soundIconOff = document.getElementById('soundIconOff');
const pageIndicator = document.getElementById('pageIndicator');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const srStatus = document.getElementById('srStatus');

// ---- State ----
let totalPages = 0;
let currentPage = 1; // 1-indexed PDF page currently "on top" / left-most visible
let isSpreadMode = false; // dual-page on desktop
let isAnimating = false;
let dims = { width: 1, height: 1, aspect: 1 };
let railHideTimer = null;
let leafElements = new Map(); // pageNum -> sheet element

const SPREAD_BREAKPOINT = 900;

// ============================================================
// BOOT
// ============================================================
async function boot() {
  try {
    const { pageCount } = await loadPdf((progress) => {
      loaderBar.style.width = `${Math.round(progress * 100)}%`;
    });
    totalPages = pageCount;
    dims = await getPageDimensions(1);

    isSpreadMode = window.innerWidth >= SPREAD_BREAKPOINT && totalPages > 1;

    await buildBook();
    await renderActiveWindow();

    hideLoader();
    bookWrapper.classList.add('is-ready');
    scheduleIdleAnimation();
    updatePageIndicator();
    updateNavButtonState();
    showRailBriefly();

    if (totalPages > 1) {
      nextBtn.classList.add('invite');
      setTimeout(() => nextBtn.classList.remove('invite'), 3200);
    }

    initSoundEngine();
  } catch (err) {
    console.error('Failed to boot flipbook:', err);
    showLoadError();
  }
}

function showLoadError() {
  const loaderText = loader.querySelector('.loader-text');
  if (loaderText) {
    loaderText.textContent = 'Could not open the publication. Please refresh.';
  }
}

function hideLoader() {
  loader.classList.add('is-hidden');
  setTimeout(() => { loader.style.display = 'none'; }, 300);
}

// ============================================================
// LAYOUT
// ============================================================
function computeLayout() {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const safeMargin = viewportW < 640 ? 0.10 : 0.08;
  const railClearance = 70;

  const maxW = viewportW * (1 - safeMargin * 2);
  const maxH = (viewportH - railClearance) * (1 - safeMargin);

  const pageAspect = dims.aspect;

  if (isSpreadMode) {
    const spreadAspect = pageAspect * 2;
    let bookW = maxW;
    let bookH = bookW / spreadAspect;
    if (bookH > maxH) {
      bookH = maxH;
      bookW = bookH * spreadAspect;
    }
    return { bookW, bookH, pageW: bookW / 2, pageH: bookH };
  } else {
    let bookH = maxH;
    let bookW = bookH * pageAspect;
    if (bookW > maxW) {
      bookW = maxW;
      bookH = bookW / pageAspect;
    }
    return { bookW, bookH, pageW: bookW, pageH: bookH };
  }
}

function applyLayout() {
  const { bookW, bookH } = computeLayout();
  bookEl.style.width = `${bookW}px`;
  bookEl.style.height = `${bookH}px`;

  leafElements.forEach((sheet) => {
    sheet.style.width = isSpreadMode ? `${bookW / 2}px` : `${bookW}px`;
    sheet.style.height = `${bookH}px`;
  });
}

// ============================================================
// BOOK CONSTRUCTION
// ============================================================
async function buildBook() {
  bookEl.innerHTML = '';
  leafElements.clear();

  const { bookW, bookH } = computeLayout();
  bookEl.style.width = `${bookW}px`;
  bookEl.style.height = `${bookH}px`;

  const initialWindow = getActiveWindow(currentPage, totalPages);
  initialWindow.forEach((pageNum) => createSheet(pageNum));

  attachInteractions();
}

function createSheet(pageNum) {
  if (leafElements.has(pageNum)) return leafElements.get(pageNum);

  const sheet = document.createElement('div');
  sheet.className = 'sheet is-loading';
  sheet.dataset.page = String(pageNum);
  sheet.style.zIndex = String(200 + pageNum); // positionSheets() will correct this

  const { bookW, bookH } = computeLayout();
  sheet.style.width = isSpreadMode ? `${bookW / 2}px` : `${bookW}px`;
  sheet.style.height = `${bookH}px`;

  const canvas = document.createElement('canvas');
  sheet.appendChild(canvas);

  const shadow = document.createElement('div');
  shadow.className = 'turn-shadow';
  sheet.appendChild(shadow);

  attachHotspotsForPage(sheet, pageNum);

  bookEl.appendChild(sheet);
  leafElements.set(pageNum, sheet);
  return sheet;
}

// ============================================================
// RENDERING WINDOW MANAGEMENT
// ============================================================
async function renderActiveWindow() {
  const activeWindow = getActiveWindow(currentPage, totalPages);
  const { pageW, pageH } = computeLayout();

  leafElements.forEach((sheet, pageNum) => {
    if (!activeWindow.has(pageNum)) {
      const canvas = sheet.querySelector('canvas');
      if (canvas) unloadPage(pageNum, canvas);
      sheet.remove();
      leafElements.delete(pageNum);
    }
  });

  const renderPromises = [];
  activeWindow.forEach((pageNum) => {
    const sheet = createSheet(pageNum);
    const canvas = sheet.querySelector('canvas');
    const p = ensurePageRendered(pageNum, canvas, pageW, pageH).then(() => {
      sheet.classList.remove('is-loading');
    });
    renderPromises.push(p);
  });

  await Promise.all(renderPromises);
  positionSheets();
}

function positionSheets() {
  leafElements.forEach((sheet, pageNum) => {
    sheet.style.top = '0';
    if (isSpreadMode) {
      const isRightSide = pageNum % 2 === 1;
      sheet.dataset.side = isRightSide ? 'right' : 'left';
      sheet.style.left = isRightSide ? '50%' : '0';
      // Spread mode: later pages stack above earlier ones so a turned
      // (flipped-away) leaf doesn't visually cover its neighbor.
      sheet.style.zIndex = String(200 + pageNum);
    } else {
      sheet.dataset.side = 'right';
      sheet.style.left = '0';
      // Single-page mode: only one page is visible at a time. The
      // current page must always be top-most; others sit beneath,
      // ordered by distance so near neighbors stay just below it.
      if (pageNum === currentPage) {
        sheet.style.zIndex = '500';
      } else {
        const distance = Math.abs(pageNum - currentPage);
        sheet.style.zIndex = String(500 - distance);
      }
    }

    if (pageNum < currentPage) {
      instantSetAngle(sheet, 'forward', 1);
    } else {
      instantSetAngle(sheet, 'forward', 0);
    }
  });
}

// ============================================================
// NAVIGATION
// ============================================================
async function goNext() {
  if (isAnimating || currentPage >= totalPages) return;
  isAnimating = true;
  unlockAudio();
  stopVideoOnPage(currentPage);

  const pageNum = currentPage;
  const sheet = leafElements.get(pageNum) || createSheet(pageNum);

  await animateFlip(sheet, 'forward');
  playPageTurn('flip');

  currentPage += 1;
  await renderActiveWindow();
  updatePageIndicator();
  updateNavButtonState();
  announcePage();

  isAnimating = false;
}

async function goPrev() {
  if (isAnimating || currentPage <= 1) return;
  isAnimating = true;
  unlockAudio();

  const pageNum = currentPage - 1;
  const sheet = leafElements.get(pageNum) || createSheet(pageNum);
  instantSetAngle(sheet, 'forward', 1);

  currentPage -= 1;
  await renderActiveWindow();

  await animateFlip(sheet, 'backward');
  playPageTurn('soft');

  updatePageIndicator();
  updateNavButtonState();
  announcePage();

  isAnimating = false;
}

function updateNavButtonState() {
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

function updatePageIndicator() {
  pageIndicator.textContent = `${currentPage} / ${totalPages}`;
}

function announcePage() {
  srStatus.textContent = `Page ${currentPage} of ${totalPages}`;
}

// ============================================================
// IDLE / AMBIENT ANIMATION TOGGLE
// ============================================================
function scheduleIdleAnimation() {
  bookWrapper.classList.add('is-idle');
}
function pauseIdleAnimation() {
  bookWrapper.classList.remove('is-idle');
}

// ============================================================
// CONTROL RAIL AUTO-HIDE
// ============================================================
function showRailBriefly() {
  controlRail.classList.add('is-visible');
  clearTimeout(railHideTimer);
  railHideTimer = setTimeout(() => {
    controlRail.classList.remove('is-visible');
  }, 3500);
}

// ============================================================
// INTERACTIONS: gestures, keyboard, buttons
// ============================================================
let dragState = null;

function attachInteractions() {
  attachGestures(bookWrapper, {
    onSwipeLeft: () => { if (!dragState) goNext(); },
    onSwipeRight: () => { if (!dragState) goPrev(); },
    onTap: (xRatio, yRatio, e) => {
      showRailBriefly();
      if (dragState) return;
      if (e?.target?.closest?.('.video-hotspot')) return; // let the hotspot's own click handle it
      if (xRatio > 0.65) goNext();
      else if (xRatio < 0.35) goPrev();
    },
    onDoubleTap: (xRatio, yRatio, e) => {
      if (e?.target?.closest?.('.video-hotspot')) return; // don't zoom when double-tapping the video area
      toggleDoubleTapZoom(xRatio, yRatio);
    },
    onDragStart: () => {
      if (getZoom() > 1) return;
      pauseIdleAnimation();
      showRailBriefly();
    },
    onDragMove: (dx) => {
      if (getZoom() > 1 || isAnimating) return;
      const rect = bookWrapper.getBoundingClientRect();
      const threshold = rect.width * (isSpreadMode ? 0.5 : 1);

      if (!dragState) {
        if (Math.abs(dx) < 12) return;
        if (dx < 0 && currentPage < totalPages) {
          const sheet = leafElements.get(currentPage) || createSheet(currentPage);
          stopVideoOnPage(currentPage);
          dragState = { pageNum: currentPage, sheet, direction: 'forward' };
        } else if (dx > 0 && currentPage > 1) {
          const sheet = leafElements.get(currentPage - 1) || createSheet(currentPage - 1);
          instantSetAngle(sheet, 'forward', 1);
          dragState = { pageNum: currentPage - 1, sheet, direction: 'backward' };
        } else {
          return;
        }
      }

      const effectiveProgress = dragState.direction === 'forward'
        ? Math.min(1, Math.abs(dx) / threshold)
        : Math.max(0, 1 - Math.abs(dx) / threshold);

      setDragProgress(dragState.sheet, dragState.direction, effectiveProgress);
    },
    onDragEnd: async (dx) => {
      scheduleIdleAnimation();
      if (!dragState) return;
      const rect = bookWrapper.getBoundingClientRect();
      const threshold = rect.width * (isSpreadMode ? 0.5 : 1);
      const rawProgress = Math.min(1, Math.abs(dx) / threshold);
      const shouldComplete = rawProgress > 0.35;
      const { sheet, direction } = dragState;
      const currentProgress = direction === 'forward' ? rawProgress : 1 - rawProgress;

      isAnimating = true;
      await resolveDragFlip(sheet, direction, currentProgress, shouldComplete);
      playPageTurn(shouldComplete ? 'flip' : 'soft');

      if (shouldComplete) {
        currentPage = direction === 'forward' ? currentPage + 1 : currentPage - 1;
      }
      dragState = null;
      await renderActiveWindow();
      updatePageIndicator();
      updateNavButtonState();
      announcePage();
      isAnimating = false;
    },
    onPinchStart: () => {
      pauseIdleAnimation();
    },
    onPinchMove: (scale) => {
      setRawZoom(scale);
    },
    onPinchEnd: () => {
      const raw = getZoom();
      snapToNearestLevel(raw);
      scheduleIdleAnimation();
    },
  });

  prevBtn.addEventListener('click', () => { showRailBriefly(); goPrev(); });
  nextBtn.addEventListener('click', () => { showRailBriefly(); goNext(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') goNext();
    else if (e.key === 'ArrowLeft') goPrev();
    else if (e.key === '+' || e.key === '=') zoomIn();
    else if (e.key === '-' || e.key === '_') zoomOut();
    showRailBriefly();
  });

  zoomInBtn.addEventListener('click', () => { zoomIn(); showRailBriefly(); });
  zoomOutBtn.addEventListener('click', () => { zoomOut(); showRailBriefly(); });

  soundBtn.addEventListener('click', () => {
    const muted = toggleMuted();
    soundBtn.setAttribute('aria-pressed', String(muted));
    soundIconOn.style.display = muted ? 'none' : '';
    soundIconOff.style.display = muted ? '' : 'none';
    showRailBriefly();
  });

  fullscreenBtn.addEventListener('click', () => {
    toggleFullscreen();
    showRailBriefly();
  });

  document.getElementById('stage').addEventListener('mousemove', showRailBriefly);
  document.getElementById('stage').addEventListener('pointerdown', showRailBriefly, { passive: true });

  onZoomChange((zoom, panX, panY) => {
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    bookEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    bookEl.style.transformOrigin = 'center center';
  });

  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}

let resizeRaf = null;
function handleResize() {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(async () => {
    const shouldBeSpread = window.innerWidth >= SPREAD_BREAKPOINT && totalPages > 1;
    if (shouldBeSpread !== isSpreadMode) {
      isSpreadMode = shouldBeSpread;
      await buildBook();
    } else {
      applyLayout();
    }
    await renderActiveWindow();
  });
}

// ============================================================
// GO
// ============================================================
boot();
