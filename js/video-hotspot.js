/**
 * video-hotspot.js
 * Turns a region of a specific flipbook page into a clickable
 * "video container": a play-button overlay sits on top of the
 * PDF-rendered image, and clicking it swaps in a YouTube iframe
 * that plays inline, in place, without leaving the page or
 * opening any new tab/window.
 *
 * Coordinates are percentages of the page's own width/height, so
 * the hotspot tracks the page exactly across every breakpoint,
 * zoom level, and orientation — no separate mobile/desktop math.
 */

// ---- Configuration: one entry per interactive image -------------
// page: 1-indexed PDF page number this hotspot belongs to.
// xPct/yPct/wPct/hPct: position + size as % of the page's own box,
//   measured directly off the rendered PDF (see project notes).
// youtubeId: the video to play inline.
const HOTSPOTS = [
  {
    page: 1,
    xPct: 1.0,
    yPct: 20.5,
    wPct: 96.2,
    hPct: 34.2,
    youtubeId: '5wTmPK4Jg5g',
    
    label: 'Play campus tour video',
  },
];

// Tracks the currently active (playing) hotspot, if any, so it can
// be torn down cleanly when the user navigates away.
let activeHotspot = null; // { pageNum, container, iframe }

function getHotspotsForPage(pageNum) {
  return HOTSPOTS.filter((h) => h.page === pageNum);
}

/**
 * Builds the play-button overlay + click target for a hotspot and
 * appends it to the given sheet element. Idempotent: if the sheet
 * already has this hotspot mounted, does nothing.
 */
function mountHotspot(sheet, pageNum, hotspot) {
  const key = `${hotspot.page}-${hotspot.youtubeId}`;
  if (sheet.querySelector(`[data-hotspot-key="${key}"]`)) return;

  const region = document.createElement('div');
  region.className = 'video-hotspot';
  region.dataset.hotspotKey = key;
  region.style.left = `${hotspot.xPct}%`;
  region.style.top = `${hotspot.yPct}%`;
  region.style.width = `${hotspot.wPct}%`;
  region.style.height = `${hotspot.hPct}%`;

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'video-hotspot-play';
  playBtn.setAttribute('aria-label', hotspot.label || 'Play video');
  playBtn.innerHTML = `
    <span class="video-hotspot-ring"></span>
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor"/>
    </svg>
  `;

  region.appendChild(playBtn);

  // No manual pointer-event interception here. A real <button> click
  // only fires when mousedown/up (or the touch equivalent) happen at
  // essentially the same point — the browser itself suppresses the
  // click if the pointer moved significantly in between. That gives
  // us tap-to-play for free, while a drag/swipe that merely starts
  // over the cover image still bubbles up to bookWrapper untouched
  // and gets handled as a normal page-flip by touch-controls.js.
  const activate = () => playHotspot(sheet, pageNum, hotspot, region);
  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    activate();
  });
  // Clicking anywhere in the image region (not just the button) also starts playback —
  // the whole image is the "container", per the requirement. Same click semantics apply:
  // this only fires for a genuine tap, never after the pointer has dragged away.
  region.addEventListener('click', (e) => {
    if (region.classList.contains('is-playing')) return;
    e.stopPropagation();
    activate();
  });

  sheet.appendChild(region);
}

/**
 * Swaps the play-button overlay for a live YouTube iframe, playing
 * inline. Uses youtube-nocookie.com + minimal chrome so it blends
 * with the page rather than feeling like an embedded widget.
 */
function playHotspot(sheet, pageNum, hotspot, region) {
  if (region.classList.contains('is-playing')) return;

  // If some other hotspot is already playing elsewhere, stop it first
  // (only one video plays at a time across the whole flipbook).
  stopActiveVideo();

  region.classList.add('is-playing');

  const frameWrap = document.createElement('div');
  frameWrap.className = 'video-hotspot-frame';

  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${hotspot.youtubeId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1`;
  iframe.title = hotspot.label || 'Embedded video';
  iframe.frameBorder = '0';
  iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
  iframe.allowFullscreen = true;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'video-hotspot-close';
  closeBtn.setAttribute('aria-label', 'Close video');
  closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    stopActiveVideo();
  });

  frameWrap.appendChild(iframe);
  frameWrap.appendChild(closeBtn);
  region.appendChild(frameWrap);

  // Fade the play button out, frame in (handled in CSS via .is-playing)
  activeHotspot = { pageNum, sheet, region, frameWrap };
}

/**
 * Stops whatever video is currently playing (if any) and restores
 * the play-button overlay. Safe to call even when nothing is playing.
 */
export function stopActiveVideo() {
  if (!activeHotspot) return;
  const { region, frameWrap } = activeHotspot;
  frameWrap.remove();
  region.classList.remove('is-playing');
  activeHotspot = null;
}

/**
 * Stops the active video only if it belongs to the given page —
 * used when a specific page is about to be unmounted/turned away
 * from, without affecting a hotspot on a different page.
 */
export function stopVideoOnPage(pageNum) {
  if (activeHotspot && activeHotspot.pageNum === pageNum) {
    stopActiveVideo();
  }
}

/**
 * Call this right after a sheet for `pageNum` is created/rendered.
 * Mounts any configured hotspots for that page onto the sheet.
 */
export function attachHotspotsForPage(sheet, pageNum) {
  const hotspots = getHotspotsForPage(pageNum);
  hotspots.forEach((h) => mountHotspot(sheet, pageNum, h));
}

export function hasHotspotForPage(pageNum) {
  return getHotspotsForPage(pageNum).length > 0;
}
