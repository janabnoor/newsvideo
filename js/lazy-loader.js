/**
 * lazy-loader.js
 * Keeps only a small window of pages rendered around the current
 * position (current ± window). Distant pages are unloaded (canvas
 * cleared and dimensions reset to free GPU/CPU memory), satisfying
 * the "100+ page PDF stays smooth" requirement.
 */

import { renderPageToCanvas } from './pdf-renderer.js';

const RENDER_WINDOW = 2; // pages ahead/behind to keep rendered
const renderedPages = new Set();
const pendingRenders = new Map(); // pageNum -> Promise

/**
 * Ensures the given page is rendered into its canvas element.
 * Returns a promise that resolves once rendering completes.
 * De-dupes concurrent requests for the same page.
 */
export function ensurePageRendered(pageNum, canvasEl, cssWidth, cssHeight) {
  const cacheKey = pageNum;

  if (renderedPages.has(cacheKey) && canvasEl.dataset.renderedAt === `${cssWidth}x${cssHeight}`) {
    return Promise.resolve();
  }

  if (pendingRenders.has(cacheKey)) {
    return pendingRenders.get(cacheKey);
  }

  const promise = renderPageToCanvas(pageNum, canvasEl, cssWidth, cssHeight)
    .then(() => {
      renderedPages.add(cacheKey);
      canvasEl.dataset.renderedAt = `${cssWidth}x${cssHeight}`;
      pendingRenders.delete(cacheKey);
    })
    .catch((err) => {
      pendingRenders.delete(cacheKey);
      console.error(`Failed to render page ${pageNum}:`, err);
    });

  pendingRenders.set(cacheKey, promise);
  return promise;
}

/**
 * Frees a page's canvas memory (sets width/height to 0) — call this
 * for pages that have drifted outside the render window.
 */
export function unloadPage(pageNum, canvasEl) {
  if (!renderedPages.has(pageNum)) return;
  canvasEl.width = 0;
  canvasEl.height = 0;
  delete canvasEl.dataset.renderedAt;
  renderedPages.delete(pageNum);
}

/**
 * Given the current page and total count, returns the set of page
 * numbers that should remain loaded right now.
 */
export function getActiveWindow(currentPage, totalPages) {
  const set = new Set();
  for (let p = currentPage - RENDER_WINDOW; p <= currentPage + RENDER_WINDOW; p++) {
    if (p >= 1 && p <= totalPages) set.add(p);
  }
  return set;
}

export function isPageRendered(pageNum) {
  return renderedPages.has(pageNum);
}

export function getRenderWindowSize() {
  return RENDER_WINDOW;
}
