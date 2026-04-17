// First-run detection via localStorage sentinel.
//
// Why this exists:
//   The status banner defaults to "Loading model from cache..." on a
//   true first-time visit, and only upgrades to the first-run banner
//   after 800 ms of slow progress. For a returning user that is fine;
//   for a first-timer it is the worst possible moment to tell them
//   they are returning, because it contradicts their lived
//   experience at exactly the moment we need to explain a ~60 MB
//   wait. The sentinel flips the default for a confirmed-fresh
//   visitor.
//
// Why this is a separate module:
//   Keeping these two functions in `main.js` would require importing
//   `main.js` in the test — which triggers `boot()` under jsdom and
//   is noisy. A small dedicated module is testable in isolation.

/**
 * localStorage key used to detect whether this browser has completed
 * at least one model load before. The `v1` suffix means a future
 * model swap that changes weight size or download shape can bump to
 * `v2` and correctly treat every existing user as first-time again
 * for the new download.
 */
export const HAS_RUN_KEY = 'foveacast:has-run:v1';

/**
 * Read the first-run sentinel. Wrapped in a try/catch because
 * `localStorage` throws (`SecurityError`) in some sandboxed contexts
 * and in Safari private browsing. A thrown access is treated as
 * "fresh visit" — the more conservative assumption, because showing
 * a first-run banner to a returning user is less harmful than
 * showing a cache-load banner to a fresh user.
 *
 * @param {Storage} [storage] - Optional test hook; defaults to `window.localStorage`.
 * @returns {boolean}
 */
export function readHasRunSentinel(storage) {
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return false;
    return store.getItem(HAS_RUN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Write the first-run sentinel after a successful model load. Same
 * try/catch safety as the reader — we never want a storage quota
 * error to propagate out of the happy path.
 *
 * @param {Storage} [storage]
 */
export function writeHasRunSentinel(storage) {
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return;
    store.setItem(HAS_RUN_KEY, '1');
  } catch {
    /* ignore — see readHasRunSentinel */
  }
}
