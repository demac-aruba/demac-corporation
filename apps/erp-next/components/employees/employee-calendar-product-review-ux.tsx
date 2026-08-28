'use client';

import { useEffect } from 'react';

/**
 * Product-review-only UX bridge for the Employee Calendar prototype.
 *
 * The underlying payroll period already has one React source of truth. This bridge only
 * removes the duplicate header control and adds conventional dropdown dismissal while
 * the owner validates the intended UX. During engineering hardening these behaviors
 * must be moved into EmployeeWorkspace itself and this bridge removed.
 */
export function EmployeeCalendarProductReviewUx() {
  useEffect(() => {
    const findQuickActions = () => [...document.querySelectorAll<HTMLDetailsElement>('details')]
      .find((details) => details.querySelector('summary')?.textContent?.includes('Quick actions'));

    const syncPayrollPresentation = () => {
      const periodSelector = [...document.querySelectorAll<HTMLElement>('header div')]
        .find((element) => element.textContent?.includes('Payroll Period') && element.querySelectorAll('button').length === 2);
      const periodText = periodSelector?.querySelector('strong')?.textContent?.trim();
      if (periodSelector) periodSelector.style.display = 'none';
      if (!periodText) return;

      const existingHeading = document.querySelector<HTMLHeadingElement>('h2[data-payroll-period-heading="true"]');
      const heading = existingHeading ?? [...document.querySelectorAll<HTMLHeadingElement>('h2')]
        .find((candidate) => /^[A-Za-z]+\s+\d{4}$/.test(candidate.textContent?.trim() ?? ''));
      if (!heading) return;
      heading.dataset.payrollPeriodHeading = 'true';

      let note = heading.querySelector<HTMLSpanElement>('[data-payroll-period-note="true"]');
      if (!note) {
        note = document.createElement('span');
        note.dataset.payrollPeriodNote = 'true';
        note.style.display = 'block';
        note.style.marginTop = '3px';
        note.style.color = 'var(--muted)';
        note.style.fontSize = '10px';
        note.style.fontWeight = '700';
        note.style.letterSpacing = '0';
        heading.appendChild(note);
      }
      const nextText = `Payroll period · ${periodText}`;
      if (note.textContent !== nextText) note.textContent = nextText;

      const toolbar = heading.parentElement;
      const payrollBadge = toolbar
        ? [...toolbar.querySelectorAll<HTMLElement>('span')].find((element) => element.textContent?.trim() === 'Payroll⌄')
        : undefined;
      if (payrollBadge) payrollBadge.style.display = 'none';
    };

    const onPointerDown = (event: PointerEvent) => {
      const details = findQuickActions();
      if (!details?.open) return;
      const target = event.target;
      if (target instanceof Node && !details.contains(target)) details.open = false;
    };

    const onClick = (event: MouseEvent) => {
      const details = findQuickActions();
      if (!details?.open) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('button');
      if (button && details.contains(button) && !button.hasAttribute('disabled')) details.open = false;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const details = findQuickActions();
        if (details?.open) details.open = false;
      }
    };

    const observer = new MutationObserver(syncPayrollPresentation);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('click', onClick);
    window.addEventListener('keydown', onKeyDown);
    syncPayrollPresentation();

    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return null;
}
