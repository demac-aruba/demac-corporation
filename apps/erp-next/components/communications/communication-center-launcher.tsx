'use client';

import { useEffect } from 'react';

export function CommunicationCenterLauncher() {
  useEffect(() => {
    const applyDedicatedTarget = () => {
      document.querySelectorAll<HTMLAnchorElement>('a[href="/communication-center"]').forEach((link) => {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', `${link.textContent?.trim() || 'Communication Center'} (opens in a new tab)`);
      });
    };

    applyDedicatedTarget();
    const observer = new MutationObserver(applyDedicatedTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
