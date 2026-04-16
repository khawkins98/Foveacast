// Unit tests for the controls panel.
//
// Coverage is deliberately narrow: the only behaviour with a real
// failure mode we have not already exercised elsewhere is the
// progressive-disclosure `setVisible` path. Event-dispatch behaviour
// is hard to test meaningfully without a real user, and is covered by
// the Playwright E2E suite.

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
