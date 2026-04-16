// Mobile-guard detection tests.
//
// Small by design — we cover the three detection branches (pointer
// coarse, UA string, non-mobile baseline) and leave the DOM-mount
// behaviour to the Phase E gstack smoke suite.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isMobileBrowser, mountMobileGuard } from '../docs/src/ui/mobile-guard.js';

/**
 * @param {{ pointerCoarse: boolean }} mediaState
 */
function installMatchMedia({ pointerCoarse }) {
  return vi.fn((query) => ({
    matches: query.includes('pointer: coarse') ? pointerCoarse : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }));
}

describe('isMobileBrowser', () => {
  /** @type {any} */
  let originalMatchMedia;
  /** @type {any} */
  let originalUserAgent;
  /** @type {any} */
  let originalInnerWidth;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    originalUserAgent = Object.getOwnPropertyDescriptor(
      window.navigator,
      'userAgent',
    );
    originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    if (originalUserAgent) {
      Object.defineProperty(window.navigator, 'userAgent', originalUserAgent);
    }
    if (originalInnerWidth) {
      Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    }
  });

  function setUA(ua) {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: ua,
      configurable: true,
    });
  }

  function setWidth(width) {
    Object.defineProperty(window, 'innerWidth', {
      value: width,
      configurable: true,
      writable: true,
    });
  }

  it('returns true when pointer is coarse', () => {
    window.matchMedia = installMatchMedia({ pointerCoarse: true });
    setUA('Mozilla/5.0 (whatever)');
    setWidth(1400);
    expect(isMobileBrowser()).toBe(true);
  });

  it('returns true when UA matches a mobile pattern', () => {
    window.matchMedia = installMatchMedia({ pointerCoarse: false });
    setUA(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    );
    setWidth(390);
    expect(isMobileBrowser()).toBe(true);
  });

  it('returns true when viewport is narrow AND UA hints at mobile', () => {
    window.matchMedia = installMatchMedia({ pointerCoarse: false });
    setUA(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Chrome/124',
    );
    setWidth(412);
    expect(isMobileBrowser()).toBe(true);
  });

  it('returns false for a typical desktop Chrome UA + wide viewport + fine pointer', () => {
    window.matchMedia = installMatchMedia({ pointerCoarse: false });
    setUA(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    );
    setWidth(1680);
    expect(isMobileBrowser()).toBe(false);
  });

  it('returns false for a narrow desktop window with no mobile UA hint', () => {
    // A user dragging a desktop Chrome window narrow should not be
    // locked out — viewport alone is not enough to trigger the guard.
    window.matchMedia = installMatchMedia({ pointerCoarse: false });
    setUA(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    );
    setWidth(700);
    expect(isMobileBrowser()).toBe(false);
  });
});

describe('mountMobileGuard — dismissible escape', () => {
  /** @type {any} */
  let originalMatchMedia;
  /** @type {any} */
  let originalUserAgent;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    originalUserAgent = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
    // Simulate a mobile environment so the guard fires.
    window.matchMedia = vi.fn((query) => ({
      matches: query.includes('pointer: coarse'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }));
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Mobile',
      configurable: true,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    if (originalUserAgent) {
      Object.defineProperty(window.navigator, 'userAgent', originalUserAgent);
    }
  });

  /** Build an in-memory Storage so each test is isolated. */
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
      length: 0,
      clear: () => {},
      key: () => null,
      __data: data,
    }));
  }

  it('renders a "Proceed anyway" button alongside the warning', () => {
    const container = document.createElement('div');
    const fired = mountMobileGuard(container, { storage: fakeStorage() });
    expect(fired).toBe(true);
    const proceed = container.querySelector('.fc-mobile-guard__proceed');
    expect(proceed).toBeTruthy();
    expect(proceed && proceed.textContent).toMatch(/proceed anyway/i);
  });

  it('clicking Proceed anyway sets the bypass sentinel and calls onProceed', () => {
    const container = document.createElement('div');
    const storage = fakeStorage();
    const onProceed = vi.fn();

    mountMobileGuard(container, { storage, onProceed });

    const proceed = /** @type {HTMLButtonElement} */ (
      container.querySelector('.fc-mobile-guard__proceed')
    );
    proceed.click();

    // Sentinel written.
    expect(storage.getItem('foveacast:mobile-guard-bypass:v1')).toBe('1');
    // Callback fired.
    expect(onProceed).toHaveBeenCalledTimes(1);
    // Guard markup cleared from the container so the caller can
    // rebuild the normal layout.
    expect(container.querySelector('.fc-mobile-guard')).toBeFalsy();
  });

  it('does not re-fire the guard when the bypass sentinel is already set', () => {
    const container = document.createElement('div');
    const storage = fakeStorage({ 'foveacast:mobile-guard-bypass:v1': '1' });

    const fired = mountMobileGuard(container, { storage });

    // Even though the environment looks mobile, the previous bypass
    // lets the app boot normally.
    expect(fired).toBe(false);
    expect(container.querySelector('.fc-mobile-guard')).toBeFalsy();
  });
});
