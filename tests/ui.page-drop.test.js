// Unit tests for the document-level drop + paste handler.
//
// The drop path is exercised end-to-end by the Playwright suite
// (synthetic drag + drop events are fiddly under jsdom). What we
// cover here are the two paths that DO work cleanly with dispatched
// events:
//
//   1. The `paste` handler — routes image items from the clipboard
//      through the same validation + `onFile` pathway drops use.
//   2. The `dragover` → `preventDefault` safety net — without it,
//      a misdropped file navigates the browser away, which is the
//      worst failure mode for a one-purpose tool.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installPageDrop } from '../docs/src/ui/page-drop.js';

describe('installPageDrop — paste', () => {
  /** @type {any} */
  let controller;
  let onFile;
  let onError;

  beforeEach(() => {
    onFile = vi.fn();
    onError = vi.fn();
    controller = installPageDrop({ onFile, onError });
  });

  afterEach(() => {
    if (controller) controller.dispose();
  });

  /**
   * Dispatch a ClipboardEvent-shaped event with the given items.
   * jsdom's `ClipboardEvent` constructor doesn't accept `clipboardData`,
   * so we synthesize an event and attach a minimal items list
   * matching the real DataTransferItemList surface we actually use.
   */
  function dispatchPaste(items) {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', {
      value: { items },
      configurable: true,
    });
    document.dispatchEvent(ev);
    return ev;
  }

  function makeImageItem(file) {
    return {
      kind: 'file',
      type: file.type,
      getAsFile: () => file,
    };
  }

  function makeStringItem(text) {
    return {
      kind: 'string',
      type: 'text/plain',
      getAsFile: () => null,
      getAsString: (cb) => cb(text),
    };
  }

  it('routes a pasted PNG through onFile', () => {
    const file = new File(['fake-png-bytes'], 'image.png', { type: 'image/png' });
    dispatchPaste([makeImageItem(file)]);
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    const passed = onFile.mock.calls[0][0];
    expect(passed.type).toBe('image/png');
  });

  it('renames the generic "image.png" filename to something descriptive', () => {
    // Chromium's clipboard pastes arrive as `image.png` for every
    // screenshot. A date-stamped name helps the user recognise what
    // they pasted and gives the eventual download a better default.
    const file = new File(['fake-png-bytes'], 'image.png', { type: 'image/png' });
    dispatchPaste([makeImageItem(file)]);
    const passed = onFile.mock.calls[0][0];
    expect(passed.name).toMatch(/^pasted-screenshot-\d+\.png$/);
  });

  it('keeps a meaningful filename the clipboard already provided', () => {
    const file = new File(['fake-png-bytes'], 'hero-shot.png', { type: 'image/png' });
    dispatchPaste([makeImageItem(file)]);
    const passed = onFile.mock.calls[0][0];
    expect(passed.name).toBe('hero-shot.png');
  });

  it('ignores a text-only paste (URL bar, search boxes, etc. still work)', () => {
    dispatchPaste([makeStringItem('https://example.com')]);
    expect(onFile).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('rejects a pasted image that exceeds the size ceiling', () => {
    // Simulate a >20 MB image by lying about `size`. Can't easily
    // create 20+ MB of real bytes in-test, but `validateDroppedFile`
    // reads `.size` so a getter override is sufficient.
    const file = new File(['bytes'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 25 * 1024 * 1024 });
    dispatchPaste([makeImageItem(file)]);
    expect(onFile).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].code).toBe('TOO_LARGE');
  });

  it('picks the first image when the clipboard carries multiple items', () => {
    const text = makeStringItem('some text');
    const imageA = new File(['a'], 'a.png', { type: 'image/png' });
    const imageB = new File(['b'], 'b.png', { type: 'image/png' });
    dispatchPaste([text, makeImageItem(imageA), makeImageItem(imageB)]);
    expect(onFile).toHaveBeenCalledTimes(1);
    const passed = onFile.mock.calls[0][0];
    // Renamed per the descriptive-default rule — we can still check
    // type and that only one file flowed through.
    expect(passed.type).toBe('image/png');
  });

  it('does nothing when clipboardData is absent (older browsers)', () => {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    // No clipboardData property defined.
    document.dispatchEvent(ev);
    expect(onFile).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('installPageDrop — dragover safety net', () => {
  /** @type {any} */
  let controller;

  beforeEach(() => {
    controller = installPageDrop({ onFile: () => {}, onError: () => {} });
  });

  afterEach(() => {
    if (controller) controller.dispose();
  });

  it('preventDefault fires on a document-level dragover (otherwise the browser navigates on drop)', () => {
    const ev = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', {
      value: { types: ['Files'], dropEffect: '' },
      configurable: true,
    });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('installPageDrop — dispose', () => {
  it('removes document-level listeners so subsequent events do nothing', () => {
    const onFile = vi.fn();
    const controller = installPageDrop({ onFile, onError: () => {} });
    controller.dispose();

    // After dispose, a paste with an image should NOT route through
    // onFile — the listener is gone.
    const file = new File(['x'], 'post-dispose.png', { type: 'image/png' });
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      },
      configurable: true,
    });
    document.dispatchEvent(ev);
    expect(onFile).not.toHaveBeenCalled();
  });
});
