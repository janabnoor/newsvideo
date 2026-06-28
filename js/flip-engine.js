/**
 * flip-engine.js
 * Drives the realistic 3D page-turn: rotateY with perspective,
 * a moving shadow that darkens as the leaf approaches 90°, and
 * GPU-accelerated transforms (translate3d/will-change) so the
 * animation stays at 60fps even on mid-range mobile hardware.
 *
 * Two leaves exist in the DOM at any time during a turn: the
 * page being turned (animated) and the page beneath it (static,
 * revealed as the turning leaf rotates away).
 */

const FLIP_DURATION_MS = 720;
const FLIP_EASE = 'cubic-bezier(0.45, 0.05, 0.15, 1)';

/**
 * Animates a leaf element rotating from 0deg to ±180deg (or vice
 * versa for previous-page turns), simulating a page turn. Returns
 * a Promise that resolves when the animation completes.
 *
 * direction: 'forward' (turns right-to-left, rotateY 0 -> -180)
 *            'backward' (turns left-to-right, rotateY -180 -> 0)
 */
export function animateFlip(leafEl, direction, opts = {}) {
  const duration = opts.duration ?? FLIP_DURATION_MS;
  const shadowEl = leafEl.querySelector('.turn-shadow');

  return new Promise((resolve) => {
    leafEl.style.willChange = 'transform';
    leafEl.classList.add('is-turning');

    const startDeg = direction === 'forward' ? 0 : -180;
    const endDeg = direction === 'forward' ? -180 : 0;

    leafEl.style.transformOrigin = 'left center';
    leafEl.style.transition = `transform ${duration}ms ${FLIP_EASE}`;
    leafEl.style.transform = `translate3d(0,0,0) rotateY(${startDeg}deg)`;

    // Force reflow so the start state is committed before transition
    leafEl.getBoundingClientRect();

    requestAnimationFrame(() => {
      leafEl.style.transform = `translate3d(0,0,0) rotateY(${endDeg}deg)`;
    });

    // Animate the cast shadow opacity in sync (peaks mid-turn at ~90deg)
    if (shadowEl) {
      animateShadowDuringFlip(shadowEl, duration);
    }

    const onEnd = (e) => {
      if (e.propertyName !== 'transform') return;
      leafEl.removeEventListener('transitionend', onEnd);
      leafEl.classList.remove('is-turning');
      leafEl.style.willChange = '';
      resolve();
    };
    leafEl.addEventListener('transitionend', onEnd);

    // Safety fallback in case transitionend doesn't fire (e.g. tab backgrounded)
    setTimeout(() => {
      leafEl.removeEventListener('transitionend', onEnd);
      leafEl.classList.remove('is-turning');
      leafEl.style.willChange = '';
      resolve();
    }, duration + 120);
  });
}

function animateShadowDuringFlip(shadowEl, duration) {
  const start = performance.now();
  function tick() {
    const elapsed = performance.now() - start;
    const t = Math.min(1, elapsed / duration);
    // Shadow intensity peaks at the midpoint of the turn (paper edge-on to viewer)
    const intensity = Math.sin(t * Math.PI);
    shadowEl.style.opacity = (intensity * 0.65).toFixed(3);
    if (t < 1) requestAnimationFrame(tick);
    else shadowEl.style.opacity = '0';
  }
  requestAnimationFrame(tick);
}

/**
 * Follows a finger/mouse drag in real time (pre-commit, before release
 * decides whether to complete or cancel the turn). progress is 0..1.
 */
export function setDragProgress(leafEl, direction, progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  const deg = direction === 'forward' ? -180 * clamped : -180 * (1 - clamped);
  leafEl.style.transition = 'none';
  leafEl.style.transformOrigin = 'left center';
  leafEl.style.transform = `translate3d(0,0,0) rotateY(${deg}deg)`;

  const shadowEl = leafEl.querySelector('.turn-shadow');
  if (shadowEl) {
    const intensity = Math.sin(clamped * Math.PI);
    shadowEl.style.opacity = (intensity * 0.65).toFixed(3);
  }
}

/**
 * Completes or cancels a drag-in-progress turn, animating smoothly
 * from the current partial angle to the resolved endpoint.
 */
export function resolveDragFlip(leafEl, direction, progress, shouldComplete) {
  const targetProgress = shouldComplete ? 1 : 0;
  const remaining = Math.abs(targetProgress - progress);
  const duration = Math.max(120, remaining * FLIP_DURATION_MS);
  return animateFlipFrom(leafEl, direction, progress, targetProgress, duration);
}

function animateFlipFrom(leafEl, direction, fromProgress, toProgress, duration) {
  const shadowEl = leafEl.querySelector('.turn-shadow');
  return new Promise((resolve) => {
    const startDeg = direction === 'forward' ? -180 * fromProgress : -180 * (1 - fromProgress);
    const endDeg = direction === 'forward' ? -180 * toProgress : -180 * (1 - toProgress);

    leafEl.style.willChange = 'transform';
    leafEl.classList.add('is-turning');
    leafEl.style.transition = `transform ${duration}ms ${FLIP_EASE}`;
    leafEl.style.transform = `translate3d(0,0,0) rotateY(${startDeg}deg)`;
    leafEl.getBoundingClientRect();

    requestAnimationFrame(() => {
      leafEl.style.transform = `translate3d(0,0,0) rotateY(${endDeg}deg)`;
    });

    if (shadowEl) animateShadowDuringFlip(shadowEl, duration);

    const onEnd = (e) => {
      if (e.propertyName !== 'transform') return;
      leafEl.removeEventListener('transitionend', onEnd);
      leafEl.classList.remove('is-turning');
      leafEl.style.willChange = '';
      resolve();
    };
    leafEl.addEventListener('transitionend', onEnd);
    setTimeout(() => {
      leafEl.removeEventListener('transitionend', onEnd);
      leafEl.classList.remove('is-turning');
      leafEl.style.willChange = '';
      resolve();
    }, duration + 120);
  });
}

export function instantSetAngle(leafEl, direction, progress) {
  const deg = direction === 'forward' ? -180 * progress : -180 * (1 - progress);
  leafEl.style.transition = 'none';
  leafEl.style.transform = `translate3d(0,0,0) rotateY(${deg}deg)`;
}

export const FLIP_DURATION = FLIP_DURATION_MS;
