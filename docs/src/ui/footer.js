/**
 * ui/footer.js
 *
 * Mounts the attribution and disclosure footer. Called once at boot;
 * the footer content is static — model version, credits, bias note,
 * and the commercial-alternatives button — so there is no re-render.
 *
 * The modal element is passed explicitly so this module stays
 * dependency-free from DOM queries. (Querying #fc-alternatives-modal
 * inside the module would create a hidden coupling to a specific element
 * ID that is easy to miss when editing index.html.)
 */

/**
 * Populate the footer element and wire the "See commercial alternatives"
 * button to open the alternatives modal.
 *
 * @param {Element | null} footerEl - The `.fc-footer` element.
 * @param {HTMLDialogElement | null} modalEl - The `#fc-alternatives-modal` element.
 */
export function mountFooter(footerEl, modalEl) {
  if (!footerEl) return;
  footerEl.textContent = '';

  const modelLine = document.createElement('p');
  modelLine.className = 'fc-footer__line fc-footer__model';
  modelLine.textContent = 'Model: MSI-Net · fine-tuned on UEyes (240×320)';
  footerEl.appendChild(modelLine);

  // Attribution lines are built as individual nodes rather than one
  // innerHTML blob so the anchors carry real DOM event hooks (and a
  // future reviewer spotting innerHTML has no XSS to worry about).
  const credits = document.createElement('p');
  credits.className = 'fc-footer__line';
  credits.appendChild(
    textAndLink(
      'Architecture: ',
      'MSI-Net',
      'https://doi.org/10.1016/j.neunet.2020.05.004',
      ' (Kroner et al. 2020, MIT). ',
    ),
  );
  credits.appendChild(
    textAndLink(
      'Fine-tuned on ',
      'UEyes',
      'https://doi.org/10.1145/3544548.3581096',
      ' (Jiang et al. 2023, CC BY 4.0). ',
    ),
  );
  credits.appendChild(
    textAndLink(
      'Training pipeline: ',
      'foveacast-training',
      'https://github.com/khawkins98/foveacast-training',
      '. ',
    ),
  );
  credits.appendChild(
    textAndLink(
      'Inference via ',
      'ONNX Runtime Web',
      'https://onnxruntime.ai/docs/tutorials/web/',
      ' (MIT). ',
    ),
  );
  credits.appendChild(
    textAndLink(
      'Saliency colormap: inferno (matplotlib, ',
      'BSD licensed',
      'https://matplotlib.org/stable/users/project/license.html',
      '). ',
    ),
  );
  footerEl.appendChild(credits);

  const bias = document.createElement('p');
  bias.className = 'fc-footer__line fc-footer__bias';
  bias.textContent =
    "Heatmap outputs reflect population-average gaze patterns from the model's training data. They are estimates, not measurements of any specific person's attention.";
  footerEl.appendChild(bias);

  const moreLine = document.createElement('p');
  moreLine.className = 'fc-footer__line';
  moreLine.appendChild(document.createTextNode('Need more than Foveacast can offer? '));
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'fc-footer__more';
  moreBtn.textContent = 'See commercial alternatives.';
  moreBtn.addEventListener('click', () => openAlternativesModal(modalEl));
  moreLine.appendChild(moreBtn);
  footerEl.appendChild(moreLine);
}

/**
 * Open the commercial-alternatives modal and track focus so it can be
 * restored when the dialog closes.
 *
 * WHY we use <dialog>.showModal(): it gives us focus-trap and Escape-to-close
 * without hand-rolling either. showModal also elevates the dialog to the
 * top-layer so no z-index games are needed.
 *
 * @param {HTMLDialogElement | null} modal
 */
function openAlternativesModal(modal) {
  if (!modal) return;
  const previouslyFocused = /** @type {HTMLElement | null} */ (document.activeElement);

  const onClose = () => {
    modal.removeEventListener('close', onClose);
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  };
  modal.addEventListener('close', onClose);

  if (typeof modal.showModal === 'function') {
    modal.showModal();
  } else {
    // Extremely old engine fallback — just show it. Focus and dismissal
    // gestures won't be trapped, but the content is still readable.
    // <dialog> is supported everywhere in our target set.
    modal.setAttribute('open', '');
  }
}

/**
 * Build a lead-text + anchor + trailing-text run in a single span.
 * Keeps footer prose readable in the DOM without innerHTML.
 *
 * @param {string} lead
 * @param {string} linkText
 * @param {string} href
 * @param {string} trail
 * @returns {HTMLSpanElement}
 */
function textAndLink(lead, linkText, href, trail) {
  const span = document.createElement('span');
  span.appendChild(document.createTextNode(lead));
  const a = document.createElement('a');
  a.href = href;
  a.textContent = linkText;
  a.rel = 'noopener noreferrer';
  span.appendChild(a);
  span.appendChild(document.createTextNode(trail));
  return span;
}
