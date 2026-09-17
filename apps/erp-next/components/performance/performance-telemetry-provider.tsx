'use client';

import { usePathname } from 'next/navigation';
import { Component, useEffect, useRef, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { moduleFromPath, startPerformanceSession } from '@/lib/performance-telemetry';
import type { PerformanceMeasurement } from '@/lib/performance-types';
import { installPerformanceObservers } from '@/lib/performance-observers';

// The boundary contains ONLY the sensor, never the operational ERP children.
class SensorBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state = { failed:false };
  static getDerivedStateFromError() { return { failed:true }; }
  render() { return this.state.failed ? null : this.props.children; }
}
function PerformanceSensor() {
  const pathname = usePathname();
  const { mode,status,principal } = useAuth();
  const activeRef = useRef<ReturnType<typeof startPerformanceSession>|null>(null);
  useEffect(() => {
    if (mode !== 'firebase' || status !== 'ready' || !principal.active) return;
    const session = startPerformanceSession(principal.userId);
    activeRef.current = session;
    const safeRecord = (input:PerformanceMeasurement) => { try { session.record(input); } catch { /* optional */ } };
    let cleanupObservers = () => {};
    try { cleanupObservers = installPerformanceObservers(window,safeRecord,session.canCollect); } catch { /* The ERP still renders. */ }
    const sample = () => {
      if (document.visibilityState === 'visible') safeRecord({name:'session_heartbeat',module:moduleFromPath(window.location.pathname),value:1,unit:'count'});
    };
    const tick = async () => { try { await session.checkPolicy(); sample(); await session.flush(); } catch { /* No unhandled telemetry rejection. */ } };
    void tick();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void tick(); },60000);
    const visibility = () => { if (document.visibilityState === 'hidden') void session.flush(); else void tick(); };
    const pagehide = () => { void session.flush(); };
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('pagehide',pagehide);
    return () => {
      try { cleanupObservers(); } catch { /* cleanup is best effort */ }
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange',visibility); window.removeEventListener('pagehide',pagehide);
      session.stop(); if (activeRef.current === session) activeRef.current = null;
    };
  }, [mode,status,principal.active,principal.userId]);
  useEffect(() => {
    try { activeRef.current?.record({name:'route_view',module:moduleFromPath(pathname || '/'),value:1,unit:'count'}); } catch { /* optional */ }
  }, [pathname,mode,status,principal.userId]);
  return null;
}
export function PerformanceTelemetryProvider({children}:Readonly<{children:ReactNode}>) {
  return <><SensorBoundary><PerformanceSensor/></SensorBoundary>{children}</>;
}
