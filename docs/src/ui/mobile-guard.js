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
 * Secondary copy shown on the "proceed anyway" button and its warning
 * line. The framing is deliberately honest: the tool may work, or it
 * may run out of memory halfway through inference. The user has
 * asked to take the risk; we let them.
 */
export const MOBILE_PROCEED_LABEL = 'Proceed anyway (at my own risk)';

/**
 * localStorage sentinel that remembers a user's choice to bypass the
 * guard, so they don't have to dismiss it on every reload. The
 * `:v1` suffix leaves room to bump the key if the guard's scope
 * changes (e.g. iOS Safari gets its own tier in V2).
 */
const BYPASS_KEY = 'foveacast:mobile-guard-bypass:v1';

/**
 * @param {Storage} [storage]
 * @returns {boolean}
 */
function hasBypassed(storage) {
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return false;
    return store.getItem(BYPASS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * @param {Storage} [storage]
 */
function rememberBypass(storage) {
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return;
    store.setItem(BYPASS_KEY, '1');
  } catch {
    /* ignore — remembering is best-effort; the guard will just reappear next time */
  }
}

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
 * The guard is dismissible: a "Proceed anyway" button lets a user who
 * understands the constraint (or who is testing on a narrow window
 * that happens to look mobile) continue to the real app. The choice
 * is remembered in localStorage so a reload doesn't force them to
 * dismiss it again.
 *
 * @param {HTMLElement} container
 * @param {{ storage?: Storage, onProceed?: () => void }} [options]
 *   - `storage` lets tests inject a fake Storage.
 *   - `onProceed` is called by the "Proceed anyway" button. main.js
 *     passes a rebooting function so the real app starts. Tests pass
 *     a spy.
 * @returns {boolean} Whether the guard fired (i.e. the app should
 *   *not* continue to boot).
 */
export function mountMobileGuard(container, options = {}) {
  const { storage, onProceed } = options;

  if (!isMobileBrowser()) return false;
  if (!container) return false;

  // If the user previously dismissed the guard, treat this visit as
  // desktop-equivalent and let the app boot.
  if (hasBypassed(storage)) return false;

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

  // Proceed-anyway escape. Honest copy above the button: we aren't
  // blocking anyone; we're telling them what the constraint is and
  // letting them decide. The button sets the bypass sentinel, removes
  // the guard, and calls back into main.js to restart bootstrapping.
  const actions = document.createElement('div');
  actions.className = 'fc-mobile-guard__actions';

  const caveat = document.createElement('p');
  caveat.className = 'fc-mobile-guard__caveat';
  caveat.textContent =
    'If you know what you are doing — for example, testing on a narrow browser window, or on a tablet with plenty of memory — you can bypass this notice. Inference may still fail.';
  actions.appendChild(caveat);

  const proceed = document.createElement('button');
  proceed.type = 'button';
  proceed.className = 'fc-mobile-guard__proceed';
  proceed.textContent = MOBILE_PROCEED_LABEL;
  proceed.addEventListener('click', () => {
    rememberBypass(storage);
    // Clear the guard out of the container so the caller can rebuild
    // the normal layout on top of an empty root.
    container.textContent = '';
    if (typeof onProceed === 'function') {
      onProceed();
    }
  });
  actions.appendChild(proceed);

  wrap.appendChild(actions);
  container.appendChild(wrap);
  return true;
}
