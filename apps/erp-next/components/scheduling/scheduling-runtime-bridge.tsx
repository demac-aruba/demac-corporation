'use client';

import { useEffect } from 'react';
import { applyBrowserSchedulingRuntime } from '../../lib/browser-scheduling-settings';
import { browserKeys } from '../../lib/browser-store';

export function SchedulingRuntimeBridge({ children }: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    const apply = () => {
      applyBrowserSchedulingRuntime();
    };

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === browserKeys.businessSettings) apply();
    };

    apply();
    window.addEventListener('storage', handleStorage);
    window.addEventListener('demac:business-settings-saved', apply);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('demac:business-settings-saved', apply);
    };
  }, []);

  return children;
}
