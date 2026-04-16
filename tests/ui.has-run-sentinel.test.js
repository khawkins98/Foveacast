// Unit tests for the first-run sentinel.
//
// The reader and writer are intentionally defensive against
// `localStorage` throwing — SecurityError in iframed sandboxes and
// in Safari private browsing are the usual culprits. Both code paths
// are exercised below.

import { describe, it, expect } from 'vitest';
import {
  readHasRunSentinel,
  writeHasRunSentinel,
  HAS_RUN_KEY,
} from '../docs/src/ui/has-run-sentinel.js';

/** Build an in-memory Storage-alike. */
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return /** @type {Storage} */ (/** @type {unknown} */ ({
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
    get length() {
      return Object.keys(data).length;
    },
    clear: () => {
      for (const k of Object.keys(data)) delete data[k];
    },
    key: (i) => Object.keys(data)[i] ?? null,
    __data: data,
  }));
}

/** Build a Storage-alike that throws on every access. */
function throwingStorage() {
  return /** @type {Storage} */ (/** @type {unknown} */ ({
    getItem: () => {
      throw new Error('SecurityError: The operation is insecure.');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('no');
    },
    length: 0,
    clear: () => {},
    key: () => null,
  }));
}

describe('readHasRunSentinel', () => {
  it('returns false when the sentinel is not set (fresh visit)', () => {
    expect(readHasRunSentinel(fakeStorage())).toBe(false);
  });

  it('returns true when the sentinel is set to "1"', () => {
    expect(readHasRunSentinel(fakeStorage({ [HAS_RUN_KEY]: '1' }))).toBe(true);
  });

  it('returns false for any value other than "1" (future-proofing)', () => {
    // If we ever store richer data (JSON, timestamps) under this key,
    // the boolean-returning helper should stay strict. Loose
    // truthiness would be a foot-gun here.
    expect(readHasRunSentinel(fakeStorage({ [HAS_RUN_KEY]: 'true' }))).toBe(false);
    expect(readHasRunSentinel(fakeStorage({ [HAS_RUN_KEY]: '' }))).toBe(false);
    expect(readHasRunSentinel(fakeStorage({ [HAS_RUN_KEY]: '0' }))).toBe(false);
  });

  it('returns false when storage access throws (sandboxed iframe, private browsing)', () => {
    expect(readHasRunSentinel(throwingStorage())).toBe(false);
  });
});

describe('writeHasRunSentinel', () => {
  it('sets the key to "1"', () => {
    const s = fakeStorage();
    writeHasRunSentinel(s);
    expect(s.getItem(HAS_RUN_KEY)).toBe('1');
  });

  it('is idempotent — writing twice is indistinguishable from writing once', () => {
    const s = fakeStorage();
    writeHasRunSentinel(s);
    writeHasRunSentinel(s);
    expect(s.getItem(HAS_RUN_KEY)).toBe('1');
  });

  it('swallows exceptions so a storage quota error never bubbles out of the happy path', () => {
    // If this throws, the test fails; not throwing is the assertion.
    expect(() => writeHasRunSentinel(throwingStorage())).not.toThrow();
  });
});

describe('round trip', () => {
  it('writer + reader compose into the obvious "user was here before" check', () => {
    const s = fakeStorage();
    expect(readHasRunSentinel(s)).toBe(false); // fresh
    writeHasRunSentinel(s);
    expect(readHasRunSentinel(s)).toBe(true); // returning
  });
});
