// Tests for ui/footer.js — mountFooter.
//
// Coverage focuses on the observable DOM structure.
// The exact link hrefs and attribution text are not under test —
// those are content concerns, not logic concerns.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountFooter } from '../docs/src/ui/footer.js';

describe('mountFooter', () => {
  /** @type {HTMLElement} */
  let footerEl;

  beforeEach(() => {
    footerEl = document.createElement('footer');
    document.body.appendChild(footerEl);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns early without error when footerEl is null', () => {
    expect(() => mountFooter(null)).not.toThrow();
  });

  it('clears any existing footer content before rendering', () => {
    footerEl.textContent = 'stale content';
    mountFooter(footerEl);
    expect(footerEl.textContent).not.toContain('stale content');
  });

  it('adds the model name line', () => {
    mountFooter(footerEl);
    const modelLine = footerEl.querySelector('.fc-footer__model');
    expect(modelLine).not.toBeNull();
    expect(modelLine.textContent).toContain('MSI-Net');
  });

  it('adds a credits paragraph containing attribution links', () => {
    mountFooter(footerEl);
    const links = footerEl.querySelectorAll('a');
    const hrefs = Array.from(links).map((a) => a.href);
    // MSI-Net paper DOI, UEyes paper DOI, and ONNX Runtime Web docs
    // are the three external anchors we care about.
    expect(hrefs.some((h) => h.includes('neunet.2020'))).toBe(true);
    expect(hrefs.some((h) => h.includes('3544548'))).toBe(true);
    expect(hrefs.some((h) => h.includes('onnxruntime'))).toBe(true);
  });

  it('all attribution links have rel="noopener noreferrer"', () => {
    mountFooter(footerEl);
    const links = footerEl.querySelectorAll('a');
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a.rel).toContain('noopener');
      expect(a.rel).toContain('noreferrer');
    }
  });

  it('adds the bias disclosure paragraph', () => {
    mountFooter(footerEl);
    const bias = footerEl.querySelector('.fc-footer__bias');
    expect(bias).not.toBeNull();
    expect(bias.textContent).toContain('population-average');
  });

  it('does not include a "See commercial alternatives" button', () => {
    mountFooter(footerEl);
    const btn = footerEl.querySelector('.fc-footer__more');
    expect(btn).toBeNull();
  });
});
