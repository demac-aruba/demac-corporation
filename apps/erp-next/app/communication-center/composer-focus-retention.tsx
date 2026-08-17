'use client';

import { useEffect } from 'react';

function findCommunicationRoot() {
  return document.querySelector<HTMLElement>('.communication-v4');
}

function findComposerTextarea() {
  return document.querySelector<HTMLTextAreaElement>('.communication-v4 textarea');
}

function sendIsInFlight() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.communication-v4 button'))
    .some((button) => {
      const label = button.textContent?.trim();
      return label === 'Sending…' || label === 'Uploading…';
    });
}

function isInternalComposer(textarea: HTMLTextAreaElement) {
  return textarea.placeholder.startsWith('Write an internal note');
}

function focusAtEnd(textarea: HTMLTextAreaElement) {
  textarea.focus({ preventScroll: true });
  const cursor = textarea.value.length;
  textarea.setSelectionRange(cursor, cursor);
}

export function ComposerFocusRetention() {
  useEffect(() => {
    let pendingRestore = false;
    let sawBusySend = false;
    let observer: MutationObserver | null = null;
    let fallbackTimer: number | null = null;
    let safetyTimer: number | null = null;
    let frame: number | null = null;

    const cleanupObserver = () => {
      observer?.disconnect();
      observer = null;
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (safetyTimer !== null) {
        window.clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
    };

    const finishRestore = () => {
      const textarea = findComposerTextarea();
      if (textarea && !textarea.disabled) focusAtEnd(textarea);
      pendingRestore = false;
      sawBusySend = false;
      cleanupObserver();
    };

    const restoreWhenReady = () => {
      if (!pendingRestore) return;
      const textarea = findComposerTextarea();
      if (!textarea) return;

      const inFlight = sendIsInFlight();
      if (inFlight) {
        sawBusySend = true;

        if (!isInternalComposer(textarea)) {
          if (textarea.disabled) textarea.disabled = false;
          focusAtEnd(textarea);
        }
        return;
      }

      if (sawBusySend && !textarea.disabled) finishRestore();
    };

    const armRestore = () => {
      pendingRestore = true;
      sawBusySend = false;
      cleanupObserver();

      const root = findCommunicationRoot();
      if (root) {
        observer = new MutationObserver(restoreWhenReady);
        observer.observe(root, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['disabled'],
        });
      }

      frame = window.requestAnimationFrame(restoreWhenReady);
      fallbackTimer = window.setTimeout(() => {
        if (!pendingRestore || sawBusySend) return;
        const textarea = findComposerTextarea();
        if (textarea && !textarea.disabled) finishRestore();
      }, 750);
      safetyTimer = window.setTimeout(finishRestore, 10_000);
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
      sawBusySend = false;
      cleanupObserver();
    };
  }, []);

  return null;
}
