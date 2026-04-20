// Unit tests for ui/report.js
//
// The report module creates DOM nodes and updates them in-place as duration
// results arrive. Tests focus on: structure (hidden/visible, correct elements),
// data population (headline text, rule-of-thirds grid, slot updates), and
// near-tie detection in rotHeadline.
//
// jsdom does not implement HTMLCanvasElement.prototype.getContext, so
// compositeThumb returns a blank (but correctly-sized) canvas. Tests do not
// assert pixel content — they assert structure, text, and state.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createReport, rotHeadline, renderRotGrid } from '../docs/src/ui/report.js';

// ---------------------------------------------------------------------------
// Canvas stub — same pattern as render.plain-canvas.test.js
// ---------------------------------------------------------------------------

let originalGetContext;
beforeEach(() => {
  const ctxStub = {
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  };
  Object.defineProperty(ctxStub, 'globalAlpha', { writable: true, value: 1 });
  Object.defineProperty(ctxStub, 'globalCompositeOperation', { writable: true, value: 'source-over' });

  originalGetContext = HTMLCanvasElement.prototype.getContext;
  // eslint-disable-next-line no-extend-native
  HTMLCanvasElement.prototype.getContext = () => ctxStub;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

// ---------------------------------------------------------------------------
// Minimal fake data helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake source image canvas.
 * @param {number} [w=800] @param {number} [h=600]
 */
function fakeImage(w = 800, h = 600) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Build a minimal fake heatmap canvas.
 */
function fakeHeatmap(w = 800, h = 600) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Build a fake DurationResult-like object.
 * @param {number[]} [rot] Rule-of-thirds array (default: equal thirds).
 */
function fakeResult(rot = Array(9).fill(1 / 9)) {
  return {
    heatmapCanvas:      fakeHeatmap(),
    fixation:           { x: 400, y: 300 },
    origDims:           [600, 800],
    ruleOfThirds:       rot,
    fixationSequence:   [{ x: 200, y: 150 }, { x: 400, y: 300 }, { x: 600, y: 400 }],
    attentionZoneCanvas: fakeHeatmap(),
  };
}

/** Shorthand: valid durationResults with only 3s set. */
function only3s() {
  return { '1s': null, '3s': fakeResult(), '7s': null };
}

/** Shorthand: all three durations ready. */
function allReady() {
  return { '1s': fakeResult(), '3s': fakeResult(), '7s': fakeResult() };
}

// ---------------------------------------------------------------------------
// rotHeadline — pure function, no DOM
// ---------------------------------------------------------------------------

describe('rotHeadline', () => {
  it('names the dominant third when it is clearly dominant', () => {
    const rot = Array(9).fill(5);
    rot[0] = 60; // top-left dominates (leaves 40 split among 8 cells of 5)
    expect(rotHeadline(rot)).toMatch(/top-left/);
    expect(rotHeadline(rot)).toMatch(/60%/);
    expect(rotHeadline(rot)).toMatch(/Most attention/);
  });

  it('uses near-tie copy when two cells are within 10% of each other', () => {
    const rot = Array(9).fill(5);
    rot[0] = 20; // top-left
    rot[4] = 19; // center — within 10% of top-left value
    const headline = rotHeadline(rot);
    expect(headline).toMatch(/split between/);
    expect(headline).toMatch(/top-left/);
    expect(headline).toMatch(/center/);
  });

  it('displays the integer percentage directly', () => {
    const rot = Array(9).fill(5);
    rot[8] = 56; // bottom-right — a representative integer value
    const headline = rotHeadline(rot);
    expect(headline).toMatch(/56%/);
    // Should not show a decimal fraction before the percent sign.
    expect(headline).not.toMatch(/\d\.\d+%/);
  });
});

// ---------------------------------------------------------------------------
// renderRotGrid — DOM helper
// ---------------------------------------------------------------------------

describe('renderRotGrid', () => {
  it('renders exactly 9 cells', () => {
    const container = document.createElement('div');
    renderRotGrid(container, Array(9).fill(11)); // ~99, close enough for structure test
    expect(container.querySelectorAll('.fc-report__rot-cell').length).toBe(9);
  });

  it('marks the max cell with --max modifier class', () => {
    const rot = Array(9).fill(5);
    rot[4] = 60; // center dominates
    const container = document.createElement('div');
    renderRotGrid(container, rot);
    const maxCells = container.querySelectorAll('.fc-report__rot-cell--max');
    expect(maxCells.length).toBe(1);
    expect(maxCells[0].textContent).toBe('60%');
  });

  it('max cell aria-label includes "highest attention area"', () => {
    const rot = Array(9).fill(5);
    rot[0] = 65; // top-left
    const container = document.createElement('div');
    renderRotGrid(container, rot);
    const maxCell = container.querySelector('.fc-report__rot-cell--max');
    expect(maxCell.getAttribute('aria-label')).toMatch(/highest attention area/);
  });

  it('non-max cells do not have the --max class', () => {
    const rot = Array(9).fill(5);
    rot[3] = 55;
    const container = document.createElement('div');
    renderRotGrid(container, rot);
    const nonMax = Array.from(container.querySelectorAll('.fc-report__rot-cell')).filter(
      (c) => !c.classList.contains('fc-report__rot-cell--max'),
    );
    expect(nonMax.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// createReport — structure and progressive-disclosure
// ---------------------------------------------------------------------------

describe('createReport — initial state', () => {
  it('creates a section element in the mount', () => {
    const mount = document.createElement('div');
    createReport({ mountEl: mount });
    const section = mount.querySelector('section.fc-report');
    expect(section).toBeTruthy();
  });

  it('starts hidden before update() is called', () => {
    const mount = document.createElement('div');
    createReport({ mountEl: mount });
    const section = mount.querySelector('section.fc-report');
    expect(section.hidden).toBe(true);
  });

  it('renders three duration slot figures in the comparison strip at mount time', () => {
    const mount = document.createElement('div');
    createReport({ mountEl: mount });
    // Query scoped to the duration comparison strip only — not the overlay strips.
    const strip = mount.querySelector('.fc-report__section--durations .fc-report__strip');
    const slots = strip ? strip.querySelectorAll('.fc-report__dur-item') : [];
    expect(slots.length).toBe(3);
    const attrs = Array.from(slots).map((s) => s.dataset.duration);
    expect(attrs).toEqual(['1s', '3s', '7s']);
  });

  it('has a methodology section with links to docs', () => {
    const mount = document.createElement('div');
    createReport({ mountEl: mount });
    const links = mount.querySelectorAll('.fc-report__method-link');
    expect(links.length).toBe(2);
    const texts = Array.from(links).map((l) => l.textContent);
    expect(texts).toContain('How to read results');
    expect(texts).toContain('Methodology');
  });
});

// ---------------------------------------------------------------------------
// createReport — update()
// ---------------------------------------------------------------------------

describe('createReport — update()', () => {
  it('becomes visible after update() is called with a ready result', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: only3s() });
    expect(mount.querySelector('section.fc-report').hidden).toBe(false);
  });

  it('stays hidden if no duration results are ready', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: { '1s': null, '3s': null, '7s': null } });
    expect(mount.querySelector('section.fc-report').hidden).toBe(true);
  });

  it('populates the headline from rule-of-thirds data', () => {
    const rot = Array(9).fill(0.05);
    rot[0] = 0.65; // top-left
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: { '1s': null, '3s': fakeResult(rot), '7s': null } });
    const headline = mount.querySelector('.fc-report__headline');
    expect(headline.textContent).toMatch(/top-left/);
  });

  it('renders 9 rule-of-thirds grid cells after update()', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: only3s() });
    expect(mount.querySelectorAll('.fc-report__rot-cell').length).toBe(9);
  });

  it('populates the fixation note with percentage coordinates', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: only3s() });
    // fakeResult has fixation {x:400,y:300} on an 800×600 image → 50% across, 50% down
    const note = mount.querySelector('.fc-report__fixation-note');
    expect(note.textContent).toMatch(/50%/);
  });

  it('prefers 3s for the hero when both 3s and 1s are ready', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: allReady() });
    const sourceLabel = mount.querySelector('.fc-report__source-label');
    expect(sourceLabel.textContent).toMatch(/Quick scan \(3 seconds\)/);
  });

  it('falls back to 1s for the hero when only 1s is ready', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: { '1s': fakeResult(), '3s': null, '7s': null } });
    const sourceLabel = mount.querySelector('.fc-report__source-label');
    expect(sourceLabel.textContent).toMatch(/First glance \(1 second\)/);
  });

  it('renders a canvas in the 3s duration slot when 3s is ready', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: only3s() });
    const slot = mount.querySelector('[data-duration="3s"] .fc-report__dur-canvas');
    expect(slot.querySelector('canvas')).toBeTruthy();
  });

  it('renders a placeholder in the 1s slot when 1s is not yet ready', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: only3s() });
    const slot = mount.querySelector('[data-duration="1s"] .fc-report__dur-canvas');
    expect(slot.querySelector('.fc-report__dur-placeholder')).toBeTruthy();
    expect(slot.querySelector('canvas')).toBeFalsy();
  });

  it('replaces placeholder with canvas when update() is called again with 1s ready', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: only3s() });
    update({ image: fakeImage(), durationResults: allReady() });
    const slot = mount.querySelector('[data-duration="1s"] .fc-report__dur-canvas');
    expect(slot.querySelector('canvas')).toBeTruthy();
    expect(slot.querySelector('.fc-report__dur-placeholder')).toBeFalsy();
  });

  it('shows a "loading" placeholder while a duration is in progress', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: { '1s': 'loading', '3s': fakeResult(), '7s': null } });
    const slot = mount.querySelector('[data-duration="1s"] .fc-report__dur-canvas');
    expect(slot.getAttribute('aria-busy')).toBe('true');
    expect(slot.querySelector('.fc-report__dur-placeholder')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Duration tabs
// ---------------------------------------------------------------------------

describe('createReport — duration tabs', () => {
  it('renders a tablist with 3 tabs', () => {
    const mount = document.createElement('div');
    createReport({ mountEl: mount });
    const tablist = mount.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();
    const tabs = tablist.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(3);
  });

  it('all tabs start as aria-disabled (no results yet)', () => {
    const mount = document.createElement('div');
    createReport({ mountEl: mount });
    const tabs = Array.from(mount.querySelectorAll('[role="tab"]'));
    for (const tab of tabs) {
      expect(tab.getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('enables the tab for a duration that has a ready result', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: only3s() });
    const tab3s = mount.querySelector('[role="tab"][data-duration="3s"]');
    const tab1s = mount.querySelector('[role="tab"][data-duration="1s"]');
    expect(tab3s.getAttribute('aria-disabled')).toBe('false');
    expect(tab1s.getAttribute('aria-disabled')).toBe('true');
  });

  it('marks activeDuration tab as aria-selected="true"', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: allReady(), activeDuration: '1s' });
    const tab1s = mount.querySelector('[role="tab"][data-duration="1s"]');
    const tab3s = mount.querySelector('[role="tab"][data-duration="3s"]');
    expect(tab1s.getAttribute('aria-selected')).toBe('true');
    expect(tab3s.getAttribute('aria-selected')).toBe('false');
  });

  it('calls onDurationChange with the clicked duration', () => {
    const mount = document.createElement('div');
    let called = null;
    const { update } = createReport({ mountEl: mount, onDurationChange: (d) => { called = d; } });
    update({ image: fakeImage(), durationResults: allReady() });
    const tab7s = mount.querySelector('[role="tab"][data-duration="7s"]');
    tab7s.click();
    expect(called).toBe('7s');
  });

  it('does not call onDurationChange when clicking a disabled tab', () => {
    const mount = document.createElement('div');
    let called = null;
    const { update } = createReport({ mountEl: mount, onDurationChange: (d) => { called = d; } });
    update({ image: fakeImage(), durationResults: only3s() });
    const tab1s = mount.querySelector('[role="tab"][data-duration="1s"]');
    tab1s.click();
    expect(called).toBeNull();
  });

  it('shows the hero for activeDuration when that result is ready', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: allReady(), activeDuration: '7s' });
    const sourceLabel = mount.querySelector('.fc-report__source-label');
    expect(sourceLabel.textContent).toMatch(/Full viewing \(7 seconds\)/);
  });

  it('falls back to pickHero when activeDuration result is not ready', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    // activeDuration is 7s but only 3s is ready — should fall back to 3s
    update({ image: fakeImage(), durationResults: only3s(), activeDuration: '7s' });
    const sourceLabel = mount.querySelector('.fc-report__source-label');
    expect(sourceLabel.textContent).toMatch(/Quick scan \(3 seconds\)/);
  });
});

// ---------------------------------------------------------------------------
// Overlay sections — fixation, zones, trajectory
// ---------------------------------------------------------------------------

describe('report overlay sections — DOM structure', () => {
  it('renders a fixation sequence section', () => {
    const mount = document.createElement('div');
    createReport({ mountEl: mount });
    expect(mount.querySelector('.fc-report__section--fixation')).not.toBeNull();
  });

  it('renders an attention zones section', () => {
    const mount = document.createElement('div');
    createReport({ mountEl: mount });
    expect(mount.querySelector('.fc-report__section--zones')).not.toBeNull();
  });

  it('renders a trajectory section hidden by default', () => {
    const mount = document.createElement('div');
    createReport({ mountEl: mount });
    const traj = mount.querySelector('.fc-report__section--trajectory');
    expect(traj).not.toBeNull();
    expect(traj.hidden).toBe(true);
  });

  it('fixation section has 3 per-duration slots', () => {
    const mount = document.createElement('div');
    createReport({ mountEl: mount });
    const section = mount.querySelector('.fc-report__section--fixation');
    const items = section.querySelectorAll('.fc-report__dur-item');
    expect(items.length).toBe(3);
  });
});

describe('report overlay sections — update()', () => {
  it('populates fixation slots with canvases when results are ready', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: allReady() });
    const section = mount.querySelector('.fc-report__section--fixation');
    const canvases = section.querySelectorAll('canvas');
    // All 3 ready → 3 canvases
    expect(canvases.length).toBe(3);
  });

  it('shows placeholder for a loading duration in fixation section', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: { '1s': 'loading', '3s': fakeResult(), '7s': null } });
    const section = mount.querySelector('.fc-report__section--fixation');
    const placeholders = section.querySelectorAll('.fc-report__dur-placeholder');
    // 1 loading + 1 null = 2 placeholders; 1 canvas for 3s
    expect(placeholders.length).toBe(2);
  });

  it('populates zone slots with canvases when results are ready', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: allReady() });
    const section = mount.querySelector('.fc-report__section--zones');
    const canvases = section.querySelectorAll('canvas');
    expect(canvases.length).toBe(3);
  });

  it('trajectory section stays hidden with only 1 result', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: only3s() });
    const traj = mount.querySelector('.fc-report__section--trajectory');
    expect(traj.hidden).toBe(true);
  });

  it('trajectory section is revealed once 2+ results are ready', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    const results = { '1s': fakeResult(), '3s': fakeResult(), '7s': null };
    update({ image: fakeImage(), durationResults: results });
    const traj = mount.querySelector('.fc-report__section--trajectory');
    expect(traj.hidden).toBe(false);
  });

  it('trajectory section contains a canvas when visible', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    update({ image: fakeImage(), durationResults: allReady() });
    const wrap = mount.querySelector('.fc-report__trajectory-wrap');
    expect(wrap.querySelector('canvas')).not.toBeNull();
  });

  it('trajectory section re-hides after image reset', () => {
    const mount = document.createElement('div');
    const { update } = createReport({ mountEl: mount });
    // First: 3 results ready — trajectory visible
    update({ image: fakeImage(), durationResults: allReady() });
    const traj = mount.querySelector('.fc-report__section--trajectory');
    expect(traj.hidden).toBe(false);
    // New image: no results yet — trajectory must hide again
    update({ image: fakeImage(), durationResults: { '1s': null, '3s': null, '7s': null } });
    expect(traj.hidden).toBe(true);
  });
});
