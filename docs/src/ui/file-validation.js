// Shared drop-target file validation.
//
// WHY this lives in its own module:
//   The UX review flagged that validation logic was duplicated between
//   the drop zone and the page-level handler (commit 1 of the UX batch).
//   The drop zone validated inline; the new page handler would have
//   needed the same rules. Extracting the pure function keeps the two
//   callers in lockstep and gives us a single place to unit-test the
//   rules without pulling in DOM setup.
//
// WHY the error codes come from STATUS_ERROR_MESSAGES:
//   The tech-writer review complained that the rejection copy was
//   written twice — once inside dropzone.js, once inside status.js. The
//   source of truth is `STATUS_ERROR_MESSAGES` in status.js. Importing
//   it here means the drop zone and the document-level handler both
//   quote the canonical text and it updates in one place.

import { STATUS_ERROR_MESSAGES } from './status.js';

/** Maximum accepted file size, per PRD §Error States (20 MB). */
export const MAX_BYTES = 20 * 1024 * 1024;

/**
 * MIME types we accept. PRD §File handling lists PNG and JPEG.
 * `image/jpg` is not a registered MIME type but some older browsers
 * send it; we accept it to be tolerant of real-world variance.
 */
const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

/**
 * @typedef {Object} FileValidationError
 * @property {'UNSUPPORTED_TYPE'|'TOO_LARGE'} code
 * @property {string} message
 */

/**
 * @typedef {Object} FileValidationResult
 * @property {true} ok
 */

/**
 * Validate a File against the PRD's accepted-type and max-size rules.
 *
 * Returns either `{ ok: true }` for an accepted file, or
 * `{ ok: false, error: { code, message } }` when the file should be
 * rejected. Callers forward `error` to their UI surface (the status
 * banner) verbatim.
 *
 * WHY a Result object rather than throwing: validation failures are
 * expected, common, user-facing events — they are not exceptions. A
 * plain return value keeps the call sites straight-line.
 *
 * @param {File | null | undefined} file
 * @returns {{ ok: true } | { ok: false, error: FileValidationError }}
 */
export function validateDroppedFile(file) {
  if (!file) {
    // Treat "no file at all" as an unsupported type rather than
    // silently dropping: the user clearly tried to drop something.
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_TYPE',
        message: STATUS_ERROR_MESSAGES.UNSUPPORTED_TYPE,
      },
    };
  }

  // Type check. Some OSes hand us files with an empty `type` (e.g. a
  // Finder-copied PNG whose metadata was stripped). Fall back to
  // extension sniffing so PNG/JPEG still make it through.
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  const extOk =
    name.endsWith('.png') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg');
  const typeOk = ACCEPTED_TYPES.has(type) || extOk;

  if (!typeOk) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_TYPE',
        message: STATUS_ERROR_MESSAGES.UNSUPPORTED_TYPE,
      },
    };
  }

  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: {
        code: 'TOO_LARGE',
        message: STATUS_ERROR_MESSAGES.TOO_LARGE,
      },
    };
  }

  return { ok: true };
}
