import type { Metadata } from 'next';
import { AccessibilityTextProvider } from '@/components/accessibility/text-size-provider';
import { AuthGate } from '@/components/auth/auth-gate';
import { CommunicationCenterLauncher } from '@/components/communications/communication-center-launcher';
import { DemoDataGate } from '@/components/demo/demo-data-gate';
import { ErpShell } from '@/components/erp-shell';
import '../mobile-shell-fixes.css';

export const metadata: Metadata = {
  title: 'ERP',
  robots: { index: false, follow: false, nocache: true },
};

export default function ErpLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AuthGate><AccessibilityTextProvider><CommunicationCenterLauncher /><ErpShell><DemoDataGate>{children}</DemoDataGate></ErpShell></AccessibilityTextProvider></AuthGate>;
}
