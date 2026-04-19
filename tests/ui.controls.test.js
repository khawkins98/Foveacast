// Unit tests for the controls panel.
//
// Coverage is deliberately narrow: progressive-disclosure
// `setVisible`, duration picker state, and the loading hint are the
// behaviours with real failure modes. Event-dispatch behaviour is hard
// to test meaningfully without a real user, and is covered by the
// Playwright E2E suite.

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

describe('createControls — duration picker', () => {
  it('renders radio buttons for all three durations', () => {
    const controls = createControls();
    const radios = controls.element.querySelectorAll('input[type="radio"][name*="duration"]');
    expect(radios.length).toBe(3);
    const values = Array.from(radios).map((r) => /** @type {HTMLInputElement} */ (r).value);
    expect(values).toEqual(['1s', '3s', '7s']);
  });

  it('defaults to the 3s duration', () => {
    const controls = createControls();
    const checked = controls.element.querySelector('input[type="radio"][name*="duration"]:checked');
    expect(/** @type {HTMLInputElement} */ (checked).value).toBe('3s');
  });

  it('setDuration updates the checked radio', () => {
    const controls = createControls();
    controls.setDuration('7s');
    const checked = controls.element.querySelector('input[type="radio"][name*="duration"]:checked');
    expect(/** @type {HTMLInputElement} */ (checked).value).toBe('7s');
  });

  it('setDurationLoading shows and hides the loading hint via textContent', () => {
    const controls = createControls();
    const hint = controls.element.querySelector('.fc-controls__duration-loading');
    // why: textContent toggle (not hidden attribute) keeps the element in the
    // accessibility tree so aria-live announcements fire reliably.
    expect(hint.textContent).toBe('');
    controls.setDurationLoading(true);
    expect(hint.textContent).toBe('Loading model…');
    controls.setDurationLoading(false);
    expect(hint.textContent).toBe('');
  });
});
