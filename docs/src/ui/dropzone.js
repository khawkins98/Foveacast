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
// PRD references:
//   - §Accessibility: keyboard-activatable drop zone, Tab + Enter/Space.
//   - §Error States: verbatim messages for UNSUPPORTED_TYPE and TOO_LARGE.
//   - §First-Run: "Ready once model loads…" label during the disabled state.

/** Maximum accepted file size, per PRD §Error States. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * MIME types we accept. PRD explicitly lists PNG and JPEG.
 * (`image/jpg` is not a registered MIME type but some older browsers
 * send it; we accept it to be tolerant of real-world variance.)
 */
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

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

  // Default visible copy. Caller can swap this out via setEnabled(false).
  const label = document.createElement('p');
  label.className = 'fc-dropzone__label';
  label.textContent = 'Drop a screenshot here, or click to choose a file.';
  element.appendChild(label);

  const hint = document.createElement('p');
  hint.className = 'fc-dropzone__hint';
  hint.textContent = 'PNG or JPEG, up to 20 MB.';
  element.appendChild(hint);

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

  /** Validate and hand off a single file. Returns true if accepted. */
  function handleFile(file) {
    if (!file) return false;

    // Type check. Some OSes drop files with empty `type` (e.g. a
    // Finder-copied PNG without metadata). Fall back to extension
    // sniffing so PNG/JPEG still make it through.
    const type = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    const extOk = name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg');
    const typeOk = ACCEPTED_TYPES.has(type) || extOk;

    if (!typeOk) {
      onError({
        code: 'UNSUPPORTED_TYPE',
        message:
          'Foveacast accepts PNG and JPEG screenshots. Try saving your image as a PNG first.',
      });
      return false;
    }

    if (file.size > MAX_BYTES) {
      onError({
        code: 'TOO_LARGE',
        message:
          'That image is too large. Try a screenshot under 20MB, or use a lower screen resolution.',
      });
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
    ev.preventDefault();
    setDragging(false);
    if (!enabled || busy) return;

    const files = ev.dataTransfer && ev.dataTransfer.files;
    if (!files || files.length === 0) return;
    handleFile(files[0]);
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
      label.textContent = 'Drop a screenshot here, or click to choose a file.';
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

  return { element, setEnabled, setBusy };
}
