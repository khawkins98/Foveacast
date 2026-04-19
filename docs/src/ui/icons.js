/**
 * ui/icons.js
 *
 * Inline SVG icons for the sidebar and navigation. All paths are from
 * Material Symbols Outlined (Apache 2.0 licence), committed locally so
 * the app remains offline-capable without a CDN dependency.
 *
 * Each export is an SVG string suitable for `el.innerHTML = icon(…)` or
 * direct interpolation in template literals. The `aria-hidden="true"`
 * attribute is included on every icon because all call-sites pair the
 * icon with a visible text label; the icon is purely decorative.
 *
 * Viewbox is 0 0 24 24 for all icons (Material Symbols grid).
 */

/**
 * Build a standardised SVG wrapper around a path data string.
 *
 * @param {string} pathData - The `d` attribute for the <path>.
 * @param {string} [title]  - If provided, adds a <title> for non-decorative use.
 * @returns {string} SVG markup.
 */
function svg(pathData, title) {
  const titleEl = title ? `<title>${title}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ` +
    `width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false">` +
    `${titleEl}<path d="${pathData}"/></svg>`
  );
}

/** Tune / sliders — used for Heatmap Strength control. */
export const iconTune = svg(
  'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
  'Tune',
);

/** Timer — used for Viewing Duration control. */
export const iconTimer = svg(
  'M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61 1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z',
  'Timer',
);

/** Layers — used for Display Modes control. */
export const iconLayers = svg(
  'M11.99 18.54 4.62 12.81 3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zm.01-2.07 7.36-5.73L21 9.47l-9-7-9 7 1.63 1.27 7.37 5.73z',
  'Layers',
);

/** Help — used in top navigation. */
export const iconHelp = svg(
  'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z',
  'Help',
);

/** Description / document — used for Documentation link. */
export const iconDescription = svg(
  'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  'Description',
);

/** Policy / shield — used for Legal link. */
export const iconPolicy = svg(
  'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z',
  'Policy',
);

/** Download — used for Export button. */
export const iconDownload = svg(
  'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  'Download',
);

/** Upload / drop — used in the dropzone. */
export const iconUpload = svg(
  'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
  'Upload',
);

/** Compare — used in the comparison nav. */
export const iconCompare = svg(
  'M10 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h5v2h2V1h-2v2zm0 15H5l5-6v6zm9-15h-5v2l5 6V5zm0 14h-5v2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2v14z',
  'Compare',
);
