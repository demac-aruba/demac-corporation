'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  flushPerformanceTelemetry,
  moduleFromPath,
  recordPerformanceMeasurement,
} from '@/lib/performance-telemetry';

function logicalResourceName(name: string) {
  if (name.includes('/performanceTelemetry')) return null;
  const functionMatch = name.match(/cloudfunctions\.net\/([^/?#]+)/i);
  if (functionMatch?.[1]) return `function_${functionMatch[1].replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`.slice(0, 80);
  if (name.includes('firestore.googleapis.com')) return 'firestore_rest';
  if (name.includes('identitytoolkit.googleapis.com') || name.includes('securetoken.googleapis.com')) return 'firebase_auth';
  return null;
}

export function PerformanceTelemetryProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const { mode, status, principal } = useAuth();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (mode !== 'firebase' || status !== 'ready' || !principal.active) return;
    const route = pathname || '/';
    recordPerformanceMeasurement({
      name: 'route_view',
      module: moduleFromPath(route),
      value: 1,
      unit: 'count',
      route,
    });
  }, [mode, pathname, principal.active, status]);

  useEffect(() => {
    if (mode !== 'firebase' || status !== 'ready' || !principal.active || initializedRef.current) return;
    initializedRef.current = true;

    const route = window.location.pathname;
    const module = moduleFromPath(route);
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigation) {
      if (navigation.domContentLoadedEventEnd > 0) {
        recordPerformanceMeasurement({ name: 'dom_content_loaded', module, value: navigation.domContentLoadedEventEnd, unit: 'ms', route });
      }
      if (navigation.loadEventEnd > 0) {
        recordPerformanceMeasurement({ name: 'page_load', module, value: navigation.loadEventEnd, unit: 'ms', route });
      }
      if (navigation.responseStart > 0) {
        recordPerformanceMeasurement({ name: 'ttfb', module, value: navigation.responseStart, unit: 'ms', route });
      }
    }

    for (const paint of performance.getEntriesByType('paint')) {
      if (paint.name === 'first-contentful-paint') {
        recordPerformanceMeasurement({ name: 'first_contentful_paint', module, value: paint.startTime, unit: 'ms', route });
      }
    }

    const observers: PerformanceObserver[] = [];
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const resourceObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
            const resourceName = logicalResourceName(entry.name);
            if (!resourceName || entry.duration <= 0) continue;
            const currentRoute = window.location.pathname;
            recordPerformanceMeasurement({
              name: resourceName,
              module: moduleFromPath(currentRoute),
              value: entry.duration,
              unit: 'ms',
              route: currentRoute,
            });
          }
        });
        resourceObserver.observe({ type: 'resource', buffered: true });
        observers.push(resourceObserver);
      } catch {
        // Resource Timing is optional; telemetry must never affect ERP operation.
      }

      try {
        const longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const currentRoute = window.location.pathname;
            recordPerformanceMeasurement({
              name: 'long_task',
              module: moduleFromPath(currentRoute),
              value: entry.duration,
              unit: 'ms',
              route: currentRoute,
            });
          }
        });
        longTaskObserver.observe({ type: 'longtask', buffered: true });
        observers.push(longTaskObserver);
      } catch {
        // Long Task API is not available in every browser.
      }
    }

    const onError = () => {
      const currentRoute = window.location.pathname;
      recordPerformanceMeasurement({ name: 'browser_error', module: moduleFromPath(currentRoute), value: 1, unit: 'count', error: true, route: currentRoute });
    };
    const onRejection = () => {
      const currentRoute = window.location.pathname;
      recordPerformanceMeasurement({ name: 'unhandled_rejection', module: moduleFromPath(currentRoute), value: 1, unit: 'count', error: true, route: currentRoute });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    const flushTimer = window.setInterval(() => { void flushPerformanceTelemetry(); }, 60_000);
    const heartbeatTimer = window.setInterval(() => {
      const currentRoute = window.location.pathname;
      recordPerformanceMeasurement({ name: 'session_heartbeat', module: moduleFromPath(currentRoute), value: 1, unit: 'count', route: currentRoute });
      void flushPerformanceTelemetry();
    }, 120_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void flushPerformanceTelemetry();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    recordPerformanceMeasurement({ name: 'session_start', module, value: 1, unit: 'count', route });
    void flushPerformanceTelemetry();

    return () => {
      for (const observer of observers) observer.disconnect();
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(flushTimer);
      window.clearInterval(heartbeatTimer);
      void flushPerformanceTelemetry();
    };
  }, [mode, principal.active, status]);

  return <>{children}</>;
}
