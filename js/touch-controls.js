/**
 * touch-controls.js
 * Unified pointer/touch gesture layer: swipe (next/prev), tap
 * (navigate), drag (page-flip follow-finger), and pinch (zoom).
 * Uses Pointer Events so the same code path covers mouse, touch,
 * and pen across Android, iPhone, iPad, and tablets.
 */

const SWIPE_THRESHOLD_PX = 50;
const SWIPE_MAX_DURATION_MS = 600;
const TAP_MAX_MOVEMENT_PX = 8;
const TAP_MAX_DURATION_MS = 280;
const DOUBLE_TAP_WINDOW_MS = 300;

/**
 * Attaches gesture handling to `el`. Calls back into the supplied
 * handlers object for each recognized gesture. Returns a cleanup fn.
 *
 * handlers: {
 *   onSwipeLeft, onSwipeRight,
 *   onTap(xRatio, yRatio),
 *   onDoubleTap(xRatio, yRatio),
 *   onDragStart(x,y), onDragMove(dx,dy,x,y), onDragEnd(dx,dy,velocity),
 *   onPinchStart(), onPinchMove(scale, centerX, centerY), onPinchEnd(scale),
 * }
 */
export function attachGestures(el, handlers) {
  const pointers = new Map(); // pointerId -> {x, y}
  let dragStart = null;
  let pinchStartDist = null;
  let pinchStartScale = 1;
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let isPinching = false;

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function getRect() {
    return el.getBoundingClientRect();
  }

  function onPointerDown(e) {
    // Don't capture the pointer if it started on a video hotspot —
    // capturing redirects all subsequent events (including the click)
    // to `el` regardless of which child is under the cursor, which
    // would silently break the hotspot's own click-to-play button.
    // Without capture here, drag tracking below still works fine since
    // pointermove/pointerup keep bubbling normally as long as the
    // pointer stays within the window.
    const startedOnHotspot = e.target?.closest?.('.video-hotspot');
    if (!startedOnHotspot) {
      el.setPointerCapture?.(e.pointerId);
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      dragStart = { x: e.clientX, y: e.clientY, t: performance.now() };
      handlers.onDragStart?.(e.clientX, e.clientY);
    } else if (pointers.size === 2) {
      isPinching = true;
      const pts = Array.from(pointers.values());
      pinchStartDist = dist(pts[0], pts[1]);
      handlers.onPinchStart?.();
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (isPinching && pointers.size === 2) {
      const pts = Array.from(pointers.values());
      const newDist = dist(pts[0], pts[1]);
      const scale = pinchStartScale * (newDist / pinchStartDist);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      handlers.onPinchMove?.(scale, cx, cy);
      return;
    }

    if (dragStart && pointers.size === 1) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      handlers.onDragMove?.(dx, dy, e.clientX, e.clientY);
    }
  }

  function onPointerUp(e) {
    const wasPinching = isPinching && pointers.size === 2;
    pointers.delete(e.pointerId);

    if (wasPinching) {
      isPinching = false;
      pinchStartDist = null;
      handlers.onPinchEnd?.();
      dragStart = null;
      return;
    }

    if (pointers.size === 0 && dragStart) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      const duration = performance.now() - dragStart.t;
      const distMoved = Math.hypot(dx, dy);

      if (distMoved < TAP_MAX_MOVEMENT_PX && duration < TAP_MAX_DURATION_MS) {
        // Tap or double-tap
        const rect = getRect();
        const xRatio = (e.clientX - rect.left) / rect.width;
        const yRatio = (e.clientY - rect.top) / rect.height;
        const now = performance.now();

        if (now - lastTapTime < DOUBLE_TAP_WINDOW_MS &&
            Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 40) {
          handlers.onDoubleTap?.(xRatio, yRatio, e);
          lastTapTime = 0;
        } else {
          handlers.onTap?.(xRatio, yRatio, e);
          lastTapTime = now;
          lastTapX = e.clientX;
          lastTapY = e.clientY;
        }
      } else if (Math.abs(dx) > SWIPE_THRESHOLD_PX &&
                 Math.abs(dx) > Math.abs(dy) &&
                 duration < SWIPE_MAX_DURATION_MS) {
        if (dx < 0) handlers.onSwipeLeft?.();
        else handlers.onSwipeRight?.();
        handlers.onDragEnd?.(dx, dy, dx / duration);
      } else {
        handlers.onDragEnd?.(dx, dy, dx / duration);
      }
      dragStart = null;
    }
  }

  function onPointerCancel(e) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      dragStart = null;
      isPinching = false;
      handlers.onDragEnd?.(0, 0, 0);
    }
  }

  el.addEventListener('pointerdown', onPointerDown, { passive: true });
  el.addEventListener('pointermove', onPointerMove, { passive: true });
  el.addEventListener('pointerup', onPointerUp, { passive: true });
  el.addEventListener('pointercancel', onPointerCancel, { passive: true });
  el.addEventListener('pointerleave', onPointerCancel, { passive: true });

  return function cleanup() {
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerCancel);
    el.removeEventListener('pointerleave', onPointerCancel);
  };
}
