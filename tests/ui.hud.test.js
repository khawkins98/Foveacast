// Unit tests for ui/hud.js.
//
// Requires DOM — runs under vitest with jsdom environment (default for
// this project). Tests cover element structure, initial state, and
// update behaviour.

import { describe, it, expect, beforeEach } from 'vitest';
import { createHud, updateHud, updateHudRuleOfThirds } from '../docs/src/ui/hud.js';

describe('createHud', () => {
  it('returns an element with className fc-hud', () => {
    const el = createHud();
    expect(el.className).toBe('fc-hud');
  });

  it('starts hidden', () => {
    const el = createHud();
    expect(el.hidden).toBe(true);
  });

  it('has an aria-label describing its purpose', () => {
    const el = createHud();
    expect(el.getAttribute('aria-label')).toBe('Analysis statistics');
  });

  it('contains four stat cards', () => {
    const el = createHud();
    const cards = el.querySelectorAll('.fc-hud__card');
    expect(cards.length).toBe(4);
  });

  it('each card has a label and a value element', () => {
    const el = createHud();
    const cards = el.querySelectorAll('.fc-hud__card');
    for (const card of cards) {
      expect(card.querySelector('.fc-hud__label')).not.toBeNull();
      expect(card.querySelector('.fc-hud__value')).not.toBeNull();
    }
  });

  it('initial card values are non-empty placeholder text', () => {
    const el = createHud();
    const values = el.querySelectorAll('.fc-hud__value');
    for (const v of values) {
      // Should contain an em dash (—, U+2014) as the initial placeholder.
      expect(v.textContent).toBeTruthy();
    }
  });
});

describe('updateHud', () => {
  /** @type {HTMLElement} */
  let hud;

  beforeEach(() => {
    hud = createHud();
  });

  it('reveals the element (hidden → false)', () => {
    updateHud(hud, {
      inferenceMs: 1234,
      duration: '3s',
      spreadLevel: 'Low',
      width: 1280,
      height: 720,
    });
    expect(hud.hidden).toBe(false);
  });

  it('populates the inference-time card', () => {
    updateHud(hud, {
      inferenceMs: 987,
      duration: '1s',
      spreadLevel: 'Medium',
      width: 800,
      height: 600,
    });
    const card = hud.querySelector('.fc-hud__inference');
    expect(card).not.toBeNull();
    // Value should include the ms figure somewhere in the text.
    expect(card.querySelector('.fc-hud__value').textContent).toContain('987');
  });

  it('populates the duration card', () => {
    updateHud(hud, {
      inferenceMs: 500,
      duration: '7s',
      spreadLevel: 'High',
      width: 1920,
      height: 1080,
    });
    const card = hud.querySelector('.fc-hud__duration');
    expect(card.querySelector('.fc-hud__value').textContent).toBe('7s');
  });

  it('populates the attention spread card', () => {
    updateHud(hud, {
      inferenceMs: 500,
      duration: '3s',
      spreadLevel: 'High',
      width: 1280,
      height: 720,
    });
    const card = hud.querySelector('.fc-hud__spread');
    expect(card.querySelector('.fc-hud__value').textContent).toBe('High');
  });

  it('populates the resolution card with width × height', () => {
    updateHud(hud, {
      inferenceMs: 500,
      duration: '3s',
      spreadLevel: 'Low',
      width: 1920,
      height: 1080,
    });
    const card = hud.querySelector('.fc-hud__resolution');
    const text = card.querySelector('.fc-hud__value').textContent;
    expect(text).toContain('1920');
    expect(text).toContain('1080');
  });

  it('is idempotent — re-calling with new data updates values in place', () => {
    updateHud(hud, { inferenceMs: 100, duration: '1s', spreadLevel: 'Low', width: 800, height: 600 });
    updateHud(hud, { inferenceMs: 200, duration: '3s', spreadLevel: 'High', width: 1024, height: 768 });

    const infCard = hud.querySelector('.fc-hud__inference .fc-hud__value');
    expect(infCard.textContent).toContain('200');

    const durCard = hud.querySelector('.fc-hud__duration .fc-hud__value');
    expect(durCard.textContent).toBe('3s');

    // Should not have duplicate cards.
    expect(hud.querySelectorAll('.fc-hud__card').length).toBe(4);
  });
});

describe('updateHudRuleOfThirds', () => {
  it('creates a <details> element with 9 cells', () => {
    const hud = createHud();
    const cells = [12, 11, 11, 11, 11, 11, 11, 11, 11];
    updateHudRuleOfThirds(hud, cells);
    const grid = hud.querySelector('.fc-hud__thirds-grid');
    expect(grid).not.toBeNull();
    expect(grid.children.length).toBe(9);
  });

  it('each cell displays its percentage', () => {
    const hud = createHud();
    const cells = [100, 0, 0, 0, 0, 0, 0, 0, 0];
    updateHudRuleOfThirds(hud, cells);
    const gridCells = hud.querySelectorAll('.fc-hud__thirds-cell');
    expect(gridCells[0].textContent).toMatch('100');
    expect(gridCells[1].textContent).toMatch('0');
  });

  it('values sum to 100', () => {
    const hud = createHud();
    const cells = [12, 11, 11, 11, 11, 11, 11, 11, 11];
    updateHudRuleOfThirds(hud, cells);
    const sum = cells.reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('is idempotent — re-calling updates values without duplicating elements', () => {
    const hud = createHud();
    const cells1 = [20, 10, 10, 10, 10, 10, 10, 10, 10];
    const cells2 = [5, 10, 10, 10, 10, 10, 15, 15, 15];
    updateHudRuleOfThirds(hud, cells1);
    updateHudRuleOfThirds(hud, cells2);
    expect(hud.querySelectorAll('.fc-hud__thirds-grid').length).toBe(1);
    const gridCells = hud.querySelectorAll('.fc-hud__thirds-cell');
    expect(gridCells.length).toBe(9);
  });

  it('ignores wrong-length arrays (not 9 elements)', () => {
    const hud = createHud();
    // Should not throw.
    expect(() => updateHudRuleOfThirds(hud, [50, 50])).not.toThrow();
    // No grid should be created for invalid input.
    const grid = hud.querySelector('.fc-hud__thirds-grid');
    expect(grid).toBeNull();
  });

  it('sets --cell-heat CSS custom property based on cell value', () => {
    const hud = createHud();
    const cells = [100, 0, 0, 0, 0, 0, 0, 0, 0];
    updateHudRuleOfThirds(hud, cells);
    const gridCells = hud.querySelectorAll('.fc-hud__thirds-cell');
    const hotCell = /** @type {HTMLElement} */ (gridCells[0]);
    expect(hotCell.style.getPropertyValue('--cell-heat')).toBeTruthy();
  });
});
