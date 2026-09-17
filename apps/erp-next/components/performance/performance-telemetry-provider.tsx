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
  if (name.includes('firestore.googleapis.com')) return 'firestore_rest';
  if (name.includes('identitytoolkit.googleapis.com') || name.includes('securetoken.googleapis.com')) return 'firebase_auth';
  return null;
}

function cloudFunctionMetric(url: string, init?: RequestInit) {
  if (!url.includes('cloudfunctions.net/') || url.includes('/performanceTelemetry')) return null;
  const functionName = url.match(/cloudfunctions\.net\/([^/?#]+)/i)?.[1]?.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  if (!functionName) return null;
  let action = '';
  if (typeof init?.body === 'string' && init.body.length < 200_000) {
    try {
      const parsed = JSON.parse(init.body) as { action?: unknown; data?: { supportSlotSelections?: unknown } };
      action = typeof parsed.action === 'string' ? parsed.action.replace(/[^a-z0-9_-]/gi, '_').toLowerCase() : '';
      if (functionName === 'officebookingauthority' && action === 'check_availability' && Array.isArray(parsed.data?.supportSlotSelections) && parsed.data.supportSlotSelections.length > 0) return 'support_slot_validation';
      if (functionName === 'officebookingauthority' && action === 'create_appointment') return 'confirm_appointment';
    } catch {
      // Telemetry never changes or rejects the original request.
    }
  }
  return `${functionName}${action ? `_${action}` : ''}`.slice(0, 80);
}

export function PerformanceTelemetryProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const { mode, status, principal } = useAuth();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (mode !== 'firebase' || status !== 'ready' || !principal.active) return;
    const route = pathname || '/';
    recordPerformanceMeasurement({ name: 'route_view', module: moduleFromPath(route), value: 1, unit: 'count', route });
  }, [mode, pathname, principal.active, status]);

  useEffect(() => {
    if (mode !== 'firebase' || status !== 'ready' || !principal.active || initializedRef.current) return;
    initializedRef.current = true;

    const route = window.location.pathname;
    const module = moduleFromPath(route);
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (navigation) {
      if (navigation.domContentLoadedEventEnd > 0) recordPerformanceMeasurement({ name: 'dom_content_loaded', module, value: navigation.domContentLoadedEventEnd, unit: 'ms', route });
      if (navigation.loadEventEnd > 0) recordPerformanceMeasurement({ name: 'page_load', module, value: navigation.loadEventEnd, unit: 'ms', route });
      if (navigation.responseStart > 0) recordPerformanceMeasurement({ name: 'ttfb', module, value: navigation.responseStart, unit: 'ms', route });
    }
    for (const paint of performance.getEntriesByType('paint')) {
      if (paint.name === 'first-contentful-paint') recordPerformanceMeasurement({ name: 'first_contentful_paint', module, value: paint.startTime, unit: 'ms', route });
    }

    const nativeFetch = window.fetch.bind(window);
    const instrumentedFetch: typeof window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const metricName = cloudFunctionMetric(url, init);
      if (!metricName) return nativeFetch(input, init);
      const startedAt = performance.now();
      try {
        const response = await nativeFetch(input, init);
        const currentRoute = window.location.pathname;
        recordPerformanceMeasurement({
          name: metricName,
          module: moduleFromPath(currentRoute),
          value: Math.max(0, performance.now() - startedAt),
          unit: 'ms',
          error: !response.ok,
          route: currentRoute,
        });
        return response;
      } catch (error) {
        const currentRoute = window.location.pathname;
        recordPerformanceMeasurement({
          name: metricName,
          module: moduleFromPath(currentRoute),
          value: Math.max(0, performance.now() - startedAt),
          unit: 'ms',
          error: !(error instanceof DOMException && error.name === 'AbortError'),
          route: currentRoute,
        });
        throw error;
      }
    };
    window.fetch = instrumentedFetch;

    const observers: PerformanceObserver[] = [];
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const resourceObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as PerformanceResourceTiming[]) {
            const resourceName = logicalResourceName(entry.name);
            if (!resourceName || entry.duration <= 0) continue;
            const currentRoute = window.location.pathname;
            recordPerformanceMeasurement({ name: resourceName, module: moduleFromPath(currentRoute), value: entry.duration, unit: 'ms', route: currentRoute });
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
            recordPerformanceMeasurement({ name: 'long_task', module: moduleFromPath(currentRoute), value: entry.duration, unit: 'ms', route: currentRoute });
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
      if (window.fetch === instrumentedFetch) window.fetch = nativeFetch;
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
