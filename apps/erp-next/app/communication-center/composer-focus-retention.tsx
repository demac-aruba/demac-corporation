'use client';

import { useEffect } from 'react';

function findComposerTextarea() {
  return document.querySelector<HTMLTextAreaElement>('.communication-v4 textarea');
}

export function ComposerFocusRetention() {
  useEffect(() => {
    let pendingRestore = false;
    let observer: MutationObserver | null = null;
    let fallbackTimer: number | null = null;

    const cleanupObserver = () => {
      observer?.disconnect();
      observer = null;
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const restoreWhenReady = () => {
      if (!pendingRestore) return;
      const textarea = findComposerTextarea();
      if (!textarea || textarea.disabled) return;

      pendingRestore = false;
      cleanupObserver();
      textarea.focus({ preventScroll: true });
      const cursor = textarea.value.length;
      textarea.setSelectionRange(cursor, cursor);
    };

    const armRestore = () => {
      pendingRestore = true;
      cleanupObserver();

      const textarea = findComposerTextarea();
      if (!textarea) return;

      observer = new MutationObserver(restoreWhenReady);
      observer.observe(textarea, { attributes: true, attributeFilter: ['disabled'] });
      fallbackTimer = window.setTimeout(restoreWhenReady, 250);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.target instanceof HTMLTextAreaElement)) return;
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) armRestore();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest('button');
      if (!button) return;
      const label = button.textContent?.trim();
      if (label === 'Send' || label === 'Save note') armRestore();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      cleanupObserver();
    };
  }, []);

  return null;
}
