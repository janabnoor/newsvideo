/**
 * pdf-renderer.js
 * Wraps PDF.js: loads the document from /pdf/, exposes page count,
 * and renders individual pages to high-DPI canvases on demand.
 * Crystal-clear rendering is achieved by rasterizing at
 * devicePixelRatio (capped) × a quality multiplier, never at 1x.
 */

const PDFJS_WORKER_SRC = 'libraries/pdfjs/build/pdf.worker.min.mjs';
const PDF_PATH = 'pdf/newsletter.pdf';

let pdfjsLib = null;
let pdfDocument = null;
let pageCount = 0;
let pageViewportCache = new Map(); // pageNum -> {width, height, aspect}

/**
 * Dynamically imports the PDF.js ES module build and configures the worker.
 */
async function ensurePdfJs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import('../libraries/pdfjs/build/pdf.min.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
  return pdfjsLib;
}

/**
 * Loads the flipbook's PDF document. Reports progress via onProgress(0..1).
 */
export async function loadPdf(onProgress) {
  const lib = await ensurePdfJs();
  const loadingTask = lib.getDocument({
    url: PDF_PATH,
    // Quality-oriented flags
    disableFontFace: false,
    isEvalSupported: true,
  });

  if (onProgress) {
    loadingTask.onProgress = (data) => {
      if (data && data.total) {
        onProgress(Math.min(1, data.loaded / data.total));
      }
    };
  }

  pdfDocument = await loadingTask.promise;
  pageCount = pdfDocument.numPages;
  return { pageCount };
}

export function getPageCount() {
  return pageCount;
}

/**
 * Returns the natural (unscaled) width/height + aspect ratio of a page,
 * caching the lookup since getPage() is async and repeated often.
 */
export async function getPageDimensions(pageNum) {
  if (pageViewportCache.has(pageNum)) {
    return pageViewportCache.get(pageNum);
  }
  const page = await pdfDocument.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const dims = {
    width: viewport.width,
    height: viewport.height,
    aspect: viewport.width / viewport.height,
  };
  pageViewportCache.set(pageNum, dims);
  return dims;
}

/**
 * Renders a single PDF page onto the given canvas element at high
 * resolution. targetCssWidth/Height describe the on-screen CSS box;
 * we multiply by devicePixelRatio (capped at 2.5 for perf) and a
 * quality factor so text/images stay sharp even when pinch-zoomed.
 */
export async function renderPageToCanvas(pageNum, canvas, targetCssWidth, targetCssHeight, qualityFactor = 1.5) {
  if (!pdfDocument) throw new Error('PDF not loaded yet');

  const page = await pdfDocument.getPage(pageNum);
  const baseViewport = page.getViewport({ scale: 1 });

  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const scale = (targetCssWidth / baseViewport.width) * dpr * qualityFactor;
  const viewport = page.getViewport({ scale });

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = targetCssWidth + 'px';
  canvas.style.height = targetCssHeight + 'px';

  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const renderTask = page.render({
    canvasContext: ctx,
    viewport,
    intent: 'display',
  });

  await renderTask.promise;
  return canvas;
}

/**
 * Cancels in-flight render tasks isn't directly exposed per-call here,
 * but callers should avoid re-rendering a canvas that's already current
 * (see lazy-loader.js render cache) to prevent redundant PDF.js work.
 */
export function isLoaded() {
  return pdfDocument !== null;
}
