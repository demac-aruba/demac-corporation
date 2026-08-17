'use client';

import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';

type InboxView = 'active' | 'maya' | 'closed';
type InboxCounts = { active: number; maya: number; closed: number };

const emptyCounts: InboxCounts = { active: 0, maya: 0, closed: 0 };

function conversationRows(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLButtonElement>('button[class*="conversationRow"]'));
}

function statusChip(row: HTMLElement) {
  return row.querySelector<HTMLElement>('[class*="statusChip"]');
}

function rowIsClosed(row: HTMLElement) {
  const chip = statusChip(row)?.textContent?.trim().toLowerCase() || '';
  return row.dataset.state === 'resolved' || chip === 'completed' || chip === 'resolved' || chip === 'closed';
}

function rowIsMaya(row: HTMLElement) {
  const chip = statusChip(row)?.textContent?.trim().toLowerCase() || '';
  return !rowIsClosed(row) && (chip.includes('maya') || chip === 'ai active');
}

function shouldShow(view: InboxView, row: HTMLElement) {
  if (view === 'closed') return rowIsClosed(row);
  if (view === 'maya') return rowIsMaya(row);
  return !rowIsClosed(row);
}

function sameCounts(left: InboxCounts, right: InboxCounts) {
  return left.active === right.active && left.maya === right.maya && left.closed === right.closed;
}

function updatePipelineUnreadBadges(root: HTMLElement, inboxRows: HTMLButtonElement[]) {
  const unreadByCustomer = new Map<string, string>();

  for (const row of inboxRows) {
    const name = row.querySelector<HTMLElement>('[class*="rowTop"] strong')?.textContent?.trim();
    const unread = row.querySelector<HTMLElement>('[class*="unreadBadge"]')?.textContent?.trim();
    if (!name || !unread) continue;
    const previous = Number(unreadByCustomer.get(name) || 0);
    const next = Number(unread || 0);
    unreadByCustomer.set(name, String(Math.max(previous, next)));
  }

  for (const row of Array.from(root.querySelectorAll<HTMLButtonElement>('button[class*="pipelineRow"]'))) {
    const name = row.querySelector<HTMLElement>('[class*="pipelineTop"] strong')?.textContent?.trim();
    const unread = name ? unreadByCustomer.get(name) : undefined;
    if (unread) {
      if (row.dataset.unreadCount !== unread) row.dataset.unreadCount = unread;
    } else if (row.dataset.unreadCount) {
      delete row.dataset.unreadCount;
    }
  }
}

export function InboxPipelineNavigation() {
  const [view, setView] = useState<InboxView>('active');
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const [counts, setCounts] = useState<InboxCounts>(emptyCounts);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.communication-v4');
    if (!root) return undefined;

    const locatePanel = () => {
      const next = root.querySelector<HTMLElement>('aside[class*="inboxPanel"]');
      setPanel((current) => current === next ? current : next);
    };

    locatePanel();
    const observer = new MutationObserver(locatePanel);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!panel) return undefined;
    const root = panel.closest<HTMLElement>('.communication-v4');
    if (!root) return undefined;

    let frame: number | null = null;

    const apply = () => {
      frame = null;
      const rows = conversationRows(panel);
      const nextCounts: InboxCounts = { active: 0, maya: 0, closed: 0 };

      for (const row of rows) {
        const closed = rowIsClosed(row);
        const maya = rowIsMaya(row);
        if (closed) nextCounts.closed += 1;
        else nextCounts.active += 1;
        if (maya) nextCounts.maya += 1;

        const show = shouldShow(view, row);
        if (row.hidden === show) row.hidden = !show;

        const chip = statusChip(row);
        if (!closed && !maya && row.dataset.state === 'unassigned' && chip?.textContent?.trim() === 'Unassigned') {
          chip.textContent = 'Needs human';
        }
      }

      setCounts((current) => sameCounts(current, nextCounts) ? current : nextCounts);
      updatePipelineUnreadBadges(root, rows);

      const subtitle = panel.querySelector<HTMLElement>('[class*="inboxHeader"] > div > span');
      if (subtitle) {
        const shown = rows.filter((row) => !row.hidden).length;
        const label = view === 'active' ? 'active' : view === 'maya' ? 'with Maya' : 'closed';
        const nextText = `${shown} ${label} conversation${shown === 1 ? '' : 's'}`;
        if (subtitle.textContent !== nextText) subtitle.textContent = nextText;
      }

      const selectedRow = rows.find((row) => row.className.includes('selectedRow'));
      if (selectedRow?.hidden) {
        rows.find((row) => !row.hidden)?.click();
      }
    };

    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(apply);
    };

    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'data-state'],
    });
    schedule();

    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [panel, view]);

  if (!panel) return null;

  return createPortal(
    <nav className="cc-inbox-nav" role="tablist" aria-label="WhatsApp Inbox views">
      <button type="button" role="tab" aria-selected={view === 'active'} data-active={view === 'active' ? 'true' : 'false'} onClick={() => setView('active')}>
        <span>Active</span><b>{counts.active}</b>
      </button>
      <button type="button" role="tab" aria-selected={view === 'maya'} data-active={view === 'maya' ? 'true' : 'false'} onClick={() => setView('maya')}>
        <span>Maya</span><b>{counts.maya}</b>
      </button>
      <button type="button" role="tab" aria-selected={view === 'closed'} data-active={view === 'closed' ? 'true' : 'false'} onClick={() => setView('closed')}>
        <span>Closed</span><b>{counts.closed}</b>
      </button>
    </nav>,
    panel,
  );
}
