// Unit tests for the shared file-validation rules.
//
// The drop zone (click-to-pick path) and the document-level drop
// handler both call `validateDroppedFile`. Keeping the rules in a
// pure function means a single test suite covers both call sites,
// and the rules can evolve without touching DOM code.
//
// PRD references: §Error States (20 MB ceiling, PNG/JPEG accepted).

import { describe, it, expect } from 'vitest';
import { validateDroppedFile, MAX_BYTES } from '../docs/src/ui/file-validation.js';
import { STATUS_ERROR_MESSAGES } from '../docs/src/ui/status.js';

/**
 * Build a minimal File-alike for tests. jsdom provides `File`, but
 * creating one with a specific size is annoying — this stub carries
 * only the three fields the validator inspects.
 *
 * @param {{ type?: string, name?: string, size?: number }} props
 * @returns {File}
 */
function fakeFile({ type = '', name = '', size = 0 } = {}) {
  return /** @type {File} */ (/** @type {unknown} */ ({ type, name, size }));
}

describe('validateDroppedFile', () => {
  it('accepts a PNG under the size ceiling', () => {
    const result = validateDroppedFile(fakeFile({ type: 'image/png', name: 'shot.png', size: 2 * 1024 * 1024 }));
    expect(result.ok).toBe(true);
  });

  it('accepts a JPEG under the size ceiling', () => {
    const result = validateDroppedFile(fakeFile({ type: 'image/jpeg', name: 'shot.jpg', size: 1024 }));
    expect(result.ok).toBe(true);
  });

  it('accepts the non-standard image/jpg MIME type for compatibility', () => {
    const result = validateDroppedFile(fakeFile({ type: 'image/jpg', name: 'shot.jpg', size: 1024 }));
    expect(result.ok).toBe(true);
  });

  it('falls back to extension when the MIME type is missing', () => {
    // Finder-copied files sometimes arrive with empty `type`. The
    // validator should still accept them when the extension is sane.
    const result = validateDroppedFile(fakeFile({ type: '', name: 'Screenshot 2026-04-16.png', size: 512 }));
    expect(result.ok).toBe(true);
  });

  it('rejects a PDF with the canonical UNSUPPORTED_TYPE message', () => {
    const result = validateDroppedFile(fakeFile({ type: 'application/pdf', name: 'doc.pdf', size: 1024 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNSUPPORTED_TYPE');
      expect(result.error.message).toBe(STATUS_ERROR_MESSAGES.UNSUPPORTED_TYPE);
    }
  });

  it('rejects an SVG (frequent near-miss for screenshots)', () => {
    const result = validateDroppedFile(fakeFile({ type: 'image/svg+xml', name: 'icon.svg', size: 1024 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_TYPE');
  });

  it('rejects a file over the 20 MB ceiling with TOO_LARGE', () => {
    const result = validateDroppedFile(fakeFile({ type: 'image/png', name: 'big.png', size: MAX_BYTES + 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOO_LARGE');
      expect(result.error.message).toBe(STATUS_ERROR_MESSAGES.TOO_LARGE);
    }
  });

  it('accepts a file at exactly the ceiling (<=, not <)', () => {
    const result = validateDroppedFile(fakeFile({ type: 'image/png', name: 'just.png', size: MAX_BYTES }));
    expect(result.ok).toBe(true);
  });

  it('rejects null/undefined with UNSUPPORTED_TYPE rather than silently dropping', () => {
    const result = validateDroppedFile(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_TYPE');
  });

  it('rejects when a PNG file has a mismatched extension and no MIME type', () => {
    const result = validateDroppedFile(fakeFile({ type: '', name: 'shot.bmp', size: 1024 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_TYPE');
  });
});
