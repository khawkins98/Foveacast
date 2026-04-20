// Unit tests for the controls panel.
//
// Coverage is deliberately narrow: progressive-disclosure
// `setVisible` and overlay state are the behaviours with real failure modes.
// Duration selection was moved to the report section (duration tabs), so
// no duration tests live here. Event-dispatch behaviour is hard to test
// meaningfully without a real user, and is covered by the Playwright E2E suite.

import { describe, it, expect } from 'vitest';
import { createControls } from '../docs/src/ui/controls.js';

describe('createControls — progressive disclosure', () => {
  it('starts visible by default (hidden attribute absent)', () => {
    const controls = createControls();
    expect(controls.element.hidden).toBe(false);
  });

  it('setVisible(false) toggles the hidden attribute so the a11y tree honours it', () => {
    const controls = createControls();
    controls.setVisible(false);
    expect(controls.element.hidden).toBe(true);
  });

  it('setVisible(true) clears the hidden attribute', () => {
    const controls = createControls();
    controls.setVisible(false);
    controls.setVisible(true);
    expect(controls.element.hidden).toBe(false);
  });

  it('setVisible is idempotent — calling twice has no extra effect', () => {
    const controls = createControls();
    controls.setVisible(false);
    controls.setVisible(false);
    expect(controls.element.hidden).toBe(true);
    controls.setVisible(true);
    controls.setVisible(true);
    expect(controls.element.hidden).toBe(false);
  });
});

describe('createControls — duration stubs', () => {
  // Duration selection is owned by the report section now. The controls API
  // retains stub methods so existing main.js call sites do not crash while
  // we migrate callers.
  it('setDuration is a no-op that does not throw', () => {
    const controls = createControls();
    expect(() => controls.setDuration('1s')).not.toThrow();
    expect(() => controls.setDuration('3s')).not.toThrow();
    expect(() => controls.setDuration('7s')).not.toThrow();
  });

  it('setDurationLoading is a no-op that does not throw', () => {
    const controls = createControls();
    expect(() => controls.setDurationLoading(true)).not.toThrow();
    expect(() => controls.setDurationLoading(false)).not.toThrow();
  });

  it('setDurationStatus is a no-op that does not throw', () => {
    const controls = createControls();
    expect(() => controls.setDurationStatus('3s', 'loading')).not.toThrow();
    expect(() => controls.setDurationStatus('3s', 'ready')).not.toThrow();
  });

  it('no duration radio buttons in the toolbar', () => {
    const controls = createControls();
    const radios = controls.element.querySelectorAll('input[type="radio"][name*="duration"]');
    expect(radios.length).toBe(0);
  });
});

describe('createControls — overlay toggles', () => {
  it('renders 3 overlay checkboxes', () => {
    const controls = createControls();
    const checks = controls.element.querySelectorAll('.fc-controls__overlays input[type="checkbox"]');
    expect(checks.length).toBe(3);
  });

  it('trajectory checkbox starts disabled', () => {
    const controls = createControls();
    const allChecks = Array.from(controls.element.querySelectorAll('.fc-controls__overlays input[type="checkbox"]'));
    // The trajectory checkbox is the last one.
    const trajectory = allChecks[allChecks.length - 1];
    expect(/** @type {HTMLInputElement} */ (trajectory).disabled).toBe(true);
  });

  it('setTrajectoryAvailable(true) enables the trajectory checkbox', () => {
    const controls = createControls();
    controls.setTrajectoryAvailable(true);
    const allChecks = Array.from(controls.element.querySelectorAll('.fc-controls__overlays input[type="checkbox"]'));
    const trajectory = allChecks[allChecks.length - 1];
    expect(/** @type {HTMLInputElement} */ (trajectory).disabled).toBe(false);
  });

  it('setTrajectoryAvailable(false) disables the trajectory checkbox', () => {
    const controls = createControls();
    controls.setTrajectoryAvailable(true);
    controls.setTrajectoryAvailable(false);
    const allChecks = Array.from(controls.element.querySelectorAll('.fc-controls__overlays input[type="checkbox"]'));
    const trajectory = allChecks[allChecks.length - 1];
    expect(/** @type {HTMLInputElement} */ (trajectory).disabled).toBe(true);
  });

  it('fires onOverlayChange with the current overlay state when a checkbox changes', () => {
    let lastOverlays = null;
    const controls = createControls({
      onOverlayChange: (o) => { lastOverlays = o; },
    });
    const allChecks = Array.from(controls.element.querySelectorAll('.fc-controls__overlays input[type="checkbox"]'));
    // Toggle the first checkbox (fixationSequence).
    const first = /** @type {HTMLInputElement} */ (allChecks[0]);
    first.checked = true;
    first.dispatchEvent(new Event('change'));
    expect(lastOverlays).not.toBeNull();
    expect(lastOverlays.fixationSequence).toBe(true);
    expect(lastOverlays.attentionZones).toBe(false);
    expect(lastOverlays.centroidTrajectory).toBe(false);
  });
});

describe('createControls — overlay control visibility', () => {
  it('opacity and blend controls are visible by default (overlay view)', () => {
    const controls = createControls();
    const opacityWrap = controls.element.querySelector('.fc-controls__field--opacity');
    const blendWrap = controls.element.querySelector('.fc-controls__field--blend');
    expect(opacityWrap.hidden).toBe(false);
    expect(blendWrap.hidden).toBe(false);
  });

  it('setView("original") hides opacity and blend controls', () => {
    const controls = createControls();
    controls.setView('original');
    const opacityWrap = controls.element.querySelector('.fc-controls__field--opacity');
    const blendWrap = controls.element.querySelector('.fc-controls__field--blend');
    expect(opacityWrap.hidden).toBe(true);
    expect(blendWrap.hidden).toBe(true);
  });

  it('setView("sidebyside") keeps opacity and blend controls visible', () => {
    const controls = createControls();
    controls.setView('original');   // hide first
    controls.setView('sidebyside'); // then switch to sidebyside — should re-show
    const opacityWrap = controls.element.querySelector('.fc-controls__field--opacity');
    const blendWrap = controls.element.querySelector('.fc-controls__field--blend');
    expect(opacityWrap.hidden).toBe(false);
    expect(blendWrap.hidden).toBe(false);
  });

  it('setView("overlay") keeps opacity and blend controls visible', () => {
    const controls = createControls();
    controls.setView('original');
    controls.setView('overlay');
    const opacityWrap = controls.element.querySelector('.fc-controls__field--opacity');
    const blendWrap = controls.element.querySelector('.fc-controls__field--blend');
    expect(opacityWrap.hidden).toBe(false);
    expect(blendWrap.hidden).toBe(false);
  });
});

describe('createControls — visualizations', () => {
  it('visualizations checkboxes are rendered directly (no <details> wrapper)', () => {
    const controls = createControls();
    // No <details> flyout — fieldset is a direct child of the controls root.
    expect(controls.element.querySelector('.fc-controls__overlays-details')).toBeNull();
    const fieldset = controls.element.querySelector('.fc-controls__overlays');
    expect(fieldset).not.toBeNull();
    // All 3 checkboxes present.
    expect(fieldset.querySelectorAll('input[type="checkbox"]').length).toBe(3);
  });
});
