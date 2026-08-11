import type { Metadata } from 'next';
import { AccessibilityTextProvider } from '@/components/accessibility/text-size-provider';
import { AuthGate } from '@/components/auth/auth-gate';
import { DemoDataGate } from '@/components/demo/demo-data-gate';
import { ErpShell } from '@/components/erp-shell';

export const metadata: Metadata = {
  title: 'ERP',
  robots: { index: false, follow: false, nocache: true },
};

export default function ErpLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AuthGate><AccessibilityTextProvider><ErpShell><DemoDataGate>{children}</DemoDataGate></ErpShell></AccessibilityTextProvider></AuthGate>;
}
