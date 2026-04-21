// Drop zone UI.
//
// No unit tests in this commit — jsdom's DataTransfer and File support
// are just incomplete enough that high-fidelity dropzone tests spend
// more time stubbing than actually testing. Phase E's gstack browser
// smoke test exercises the real drag/drop interaction against a real
// screenshot in a real browser, which is the honest place to catch
// regressions. The module itself is small, pure DOM, and has ample
// inline comments below explaining every branch.
//
// SCOPE NOTE (UX commit 1):
//   Drop handling for dropped *files* now lives on `document` in
//   `ui/page-drop.js`, so a misdropped file anywhere on the page is
//   caught instead of navigating the browser away. This module keeps
//   its own `dragenter`/`dragover`/`dragleave` handlers for the
//   element-local hover treatment, but it no longer calls `onFile` /
//   `onError` from a `drop` event — the page-level handler owns that
//   path to avoid double-fires. Click-to-pick still lives here.
//
// PRD references:
//   - §Accessibility: keyboard-activatable drop zone, Tab + Enter/Space.
//   - §Error States: verbatim messages for UNSUPPORTED_TYPE and TOO_LARGE.
//   - §First-Run: "Ready once model loads…" label during the disabled state.

import { validateDroppedFile } from './file-validation.js';
import { iconUpload } from './icons.js';

/**
 * @typedef {Object} DropzoneError
 * @property {'UNSUPPORTED_TYPE'|'TOO_LARGE'} code
 * @property {string} message
 */

/**
 * @typedef {Object} DropzoneOptions
 * @property {(file: File) => void} onFile
 * @property {(err: DropzoneError) => void} onError
 */

/**
 * @typedef {Object} DropzoneController
 * @property {HTMLDivElement} element
 * @property {(enabled: boolean) => void} setEnabled
 * @property {(busy: boolean) => void} setBusy
 */

/**
 * Build a keyboard- and drag-accessible drop zone. Returns a
 * controller the caller can use to toggle enabled/busy states during
 * first-run model download or inference.
 *
 * WHY a `<div role="button">` rather than a real `<button>`: browsers
 * do not let drag-and-drop land on <button> elements as reliably as
 * on divs — the drop events get swallowed or redispatched. The div
 * carries all the right ARIA so assistive tech treats it like a
 * button, and we wire keyboard activation manually.
 *
 * @param {DropzoneOptions} options
 * @returns {DropzoneController}
 */
export function createDropzone({ onFile, onError }) {
  const element = document.createElement('div');
  element.className = 'fc-dropzone';
  element.setAttribute('role', 'button');
  element.setAttribute('tabindex', '0');
  element.setAttribute(
    'aria-label',
    'Drop a screenshot here or press Enter to choose a file',
  );

  // Upload icon — decorative, reinforces the affordance visually.
  const icon = document.createElement('span');
  icon.className = 'fc-dropzone__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = iconUpload;
  element.appendChild(icon);

  // Default visible copy. Caller can swap this out via setEnabled(false).
  const label = document.createElement('p');
  label.className = 'fc-dropzone__label';
  label.textContent = 'Drop or paste a screenshot (Cmd-V\u00a0/\u00a0Ctrl-V) to generate a predicted attention heatmap.';
  element.appendChild(label);

  const hint = document.createElement('p');
  hint.className = 'fc-dropzone__hint';
  hint.textContent = 'PNG or JPEG, up to 20\u00a0MB. Controls appear after the first analysis.';
  element.appendChild(hint);

  // why: reinforces the privacy promise at the point of action, where
  // users are most likely to have concerns about uploading an image.
  const privacy = document.createElement('p');
  privacy.className = 'fc-dropzone__hint';
  privacy.textContent = 'Runs locally \u2014 your image never leaves this tab.';
  element.appendChild(privacy);

  // Hidden file input — cloned-and-replaced on each pick so the same
  // file can be chosen twice in a row. (Browsers suppress a `change`
  // event when the selected file is identical to the prior value.)
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg';
  input.className = 'fc-dropzone__input';
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  input.style.position = 'absolute';
  input.style.left = '-99999px';
  input.style.width = '1px';
  input.style.height = '1px';
  input.style.opacity = '0';
  element.appendChild(input);

  /** Internal state. We keep these as closures rather than on `element`
   *  so debugging attribute dumps stay uncluttered. */
  let enabled = true;
  let busy = false;

  /**
   * Validate and hand off a single file (used by the click-to-pick
   * flow). Returns true if accepted. Drop-initiated files go through
   * the document-level handler in `ui/page-drop.js` — we deliberately
   * do NOT call this from a `drop` event here anymore.
   */
  function handleFile(file) {
    const result = validateDroppedFile(file);
    if (!result.ok) {
      onError(result.error);
      return false;
    }
    onFile(file);
    return true;
  }

  /** Drag-and-drop visual feedback. We toggle a class rather than
   *  inline styles so the stylesheet controls the hover treatment. */
  function setDragging(isDragging) {
    element.classList.toggle('fc-dropzone--dragging', isDragging);
  }

  // --- Event wiring --------------------------------------------------

  element.addEventListener('dragenter', (ev) => {
    if (!enabled || busy) return;
    ev.preventDefault();
    setDragging(true);
  });

  element.addEventListener('dragover', (ev) => {
    if (!enabled || busy) return;
    // `preventDefault` on dragover is what tells the browser that
    // this element is a valid drop target. Without it, `drop` never
    // fires.
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  });

  element.addEventListener('dragleave', (ev) => {
    // Only clear when the pointer leaves the dropzone itself; child
    // elements fire dragleave as the cursor moves between them.
    if (ev.target !== element) return;
    setDragging(false);
  });

  element.addEventListener('drop', (ev) => {
    // The document-level handler in `ui/page-drop.js` owns file
    // dispatch now; we only kill the browser's default and clear the
    // visual hover state. Calling `handleFile` here would double-fire
    // with the page handler and process the same drop twice.
    ev.preventDefault();
    setDragging(false);
  });

  // Click → open picker. We trigger on the container itself, not on
  // the input, so the whole surface is clickable.
  element.addEventListener('click', (ev) => {
    if (!enabled || busy) return;
    // Guard against re-entrant clicks coming from the hidden input.
    if (ev.target === input) return;
    input.click();
  });

  // Keyboard activation. Enter and Space both count (standard
  // button semantics); we preventDefault on Space so the page does
  // not scroll.
  element.addEventListener('keydown', (ev) => {
    if (!enabled || busy) return;
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      input.click();
    }
  });

  input.addEventListener('change', () => {
    if (!enabled || busy) return;
    const file = input.files && input.files[0];
    if (file) handleFile(file);
    // Reset so picking the same file again re-fires `change`.
    input.value = '';
  });

  // --- Controller API -----------------------------------------------

  /** @param {boolean} nextEnabled */
  function setEnabled(nextEnabled) {
    enabled = !!nextEnabled;
    if (enabled) {
      element.removeAttribute('aria-disabled');
      element.setAttribute('tabindex', '0');
      element.classList.remove('fc-dropzone--disabled');
      label.textContent = 'Drop a screenshot here, click to choose a file, or paste one from the clipboard.';
    } else {
      element.setAttribute('aria-disabled', 'true');
      // Removing from tab order is important — an aria-disabled
      // element that still accepts focus traps keyboard users.
      element.setAttribute('tabindex', '-1');
      element.classList.add('fc-dropzone--disabled');
      label.textContent = 'Ready once model loads…';
    }
  }

  /** @param {boolean} nextBusy */
  function setBusy(nextBusy) {
    busy = !!nextBusy;
    if (busy) {
      element.setAttribute('aria-busy', 'true');
    } else {
      element.removeAttribute('aria-busy');
    }
  }

  /**
   * Programmatically open the file picker — used by the "New Image"
   * button that replaces the full dropzone after first inference.
   * No-ops when the dropzone is disabled or busy so it cannot start
   * a second pipeline while one is already running.
   */
  function openPicker() {
    if (!enabled || busy) return;
    input.click();
  }

  /**
   * Override the visible label text without changing the enabled/disabled
   * state. Used after model load to surface "Model ready" inside the
   * drop zone instead of showing a separate status banner.
   * Automatically reset on the next {@link setEnabled} call.
   *
   * @param {string} text
   */
  function setLabel(text) {
    label.textContent = text;
  }

  return { element, setEnabled, setBusy, openPicker, setLabel };
}
