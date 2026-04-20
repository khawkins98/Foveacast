/**
 * ui/footer.js
 *
 * Mounts the attribution and disclosure footer. Called once at boot;
 * the footer content is static — model version, credits, and bias note.
 */

/**
 * Populate the target element with model attribution and bias disclosure.
 *
 * @param {Element | null} targetEl - Target element to populate.
 */
export function mountFooter(targetEl) {
  if (!targetEl) return;
  targetEl.textContent = '';

  const heading = document.createElement('h3');
  heading.className = 'fc-footer__heading';
  heading.textContent = 'About the model used here';
  targetEl.appendChild(heading);

  const modelLine = document.createElement('p');
  modelLine.className = 'fc-footer__line fc-footer__model';
  modelLine.textContent = 'Model: MSI-Net · fine-tuned on UEyes (240×320)';
  targetEl.appendChild(modelLine);

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
  targetEl.appendChild(credits);

  const bias = document.createElement('p');
  bias.className = 'fc-footer__line fc-footer__bias';
  bias.textContent =
    "Heatmap outputs reflect population-average gaze patterns from the model's training data. They are estimates, not measurements of any specific person's attention.";
  targetEl.appendChild(bias);
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
