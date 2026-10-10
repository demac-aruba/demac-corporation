'use client';

import { useEffect, useRef } from 'react';

/** Own only the booking layer. Existing property editors and native dialogs keep their focus/close handlers. */
export function useBookingDialog(onClose: () => void, blocked: boolean) {
  const dialogRef = useRef<HTMLElement>(null);
  const current = useRef({ onClose, blocked });
  current.current = { onClose, blocked };

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const selector = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])';
    const visible = (element: HTMLElement) => element.getClientRects().length > 0
      && !element.closest('[inert]') && getComputedStyle(element).visibility !== 'hidden';
    const childDialog = () => {
      const dialog = dialogRef.current;
      return [...document.querySelectorAll<HTMLElement>('[role="dialog"],dialog[open]')]
        .some(element => element !== dialog && visible(element)
          && !element.contains(dialog));
    };
    const timer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog || childDialog() || dialog.contains(document.activeElement)) return;
      (dialog.querySelector<HTMLElement>('input:not(:disabled)') ?? dialog).focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === 'Escape') {
        // Capture blocks the agenda's generic Escape listener during writes/recovery.
        if (current.current.blocked) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        // A nested editor owns Escape; the agenda separately defers while this layer exists.
        if (childDialog()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        current.current.onClose();
        return;
      }
      if (event.key !== 'Tab' || childDialog()) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(selector)].filter(visible);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return dialogRef;
}
