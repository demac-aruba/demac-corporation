'use client';

import { useEffect } from 'react';

function findCommunicationRoot() {
  return document.querySelector<HTMLElement>('.communication-v4');
}

function findComposerTextarea() {
  return document.querySelector<HTMLTextAreaElement>('.communication-v4 textarea');
}

export function ComposerFocusRetention() {
  useEffect(() => {
    let pendingRestore = false;
    let observer: MutationObserver | null = null;
    let fallbackTimer: number | null = null;
    let frame: number | null = null;

    const cleanupObserver = () => {
      observer?.disconnect();
      observer = null;
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
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

      const root = findCommunicationRoot();
      if (root) {
        observer = new MutationObserver(restoreWhenReady);
        observer.observe(root, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['disabled'],
        });
      }

      frame = window.requestAnimationFrame(restoreWhenReady);
      fallbackTimer = window.setTimeout(restoreWhenReady, 500);
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
      pendingRestore = false;
      cleanupObserver();
    };
  }, []);

  return null;
}
