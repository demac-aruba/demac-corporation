import type { Metadata } from 'next';
import { AccessibilityTextProvider } from '@/components/accessibility/text-size-provider';
import { AuthGate } from '@/components/auth/auth-gate';
import { ErpShell } from '@/components/erp-shell';
import { PerformanceTelemetryProvider } from '@/components/performance/performance-telemetry-provider';
import '../mobile-shell-fixes.css';
import { MessagingMonitorProvider } from '@/components/communications/messaging-monitor-provider';

export const metadata: Metadata = {
  title: 'ERP',
  robots: { index: false, follow: false, nocache: true },
};

export default function ErpLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGate>
      <PerformanceTelemetryProvider>
        <MessagingMonitorProvider><AccessibilityTextProvider><ErpShell>{children}</ErpShell></AccessibilityTextProvider></MessagingMonitorProvider>
      </PerformanceTelemetryProvider>
    </AuthGate>
  );
}
