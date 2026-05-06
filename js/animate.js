// Duration must match CSS closing animation durations (ms)
const CLOSE_MS = 200;

/**
 * Show an overlay with entrance animation.
 * Sets display then adds .is-open on the next two frames so CSS animation fires cleanly.
 */
export function openOverlay(id, displayMode = 'flex') {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;
  el.classList.remove('is-closing');
  el.style.display = displayMode;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-open')));
}

/**
 * Hide an overlay with exit animation, then set display:none after animation completes.
 * Optional callback fires after hide.
 */
export function closeOverlay(id, cb) {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;
  el.classList.remove('is-open');
  el.classList.add('is-closing');
  setTimeout(() => {
    el.style.display = 'none';
    el.classList.remove('is-closing');
    cb?.();
  }, CLOSE_MS);
}

/**
 * Animate a dynamically-created overlay element that was just appended to the DOM.
 */
export function animateOverlayIn(el) {
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-open')));
}

/**
 * Animate a dynamically-created overlay out, then remove it from the DOM.
 */
export function animateOverlayOut(el, cb) {
  el.classList.remove('is-open');
  el.classList.add('is-closing');
  setTimeout(() => { el.remove(); cb?.(); }, CLOSE_MS);
}

// ── Content entrance ───────────────────────────────────────────────────────────

const TAB_ORDER = { pending: 0, sanctioned: 1, returned: 2 };
let _prevMode = null;
let _prevTab = null;

/**
 * Trigger a directional entrance animation on #content after innerHTML is replaced.
 * Tab switches slide left/right; mode switches fade+rise.
 */
export function animateContent(mode, tab) {
  const c = document.getElementById('content');
  if (!c) return;

  let cls = 'content-enter';
  if (mode === 'fresh' && _prevMode === 'fresh' && tab !== _prevTab) {
    const prev = TAB_ORDER[_prevTab] ?? -1;
    const curr = TAB_ORDER[tab] ?? -1;
    if (prev !== -1 && curr !== -1) {
      cls = curr > prev ? 'content-enter-right' : 'content-enter-left';
    }
  }

  _prevMode = mode;
  _prevTab = tab;

  c.classList.remove('content-enter', 'content-enter-left', 'content-enter-right');
  void c.offsetWidth; // force reflow so re-adding the same class re-triggers animation
  c.classList.add(cls);
}
