// Vitest setup: filter out jsdom's "Not implemented: HTMLCanvasElement.prototype.getContext" noise.
//
// WHY THIS FILE EXISTS
// --------------------
// A green `pnpm test` run was printing three full stack traces from jsdom's
// not-implemented channel, every one of them from the same well-understood
// cause: jsdom does not implement the 2D canvas API, and our preprocess
// pipeline legitimately creates an offscreen canvas as part of its downsample
// path. The production code handles the "no 2D context" case correctly; the
// tests assert that behaviour and pass. The stack traces are therefore
// expected, load-bearing-for-nothing, and actively harmful to the
// first-impression signal of the suite (a new contributor sees red-looking
// output on a passing run and wonders what is wrong).
//
// WHAT THIS FILTER DOES, AND WHAT IT DELIBERATELY DOES NOT DO
// -----------------------------------------------------------
// We wrap `console.error` with a narrow filter that drops exactly one
// signature: the jsdom not-implemented message for
// `HTMLCanvasElement.prototype.getContext`. Every other `console.error`
// call — including every real test failure, every unexpected warning, and
// any future not-implemented warning for a different API — passes straight
// through to the original `console.error`. This is deliberate. We want real
// errors to surface; we only want to silence the single known-benign
// channel whose fix (installing the `canvas` npm package) would add a
// native build dependency that every contributor would pay for.
//
// If a future test starts relying on canvas features we have not planned
// for, the filter will still let through any unrelated jsdom messages, and
// the code path will fail loudly on the missing method rather than on a
// filtered warning.
//
// SCOPE: only the getContext not-implemented signature. Nothing else.

/**
 * The original `console.error`, captured before we install the wrapper so we
 * can forward anything that is not the canvas-getContext signature to the
 * real implementation.
 *
 * @type {(...args: unknown[]) => void}
 */
const realConsoleError = console.error.bind(console);

/**
 * Signature fragment jsdom uses when it logs the not-implemented warning
 * for the 2D canvas API. Matching on this exact substring (rather than on
 * the broader "Not implemented" prefix) keeps the filter as narrow as
 * possible — we do not want to swallow, for example, a future
 * not-implemented message for WebGL or IndexedDB.
 */
const CANVAS_GETCONTEXT_SIGNATURE =
  'Not implemented: HTMLCanvasElement.prototype.getContext';

/**
 * Return `true` when a value carries the canvas-getContext signature,
 * in any of the shapes jsdom emits it through `VirtualConsole.sendTo`.
 *
 * Concretely, jsdom's `sendTo(console)` subscribes to its own `jsdomError`
 * events and forwards them as `console.error(e.stack, e.detail)`. The first
 * argument is therefore usually the stack *string*, not the Error instance.
 * We also accept an `Error` directly (in case the routing changes in a
 * future jsdom minor) so the filter remains resilient across upgrades.
 *
 * Everything else — any other error shape, any other message — falls
 * through to the real `console.error`.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isCanvasGetContextError(value) {
  if (typeof value === 'string') {
    return value.includes(CANVAS_GETCONTEXT_SIGNATURE);
  }
  if (value instanceof Error) {
    return value.message.includes(CANVAS_GETCONTEXT_SIGNATURE);
  }
  return false;
}

// Install the wrapper. `console.error` stays itself in every shape that
// matters (name, length) — we just gate the one well-known noisy call.
console.error = (...args) => {
  if (args.length > 0 && isCanvasGetContextError(args[0])) {
    return;
  }
  realConsoleError(...args);
};
