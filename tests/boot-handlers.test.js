/**
 * tests/boot-handlers.test.js
 *
 * Unit tests for the extracted boot-time helpers: reloadModel and handleFile.
 * Each function takes an explicit `deps` parameter so we can verify behaviour
 * without booting the full app or touching the DOM.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reloadModel, handleFile } from '../docs/src/boot-handlers.js';

// ── Mock external deps that hit the network / WASM ──────────────────────────

vi.mock('../docs/src/model/loader.js', () => ({
  loadModel: vi.fn(),
}));

vi.mock('../docs/src/ui/has-run-sentinel.js', () => ({
  readHasRunSentinel: vi.fn(),
  writeHasRunSentinel: vi.fn(),
}));

vi.mock('../docs/src/ui/image-resize.js', () => ({
  // Pass the canvas through unchanged — we only care that it is forwarded to
  // runInferenceOnImage, not that it is actually resized.
  downsampleIfLarge: vi.fn((src) => src),
}));

import { loadModel } from '../docs/src/model/loader.js';
import { readHasRunSentinel, writeHasRunSentinel } from '../docs/src/ui/has-run-sentinel.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal state object with sensible defaults. */
function makeState(overrides = {}) {
  return {
    loadedModel: { session: null },
    activeDuration: '3s',
    queuedFile: null,
    ...overrides,
  };
}

/** Create a minimal status mock. */
function makeStatus() {
  return {
    showFirstRun: vi.fn(),
    showCacheLoad: vi.fn(),
    showError: vi.fn(),
    clear: vi.fn(),
    element: { removeAttribute: vi.fn(), setAttribute: vi.fn() },
  };
}

/** Create minimal dropzone / controls mocks. */
function makeDropzone() {
  return { setEnabled: vi.fn(), setLabel: vi.fn() };
}
function makeControls() {
  return { setDisabled: vi.fn(), setDurationLoading: vi.fn() };
}

// ── handleFile tests ─────────────────────────────────────────────────────────

describe('handleFile', () => {
  let state, status, runInferenceOnImage, deps;

  beforeEach(() => {
    state = makeState();
    status = makeStatus();
    runInferenceOnImage = vi.fn().mockResolvedValue(undefined);
    deps = { state, status, runInferenceOnImage };
  });

  it('queues the file and shows first-run banner when the model is not loaded', async () => {
    state.loadedModel = null;
    const file = new File(['x'], 'test.png', { type: 'image/png' });

    await handleFile(file, deps);

    expect(state.queuedFile).toBe(file);
    expect(status.showFirstRun).toHaveBeenCalledWith({
      fraction: 0,
      loaded: undefined,
      total: undefined,
    });
    expect(status.element.setAttribute).toHaveBeenCalledWith('data-foveacast-queued', 'true');
    // why: inference must NOT run while the model is absent
    expect(runInferenceOnImage).not.toHaveBeenCalled();
  });

  it('does not queue when the model is already loaded', async () => {
    // Stub createImageBitmap to avoid browser API unavailability in jsdom.
    const canvas = {};
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(canvas);

    const file = new File(['x'], 'test.png', { type: 'image/png' });
    await handleFile(file, deps);

    expect(state.queuedFile).toBeNull();
    expect(runInferenceOnImage).toHaveBeenCalledWith(canvas);
  });
});

// ── reloadModel tests ─────────────────────────────────────────────────────────

describe('reloadModel', () => {
  let state, status, dropzone, controls, setAppBusy, handleFileFn, deps;
  const fakeSession = { release: vi.fn() };
  const fakeModel = { session: fakeSession };

  beforeEach(() => {
    vi.clearAllMocks();

    state = makeState();
    status = makeStatus();
    dropzone = makeDropzone();
    controls = makeControls();
    setAppBusy = vi.fn();
    handleFileFn = vi.fn().mockResolvedValue(undefined);

    loadModel.mockResolvedValue(fakeModel);
    readHasRunSentinel.mockReturnValue(false);
    writeHasRunSentinel.mockReturnValue(undefined);

    deps = { state, dropzone, controls, status, setAppBusy, voxelBg: null, handleFileFn };
  });

  it('shows first-run banner immediately when sentinel is absent', async () => {
    readHasRunSentinel.mockReturnValue(false);
    await reloadModel({}, deps);

    expect(status.showFirstRun).toHaveBeenCalledWith({
      fraction: 0,
      loaded: undefined,
      total: undefined,
    });
    expect(status.showCacheLoad).not.toHaveBeenCalled();
  });

  it('shows cache-load banner when sentinel is present', async () => {
    readHasRunSentinel.mockReturnValue(true);
    await reloadModel({}, deps);

    expect(status.showCacheLoad).toHaveBeenCalled();
    expect(status.showFirstRun).not.toHaveBeenCalled();
  });

  it('suppresses all banners when silent=true', async () => {
    readHasRunSentinel.mockReturnValue(false);
    await reloadModel({ silent: true }, deps);

    expect(status.showFirstRun).not.toHaveBeenCalled();
    expect(status.showCacheLoad).not.toHaveBeenCalled();
  });

  it('writes the sentinel after a successful load', async () => {
    await reloadModel({}, deps);
    expect(writeHasRunSentinel).toHaveBeenCalled();
  });

  it('drains a queued file after the model loads', async () => {
    const queued = new File(['x'], 'queued.png');
    state.queuedFile = queued;

    await reloadModel({}, deps);

    // why: the queued pointer must be cleared to prevent double-drain
    expect(state.queuedFile).toBeNull();
    expect(handleFileFn).toHaveBeenCalledWith(queued);
  });

  it('does not call handleFileFn when there is no queued file', async () => {
    state.queuedFile = null;
    await reloadModel({}, deps);
    expect(handleFileFn).not.toHaveBeenCalled();
  });

  it('releases the previous ORT session before loading a new one', async () => {
    state.loadedModel = fakeModel;
    await reloadModel({}, deps);
    expect(fakeSession.release).toHaveBeenCalled();
  });

  it('stores the newly loaded model on state', async () => {
    const newModel = { session: null };
    loadModel.mockResolvedValue(newModel);
    await reloadModel({}, deps);
    expect(state.loadedModel).toBe(newModel);
  });
});
