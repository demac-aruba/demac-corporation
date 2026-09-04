'use client';

import { useEffect } from 'react';

const ignoredInputTypes = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

function protectField(field: HTMLInputElement | HTMLTextAreaElement) {
  if (field instanceof HTMLInputElement && ignoredInputTypes.has(field.type)) return;

  // These are ERP business-entry fields. Their suggestions must come from the
  // owning ERP control (for example, the canonical CRM customer picker), not
  // from Chrome form history or third-party password/autofill managers.
  field.setAttribute('autocomplete', 'off');
  field.setAttribute('data-form-type', 'other');
  field.setAttribute('data-lpignore', 'true');
  field.setAttribute('data-1p-ignore', 'true');
  field.setAttribute('data-bwignore', 'true');
}

function applyProjectsAutocompletePolicy(root: Element) {
  if (root.matches('form')) root.setAttribute('autocomplete', 'off');
  if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) protectField(root);

  root.querySelectorAll<HTMLFormElement>('form').forEach((form) => {
    form.setAttribute('autocomplete', 'off');
  });
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(protectField);
}

export function ProjectsBrowserAutofillGuard() {
  useEffect(() => {
    const scope = document.querySelector<HTMLElement>('[data-projects-autofill-scope]');
    if (!scope) return undefined;

    applyProjectsAutocompletePolicy(scope);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) applyProjectsAutocompletePolicy(node);
        });
      });
    });
    observer.observe(scope, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
