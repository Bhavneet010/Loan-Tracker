// Must be >= longest CSS exit animation (backdropOut: 0.24s + sheet/modal: 0.24s)
const CLOSE_MS = 260;

/**
 * Show an overlay with entrance animation.
 * Pre-hides via opacity:0 so the backdrop fade starts from invisible,
 * then adds .is-open two frames later so CSS animation fires cleanly.
 */
export function openOverlay(id, displayMode = 'flex') {
  const el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;
  el.classList.remove('is-closing');
  el.style.opacity = '0';
  el.style.display = displayMode;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.opacity = '';
    el.classList.add('is-open');
  }));
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
 * Pre-hides so there is no flash before the entrance animation starts.
 */
export function animateOverlayIn(el) {
  el.style.opacity = '0';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.opacity = '';
    el.classList.add('is-open');
  }));
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

let contentSwapTimer = null;

/**
 * Trigger a calm entrance animation on #content after innerHTML is replaced.
 * The motion stays intentionally small so frequent stat tab changes feel responsive.
 */
export function animateContent(mode, tab) {
  const c = document.getElementById('content');
  if (!c) return;

  c.classList.remove('content-enter', 'content-enter-left', 'content-enter-right', 'content-leaving');
  void c.offsetWidth; // force reflow so re-adding the same class re-triggers animation
  c.classList.add('content-enter');
}

export function transitionContentSwap(renderNext) {
  const c = document.getElementById('content');
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  clearTimeout(contentSwapTimer);

  if (!c || reduceMotion) {
    renderNext();
    return;
  }

  if (c.classList.contains('content-leaving')) {
    contentSwapTimer = setTimeout(renderNext, 120);
    return;
  }

  c.classList.remove('content-enter', 'content-enter-left', 'content-enter-right');
  c.classList.add('content-leaving');

  let swapped = false;
  const swap = () => {
    if (swapped) return;
    swapped = true;
    renderNext();
  };

  c.addEventListener('animationend', swap, { once: true });
  contentSwapTimer = setTimeout(swap, 210);
}
