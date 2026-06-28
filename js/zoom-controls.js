/**
 * zoom-controls.js
 * Manages zoom state for the book (pinch, double-tap, and button
 * zoom) across discrete levels: 100/125/150/200/300%. Re-renders
 * the active page's canvas at the new effective resolution so text
 * and images stay crisp rather than blurring from a CSS-only scale.
 */

const ZOOM_LEVELS = [1, 1.25, 1.5, 2, 3];
let currentZoomIndex = 0;
let panX = 0;
let panY = 0;

const listeners = new Set();

export function onZoomChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  const zoom = ZOOM_LEVELS[currentZoomIndex];
  listeners.forEach((fn) => fn(zoom, panX, panY));
}

export function getZoom() {
  return ZOOM_LEVELS[currentZoomIndex];
}

export function getPan() {
  return { x: panX, y: panY };
}

export function setPan(x, y) {
  panX = x;
  panY = y;
  notify();
}

export function zoomIn() {
  currentZoomIndex = Math.min(ZOOM_LEVELS.length - 1, currentZoomIndex + 1);
  if (getZoom() === 1) { panX = 0; panY = 0; }
  notify();
}

export function zoomOut() {
  currentZoomIndex = Math.max(0, currentZoomIndex - 1);
  if (getZoom() === 1) { panX = 0; panY = 0; }
  notify();
}

export function resetZoom() {
  currentZoomIndex = 0;
  panX = 0;
  panY = 0;
  notify();
}

/** Toggles between 100% and 200% — used for double-tap/double-click. */
export function toggleDoubleTapZoom(focalXRatio = 0.5, focalYRatio = 0.5) {
  if (currentZoomIndex === 0) {
    currentZoomIndex = ZOOM_LEVELS.indexOf(2);
    // Bias pan toward the tapped point (subtle, kept within sane bounds)
    panX = (0.5 - focalXRatio) * 60;
    panY = (0.5 - focalYRatio) * 60;
  } else {
    currentZoomIndex = 0;
    panX = 0;
    panY = 0;
  }
  notify();
}

/** Sets zoom directly from a pinch gesture's computed scale (snaps to nearest level on release). */
export function setRawZoom(scale) {
  const zoom = Math.max(1, Math.min(3, scale));
  // Live, continuous — snapping happens in snapToNearestLevel()
  listeners.forEach((fn) => fn(zoom, panX, panY));
  return zoom;
}

export function snapToNearestLevel(rawZoom) {
  let closestIdx = 0;
  let closestDist = Infinity;
  ZOOM_LEVELS.forEach((level, idx) => {
    const dist = Math.abs(level - rawZoom);
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = idx;
    }
  });
  currentZoomIndex = closestIdx;
  if (getZoom() === 1) { panX = 0; panY = 0; }
  notify();
}

export function isZoomedIn() {
  return currentZoomIndex > 0;
}

export function getZoomLevels() {
  return ZOOM_LEVELS.slice();
}
