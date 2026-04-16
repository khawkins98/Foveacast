// Document-level drag-and-drop handler.
//
// WHY this module exists (the load-bearing finding):
//   Before this, the only drag/drop listeners lived on the drop-zone
//   element. A file dropped one pixel outside that rectangle would
//   trigger the browser's default behaviour — navigating away from
//   Foveacast and opening the file in the tab. For a tool whose whole
//   job is "drop a file", that is the worst possible failure mode: the
//   app disappears and the user assumes it crashed.
//
//   This module attaches `dragover`, `dragleave`, and `drop` to
//   `document` in the capture phase. It always calls `preventDefault()`
//   so the browser never navigates away on a misdrop, and it forwards
//   accepted drops to the same `onFile` callback the drop zone uses.
//
// WHY the drop zone's own listeners stay in place:
//   They remain as a pure visual-affordance no-op — the zone's
//   `dragenter`/`dragover`/`dragleave` handlers only toggle the
//   `fc-dropzone--dragging` class so the user sees a hover treatment
//   when their cursor is actually over the zone. The `drop` event on
//   the drop zone bubbles to document, where this module handles it.
//   Both handlers call `preventDefault`, so there is no double-fire:
//   the file is only ever dispatched once — from here.

import { validateDroppedFile } from './file-validation.js';

/**
 * CSS class toggled on `<body>` while a drag is in progress anywhere
 * over the document. The drop zone uses this class (via `body.fc-page-dragover
 * .fc-dropzone`) to visually lift / highlight itself so the user can
 * see where the file will land even when their cursor is elsewhere.
 */
export const PAGE_DRAGOVER_CLASS = 'fc-page-dragover';

/**
 * @typedef {Object} PageDropOptions
 * @property {(file: File) => void} onFile
 *   - Called once with the first dropped file when validation passes.
 * @property {(error: { code: string, message: string }) => void} onError
 *   - Called with a rejection when validation fails. The caller should
 *     surface `message` through its status banner.
 * @property {Document | null | undefined} [doc]
 *   - Document to bind to. Defaults to `document`. Mainly a test hook.
 * @property {HTMLElement | null | undefined} [dropzoneElement]
 *   - Currently unused inside the handler itself, but accepted so tests
 *     and future callers can hand off a reference without reshaping
 *     this API. The visual affordance is CSS-driven via the body class.
 */

/**
 * @typedef {Object} PageDropController
 * @property {() => void} dispose
 *   - Removes every listener and clears the dragover body class.
 */

/**
 * Install document-level drag/drop handling.
 *
 * Returns a controller with a `dispose()` method. Callers rarely need
 * dispose in the live app (the listeners should live for the page's
 * lifetime) but tests appreciate being able to tear down cleanly.
 *
 * @param {PageDropOptions} options
 * @returns {PageDropController}
 */
export function installPageDrop(options) {
  const {
    onFile,
    onError,
    doc = typeof document !== 'undefined' ? document : null,
  } = options;

  if (!doc) {
    // Nothing we can do without a document. Return a no-op controller
    // so callers don't have to special-case SSR contexts.
    return { dispose: () => {} };
  }

  /**
   * `dragenter`/`dragleave` fire for every child element the cursor
   * crosses during a drag. A naive toggle on `dragleave` would flicker
   * the hover class off and on a dozen times as the cursor moved
   * across child DOM. The standard workaround is a counter: increment
   * on `dragenter`, decrement on `dragleave`, and only clear the class
   * when the counter returns to zero. The counter also survives the
   * file being dropped (drop resets it).
   */
  let dragDepth = 0;

  function addDragClass() {
    if (doc.body && !doc.body.classList.contains(PAGE_DRAGOVER_CLASS)) {
      doc.body.classList.add(PAGE_DRAGOVER_CLASS);
    }
  }

  function removeDragClass() {
    if (doc.body) {
      doc.body.classList.remove(PAGE_DRAGOVER_CLASS);
    }
  }

  /**
   * Only treat drags that carry files as real drops. A text selection
   * or link being dragged inside the page shouldn't toggle the
   * "somebody is about to drop a screenshot" UI.
   * @param {DragEvent} ev
   */
  function dragCarriesFiles(ev) {
    const dt = ev.dataTransfer;
    if (!dt) return false;
    // `types` is a DOMStringList-alike; modern browsers include the
    // string 'Files' when the drag payload includes files.
    const types = dt.types;
    if (!types) return false;
    // Some engines expose .includes; others need an indexOf loop.
    for (let i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  }

  /** @param {DragEvent} ev */
  function onDragEnter(ev) {
    if (!dragCarriesFiles(ev)) return;
    // Always prevent default for file drags so the browser doesn't
    // race us to its navigation behaviour on a subsequent `drop`.
    ev.preventDefault();
    dragDepth += 1;
    addDragClass();
  }

  /** @param {DragEvent} ev */
  function onDragOver(ev) {
    // We call preventDefault unconditionally here. The spec requires
    // a `dragover` preventDefault to mark the target as a valid drop
    // target; without it, the browser falls back to its default
    // handler (open the file, navigate away). This is the single most
    // important line in the whole module.
    ev.preventDefault();
    if (!dragCarriesFiles(ev)) return;
    if (ev.dataTransfer) {
      // Hint to the OS that we are a copy target, not a move target —
      // purely cosmetic (the cursor changes) but expected UX.
      try {
        ev.dataTransfer.dropEffect = 'copy';
      } catch {
        // Some synthetic events (tests) have read-only dataTransfer.
      }
    }
    addDragClass();
  }

  /** @param {DragEvent} ev */
  function onDragLeave(ev) {
    if (!dragCarriesFiles(ev)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) removeDragClass();
  }

  /** @param {DragEvent} ev */
  function onDrop(ev) {
    // Always prevent the default file-open navigation, regardless of
    // whether validation passes. This is the safety net.
    ev.preventDefault();
    dragDepth = 0;
    removeDragClass();

    const files = ev.dataTransfer && ev.dataTransfer.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const result = validateDroppedFile(file);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onFile(file);
  }

  // Capture phase so we see the event before any element-level handler
  // gets a chance to stopPropagation. Even if the drop zone's own
  // handler runs afterwards, the file is only dispatched once — from
  // here — because the drop zone no longer forwards to `onFile` itself.
  doc.addEventListener('dragenter', onDragEnter, true);
  doc.addEventListener('dragover', onDragOver, true);
  doc.addEventListener('dragleave', onDragLeave, true);
  doc.addEventListener('drop', onDrop, true);

  return {
    dispose() {
      doc.removeEventListener('dragenter', onDragEnter, true);
      doc.removeEventListener('dragover', onDragOver, true);
      doc.removeEventListener('dragleave', onDragLeave, true);
      doc.removeEventListener('drop', onDrop, true);
      removeDragClass();
      dragDepth = 0;
    },
  };
}
