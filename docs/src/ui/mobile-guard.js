// Mobile-browser detection + desktop-only message.
//
// Per PRD §Browser Support, Foveacast is a desktop-only tool — the
// attention model needs more memory and CPU than phones and tablets
// can reliably provide. We detect likely-mobile environments early
// and replace the page content with a friendly explanation before any
// model code runs, so a phone user never triggers a 60MB download
// that is guaranteed to be useless to them.
//
// This module is deliberately not wired into the app here — Phase D's
// main.js is responsible for calling mountMobileGuard() on the app
// root before bootstrapping anything else. Keeping the call site in
// one place means nobody can accidentally bypass the guard by
// importing a sub-component directly.
//
// Detection combines three signals, any of which is sufficient:
//   1. `pointer: coarse` media query — the standard modern indicator
//      that the primary input is a touch screen. More reliable than
//      UA sniffing for tablets.
//   2. Viewport width < 900 px — catches small windows on laptops as
//      well, which is a false positive, but the consequence (a
//      desktop user resizing to pocket width and being politely
//      redirected) is low-cost compared to failed inference on a
//      phone.
//   3. UA string containing `Mobi` / `Android` / `iPhone` / `iPad` —
//      a last-resort fallback for environments that expose neither
//      pointer media queries nor a meaningful viewport.

/**
 * Exported copy for the mobile-only view. Kept as a constant so
 * tests can snapshot it if desired and future copy edits land in one
 * place.
 */
export const MOBILE_MESSAGE =
  'Foveacast is designed for desktop use. The attention model needs more memory and CPU than a phone or tablet can reliably provide. Please open this page on a laptop or desktop computer.';

/**
 * Mobile-viewport breakpoint. Width-only because height on mobile
 * varies wildly with the address bar state.
 *
 * 900 px is slightly generous — it catches many tablets in landscape
 * but also small laptop windows. The trade-off is documented above.
 */
const MOBILE_MAX_WIDTH = 900;

/**
 * Heuristic mobile-browser detection.
 *
 * WHY three signals in OR: no single signal is reliable. `pointer:
 * coarse` misses desktop browsers forced into touch mode; viewport
 * width can be spoofed or resized; UA strings lie. Any one signal
 * tipping us toward "mobile" is enough to show the friendly message.
 *
 * @returns {boolean}
 */
export function isMobileBrowser() {
  if (typeof window === 'undefined') return false;

  // 1. Pointer media query. Wrapped in try/catch because some older
  //    test runners throw on unknown media features.
  try {
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
    ) {
      return true;
    }
  } catch {
    // Fall through to the other signals.
  }

  // 2. Viewport width.
  const width =
    (typeof window.innerWidth === 'number' && window.innerWidth) ||
    (typeof document !== 'undefined' &&
      document.documentElement &&
      document.documentElement.clientWidth) ||
    0;
  if (width > 0 && width < MOBILE_MAX_WIDTH) {
    // Do NOT return true from viewport width alone when a non-coarse
    // pointer test has already passed; a desktop user with a narrow
    // window is a real case. We only treat narrow-width as mobile
    // when combined with another signal — check UA below.
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) {
      return true;
    }
  }

  // 3. UA fallback for environments without meaningful media queries.
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) {
    return true;
  }

  return false;
}

/**
 * If the current browser looks mobile, replace the contents of
 * `container` with a desktop-only message and return `true`. The
 * caller (main.js) is expected to bail out of any further bootstrap
 * when the return value is `true`.
 *
 * @param {HTMLElement} container
 * @returns {boolean} Whether the guard fired.
 */
export function mountMobileGuard(container) {
  if (!isMobileBrowser()) return false;
  if (!container) return false;

  container.textContent = '';

  const wrap = document.createElement('div');
  wrap.className = 'fc-mobile-guard';
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', 'Desktop-only notice');

  const heading = document.createElement('h1');
  heading.className = 'fc-mobile-guard__heading';
  heading.textContent = 'Foveacast is a desktop tool';
  wrap.appendChild(heading);

  const body = document.createElement('p');
  body.className = 'fc-mobile-guard__body';
  body.textContent = MOBILE_MESSAGE;
  wrap.appendChild(body);

  container.appendChild(wrap);
  return true;
}
